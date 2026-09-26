// El puesto de Control de acceso. De aquí salen dos aplicaciones con el mismo
// código, igual que gestión y desarrollador: la de quien hace el turno en la
// garita, que apunta su parte, y la de quien lleva el puesto, que los ve
// todos, los corrige y los borra. Lo único que las distingue es la etiqueta
// app-rol del index, que el montaje del APK cambia.

// En la web las dos son la misma dirección, y la del puesto se distingue por
// ?app=gestion-control —o, al volver de Google, por el paquete que va en
// state—. Tiene que ir lo primero: todo lo de abajo lee la etiqueta app-rol.
(function rolEnLaWeb() {
    try {
        if (window.Capacitor?.isNativePlatform?.()) return;
        const q = new URLSearchParams(window.location.search);
        const gc = q.get('app') === 'gestion-control'
            || /(^|:)com\.guillermorc\.gcontrolemt$/.test(q.get('state') || '');
        if (!gc) return;
        document.querySelector('meta[name="app-rol"]')?.setAttribute('content', 'gestion-control');
        // Al instalarla desde el navegador tiene que abrir esta y no la de la garita
        document.querySelector('link[rel="manifest"]')?.setAttribute('href', 'manifest-gc.json');
        document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', 'icons/icon-gc-192.png');
    } catch (_) {}
})();

// En la web las tres webs se sirven del mismo dominio, y localStorage va por
// origen y no por ruta: sin esto se pisarían la sesión unas con otras. En el
// móvil cada APK tiene su propio almacenamiento y no hace falta.
(function aislarAlmacenamiento() {
    try {
        if (window.Capacitor?.isNativePlatform?.()) return;
        const real = window.localStorage;
        const P = (document.querySelector('meta[name="app-rol"]')?.content || 'control').trim() + ':';
        const mios = () => Object.keys(real).filter(k => k.startsWith(P));
        const shim = {
            getItem:    k => real.getItem(P + k),
            setItem:    (k, v) => real.setItem(P + k, v),
            removeItem: k => real.removeItem(P + k),
            clear:      () => mios().forEach(k => real.removeItem(k)),
            key:        i => mios()[i]?.slice(P.length) ?? null,
            get length() { return mios().length; },
        };
        Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
    } catch (_) { /* si el navegador no deja, se sigue con el de siempre */ }
})();

'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
// Se piden los permisos justos: quién eres y, para la copia de seguridad, los
// archivos que la propia app crea en tu Drive —como en la de conductores—.
// Con cualquiera de los que Google llama sensibles saldría el aviso de
// aplicación no verificada, y éste no lo es.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_SCOPE = 'profile email ' + DRIVE_SCOPE;

const ROL_APP  = (document.querySelector('meta[name="app-rol"]')?.content || 'control').trim();
// La de quien lleva el puesto. La otra es la de quien hace el turno.
const ES_GC    = ROL_APP === 'gestion-control';

const SUPER_USER_EMAIL = 'g.rioscorrea@gmail.com';
const BASE_URL   = 'https://emt-palma-movilidad.vercel.app';
const API_BASE   = BASE_URL + '/api/';
// A dónde devuelve Google la entrada hecha desde la aplicación. Esta dirección
// exacta tiene que estar dada de alta en la consola de Google; de ahí que esté
// aquí sola y no repetida por el fichero.
const RETORNO_APP  = BASE_URL + '/';
const PARTES_URL   = API_BASE + 'partes';
const VERSION_URL  = API_BASE + 'version';
const ALLOWLIST_URL = API_BASE + 'allowlist';

const ALLOWLIST_APP   = ES_GC ? 'gestion-control' : 'control';
const ANDROID_PACKAGE = ES_GC ? 'com.guillermorc.gcontrolemt' : 'com.guillermorc.controlemt';
const RELEASE_PREFIX  = ES_GC ? 'gcontrol-build-' : 'control-build-';
// Cada aplicación lleva su propio número de versión publicada
const VERSION_KEY     = ES_GC ? 'gestionControl' : 'control';

const NOMBRE_APP = ES_GC ? 'Gestión control de acceso EMT - Movilidad'
                         : 'Control de acceso EMT - Movilidad';

const TURNOS = [
    { id: 'M', nombre: 'Mañana', desde: '05:00', hasta: '14:00' },
    { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '20:00' },
    { id: 'N', nombre: 'Noche',  desde: '20:00', hasta: '05:00' },
];
const TIPOS = {
    entrada:    '🟢 Entrada',
    salida:     '🔴 Salida',
    visita:     '👤 Visita',
    incidencia: '⚠️ Incidencia',
    llaves:     '🔑 Llaves',
    otro:       '· Otro',
};
// Por orden de reloj, que es como se leen. Por la letra salían M, N, T, con la
// noche antes de la tarde.
const ORDEN_TURNO = { M: 0, T: 1, N: 2 };

const AVATAR_EMOJIS = ['🚌','⭐','🔥','⚡','🌊','🎯','🚀','🦸','🎨','🌈'];
const AVATAR_BG     = ['#667eea','#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e67e22','#764ba2','#e91e63'];
const TEMAS         = ['azul', 'verde', 'fuego', 'acero', 'rojo'];
// La copia va a la misma carpeta de Drive que la de conductores
const CARPETA_DRIVE = 'Movilidad Emt';
const FICHERO_COPIA = (ES_GC ? 'Gestión control de acceso' : 'Control de acceso') + ' - copia de seguridad.json';

const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const app = {
    accessToken: localStorage.getItem('cAccessToken') || null,
    tokenExpiry: parseInt(localStorage.getItem('cTokenExpiry') || '0'),
    refreshToken: localStorage.getItem('cRefreshToken') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    tema: localStorage.getItem('tema') || '',
    notifSound: localStorage.getItem('notifSound') || 'default',
    backupFreq: localStorage.getItem('backupFreq') || 'dia',
    _copiando: false,
    modalCallback: null,
    _partes: null,
    _parte: null,          // el que se está escribiendo o corrigiendo
    _tab: 0,
    _toastTimer: null,
    _tokenRefreshTimer: null,
    _updateApkUrl: null,

    // ── Arranque ─────────────────────────────────────────────────────────────

    init() {
        this._pintarIdentidad();
        this._aplicarTema(this.tema);
        this._instalarFirmaApi();
        this._buildAvatarGrid();
        this._prepararCopiaAutomatica();
        // La comprobación de versión va aparte y con retraso: si algo de arriba
        // falla, quien la tenga instalada no puede quedarse clavado para
        // siempre en una versión vieja por culpa de eso.
        setTimeout(() => { try { this._checkForUpdates(); } catch (_) {} }, 1500);
        // Y cada vez que se vuelve a la app, aunque solo estuviera en segundo
        // plano, como en la de conductores. La espera corta es para que entrar
        // y salir seguido no gaste las 60 consultas por hora de GitHub.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            const ultima = parseInt(sessionStorage.getItem('lastUpdateCheck') || '0', 10);
            if (Date.now() - ultima > 90 * 1000) { try { this._checkForUpdates(); } catch (_) {} }
            // Y lo que le toca hoy, por si gestión le ha cambiado el sitio
            if (this.usuarioActual && !ES_GC) this._cargarAsignacion();
        });
        if (this.darkMode) document.body.classList.add('dark');
        this._pintarTurnos();
        this._setupDeepLinkListener();
        window.addEventListener('popstate', () => {
            if (history.state?.pantalla !== 'opciones'
                    && document.getElementById('optionsScreen')?.classList.contains('active')) this.mostrarApp();
        });
        this._initGoogleAuth();
        this._pintarVersion();
    },

    // Las dos son el mismo código, así que hay que decir cuál es antes de que
    // se vea nada: en la entrada, en la cabecera y en el logotipo, con la
    // misma chapita que lleva el icono del móvil.
    _pintarIdentidad() {
        if (ES_GC) document.body.classList.add('rol-gc');
        const poner = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        document.title = NOMBRE_APP;
        if (ES_GC) {
            poner('authTitulo', NOMBRE_APP);
            poner('authSub', 'Los partes del puesto · EMT Palma');
            poner('splashRol', '🗝️ Gestión del puesto');
            poner('cabeceraTitulo', '🗝️ Gestión control de acceso');
            poner('tabLblPartes', 'Todos los partes');
            const logo = document.getElementById('authLogo');
            if (logo) logo.src = 'icons/icon-gc-192.png';
            const modoLogo = document.getElementById('modoLogo');
            if (modoLogo) modoLogo.src = 'icons/icon-gc-192.png';
            poner('modoTit', NOMBRE_APP);
            const f = document.getElementById('paFiltros');
            if (f) f.style.display = '';
            const d = document.getElementById('pDuenoBox');
            if (d) d.style.display = '';
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && ES_GC) meta.content = '#7B241C';
    },

    // ── Entrada con Google ───────────────────────────────────────────────────

    // La dirección sin lo que ha dejado Google, pero con ?app= si es la del
    // puesto: si no, al recargar se abriría la de la garita.
    _direccionLimpia() {
        const nativo = window.Capacitor?.isNativePlatform?.();
        return window.location.pathname + (ES_GC && !nativo ? '?app=gestion-control' : '');
    },

    _initGoogleAuth() {
        const hash   = window.location.hash.length > 1   ? new URLSearchParams(window.location.hash.slice(1)) : null;
        const query  = window.location.search.length > 1 ? new URLSearchParams(window.location.search.slice(1)) : null;
        const code   = query?.get('code');
        const error  = hash?.get('error') || query?.get('error');

        if (code) {
            history.replaceState(null, '', this._direccionLimpia());
            this._exchangeCode(code);
            return;
        }
        if (error) {
            history.replaceState(null, '', this._direccionLimpia());
            this.mostrarAuth();
            this.mostrarMensaje('Error de Google: ' + error, 'error');
            return;
        }
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            this._loadUserAndStart();
            return;
        }
        // Si ya había sesión se renueva por detrás y no se enseña la pantalla de
        // entrar: en la garita se abre la app para apuntar algo, no para entrar.
        const habia = !!localStorage.getItem('cUserEmail');
        if (habia && !sessionStorage.getItem('reauthIntentado')) {
            sessionStorage.setItem('reauthIntentado', '1');
            document.getElementById('authScreen')?.classList.add('hidden');
            this._silentReauth();
        } else {
            sessionStorage.removeItem('reauthIntentado');
            this.mostrarAuth();
        }
    },

    _setupDeepLinkListener() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        try {
            window.Capacitor.Plugins.App?.addListener('appUrlOpen', d => this._processOAuthUrl(d?.url));
            window.Capacitor.Plugins.App?.addListener('backButton', () => {
                if (!this.atras()) window.Capacitor.Plugins.App?.minimizeApp?.();
            });
        } catch (_) {}
    },

    // Atrás cierra lo que haya abierto, y solo cierra la app cuando no queda
    // nada: ni un cuadro ni las opciones.
    atras() {
        const abiertos = [...document.querySelectorAll('.modal.show')];
        if (abiertos.length) { abiertos.pop().classList.remove('show'); return true; }
        if (document.getElementById('optionsScreen')?.classList.contains('active')) {
            if (!this._enLaApp() && history.state?.pantalla === 'opciones') history.back();
            else this.mostrarApp();
            return true;
        }
        if (this._tab !== 0) { this.irA(0); return true; }
        return false;
    },

    _processOAuthUrl(url) {
        if (!url) return;
        try {
            const u = new URL(url);
            if (u.searchParams.get('silent_failed') === '1') {
                sessionStorage.removeItem('reauthIntentado');
                this.mostrarAuth();
                return;
            }
            const code = u.searchParams.get('code');
            if (code) {
                sessionStorage.removeItem('reauthIntentado');
                this._exchangeCode(code);
            }
        } catch (_) {}
    },

    _generateVerifier() {
        const a = new Uint8Array(32);
        crypto.getRandomValues(a);
        return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async _deriveChallenge(verifier) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    // Dentro de la aplicación la página se sirve desde localhost, y ahí Google
    // no puede devolver a nadie: vale la dirección de retorno, que es la que
    // está dada de alta.
    _redirectUri() {
        const nativo = !!(window.Capacitor?.isNativePlatform?.());
        const enLocal = /^https?:\/\/localhost(:|$)/.test(window.location.origin);
        return (nativo || enLocal) ? RETORNO_APP : window.location.origin + '/';
    },

    async login(silent = false) {
        const nativo = !!(window.Capacitor?.isNativePlatform?.());
        const email = this.usuarioActual?.email || localStorage.getItem('cUserEmail') || '';
        const verifier = this._generateVerifier();
        localStorage.setItem('pkceVerifier', verifier);
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: this._redirectUri(),
            response_type: 'code',
            scope: AUTH_SCOPE,
            code_challenge: await this._deriveChallenge(verifier),
            code_challenge_method: 'S256',
            access_type: 'offline',
            // A qué app hay que volver, y si hay que volver a alguna: desde el
            // navegador se entra ahí mismo, que la app puede no estar puesta.
            state: (nativo ? 'app:' : 'web:') + ANDROID_PACKAGE,
            // Sin select_account, y con el correo de la última sesión de pista,
            // Google entraba con esa cuenta sin preguntar y quien quería
            // cambiar de correo en el mismo móvil no podía. La pista solo vale
            // para renovar por detrás, que ahí sí se sabe de quién es.
            prompt: silent ? 'none' : 'select_account consent',
            ...(silent && email ? { login_hint: email } : {}),
        });
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
        if (nativo && window.AndroidBridge?.performOAuthInWebView
                && !sessionStorage.getItem('oauthWebViewFailed')) {
            window.AndroidBridge.performOAuthInWebView(url, silent);
        } else {
            window.location.assign(url);
        }
    },

    async _exchangeCode(code, isSilent = false) {
        const verifier = localStorage.getItem('pkceVerifier');
        localStorage.removeItem('pkceVerifier');
        if (!verifier) { this.mostrarAuth(); return; }
        try {
            const resp = await fetch(API_BASE + 'auth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: this._redirectUri() }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                sessionStorage.removeItem('reauthIntentado');
                this.mostrarAuth();
                if (!isSilent) this.mostrarMensaje('No se ha podido entrar: ' + (err.error || resp.status), 'error');
                return;
            }
            sessionStorage.removeItem('reauthIntentado');
            sessionStorage.removeItem('oauthWebViewFailed');
            this._saveToken(await resp.json());
            this._loadUserAndStart();
        } catch (e) {
            sessionStorage.removeItem('reauthIntentado');
            this.mostrarAuth();
            if (!isSilent) this.mostrarMensaje('Error de red: ' + e.message, 'error');
        }
    },

    async _silentReauth() {
        if (this.refreshToken) {
            try {
                const resp = await fetch(API_BASE + 'auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: this.refreshToken }),
                });
                if (resp.ok) {
                    this._saveToken(await resp.json());
                    if (!this.usuarioActual) this._loadUserAndStart();
                    return;
                }
                // Caducado o revocado: se tira y se entra a mano
                this.refreshToken = null;
                localStorage.removeItem('cRefreshToken');
            } catch (_) {}
        }
        if (!window.Capacitor?.isNativePlatform?.()) { this.mostrarAuth(); return; }
        this.login(true);
    },

    // Los llama Java cuando vuelve de la pestaña del navegador
    _onOAuthCode(code, isSilent = false) {
        if (!code) {
            if (!isSilent) sessionStorage.setItem('oauthWebViewFailed', '1');
            sessionStorage.removeItem('reauthIntentado');
            if (isSilent && window.Capacitor?.isNativePlatform?.()
                    && !sessionStorage.getItem('autoLoginIntentado')) {
                sessionStorage.setItem('autoLoginIntentado', '1');
                const m = document.getElementById('splashMsg');
                if (m) m.textContent = 'Conectando con Google...';
                this.login(false);
                return;
            }
            sessionStorage.removeItem('autoLoginIntentado');
            this.mostrarAuth();
            return;
        }
        sessionStorage.removeItem('autoLoginIntentado');
        sessionStorage.removeItem('oauthWebViewFailed');
        this._exchangeCode(code, isSilent);
    },

    _saveToken(r) {
        this.accessToken = r.access_token;
        this.tokenExpiry = Date.now() + (parseInt(r.expires_in) - 60) * 1000;
        localStorage.setItem('cAccessToken', this.accessToken);
        localStorage.setItem('cTokenExpiry', String(this.tokenExpiry));
        if (r.refresh_token) {
            this.refreshToken = r.refresh_token;
            localStorage.setItem('cRefreshToken', this.refreshToken);
        }
        clearTimeout(this._tokenRefreshTimer);
        const ms = this.tokenExpiry - Date.now() - 2 * 60 * 1000;
        if (ms <= 0) this._silentReauth();
        else this._tokenRefreshTimer = setTimeout(() => this._silentReauth(), ms);
    },

    _olvidarSesion() {
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.refreshToken = null;
        ['cAccessToken', 'cTokenExpiry', 'cRefreshToken']
            .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    },

    // Todo lo que va a nuestra API va firmado con el token de Google, y el
    // servidor saca de ahí quién eres en vez de creerse una cabecera. Se
    // engancha en fetch, en un único sitio, para que no se pueda olvidar en
    // ninguna llamada nueva. También las lecturas: el parte no lo lee nadie
    // sin decir quién es.
    _instalarFirmaApi() {
        if (this._fetchOriginal) return;
        this._fetchOriginal = window.fetch.bind(window);
        const yo = this;
        window.fetch = async function (recurso, opciones) {
            const url = typeof recurso === 'string' ? recurso : recurso?.url || '';
            if (!url.startsWith(API_BASE) || url.startsWith(API_BASE + 'auth/')) {
                return yo._fetchOriginal(recurso, opciones);
            }
            const op = { ...(opciones || {}) };
            const metodo = (op.method || 'GET').toUpperCase();
            if (metodo !== 'OPTIONS') {
                // Caducado se renueva antes: mandarlo vencido sería un 401.
                if (yo.accessToken && Date.now() >= yo.tokenExpiry) {
                    try { await yo._silentReauth(); } catch (_) {}
                }
                // Las cabeceras pueden venir como objeto o como Headers, y
                // esparcir un Headers da {} y se perdería el Content-Type.
                const h = new Headers(op.headers || {});
                if (yo.accessToken) h.set('Authorization', `Bearer ${yo.accessToken}`);
                op.headers = h;
            }
            return yo._fetchOriginal(recurso, op);
        };
    },

    async _loadUserAndStart() {
        try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            });
            if (!resp.ok) {
                this.mostrarAuth();
                this.mostrarMensaje('No se ha podido leer el perfil (' + resp.status + ')', 'error');
                return;
            }
            this.usuarioActual = await resp.json();
            const antes = localStorage.getItem('cUserEmail');
            if (antes && antes.toLowerCase() !== this.usuarioActual.email.toLowerCase()) {
                // Otro correo en el mismo móvil es otra persona: lo que dejó
                // aquí el anterior no puede quedarse a la vista.
                ['partesCache', 'parteNombre', 'parteConductor'].forEach(k => localStorage.removeItem(k));
                this._partes = null;
            }
            localStorage.setItem('cUserEmail', this.usuarioActual.email);

            if (!await this._tieneAcceso(this.usuarioActual.email)) {
                const conQue = this.usuarioActual.email;
                this.mostrarAuth();
                this.mostrarMensaje(`❌ Has entrado con ${conQue}, y esa cuenta no está autorizada `
                    + `en ${NOMBRE_APP}. Pídeselo al desarrollador.`, 'error');
                // Y que la próxima vez vuelva a preguntar la cuenta: si se
                // queda la sesión guardada, al abrir entra sola otra vez con
                // la que no vale y se queda a medias sin decir por qué.
                this._olvidarSesion();
                localStorage.removeItem('cUserEmail');
                return;
            }
            this.mostrarApp();
            this._pintarQuien();
            this._actualizarBotonPerfil();
            if (!ES_GC) { this._registrarEnPlantilla(); this._cargarAsignacion(); }
            this._nuevoParteDeHoy();
            this.cargarPartes();
            // Ya está dentro: en el navegador se le pregunta si se descarga
            // la aplicación o sigue aquí, como en las de conductores y gestión.
            this._preguntarModoSiToca();
            this._crearCanalesNotificacion();
            // Por si tocaba una copia mientras estaba cerrada
            setTimeout(() => this._copiaSiToca(), 20000);
        } catch (e) {
            this.mostrarAuth();
            this.mostrarMensaje('Error de red: ' + e.message, 'error');
        }
    },

    // La lista de quién puede entrar la lleva el desarrollador desde su app.
    // Sin red vale la última que se leyó: en la garita el móvil no siempre
    // tiene cobertura y el parte hay que poder escribirlo igual.
    async _tieneAcceso(email) {
        const yo = String(email || '').toLowerCase();
        if (yo === SUPER_USER_EMAIL) return true;
        try {
            const r = await fetch(`${ALLOWLIST_URL}?app=${ALLOWLIST_APP}`, { cache: 'no-store' });
            if (r.ok) {
                const lista = (await r.json()).map(e => String(e).toLowerCase().trim());
                localStorage.setItem('listaAcceso', JSON.stringify(lista));
                return lista.includes(yo);
            }
        } catch (_) { /* se prueba con la última que se leyó */ }
        try {
            const guardada = JSON.parse(localStorage.getItem('listaAcceso') || 'null');
            if (Array.isArray(guardada)) return guardada.includes(yo);
        } catch (_) {}
        return false;
    },

    confirmarCerrarSesion() {
        this.mostrarModal('Cerrar sesión', '¿Salir de la aplicación? Habrá que volver a entrar con Google.', () => {
            if (this.accessToken) {
                this._fetchOriginal('https://oauth2.googleapis.com/revoke?token=' + this.accessToken,
                    { method: 'POST' }).catch(() => {});
            }
            this.usuarioActual = null;
            this._olvidarSesion();
            // Se va todo: el móvil puede pasar a otras manos, y salir tiene que
            // dejarlo como estaba antes de entrar.
            try { localStorage.clear(); } catch (_) {}
            try { sessionStorage.clear(); } catch (_) {}
            window.location.reload();
        });
    },

    // ── Pantallas ────────────────────────────────────────────────────────────

    _hideSplash() {
        const el = document.getElementById('splashScreen');
        if (!el) return;
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 380);
    },

    mostrarAuth() {
        this._hideSplash();
        document.getElementById('authScreen').classList.remove('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.remove('active');
    },

    mostrarApp() {
        this._hideSplash();
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.add('active');
        document.getElementById('optionsScreen').classList.remove('active');
    },

    mostrarOpciones() {
        // En el navegador las opciones dejan su paso en el historial, para
        // que atrás vuelva a la pantalla principal y no se salga de la página
        if (!this._enLaApp() && history.state?.pantalla !== 'opciones') {
            try { history.pushState({ pantalla: 'opciones' }, '', window.location.href); } catch (_) {}
        }
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        const q = document.getElementById('opsQuien');
        if (q) q.textContent = this.usuarioActual?.email || '';
        const poner = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        poner('perfilNombre', this.usuarioActual?.name || '');
        poner('perfilEmail', this.usuarioActual?.email || '');
        const cond = document.getElementById('opsConductor');
        if (cond) cond.hidden = ES_GC;
        this._actualizarConductorDisplay();
        const son = document.getElementById('notifSoundSelect');
        if (son) son.value = this.notifSound;
        document.querySelectorAll('input[name="backupFreq"]').forEach(r => { r.checked = r.value === this.backupFreq; });
        if (ES_GC) {
            const que = document.getElementById('backupQue');
            if (que) que.innerHTML = 'Se guardan en tu Google Drive, en <b>Movilidad Emt</b>, los partes de todos y tus ajustes.';
        }
        this._actualizarTemaUI();
        this._actualizarAvatarPreview();
        this._pintarUltimaCopia();
        this._pintarVersion();
    },

    mostrarMensaje(msg, tipo) {
        const el = document.getElementById('auth' + (tipo === 'error' ? 'Error' : 'Success'));
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        // Los avisos de cuenta no autorizada hay que poder leerlos con calma
        setTimeout(() => el.classList.remove('show'), tipo === 'error' ? 12000 : 5000);
    },

    _mostrarToast(msg, ms = 3000) {
        let t = document.getElementById('appToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'appToast';
            t.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);'
                + 'background:rgba(24,24,28,0.94);color:#fff;padding:11px 20px;border-radius:24px;'
                + 'font-size:13px;font-weight:600;z-index:9999;max-width:85vw;text-align:center;'
                + 'box-shadow:0 4px 16px rgba(0,0,0,0.25);';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.display = 'block';
        t.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            t.style.opacity = '0';
            setTimeout(() => { t.style.display = 'none'; }, 300);
        }, ms);
    },

    mostrarModal(titulo, mensaje, callback) {
        document.getElementById('modalTitle').textContent = titulo;
        document.getElementById('modalMessage').textContent = mensaje;
        document.getElementById('modal').classList.add('show');
        this.modalCallback = callback;
    },
    cerrarModal() { document.getElementById('modal').classList.remove('show'); this.modalCallback = null; },
    async confirmarModal() { if (this.modalCallback) await this.modalCallback(); this.cerrarModal(); },

    toggleDarkMode() {
        this.darkMode = document.getElementById('darkModeToggle').checked;
        localStorage.setItem('darkMode', String(this.darkMode));
        document.body.classList.toggle('dark', this.darkMode);
    },

    // ── Perfil ───────────────────────────────────────────────────────────────

    // Lo que se ve en el botón de arriba a la derecha y en Opciones: la foto
    // o el avatar elegidos, y si no, la foto de la cuenta de Google.
    _pintarAvatar(el, grande) {
        if (!el) return;
        const photo = localStorage.getItem('avatarPhoto') || '';
        const emoji = localStorage.getItem('avatarEmoji');
        const google = this.usuarioActual?.picture || '';
        el.style.background = '';
        el.style.fontSize = '';
        if (photo || (!emoji && google)) {
            const img = document.createElement('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.src = photo || google;
            // Si la foto no carga se queda la inicial, no un hueco
            img.onerror = () => { localStorage.removeItem('avatarPhoto'); this._pintarInicial(el, grande); };
            el.replaceChildren(img);
            el.style.background = 'transparent';
        } else if (emoji) {
            el.textContent = emoji;
            el.style.background = localStorage.getItem('avatarBg') || '#1565C0';
            el.style.fontSize = grande ? '26px' : '20px';
        } else {
            this._pintarInicial(el, grande);
        }
    },

    _pintarInicial(el, grande) {
        const email = this.usuarioActual?.email || '';
        const nombre = this.usuarioActual?.name || email || '?';
        const paleta = ['#667eea','#764ba2','#e74c3c','#27ae60','#f39c12','#3498db'];
        el.textContent = nombre.charAt(0).toUpperCase();
        el.style.background = paleta[(email.charCodeAt(0) || 0) % paleta.length];
        el.style.fontSize = grande ? '24px' : '16px';
    },

    _actualizarBotonPerfil()   { this._pintarAvatar(document.getElementById('profileBtn'), false); },
    _actualizarAvatarPreview() { this._pintarAvatar(document.getElementById('profileAvatarPreview'), true); },

    _buildAvatarGrid() {
        const grid = document.getElementById('avatarGrid');
        if (!grid) return;
        grid.innerHTML = '';
        AVATAR_EMOJIS.forEach((emoji, i) => {
            const b = document.createElement('button');
            b.className = 'avatar-option';
            b.textContent = emoji;
            b.style.background = AVATAR_BG[i];
            b.addEventListener('click', () => this._elegirAvatar({ emoji, bg: AVATAR_BG[i] }));
            grid.appendChild(b);
        });
    },

    mostrarAvatarPicker() {
        const g = document.getElementById('googlePhotoBtn');
        if (g) g.style.display = this.usuarioActual?.picture ? '' : 'none';
        document.getElementById('avatarPickerModal').classList.add('show');
    },
    cerrarAvatarPicker() { document.getElementById('avatarPickerModal').classList.remove('show'); },

    _elegirAvatar({ emoji, bg, photo }) {
        ['avatarEmoji', 'avatarBg', 'avatarPhoto'].forEach(k => localStorage.removeItem(k));
        if (photo) localStorage.setItem('avatarPhoto', photo);
        if (emoji) { localStorage.setItem('avatarEmoji', emoji); localStorage.setItem('avatarBg', bg); }
        this.cerrarAvatarPicker();
        this._actualizarBotonPerfil();
        this._actualizarAvatarPreview();
        this._registrarEnPlantilla();
    },

    usarFotoGoogle() {
        const url = this.usuarioActual?.picture;
        if (url) this._elegirAvatar({ photo: url.replace(/=s\d+(-c)?$/, '=s200-c') });
    },

    subirFotoPerfil() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const img = new Image();
                img.onload = () => {
                    // Pequeña: va en el almacenamiento del móvil y en la copia
                    const c = document.createElement('canvas');
                    c.width = 120; c.height = 120;
                    const lado = Math.min(img.width, img.height);
                    c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2,
                                                 lado, lado, 0, 0, 120, 120);
                    this._elegirAvatar({ photo: c.toDataURL('image/jpeg', 0.85) });
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    // El número de trabajador se apunta una vez aquí y sale en la cabecera y
    // solo en cada parte nuevo, igual que en la app de conductores.
    _normalizarConductor(v) {
        const digitos = String(v ?? '').replace(/\D/g, '');
        if (!String(v ?? '').trim()) return '';
        if (digitos.length !== 4 && digitos.length !== 5) return null;
        return digitos.slice(0, -1) + '-' + digitos.slice(-1);
    },

    mostrarCambiarConductor() {
        const v = prompt('Número de trabajador.\n\nPuedes escribirlo con o sin guión: 14183 o 1418-3, 2091 o 209-1',
            localStorage.getItem('parteConductor') || '');
        if (v === null) return;
        const n = this._normalizarConductor(v);
        if (n === null) {
            alert('❌ Formato incorrecto. Deben ser 4 o 5 dígitos.\nEjemplo: 209-1 o 1418-3');
            return;
        }
        localStorage.setItem('parteConductor', n);
        if (this._parte && !this._parte.id) {
            this._parte.conductor = n;
            const el = document.getElementById('pConductor');
            if (el) el.value = n;
        }
        this._actualizarConductorDisplay();
        this._pintarQuien();
        this._registrarEnPlantilla();
        this._cargarAsignacion();
    },

    _actualizarConductorDisplay() {
        const el = document.getElementById('conductorDisplay');
        if (el) el.textContent = [localStorage.getItem('parteConductor') || 'Sin asignar', this._lugarAsignado()]
            .filter(Boolean).join(' · ');
    },

    // El sitio no lo pone la app: es el que gestión de conductores le tiene
    // asignado para hoy, el mismo que ve en la app de conductores. Sin
    // asignar no sale nada.
    _lugarAsignado() {
        try {
            const a = JSON.parse(localStorage.getItem('asignacionHoy') || 'null');
            const hoy = this._aClave(this._hoyISO());
            return a && a.fecha === hoy && !(a.baja || a.vacaciones || a.libre) ? (a.lugar || '') : '';
        } catch (_) { return ''; }
    },

    // Quien hace el turno en la garita es un trabajador más: se da de alta en
    // la plantilla de gestión con su nombre y su número, igual que al abrir
    // la de conductores. Solo se manda cuando cambia algo.
    async _registrarEnPlantilla() {
        if (ES_GC || !this.usuarioActual?.email) return;
        const foto = localStorage.getItem('avatarPhoto') || '';
        const datos = {
            origen: 'control',
            nombre: this.usuarioActual.name || '',
            conductor: localStorage.getItem('parteConductor') || '',
            // Una foto subida puede pesar; la de Google es solo su dirección
            avatar: foto.length < 40000 ? foto || this.usuarioActual.picture || '' : '',
        };
        const huella = JSON.stringify([this.usuarioActual.email, datos.nombre, datos.conductor, datos.avatar,
                                       new Date().toISOString().slice(0, 10)]);
        if (localStorage.getItem('plantillaHuella') === huella) return;
        try {
            const r = await fetch(API_BASE + 'usuarios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });
            if (r.ok) localStorage.setItem('plantillaHuella', huella);
        } catch (_) { /* se vuelve a intentar la próxima vez que entre */ }
    },

    async _cargarAsignacion() {
        const email = this.usuarioActual?.email;
        if (!email) return;
        try {
            const r = await fetch(`${API_BASE}usuarios?mio=${encodeURIComponent(email)}`, { cache: 'no-store' });
            if (!r.ok) return;
            const a = await r.json();
            if (!a || !a.fecha) return;
            localStorage.setItem('asignacionHoy', JSON.stringify(a));
            this._pintarQuien();
            this._actualizarConductorDisplay();
        } catch (_) { /* sin red se queda lo último que se supo */ }
    },

    // ── Apariencia ───────────────────────────────────────────────────────────

    seleccionarTema(tema) {
        this.tema = TEMAS.includes(tema) ? tema : '';
        localStorage.setItem('tema', this.tema);
        this._aplicarTema(this.tema);
        this._actualizarTemaUI();
    },

    _aplicarTema(tema) {
        TEMAS.forEach(t => document.body.classList.remove('theme-' + t));
        if (TEMAS.includes(tema)) document.body.classList.add('theme-' + tema);
    },

    _actualizarTemaUI() {
        const propio = document.getElementById('dot-propio');
        if (propio) propio.style.background = ES_GC
            ? 'linear-gradient(135deg,#943126,#7B241C)' : 'linear-gradient(135deg,#1E8449,#186A3B)';
        ['propio', ...TEMAS].forEach(t => {
            const dot = document.getElementById('dot-' + t);
            if (dot) dot.classList.toggle('active', (t === 'propio' ? '' : t) === this.tema);
        });
    },

    // ── Notificaciones ───────────────────────────────────────────────────────

    guardarSonidoNotif(sonido) {
        this.notifSound = sonido || 'default';
        localStorage.setItem('notifSound', this.notifSound);
        this._crearCanalesNotificacion();
    },

    // Un canal por sonido: en Android el sonido va con el canal y no con cada
    // aviso. Los ficheros de sonido los mete el montaje del APK.
    _crearCanalesNotificacion() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.createChannel) return;
        [['notif_ding', 'Ding'], ['notif_campana', 'Campana'], ['notif_alerta', 'Alerta'],
         ['notif_silbido', 'Silbido'], ['notif_doble', 'Doble pitido'], ['notif_fanfare', 'Fanfare'],
         ['notif_suave', 'Suave']].forEach(([id, name]) => {
            LN.createChannel({ id, name, sound: id, importance: 5, visibility: 1 }).catch(() => {});
        });
    },

    async probarNotificacion() {
        const titulo = '🔔 ' + NOMBRE_APP + ' — prueba';
        const texto = 'Las notificaciones funcionan correctamente.';
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                const perm = await LN.requestPermissions();
                if (perm?.display && perm.display !== 'granted') {
                    alert('❌ Las notificaciones están desactivadas para esta aplicación. Actívalas en los ajustes del móvil.');
                    return;
                }
                const aviso = { id: 9999, title: titulo, body: texto };
                if (this.notifSound !== 'default') {
                    aviso.sound = this.notifSound;
                    aviso.channelId = this.notifSound;
                }
                await LN.schedule({ notifications: [aviso] });
            } catch (e) {
                alert('❌ Error al enviar la notificación: ' + e.message);
            }
            return;
        }
        if (!('Notification' in window)) { alert('❌ Tu navegador no admite notificaciones'); return; }
        if (Notification.permission === 'default' && await Notification.requestPermission() !== 'granted') {
            alert('❌ Permiso de notificación denegado');
            return;
        }
        if (Notification.permission === 'denied') {
            alert('❌ Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.');
            return;
        }
        const icono = ES_GC ? 'icons/icon-gc-192.png' : 'icons/icon-192.png';
        try {
            const reg = await navigator.serviceWorker?.getRegistration?.();
            if (reg) { await reg.showNotification(titulo, { body: texto, icon: icono, tag: 'prueba' }); return; }
        } catch (_) { /* sin trabajador de servicio se hace con la de siempre */ }
        new Notification(titulo, { body: texto, icon: icono });
    },

    // ── Copia de seguridad en Google Drive ───────────────────────────────────
    //
    // Lo que hay en el servidor son los partes; aquí se guarda una copia de
    // ellos —los suyos, o los de todos en la del puesto— y de los ajustes de
    // este móvil, en la misma carpeta de Drive que usa la de conductores.

    _getAjustes() {
        const g = k => localStorage.getItem(k);
        return {
            darkMode: this.darkMode, tema: this.tema, notifSound: this.notifSound,
            backupFreq: this.backupFreq,
            avatarEmoji: g('avatarEmoji'), avatarBg: g('avatarBg'), avatarPhoto: g('avatarPhoto'),
            parteNombre: g('parteNombre'), parteConductor: g('parteConductor'),
        };
    },

    _aplicarAjustes(a) {
        if (!a || typeof a !== 'object') return;
        const poner = (k, v) => { if (v === null || v === undefined || v === '') localStorage.removeItem(k); else localStorage.setItem(k, String(v)); };
        ['avatarEmoji', 'avatarBg', 'avatarPhoto', 'parteNombre', 'parteConductor'].forEach(k => poner(k, a[k]));
        if (typeof a.darkMode === 'boolean') {
            this.darkMode = a.darkMode;
            localStorage.setItem('darkMode', String(a.darkMode));
            document.body.classList.toggle('dark', a.darkMode);
        }
        this.seleccionarTema(a.tema || '');
        if (a.notifSound) this.guardarSonidoNotif(a.notifSound);
        if (['hora', 'dia', 'cerrar'].includes(a.backupFreq)) this.guardarFrecuenciaCopia(a.backupFreq, true);
        this._actualizarBotonPerfil();
        this._pintarQuien();
    },

    // Los partes, recién leídos del servidor. Sin poder leerlos no se hace
    // copia: una copia vacía machacaría la buena que hubiera.
    async _partesParaCopia() {
        const r = await fetch(PARTES_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error('No se han podido leer los partes (' + r.status + ')');
        const lista = await r.json();
        if (!Array.isArray(lista)) throw new Error('Respuesta rara del servidor');
        return lista;
    },

    async _contenidoCopia() {
        return {
            app: ROL_APP,
            nombreApp: NOMBRE_APP,
            version: typeof APP_VERSION === 'undefined' ? '' : APP_VERSION,
            fecha: new Date().toISOString(),
            email: this.usuarioActual?.email || '',
            ajustes: this._getAjustes(),
            partes: await this._partesParaCopia(),
        };
    },

    // Drive, con el token de la sesión. Un 401 es que ha caducado: se renueva
    // y se prueba otra vez. Un 403 casi siempre es que falta el permiso.
    async _drive(url, op = {}, reintento = true) {
        if (!this.accessToken) throw Object.assign(new Error('Sin sesión'), { sinPermiso: true });
        if (Date.now() >= this.tokenExpiry) { try { await this._silentReauth(); } catch (_) {} }
        const h = new Headers(op.headers || {});
        h.set('Authorization', 'Bearer ' + this.accessToken);
        const r = await this._fetchOriginal(url, { ...op, headers: h });
        if (r.status === 401 && reintento) {
            await this._silentReauth();
            return this._drive(url, op, false);
        }
        if (r.status === 403) throw Object.assign(new Error('Google Drive no da permiso'), { sinPermiso: true });
        if (!r.ok) throw new Error('Google Drive ' + r.status);
        return r;
    },

    async _buscarEnDrive(q) {
        const r = await this._drive('https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,modifiedTime)'
            + '&orderBy=modifiedTime desc&q=' + encodeURIComponent(q + ' and trashed=false'));
        return (await r.json()).files || [];
    },

    // Se busca cada vez en vez de guardar cuál es: si alguien la borra o la
    // mueve a la papelera, una guardada mandaría la copia a ninguna parte.
    async _carpetaDrive() {
        const nombre = CARPETA_DRIVE.replace(/'/g, "\\'");
        const ya = await this._buscarEnDrive(`name='${nombre}' and mimeType='application/vnd.google-apps.folder'`);
        let id = ya[0]?.id;
        if (!id) {
            const r = await this._drive('https://www.googleapis.com/drive/v3/files?fields=id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: CARPETA_DRIVE, mimeType: 'application/vnd.google-apps.folder' }),
            });
            id = (await r.json()).id;
        }
        return id;
    },

    async _ficheroCopia() {
        const carpeta = await this._carpetaDrive();
        const nombre = FICHERO_COPIA.replace(/'/g, "\\'");
        const ya = await this._buscarEnDrive(`name='${nombre}' and '${carpeta}' in parents`);
        return ya[0]?.id || null;
    },

    async _subirCopia(texto) {
        const id = await this._ficheroCopia();
        if (id) {
            await this._drive(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: texto,
            });
            return;
        }
        const carpeta = await this._carpetaDrive();
        const limite = 'copia' + Date.now();
        const cuerpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
            + JSON.stringify({ name: FICHERO_COPIA, parents: [carpeta], mimeType: 'application/json' })
            + `\r\n--${limite}\r\nContent-Type: application/json\r\n\r\n${texto}\r\n--${limite}--`;
        await this._drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + limite }, body: cuerpo,
        });
    },

    async hacerCopiaEnDrive(silencio = false) {
        if (this._copiando || !this.usuarioActual) return;
        this._copiando = true;
        if (!silencio) this._mostrarToast('☁️ Guardando la copia…', 2500);
        try {
            const datos = await this._contenidoCopia();
            await this._subirCopia(JSON.stringify(datos));
            localStorage.setItem('ultimaCopia', datos.fecha);
            localStorage.removeItem('copiaSinPermiso');
            this._pintarUltimaCopia();
            if (!silencio) this._mostrarToast(`✅ Copia guardada en Google Drive (${datos.partes.length} partes)`, 3500);
        } catch (e) {
            if (e.sinPermiso) {
                localStorage.setItem('copiaSinPermiso', '1');
                this._pintarUltimaCopia();
                if (!silencio) this._pedirPermisoDrive();
            } else if (!silencio) {
                this._mostrarToast('❌ No se ha podido guardar la copia: ' + e.message, 5000);
            }
        } finally {
            this._copiando = false;
        }
    },

    // Quien entró antes de que existiera la copia no le dio permiso a Drive:
    // hay que volver a entrar y aceptarlo.
    _pedirPermisoDrive() {
        this.mostrarModal('Permiso de Google Drive',
            'Para guardar la copia en tu Google Drive hace falta que le des permiso. '
            + 'Vuelve a entrar con tu cuenta de Google y acepta el permiso de Drive.',
            () => this.login(false));
    },

    _pintarUltimaCopia() {
        const el = document.getElementById('lastBackupInfo');
        if (!el) return;
        if (localStorage.getItem('copiaSinPermiso')) {
            el.textContent = '⚠️ Falta el permiso de Google Drive: pulsa «Guardar copia en Google Drive».';
            return;
        }
        const u = localStorage.getItem('ultimaCopia');
        el.textContent = u ? 'Última copia: ' + this._cuando(u) : 'Todavía no se ha hecho ninguna copia.';
    },

    guardarFrecuenciaCopia(freq, callado) {
        this.backupFreq = ['hora', 'dia', 'cerrar'].includes(freq) ? freq : 'dia';
        localStorage.setItem('backupFreq', this.backupFreq);
        document.querySelectorAll('input[name="backupFreq"]').forEach(r => { r.checked = r.value === this.backupFreq; });
        if (!callado) this._mostrarToast('✅ Copia automática: ' + ({ hora: 'cada hora', dia: 'cada día', cerrar: 'al cerrar la app' })[this.backupFreq], 2500);
    },

    _prepararCopiaAutomatica() {
        setInterval(() => this._copiaSiToca(), 5 * 60 * 1000);
        // Al irse de la app —cerrarla, cambiar a otra o apagar la pantalla—
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.backupFreq === 'cerrar') this.hacerCopiaEnDrive(true);
        });
    },

    _copiaSiToca() {
        if (!this.usuarioActual || this.backupFreq === 'cerrar') return;
        if (localStorage.getItem('copiaSinPermiso')) return;
        const cada = this.backupFreq === 'hora' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const ultima = Date.parse(localStorage.getItem('ultimaCopia') || '') || 0;
        if (Date.now() - ultima >= cada) this.hacerCopiaEnDrive(true);
    },

    async restaurarDesdeDrive() {
        try {
            const id = await this._ficheroCopia();
            if (!id) { this._mostrarToast('No hay ninguna copia en tu Google Drive', 3500); return; }
            const r = await this._drive(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
            this._confirmarRestaurar(await r.json(), 'Google Drive');
        } catch (e) {
            if (e.sinPermiso) this._pedirPermisoDrive();
            else this._mostrarToast('❌ No se ha podido leer la copia: ' + e.message, 5000);
        }
    },

    _confirmarRestaurar(datos, deDonde) {
        if (!datos || typeof datos !== 'object' || !Array.isArray(datos.partes)) {
            this._mostrarToast('❌ Eso no es una copia de esta aplicación', 4000);
            return;
        }
        const cuando = datos.fecha ? ' del ' + this._cuando(datos.fecha) : '';
        this.mostrarModal('Restaurar la copia',
            `Se recuperan los ajustes y los partes de la copia${cuando} (${deDonde}). `
            + 'Solo se vuelven a subir los partes que ya no están; los que siguen en el servidor no se tocan.',
            // Sin esperar: el cuadro se cierra y lo que va pasando sale abajo
            () => { this._restaurar(datos); });
    },

    async _restaurar(datos) {
        this._aplicarAjustes(datos.ajustes);
        this._mostrarToast('⏳ Recuperando partes…', 3000);
        let hay;
        try { hay = new Set((await this._partesParaCopia()).map(p => p.id)); }
        catch (e) { this._mostrarToast('❌ ' + e.message, 5000); return; }
        const faltan = datos.partes.filter(p => p && p.id && !hay.has(p.id));
        let bien = 0, mal = 0;
        for (const p of faltan) {
            try {
                const r = await fetch(PARTES_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fecha: p.fecha, turno: p.turno, nombre: p.nombre || '', conductor: p.conductor || '',
                        notas: p.notas || '', anotaciones: Array.isArray(p.anotaciones) ? p.anotaciones : [],
                        ...(ES_GC && p.email ? { email: p.email } : {}),
                    }),
                });
                if (r.ok) bien++; else mal++;
            } catch (_) { mal++; }
        }
        await this.cargarPartes(true);
        this._nuevoParteDeHoy();
        this.mostrarOpciones();
        this._mostrarToast(faltan.length
            ? `✅ Ajustes recuperados · ${bien} partes recuperados` + (mal ? ` · ${mal} no se han podido` : '')
            : '✅ Ajustes recuperados · no faltaba ningún parte', 5000);
    },

    async exportarDatos() {
        let datos;
        try { datos = await this._contenidoCopia(); }
        catch (e) { this._mostrarToast('❌ ' + e.message, 5000); return; }
        const texto = JSON.stringify(datos, null, 2);
        const nombre = (ES_GC ? 'gestion-control-acceso' : 'control-acceso') + `-copia-${this._hoyISO()}.json`;
        if (window.AndroidBridge?.saveFile) {
            try { window.AndroidBridge.saveFile(texto, nombre); return; }
            catch (_) { /* si el puente falla, se baja como en el navegador */ }
        }
        const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        this._mostrarToast('⬇️ ' + nombre, 3500);
    },

    importarDatos() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                let datos = null;
                try { datos = JSON.parse(ev.target.result); } catch (_) {}
                this._confirmarRestaurar(datos, 'archivo ' + file.name);
            };
            reader.readAsText(file);
        };
        input.click();
    },

    toggleSection(btn) { btn.closest('.ops-section').classList.toggle('open'); },

    irA(n) {
        this._tab = n;
        document.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('active', i === n));
        document.querySelectorAll('.tab-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === String(n)));
        document.getElementById('contenido').scrollTop = 0;
        if (n === 1) this.cargarPartes();
    },

    // La cabecera como la de conductores: a la izquierda qué app y qué día,
    // y junto a la foto quién eres, tu número y dónde.
    _pintarQuien() {
        const poner = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
        poner('cabeceraSub', new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
        poner('cabeceraNombre', this.usuarioActual?.name || this.usuarioActual?.email || '');
        poner('cabeceraNum', ES_GC ? '' : (localStorage.getItem('parteConductor') || ''));
        poner('cabeceraLugar', ES_GC ? '' : this._lugarAsignado());
    },

    // ── El parte ─────────────────────────────────────────────────────────────

    _hoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    _aISO(f)   { const s = String(f || ''); return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : ''; },
    _aClave(f) { return String(f || '').replace(/-/g, '').slice(0, 8); },

    _diaLargo(fecha) {
        const f = String(fecha || '');
        if (f.length !== 8) return f;
        const d = new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12);
        return isNaN(d) ? f : d.toLocaleDateString('es-ES',
            { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    },
    _cuando(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    // El turno en el que se está ahora mismo. Abrir la app en la garita a las
    // tres de la mañana tiene que ofrecer la noche, no la mañana.
    _turnoDeAhora() {
        const d = new Date();
        const min = d.getHours() * 60 + d.getMinutes();
        const aMin = h => +h.slice(0, 2) * 60 + +h.slice(3, 5);
        for (const t of TURNOS) {
            const a = aMin(t.desde), b = aMin(t.hasta);
            // La noche cruza la medianoche, así que el rango va del revés
            if (a < b ? (min >= a && min < b) : (min >= a || min < b)) return t.id;
        }
        return 'M';
    },

    // El día al que pertenece el turno de ahora: en la noche, de madrugada, el
    // parte sigue siendo el del día anterior.
    _diaDeAhora() {
        const d = new Date();
        if (this._turnoDeAhora() === 'N' && d.getHours() < 5) d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    _pintarTurnos() {
        const cont = document.getElementById('pTurnos');
        if (!cont) return;
        cont.innerHTML = TURNOS.map(t => `<div class="turno-op" data-turno="${t.id}" onclick="app.elegirTurno('${t.id}')">
            <b>${t.nombre}</b><span>${t.desde}–${t.hasta}</span></div>`).join('');
    },

    elegirTurno(id) {
        if (!this._parte) return;
        this._parte.turno = id;
        this._marcarTurno();
        this.cambiarTurnoParte();
    },

    _marcarTurno() {
        document.querySelectorAll('#pTurnos .turno-op').forEach(el =>
            el.classList.toggle('sel', el.dataset.turno === this._parte?.turno));
    },

    // Al abrir, el parte del turno en el que se está: si ya hay uno guardado
    // para ese día y turno se sigue escribiendo en él, que es lo que se espera
    // al volver a abrir la app en medio del turno.
    _nuevoParteDeHoy() {
        this._parte = {
            id: '', fecha: this._aClave(this._diaDeAhora()), turno: this._turnoDeAhora(),
            email: '', nombre: localStorage.getItem('parteNombre') || this.usuarioActual?.name || '',
            conductor: localStorage.getItem('parteConductor') || '',
            notas: '', anotaciones: [],
        };
        this._pintarParte();
        this.cambiarTurnoParte();
    },

    nuevoParte() {
        this._nuevoParteDeHoy();
        this.irA(0);
    },

    // Cambiar de día o de turno es cambiar de parte: si ese ya existe se trae,
    // y si no se empieza en blanco. Sin esto se guardaba lo de un turno en el
    // hueco de otro.
    cambiarTurnoParte() {
        if (!this._parte) return;
        this._recogerCampos();
        const fecha = this._aClave(document.getElementById('pFecha').value) || this._parte.fecha;
        this._parte.fecha = fecha;
        const clave = `${fecha}-${this._parte.turno}`;
        const ya = (this._partes || []).find(p => p.id === clave);
        if (ya) {
            this._parte = JSON.parse(JSON.stringify(ya));
        } else if (this._parte.id && this._parte.id !== clave) {
            // Venía de otro parte ya guardado: se empieza uno nuevo en blanco
            this._parte = { id: '', fecha, turno: this._parte.turno, email: '',
                            nombre: this._parte.nombre, conductor: this._parte.conductor,
                            notas: '', anotaciones: [] };
        }
        this._pintarParte();
    },

    abrirParte(id) {
        const p = (this._partes || []).find(x => x.id === id);
        if (!p) return;
        // Una copia: si al final no se guarda, la lista se queda como estaba
        this._parte = JSON.parse(JSON.stringify(p));
        this._pintarParte();
        this.irA(0);
    },

    _pintarParte() {
        const p = this._parte;
        if (!p) return;
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('pFecha', this._aISO(p.fecha) || this._hoyISO());
        v('pNombre', p.nombre || '');
        v('pConductor', p.conductor || '');
        v('pNotas', p.notas || '');
        if (ES_GC) v('pDueno', p.email || '');
        this._marcarTurno();
        this._pintarAnotaciones();
        const firma = document.getElementById('pFirma');
        if (firma) {
            firma.textContent = p.actualizado
                ? `Guardado el ${this._cuando(p.actualizado)}`
                    + (p.email ? ` · parte de ${p.email}` : '')
                    + (p.tocadoPor && p.tocadoPor !== p.email ? ` · corregido por ${p.tocadoPor}` : '')
                : 'Este parte todavía no se ha guardado.';
        }
    },

    _pintarAnotaciones() {
        const cont = document.getElementById('pAnotaciones');
        if (!cont || !this._parte) return;
        const filas = this._parte.anotaciones || [];
        const cuantas = document.getElementById('pCuantas');
        if (cuantas) cuantas.textContent = filas.length ? `(${filas.length})` : '';
        if (!filas.length) {
            cont.innerHTML = '<div class="an-vacio">Todavía no hay nada apuntado en este turno.</div>';
            return;
        }
        cont.innerHTML = filas.map((a, i) => `<div class="an-fila">
            <div class="an-txt">
                <div class="an-cab">
                    <input class="an-hora" type="time" value="${esc(a.hora)}" onchange="app.tocarAnotacion(${i},'hora',this.value)">
                    <select onchange="app.tocarAnotacion(${i},'tipo',this.value)">
                        ${Object.entries(TIPOS).map(([k, t]) =>
                            `<option value="${k}"${a.tipo === k ? ' selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <input type="text" value="${esc(a.que)}" maxlength="200" placeholder="Qué (bus 214, furgoneta, paquete…)"
                       onchange="app.tocarAnotacion(${i},'que',this.value)">
                <input type="text" value="${esc(a.quien)}" maxlength="200" placeholder="Quién (nombre o empresa)"
                       onchange="app.tocarAnotacion(${i},'quien',this.value)">
                <input type="text" value="${esc(a.obs)}" maxlength="400" placeholder="Observaciones"
                       onchange="app.tocarAnotacion(${i},'obs',this.value)">
            </div>
            <button class="an-x" onclick="app.quitarAnotacion(${i})" title="Quitar">✕</button>
        </div>`).join('');
    },

    tocarAnotacion(i, campo, valor) {
        const a = this._parte?.anotaciones?.[i];
        if (a) a[campo] = valor;
    },

    anadirAnotacion() {
        if (!this._parte) return;
        const d = new Date();
        this._parte.anotaciones = this._parte.anotaciones || [];
        this._parte.anotaciones.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            tipo: 'entrada', que: '', quien: '', obs: '',
        });
        this._pintarAnotaciones();
    },

    quitarAnotacion(i) {
        if (!this._parte?.anotaciones) return;
        this._parte.anotaciones.splice(i, 1);
        this._pintarAnotaciones();
    },

    _recogerCampos() {
        if (!this._parte) return;
        const g = id => document.getElementById(id)?.value ?? '';
        this._parte.nombre    = g('pNombre');
        this._parte.conductor = g('pConductor');
        this._parte.notas     = g('pNotas');
        if (ES_GC) this._parte.email = g('pDueno').trim().toLowerCase();
    },

    async guardarParte() {
        const p = this._parte;
        if (!p) return;
        this._recogerCampos();
        const fecha = this._aClave(document.getElementById('pFecha').value);
        if (fecha.length !== 8) { this._mostrarToast('❌ Falta el día', 3000); return; }
        // El nombre y el número se repiten turno tras turno: se guardan para no
        // tener que escribirlos cada vez.
        localStorage.setItem('parteNombre', p.nombre || '');
        localStorage.setItem('parteConductor', p.conductor || '');
        const cuerpo = {
            fecha, turno: p.turno, nombre: p.nombre, conductor: p.conductor, notas: p.notas,
            // Sin nada escrito no es una anotación: el servidor las descarta
            // igual, pero así no se manda de más.
            anotaciones: (p.anotaciones || []).filter(a => a.que || a.quien || a.obs),
            ...(ES_GC && p.email ? { email: p.email } : {}),
        };
        try {
            const r = await fetch(PARTES_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || r.status);
            // El que vuelve manda: puede haber cambiado de clave si se le ha
            // tocado el día o el turno.
            this._partes = [data, ...(this._partes || []).filter(x => x.id !== data.id && x.id !== p.id)]
                .sort((a, b) => this._orden(a, b));
            this._guardarCache();
            this._parte = JSON.parse(JSON.stringify(data));
            this._pintarParte();
            this._renderPartes();
            this._mostrarToast('✅ Parte guardado', 2500);
        } catch (e) {
            this._mostrarToast('❌ ' + e.message, 5000);
        }
    },

    borrarParte(id) {
        const p = (this._partes || []).find(x => x.id === id);
        if (!p) return;
        this.mostrarModal('Borrar el parte', `¿Seguro que quieres borrar el parte de `
            + `${this._diaLargo(p.fecha)} (turno ${p.turno})? No se puede deshacer.`, async () => {
            try {
                const r = await fetch(`${PARTES_URL}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error || r.status);
                this._partes = (this._partes || []).filter(x => x.id !== p.id);
                this._guardarCache();
                this._renderPartes();
                if (this._parte?.id === p.id) this._nuevoParteDeHoy();
                this._mostrarToast('🗑️ Parte borrado', 2500);
            } catch (e) {
                this._mostrarToast('❌ ' + e.message, 5000);
            }
        });
    },

    // ── La lista ─────────────────────────────────────────────────────────────

    // Del más reciente al más viejo, y dentro del día del último turno al
    // primero: lo que acaba de pasar, arriba.
    _orden(a, b) {
        return (b.fecha || '').localeCompare(a.fecha || '')
            || (ORDEN_TURNO[b.turno] ?? 9) - (ORDEN_TURNO[a.turno] ?? 9);
    },

    _guardarCache() {
        try { localStorage.setItem('partesCache', JSON.stringify(this._partes || [])); } catch (_) {}
    },

    limpiarFiltros() {
        ['paDesde', 'paHasta'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.cargarPartes(true);
    },

    async cargarPartes(forzar) {
        if (!this.usuarioActual?.email) return;
        if (this._partes && !forzar) { this._renderPartes(); return; }
        const cont = document.getElementById('paLista');
        if (cont && !this._partes) cont.innerHTML = '<div class="pa-vacio">Cargando…</div>';
        const q = new URLSearchParams();
        if (ES_GC) {
            const d = this._aClave(document.getElementById('paDesde')?.value || '');
            const h = this._aClave(document.getElementById('paHasta')?.value || '');
            if (d.length === 8) q.set('desde', d);
            if (h.length === 8) q.set('hasta', h);
        }
        try {
            const r = await fetch(PARTES_URL + (q.toString() ? '?' + q : ''), { cache: 'no-store' });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
            this._partes = await r.json();
            this._guardarCache();
        } catch (e) {
            // Sin cobertura vale lo último que se vio: un parte cerrado no
            // cambia solo, y en la garita el móvil no siempre tiene línea.
            if (!this._partes) {
                try { this._partes = JSON.parse(localStorage.getItem('partesCache') || '[]'); }
                catch (__) { this._partes = []; }
            }
            if (forzar) this._mostrarToast('❌ ' + e.message, 4500);
        }
        this._renderPartes();
    },

    _renderPartes() {
        const cont = document.getElementById('paLista');
        if (!cont) return;
        const lista = Array.isArray(this._partes) ? this._partes : [];
        if (!lista.length) {
            cont.innerHTML = '<div class="pa-vacio">Todavía no hay ningún parte.<br>'
                + 'Con ＋ Parte nuevo se empieza uno.</div>';
            return;
        }
        cont.innerHTML = lista.map(p => {
            const n = (p.anotaciones || []).length;
            // Lo primero que se apuntó, para hacerse una idea sin abrirlo
            const primeras = (p.anotaciones || []).slice(0, 2)
                .map(a => `${esc(a.hora)} ${esc(a.que || a.quien || a.obs)}`).join(' · ');
            const turno = TURNOS.find(t => t.id === p.turno);
            return `<div class="pa-card" onclick="app.abrirParte('${esc(p.id)}')">
                <div class="pa-top">
                    <span class="pa-dia">${esc(this._diaLargo(p.fecha))}</span>
                    <span class="pa-turno">${esc(turno ? turno.nombre : p.turno)}</span>
                    <span class="pa-n">${n} anotaci${n === 1 ? 'ón' : 'ones'}</span>
                </div>
                <div class="pa-quien">${esc(p.nombre || p.email || 'Sin nombre')}${
                    p.conductor ? ' · nº ' + esc(p.conductor) : ''}</div>
                ${primeras ? `<div class="pa-res">${primeras}${n > 2 ? ' …' : ''}</div>` : ''}
                ${p.notas ? `<div class="pa-res">📝 ${esc(String(p.notas).slice(0, 120))}</div>` : ''}
                ${ES_GC ? `<div style="margin-top:9px;"><button class="btn sec chico"
                    style="width:auto;padding:7px 12px;color:#c0392b;"
                    onclick="event.stopPropagation();app.borrarParte('${esc(p.id)}')">🗑️ Borrar</button></div>` : ''}
            </div>`;
        }).join('');
    },

    // ── Exportar ─────────────────────────────────────────────────────────────

    CABECERAS: ['Día', 'Turno', 'Quién', 'Nº', 'Hora', 'Tipo', 'Qué', 'Quién/empresa', 'Observaciones', 'Notas del turno'],

    exportarPartes() {
        const lista = Array.isArray(this._partes) ? this._partes : [];
        if (!lista.length) { this._mostrarToast('No hay partes que exportar', 3000); return; }
        const filas = [];
        // Del más viejo al más nuevo: una hoja se lee hacia delante
        lista.slice().sort((a, b) => this._orden(b, a)).forEach(p => {
            const dia = (this._aISO(p.fecha) || '').split('-').reverse().join('/');
            const turno = TURNOS.find(t => t.id === p.turno);
            const cab = [dia, turno ? turno.nombre : p.turno, p.nombre || p.email || '', p.conductor || ''];
            if (!(p.anotaciones || []).length) {
                filas.push([...cab, '', '', '', '', '', p.notas || '']);
                return;
            }
            (p.anotaciones || []).forEach((a, i) => {
                filas.push([...cab, a.hora || '', (TIPOS[a.tipo] || '').replace(/^\S+\s/, ''),
                            a.que || '', a.quien || '', a.obs || '', i === 0 ? (p.notas || '') : '']);
            });
        });
        // Punto y coma y BOM, que es lo que abre bien el Excel en español
        const csv = '﻿' + [this.CABECERAS, ...filas]
            .map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const nombre = `partes-control-acceso-${this._hoyISO()}.csv`;
        // En el móvil lo guarda el propio Android en Descargas; el navegador
        // no puede hacerlo y se baja como cualquier otro archivo.
        if (window.AndroidBridge?.saveFile) {
            try {
                window.AndroidBridge.saveFile(csv, nombre);
                return;
            } catch (_) { /* si el puente falla, se baja como en el navegador */ }
        }
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        this._mostrarToast('⬇️ ' + nombre, 3500);
    },

    // ── Versión ──────────────────────────────────────────────────────────────

    _buildNumToVersion(n) {
        return 'v' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
    },

    _pintarVersion() {
        const n = parseInt(String(typeof APP_VERSION === 'undefined' ? '0' : APP_VERSION)
            .replace('build-', ''), 10) || 0;
        const el = document.getElementById('versionDisplay');
        if (el) el.textContent = n ? 'Versión ' + this._buildNumToVersion(n) : 'Versión web';
    },

    // ── Descargar la aplicación desde el navegador ──────────────────────────
    //
    // Lo que se ofrece es el APK de verdad, el de la última versión que le
    // toque a esta aplicación: cada una del puesto tiene sus etiquetas.

    async _urlApkMasReciente() {
        try {
            const res = await this._releases();
            if (!res.ok) return null;
            const pub = await this._buildPublicado();
            if (!pub.ok) return null;
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            let release = null, mejor = 0;
            (Array.isArray(res.lista) ? res.lista : []).forEach(r => {
                const m = re.exec(r.tag_name || '');
                if (!m) return;
                const n = parseInt(m[1], 10);
                if (pub.build !== null && n > pub.build) return;
                if (n > mejor) { mejor = n; release = r; }
            });
            if (!release) return null;
            const asset = release.assets?.find(a => a.name.endsWith('.apk'));
            // Sin APK adjunto se abre la página de la versión, y desde ahí
            // se puede bajar a mano.
            return { url: asset?.browser_download_url || release.html_url,
                     version: this._buildNumToVersion(mejor) };
        } catch (_) { return null; }
    },

    _enLaApp() {
        return !!(window.Capacitor?.isNativePlatform?.() || window.AndroidBridge);
    },

    _debePreguntarModo() {
        if (this._enLaApp()) return false;
        // En iPhone el APK no sirve de nada
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return false;
        return !localStorage.getItem('modoUso');
    },

    _preguntarModoSiToca() {
        if (!this._enLaApp() && !/iPad|iPhone|iPod/.test(navigator.userAgent)) {
            const fila = document.getElementById('opsAplicacion');
            if (fila) fila.hidden = false;
        }
        if (!this._debePreguntarModo()) return;
        const pant = document.getElementById('modoScreen');
        if (!pant) return;
        pant.style.display = '';
        // Qué versión se va a descargar, para que no sea un salto al vacío
        this._urlApkMasReciente().then(apk => {
            const sub = document.getElementById('modoApkSub');
            if (sub && apk?.version) sub.textContent = 'Última versión: ' + apk.version;
        }).catch(() => {});
    },

    elegirModo(modo) {
        try { localStorage.setItem('modoUso', modo); } catch (_) {}
        const pant = document.getElementById('modoScreen');
        if (pant) pant.style.display = 'none';
        if (modo === 'apk') this.instalarApp();
    },

    async instalarApp() {
        const apk = await this._urlApkMasReciente();
        if (!apk) {
            this._mostrarToast('❌ No se ha podido encontrar la aplicación para descargar. Prueba en unos minutos.', 5000);
            return;
        }
        this._mostrarToast('⬇️ Descargando ' + apk.version + '…', 4000);
        // Los APK de GitHub se descargan sin sacarle de la página
        window.location.href = apk.url;
    },

    // Al pulsar "Comprobar actualizaciones" se va a GitHub sin caché: si no,
    // una versión recién salida tardaría hasta cinco minutos en verse.
    async _releases(forzar = false) {
        const CACHE = 'releasesCache', EDAD = 'releasesCacheAt';
        const t = parseInt(sessionStorage.getItem(EDAD) || '0', 10);
        if (!forzar && Date.now() - t < 5 * 60 * 1000) {
            try { return { ok: true, lista: JSON.parse(sessionStorage.getItem(CACHE) || '[]') }; } catch (_) {}
        }
        const r = await this._fetchOriginal(
            'https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=100');
        // Un 403 aquí casi siempre es el límite por hora, no un permiso
        if (!r.ok) return { ok: false, status: r.status, limite: r.status === 403 };
        const lista = await r.json();
        try {
            sessionStorage.setItem(CACHE, JSON.stringify(lista));
            sessionStorage.setItem(EDAD, String(Date.now()));
        } catch (_) {}
        return { ok: true, lista };
    },

    // Qué versión toca instalar. El que lleva todo esto ve siempre la última,
    // para poder probarla antes de soltársela a los demás; el resto reciben la
    // que él haya publicado desde la app de desarrollador.
    async _buildPublicado() {
        if ((this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL) return { ok: true, build: null };
        try {
            const r = await fetch(VERSION_URL, { cache: 'no-store' });
            if (r.ok) {
                const build = (await r.json())?.[VERSION_KEY] ?? null;
                localStorage.setItem('buildPublicado', JSON.stringify(build));
                return { ok: true, build };
            }
        } catch (_) { /* se intenta con lo último que se leyó */ }
        const guardado = localStorage.getItem('buildPublicado');
        if (guardado === null) return { ok: false };
        try { return { ok: true, build: JSON.parse(guardado) }; }
        catch (_) { return { ok: false }; }
    },

    async _checkForUpdates(avisar = false) {
        if (!window.Capacitor?.isNativePlatform?.()) {
            // En el navegador la página se carga siempre de nuevo
            if (avisar) this._mostrarToast('✅ En el navegador tienes siempre la última versión');
            return;
        }
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        sessionStorage.setItem('lastUpdateCheck', String(Date.now()));
        try {
            const res = await this._releases(avisar);
            if (!res.ok) {
                if (avisar) this._mostrarToast(res.limite
                    ? '⏳ GitHub ha limitado las consultas. Prueba en unos minutos.'
                    : '❌ No se pudo comprobar (error ' + res.status + ')', 4500);
                return;
            }
            const pub = await this._buildPublicado();
            if (!pub.ok) {
                if (avisar) this._mostrarToast(
                    '⏳ No se ha podido comprobar qué versión toca instalar. Prueba más tarde.', 4500);
                return;
            }
            // Las cinco aplicaciones publican en el mismo repositorio, así que
            // se cogen solo las etiquetadas para ésta.
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            let release = null, ultima = 0;
            (Array.isArray(res.lista) ? res.lista : []).forEach(r => {
                const m = re.exec(r.tag_name || '');
                if (!m) return;
                const n = parseInt(m[1], 10);
                if (pub.build !== null && n > pub.build) return;
                if (n > ultima) { ultima = n; release = r; }
            });
            const ahora = parseInt(String(APP_VERSION).replace('build-', ''), 10) || 0;
            if (!ultima || ultima <= ahora) {
                // No tener nada que instalar no es un error: puede que no haya
                // ninguna publicada, o que la instalada sea posterior.
                if (avisar) this._mostrarToast('✅ Tienes instalada la última versión disponible'
                    + (ahora ? ' (' + this._buildNumToVersion(ahora) + ')' : ''));
                return;
            }
            const asset = release.assets?.find(a => a.name.endsWith('.apk'));
            this._updateApkUrl = asset?.browser_download_url || release.html_url;
            this._updateLatestNum = ultima;
            const texto = `${this._buildNumToVersion(ultima)} disponible (tienes ${this._buildNumToVersion(ahora)})`;
            // La franja de abajo sale siempre; el cuadro, si no se ha apartado
            const banner = document.getElementById('updateBanner');
            const bMsg   = document.getElementById('updateBannerMsg');
            if (bMsg) bMsg.textContent = texto;
            if (banner) banner.style.display = 'flex';
            const modal = document.getElementById('updateModal');
            const msg   = document.getElementById('updateModalMsg');
            // "Más tarde" solo lo aparta unas horas, nunca para siempre: si no,
            // un toque de más dejaría a alguien clavado en una versión vieja.
            const dormido = parseInt(localStorage.getItem('updateSnooze_' + ultima) || '0', 10);
            if (modal && (avisar || Date.now() >= dormido)) {
                if (msg) msg.textContent = texto;
                modal.style.display = 'flex';
            }
        } catch (_) {
            if (avisar) this._mostrarToast('❌ No se pudo comprobar la versión');
        }
    },

    _posponerActualizacion() {
        const m = document.getElementById('updateModal');
        if (m) m.style.display = 'none';
        if (this._updateLatestNum) {
            localStorage.setItem('updateSnooze_' + this._updateLatestNum,
                String(Date.now() + 8 * 60 * 60 * 1000));
        }
    },

    _descargarActualizacion() {
        const url = this._updateApkUrl;
        if (!url) return;
        const m = document.getElementById('updateModal');
        if (m) m.style.display = 'none';
        const ov = document.getElementById('updateProgressOverlay');
        if (ov) ov.style.display = 'flex';
        const bar = document.getElementById('updateProgressBar');
        const pct = document.getElementById('updateProgressPct');
        const txt = document.getElementById('updateProgressTxt');
        const cerrar = document.getElementById('updateProgressClose');
        if (bar) bar.style.width = '0%';
        if (pct) pct.textContent = '0%';
        if (txt) txt.textContent = 'Descargando nueva versión...';
        if (cerrar) cerrar.style.display = 'none';
        if (window.AndroidBridge?.downloadAndInstallApk) {
            window.AndroidBridge.downloadAndInstallApk(url);
        } else {
            if (ov) ov.style.display = 'none';
            window.open(url, '_system');
        }
    },

    // Los llama Java mientras baja el APK. Los nombres son los que evalúa el
    // código nativo, así que no se pueden cambiar por un lado solo.
    _onUpdateProgress(porcentaje) {
        const bar = document.getElementById('updateProgressBar');
        const pct = document.getElementById('updateProgressPct');
        if (bar) bar.style.width = porcentaje + '%';
        if (pct) pct.textContent = porcentaje + '%';
        if (porcentaje >= 100) {
            const txt = document.getElementById('updateProgressTxt');
            if (txt) txt.textContent = 'Descargada. Confirma la instalación.';
        }
    },

    _onUpdateError() {
        const txt = document.getElementById('updateProgressTxt');
        const cerrar = document.getElementById('updateProgressClose');
        if (txt) txt.textContent = 'No se ha podido descargar. Inténtalo otra vez.';
        if (cerrar) cerrar.style.display = 'inline-block';
    },
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
