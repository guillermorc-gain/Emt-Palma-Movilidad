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
const ACCESOS_URL  = API_BASE + 'accesos';
const VERSION_URL  = API_BASE + 'version';
const ALLOWLIST_URL = API_BASE + 'allowlist';

const ALLOWLIST_APP   = ES_GC ? 'gestion-control' : 'control';
const ANDROID_PACKAGE = ES_GC ? 'com.guillermorc.gcontrolemt' : 'com.guillermorc.controlemt';
const RELEASE_PREFIX  = ES_GC ? 'gcontrol-build-' : 'control-build-';
// Cada aplicación lleva su propio número de versión publicada
const VERSION_KEY     = ES_GC ? 'gestionControl' : 'control';

const NOMBRE_APP = ES_GC ? 'Gestión control de acceso EMT - Movilidad'
                         : 'Control de acceso EMT - Movilidad';

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
            poner('authSub', 'Los registros del puesto · EMT Palma');
            poner('splashRol', '🗝️ Gestión del puesto');
            poner('cabeceraTitulo', '🗝️ Gestión control de acceso');

            const logo = document.getElementById('authLogo');
            if (logo) logo.src = 'icons/icon-gc-192.png';
            const modoLogo = document.getElementById('modoLogo');
            if (modoLogo) modoLogo.src = 'icons/icon-gc-192.png';
            poner('modoTit', NOMBRE_APP);
            const ex = document.getElementById('paExportar');
            if (ex) ex.hidden = false;
            const tv = document.getElementById('tabBtnVisitantes');
            if (tv) tv.hidden = false;
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
                ['partesCache', 'parteNombre', 'parteConductor', 'registrosCache'].forEach(k => localStorage.removeItem(k));
                this._porId = {};
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
            // Primero lo que tiene la plantilla (su número, si lo puso en otro
            // móvil) y luego darse de alta con él
            if (!ES_GC) this._cargarAsignacion().then(() => this._registrarEnPlantilla());
            this._prepararRegistro();
            this.cargarVisitantes();
            this.cargarRegistros();
            this._sincronizarSolo();
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

    // Como en la de conductores: borra la copia de seguridad de esta app en
    // tu Drive y lo guardado en el móvil, y cierra la sesión. Los registros no
    // son solo tuyos —son el registro del puesto— y se quedan en el servidor.
    confirmarBorrarCuenta() {
        this.mostrarModal('⚠️ Borrar datos',
            'Se borrará tu copia de seguridad de Google Drive y todo lo guardado en este móvil, y se cerrará la sesión. '
            + 'Los registros del puesto no se borran.',
            () => this._borrarCuenta());
    },

    async _borrarCuenta() {
        try {
            const id = await this._ficheroCopia();
            if (id) await this._drive(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' });
        } catch (e) {
            if (!e.sinPermiso && !confirm('No se ha podido borrar la copia de Drive (' + e.message
                    + '). ¿Cerrar la sesión y borrar lo del móvil de todas formas?')) return;
        }
        if (this.accessToken) {
            this._fetchOriginal('https://oauth2.googleapis.com/revoke?token=' + this.accessToken,
                { method: 'POST' }).catch(() => {});
        }
        this.usuarioActual = null;
        this._olvidarSesion();
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        window.location.reload();
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
            // El número se escribió en otro móvil: el que tiene la plantilla
            // vale aquí también. El de este móvil, si lo hay, manda.
            if (a.conductor && !localStorage.getItem('parteConductor')) {
                localStorage.setItem('parteConductor', a.conductor);
                this._actualizarConductorDisplay();
            }
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
    // Lo que hay en el servidor son los registros; aquí se guarda una copia de
    // ellos y del directorio de visitantes —son del puesto, no de cada uno— y
    // de los ajustes de este móvil, en la misma carpeta de Drive que usa la de
    // conductores.

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

    // Los registros y el directorio, recién leídos del servidor. Sin poder
    // leerlos no se hace copia: una copia vacía machacaría la buena que hubiera.
    async _registrosParaCopia() {
        const r = await fetch(ACCESOS_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error('No se han podido leer los registros (' + r.status + ')');
        const lista = await r.json();
        if (!Array.isArray(lista)) throw new Error('Respuesta rara del servidor');
        return lista;
    },

    async _visitantesParaCopia() {
        const r = await fetch(ACCESOS_URL + '?que=visitantes', { cache: 'no-store' });
        if (!r.ok) throw new Error('No se ha podido leer el directorio (' + r.status + ')');
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
            registros: await this._registrosParaCopia(),
            visitantes: await this._visitantesParaCopia(),
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
            if (!silencio) this._mostrarToast(`✅ Copia guardada en Google Drive (${datos.registros.length} registros · ${datos.visitantes.length} en el directorio)`, 4000);
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
        if (!datos || typeof datos !== 'object' || !Array.isArray(datos.registros)) {
            this._mostrarToast('❌ Eso no es una copia de esta aplicación', 4000);
            return;
        }
        const cuando = datos.fecha ? ' del ' + this._cuando(datos.fecha) : '';
        this.mostrarModal('Restaurar la copia',
            `Se recuperan los ajustes, los registros y el directorio de visitantes de la copia${cuando} (${deDonde}). `
            + 'Solo se vuelven a subir los registros que ya no están; los que siguen en el servidor no se tocan.',
            // Sin esperar: el cuadro se cierra y lo que va pasando sale abajo
            () => { this._restaurar(datos); });
    },

    async _restaurar(datos) {
        this._aplicarAjustes(datos.ajustes);
        this._mostrarToast('⏳ Recuperando registros…', 3000);
        let guardados = 0;
        try {
            // El servidor solo mete los que no tiene: los que están no se tocan
            const r = await fetch(ACCESOS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ registros: datos.registros }),
            });
            const out = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(out.error || r.status);
            guardados = out.guardados || 0;
            if (Array.isArray(datos.visitantes) && datos.visitantes.length) {
                await fetch(ACCESOS_URL + '?que=visitantes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lista: datos.visitantes }),
                });
            }
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); return; }
        await Promise.all([this.cargarRegistros(true), this.cargarVisitantes()]);
        this.mostrarOpciones();
        this._mostrarToast(guardados
            ? `✅ Ajustes recuperados · ${guardados} registros recuperados`
            : '✅ Ajustes recuperados · no faltaba ningún registro', 5000);
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
        if (n === 1) this._renderHistorial();
        if (n === 2) { this.renderVisitantes(); this.cargarVisitantes(); }
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

    // ── Registros de entrada y salida ────────────────────────────────────────
    //
    // Arriba el día (hoy, de salida), debajo el formulario con la hora de
    // ahora ya puesta, y debajo lo apuntado ese día. Con la matrícula de
    // alguien que ya vino se rellena todo lo demás: el directorio se va
    // aprendiendo solo con cada registro.

    _claveMatricula(m) { return String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },

    _horaAhora() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },

    // Lo que se ha cargado, por id: el día que se ve y el historial salen de aquí
    _porId: {},
    _visitantes: {},
    _dia: '',

    _registrosDe(fecha) {
        return Object.values(this._porId).filter(r => r.fecha === fecha)
            .sort((a, b) => (a.entrada || '').localeCompare(b.entrada || ''));
    },

    _guardarCacheRegistros() {
        try {
            // Solo lo reciente: es para poder seguir sin cobertura, no un archivo
            const desde = this._aClave(this._isoHaceDias(40));
            const lista = Object.values(this._porId).filter(r => r.fecha >= desde);
            localStorage.setItem('registrosCache', JSON.stringify(lista));
        } catch (_) {}
    },

    _isoHaceDias(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    // Al entrar y cada vez que se registra: hoy, con la hora de ahora
    _prepararRegistro() {
        if (!this._dia) this._dia = this._aClave(this._hoyISO());
        const pd = document.getElementById('paDesde'), ph = document.getElementById('paHasta');
        if (pd && !pd.value) pd.value = this._isoHaceDias(30);
        if (ph && !ph.value) ph.value = this._hoyISO();
        const f = document.getElementById('rFecha');
        if (f) f.value = this._aISO(this._dia);
        this._pintarDiaLargo();
        this._prepararSugerencias();
        this._limpiarFormulario();
        try {
            const c = JSON.parse(localStorage.getItem('registrosCache') || '[]');
            c.forEach(r => { if (r?.id && !this._porId[r.id]) this._porId[r.id] = r; });
            const v = JSON.parse(localStorage.getItem('visitantesCache') || '[]');
            this._ponerVisitantes(v);
        } catch (_) {}
        this._renderDia();
    },

    _pintarDiaLargo() {
        const el = document.getElementById('rDiaLargo');
        if (!el) return;
        const hoy = this._aClave(this._hoyISO());
        const d = new Date(+this._dia.slice(0, 4), +this._dia.slice(4, 6) - 1, +this._dia.slice(6, 8), 12);
        const largo = isNaN(d) ? '' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        el.textContent = (this._dia === hoy ? 'Hoy · ' : '') + largo;
        const volver = document.getElementById('rHoyBtn');
        if (volver) volver.hidden = this._dia === hoy;
    },

    cambiarDia() {
        const v = this._aClave(document.getElementById('rFecha')?.value);
        if (v.length !== 8) return;
        this._dia = v;
        this._pintarDiaLargo();
        this._renderDia();
        this.cargarRegistros(true, v, v);
    },

    irAHoy() {
        this._dia = this._aClave(this._hoyISO());
        const f = document.getElementById('rFecha');
        if (f) f.value = this._aISO(this._dia);
        this.cambiarDia();
    },

    _limpiarFormulario() {
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('rEntrada', this._horaAhora());
        // La hora va sola hasta que alguien la toque: si el formulario se queda
        // abierto un rato, al registrar tiene que ser la de ese momento
        const h = document.getElementById('rEntrada');
        if (h) {
            h.dataset.tocada = '';
            if (!h._escucha) { h._escucha = true; h.addEventListener('input', () => { h.dataset.tocada = '1'; }); }
        }
        if (!this._relojHora) {
            this._relojHora = setInterval(() => {
                const e = document.getElementById('rEntrada');
                if (e && !e.dataset.tocada && document.activeElement !== e) e.value = this._horaAhora();
            }, 20000);
        }
        ['rMatricula', 'rNombre', 'rEmpresa', 'rVehiculo', 'rDepartamento'].forEach(id => v(id, ''));
        this._autorrellenado = {};
        this._pintarPista('');
    },

    // ── El directorio ────────────────────────────────────────────────────────

    _ponerVisitantes(lista) {
        if (!Array.isArray(lista)) return;
        const mapa = {};
        lista.forEach(v => { const k = this._claveMatricula(v?.matricula); if (k) mapa[k] = v; });
        this._visitantes = mapa;
        if (this._tab === 2) this.renderVisitantes();
    },

    // ── El directorio, a mano (solo la del puesto) ───────────────────────────

    renderVisitantes() {
        const cont = document.getElementById('viLista');
        if (!cont) return;
        const t = String(document.getElementById('viBuscar')?.value || '').trim().toLowerCase();
        const k = this._claveMatricula(t);
        const orden = document.getElementById('viOrden')?.value || 'nombre';
        const lista = Object.values(this._visitantes)
            .filter(v => !t || (k && this._claveMatricula(v.matricula).includes(k))
                || [v.nombre, v.empresa, v.vehiculo, v.departamento].some(x => String(x || '').toLowerCase().includes(t)))
            .sort((a, b) => orden === 'visto'
                ? String(b.visto || '').localeCompare(String(a.visto || ''))
                : String(a[orden] || '\uffff').localeCompare(String(b[orden] || '\uffff'), 'es', { numeric: true })
                  || String(a.matricula || '').localeCompare(String(b.matricula || '')));
        const n = document.getElementById('viCuantos');
        if (n) n.textContent = String(Object.keys(this._visitantes).length);
        cont.innerHTML = lista.length ? lista.map(v => `
            <div class="re-card" onclick="app.abrirVisitante('${esc(this._claveMatricula(v.matricula))}')">
                <div class="re-top">
                    <span class="re-horas">${esc(v.nombre || '—')}</span>
                    <span class="re-mat">${esc(v.matricula)}</span>
                </div>
                ${v.empresa ? `<div class="re-quien">${esc(v.empresa)}</div>` : ''}
                ${v.vehiculo || v.departamento ? `<div class="re-que">${esc([v.vehiculo, v.departamento ? '→ ' + v.departamento : ''].filter(Boolean).join(' '))}</div>` : ''}
                ${v.visto ? `<div class="re-que">Última vez: ${esc(this._cuando(v.visto))}</div>` : ''}
            </div>`).join('')
            : '<div class="pa-vacio">No hay nadie en el directorio con eso.</div>';
    },

    abrirVisitante(clave) {
        const v = clave ? this._visitantes[clave] : null;
        this._visEditando = clave || '';
        const put = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        put('vMatricula', v?.matricula); put('vNombre', v?.nombre); put('vEmpresa', v?.empresa);
        put('vVehiculo', v?.vehiculo); put('vDepartamento', v?.departamento);
        const t = document.getElementById('visTitulo');
        if (t) t.textContent = v ? '✏️ Visitante' : '➕ Nuevo visitante';
        const b = document.getElementById('vBorrar');
        if (b) b.hidden = !v;
        const f = document.getElementById('vFirma');
        if (f) f.textContent = v?.editadoPor ? `Modificado por ${v.editadoPor}` : '';
        document.getElementById('visModal').classList.add('show');
    },

    cerrarVisitante() { document.getElementById('visModal').classList.remove('show'); },

    async guardarVisitante() {
        const g = id => (document.getElementById(id)?.value || '').trim();
        const ficha = { matricula: g('vMatricula').toUpperCase(), nombre: g('vNombre'), empresa: g('vEmpresa'),
                        vehiculo: g('vVehiculo'), departamento: g('vDepartamento') };
        if (!this._claveMatricula(ficha.matricula)) { this._mostrarToast('❌ Falta la matrícula', 3000); return; }
        try {
            const r = await fetch(ACCESOS_URL + '?que=visitantes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ficha, antes: this._visEditando }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || r.status);
            this.cerrarVisitante();
            await this.cargarVisitantes();
            this.renderVisitantes();
            this._mostrarToast('✅ Guardado', 2000);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
    },

    borrarVisitante() {
        const clave = this._visEditando;
        const v = this._visitantes[clave];
        if (!v) return;
        this.cerrarVisitante();
        this.mostrarModal('Quitar del directorio',
            `¿Quitar ${v.matricula}${v.nombre ? ' (' + v.nombre + ')' : ''} del directorio? Sus registros no se borran.`,
            async () => {
                try {
                    const r = await fetch(`${ACCESOS_URL}?que=visitantes&matricula=${encodeURIComponent(v.matricula)}`, { method: 'DELETE' });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(data.error || r.status);
                    delete this._visitantes[clave];
                    try { localStorage.setItem('visitantesCache', JSON.stringify(Object.values(this._visitantes))); } catch (_) {}
                    this.renderVisitantes();
                    this._mostrarToast('🗑️ Quitado del directorio', 2500);
                } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
            });
    },

    // ── Sugerencias al escribir ──────────────────────────────────────────────
    //
    // Debajo del campo, lo que ya se conoce y encaja con lo escrito. En la
    // matrícula basta con ir poniendo números: salen las que los llevan, las
    // que empiezan por ellos primero, con de quién son.

    _opcionesDe(campo, q) {
        const vs = Object.values(this._visitantes);
        if (campo === 'matricula') {
            const k = this._claveMatricula(q);
            if (!k) return [];
            return vs.filter(v => this._claveMatricula(v.matricula).includes(k))
                .sort((a, b) => (this._claveMatricula(b.matricula).startsWith(k) - this._claveMatricula(a.matricula).startsWith(k))
                                || (a.matricula || '').localeCompare(b.matricula || ''))
                .map(v => ({ valor: v.matricula, texto: v.matricula,
                             sub: [v.nombre, v.empresa].filter(Boolean).join(' · ') }));
        }
        const t = String(q || '').trim().toLowerCase();
        const base = campo === 'departamento' ? ['Taller', 'Obra', 'Paquetería taller'] : [];
        const valores = [...new Set([...base, ...vs.map(v => v[campo])].filter(x => x && x !== '-'))];
        return valores.filter(x => !t || x.toLowerCase().includes(t))
            .filter(x => x.toLowerCase() !== t)
            .sort((a, b) => (b.toLowerCase().startsWith(t) - a.toLowerCase().startsWith(t)) || a.localeCompare(b, 'es'))
            .map(x => ({ valor: x, texto: x }));
    },

    _prepararSugerencias() {
        const campos = { rMatricula: 'matricula', rEmpresa: 'empresa', rVehiculo: 'vehiculo', rDepartamento: 'departamento',
                         eMatricula: 'matricula', eEmpresa: 'empresa', eVehiculo: 'vehiculo', eDepartamento: 'departamento' };
        Object.entries(campos).forEach(([id, campo]) => {
            const input = document.getElementById(id);
            if (!input || input._sug) return;
            const wrap = document.createElement('div');
            wrap.className = 'sug-wrap';
            wrap.style.marginBottom = input.style.marginBottom;
            input.style.marginBottom = '0';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            const caja = document.createElement('div');
            caja.className = 'sug';
            caja.hidden = true;
            wrap.appendChild(caja);
            input._sug = caja;
            const pintar = () => {
                const ops = this._opcionesDe(campo, input.value).slice(0, 8);
                caja.innerHTML = ops.map((o, i) => `<div class="sug-op" data-i="${i}"><b>${esc(o.texto)}</b>${
                    o.sub ? `<span>${esc(o.sub)}</span>` : ''}</div>`).join('');
                caja.hidden = !ops.length || document.activeElement !== input;
                caja._ops = ops;
            };
            input.addEventListener('input', pintar);
            input.addEventListener('focus', pintar);
            input.addEventListener('blur', () => setTimeout(() => { caja.hidden = true; }, 150));
            // mousedown y no click: con click el campo pierde el foco antes y la
            // lista se cierra sin haber elegido
            caja.addEventListener('mousedown', e => e.preventDefault());
            caja.addEventListener('click', e => {
                const op = caja._ops?.[+e.target.closest('.sug-op')?.dataset.i];
                if (!op) return;
                input.value = op.valor;
                caja.hidden = true;
                input.dispatchEvent(new Event('input'));
                caja.hidden = true;
                if (id === 'rMatricula') this.buscarMatricula();
            });
        });
    },

    async cargarVisitantes() {
        try {
            const r = await fetch(ACCESOS_URL + '?que=visitantes', { cache: 'no-store' });
            if (!r.ok) return;
            const lista = await r.json();
            this._ponerVisitantes(lista);
            try { localStorage.setItem('visitantesCache', JSON.stringify(lista)); } catch (_) {}
        } catch (_) { /* sin cobertura vale lo último que se supo */ }
    },

    // Al escribir la matrícula: si ya vino alguna vez, se rellena lo demás. Lo
    // que se haya escrito a mano no se pisa; lo rellenado solo sí, por si se
    // cambia de matrícula a media escritura.
    buscarMatricula() {
        const el = document.getElementById('rMatricula');
        if (!el) return;
        const v = this._visitantes[this._claveMatricula(el.value)];
        const campos = { rNombre: 'nombre', rEmpresa: 'empresa', rVehiculo: 'vehiculo', rDepartamento: 'departamento' };
        this._autorrellenado = this._autorrellenado || {};
        Object.entries(campos).forEach(([id, k]) => {
            const c = document.getElementById(id);
            if (!c) return;
            const vacio = !c.value.trim() || this._autorrellenado[id] === c.value;
            if (v && vacio) {
                const nuevo = v[k] && v[k] !== '-' ? v[k] : '';
                c.value = nuevo;
                this._autorrellenado[id] = nuevo;
            } else if (!v && this._autorrellenado[id] === c.value) {
                c.value = '';
                delete this._autorrellenado[id];
            }
        });
        if (v) el.value = v.matricula || el.value;
        const clave = this._claveMatricula(el.value);
        // "Nueva" solo si no hay ninguna que la contenga: a medio escribir aún
        // puede ser una conocida, y para eso están las sugerencias
        const aMedias = !v && Object.keys(this._visitantes).some(k => k.includes(clave));
        this._pintarPista(!clave || aMedias ? '' : v ? `✅ Ya ha venido: ${[v.nombre, v.empresa].filter(Boolean).join(' · ')}`
            : '🆕 Matrícula nueva: se recordará al registrarla');
    },

    _pintarPista(t) {
        const el = document.getElementById('rPista');
        if (el) { el.textContent = t; el.hidden = !t; }
    },

    // ── Apuntar ──────────────────────────────────────────────────────────────

    _leerFormulario() {
        const g = id => (document.getElementById(id)?.value || '').trim();
        return {
            fecha: this._dia,
            entrada: g('rEntrada'),
            matricula: g('rMatricula').toUpperCase(),
            nombre: g('rNombre'),
            empresa: g('rEmpresa'),
            vehiculo: g('rVehiculo'),
            departamento: g('rDepartamento'),
        };
    },

    async registrarEntrada() {
        const h = document.getElementById('rEntrada');
        if (h && !h.dataset.tocada) h.value = this._horaAhora();
        const r = this._leerFormulario();
        if (!/^\d{2}:\d{2}$/.test(r.entrada)) { this._mostrarToast('❌ Falta la hora de entrada', 3000); return; }
        if (!r.matricula && !r.nombre) { this._mostrarToast('❌ Pon al menos la matrícula o el nombre', 3000); return; }
        const btn = document.getElementById('rBtn');
        if (btn) btn.disabled = true;
        try {
            const data = await this._enviarRegistro(r);
            // Lo aprendido, ya aquí, sin esperar a la próxima carga
            if (data.matricula) {
                const k = this._claveMatricula(data.matricula);
                const previo = this._visitantes[k] || {};
                const v = { ...previo, matricula: data.matricula,
                            nombre: data.nombre || previo.nombre || '', empresa: data.empresa || previo.empresa || '',
                            vehiculo: data.vehiculo || previo.vehiculo || '', departamento: data.departamento || previo.departamento || '' };
                this._ponerVisitantes([...Object.values(this._visitantes).filter(x => this._claveMatricula(x.matricula) !== k), v]);
                try { localStorage.setItem('visitantesCache', JSON.stringify(Object.values(this._visitantes))); } catch (_) {}
            }
            this._limpiarFormulario();
            this._renderDia();
            this._mostrarToast(`✅ Entrada a las ${data.entrada}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) {
            this._mostrarToast('❌ ' + e.message, 5000);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _enviarRegistro(cuerpo) {
        const r = await fetch(ACCESOS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.status);
        this._porId[data.id] = data;
        this._guardarCacheRegistros();
        return data;
    },

    // La salida, con la hora de ahora; si no era esa, se toca en el registro
    async marcarSalida(id) {
        const r = this._porId[id];
        if (!r) return;
        try {
            const data = await this._enviarRegistro({ id, salida: this._horaAhora() });
            this._renderDia();
            this._renderHistorial();
            this._mostrarToast(`🚪 Salida a las ${data.salida}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    // La hora de salida escrita a mano, por si no se apuntó en el momento
    ponerHoraSalida(id) {
        const r = this._porId[id];
        if (!r) return;
        this._salidaDe = id;
        const t = document.getElementById('hsTitulo');
        if (t) t.textContent = [r.matricula, r.nombre].filter(Boolean).join(' · ') + ` · entró a las ${r.entrada}`;
        const h = document.getElementById('hsHora');
        if (h) h.value = r.fecha === this._aClave(this._hoyISO()) ? this._horaAhora() : '';
        document.getElementById('horaSalidaModal').classList.add('show');
        setTimeout(() => h?.focus(), 50);
    },

    cerrarHoraSalida() { document.getElementById('horaSalidaModal').classList.remove('show'); this._salidaDe = null; },

    async guardarHoraSalida() {
        const r = this._porId[this._salidaDe];
        const hora = document.getElementById('hsHora')?.value || '';
        if (!r) return;
        if (!/^\d{2}:\d{2}$/.test(hora)) { this._mostrarToast('❌ Pon la hora de salida', 3000); return; }
        if (hora < r.entrada) { this._mostrarToast('❌ La salida no puede ser antes que la entrada', 3500); return; }
        try {
            const data = await this._enviarRegistro({ id: r.id, salida: hora });
            this.cerrarHoraSalida();
            this._renderDia();
            this._renderHistorial();
            this._mostrarToast(`🚪 Salida a las ${data.salida}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    // ── Lo apuntado ──────────────────────────────────────────────────────────

    _tarjeta(r, conFecha) {
        // Sin hora de salida no se pone nada. El botón para apuntarla, solo en
        // los de hoy: en uno de otro día pondría la hora de ahora, que no es.
        const abierto = !r.salida && r.fecha === this._aClave(this._hoyISO());
        const quien = [r.nombre, r.empresa].filter(Boolean).join(' · ');
        const que = [r.vehiculo, r.departamento && r.departamento !== '-' ? '→ ' + r.departamento : ''].filter(Boolean).join(' ');
        return `<div class="re-card${abierto ? ' dentro' : ''}" onclick="app.abrirRegistro('${esc(r.id)}')">
            <div class="re-top">
                <span class="re-horas">${conFecha ? esc(this._diaLargo(r.fecha)) + ' · ' : ''}${esc(r.entrada)}${r.salida ? '–' + esc(r.salida) : ''}</span>
                ${r.matricula ? `<span class="re-mat">${esc(r.matricula)}</span>` : ''}
            </div>
            ${quien ? `<div class="re-quien">${esc(quien)}</div>` : ''}
            ${que ? `<div class="re-que">${esc(que)}</div>` : ''}
            ${ES_GC && r.creadoPor ? `<div class="re-que">Apuntado por ${esc(r.creadoPor)}</div>` : ''}
            ${!r.salida ? `<div class="re-btns">${abierto
                ? `<button class="btn chico" onclick="event.stopPropagation();app.marcarSalida('${esc(r.id)}')">🚪 Salida ahora</button>` : ''}
                <button class="btn sec chico" onclick="event.stopPropagation();app.ponerHoraSalida('${esc(r.id)}')">🕒 Poner hora</button></div>` : ''}
        </div>`;
    },

    _renderDia() {
        const cont = document.getElementById('rLista');
        if (!cont) return;
        const lista = this._registrosDe(this._dia);
        const cab = document.getElementById('rCuantos');
        if (cab) cab.textContent = lista.length ? String(lista.length) : '';
        cont.innerHTML = lista.length
            // Los que siguen dentro, arriba: son a los que hay que apuntar la salida
            ? [...lista.filter(r => !r.salida), ...lista.filter(r => r.salida)].map(r => this._tarjeta(r)).join('')
            : '<div class="pa-vacio">Todavía no hay nada apuntado este día.</div>';
    },

    // A mano, con el botón: lo que haya apuntado otra garita, ya
    async recargar() {
        const b = document.getElementById('rRecargar');
        if (b) { b.disabled = true; b.textContent = '⏳'; }
        const [a, d] = await Promise.all([this.cargarRegistros(true), this.cargarRegistros(true, this._dia, this._dia),
                                          this.cargarVisitantes()]);
        if (b) { b.disabled = false; b.textContent = '🔄 Recargar'; }
        if (a && d) this._mostrarToast('✅ Actualizado', 1500);
    },

    // Y solo: mientras la app está a la vista, cada pocos segundos se trae
    // lo nuevo, para que lo que apunta una garita salga en la otra al momento.
    // Al volver a la app, también.
    _sincronizarSolo() {
        if (this._relojSync) return;
        const traer = () => {
            if (!this.usuarioActual || document.visibilityState !== 'visible') return;
            // Con un cuadro abierto no se repinta nada debajo
            if (document.querySelector('.modal.show')) return;
            const hoy = this._aClave(this._hoyISO());
            // El día que se está viendo y hasta hoy: lo que puede haber cambiado
            const desde = this._dia && this._dia < hoy ? this._dia : hoy;
            this.cargarRegistros(false, desde, this._dia > hoy ? this._dia : hoy);
        };
        this._relojSync = setInterval(traer, 15000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') { traer(); this.cargarVisitantes(); }
        });
    },

    async cargarRegistros(forzar, desde, hasta) {
        if (!desde) {
            desde = this._aClave(document.getElementById('paDesde')?.value) || this._aClave(this._isoHaceDias(30));
            hasta = this._aClave(document.getElementById('paHasta')?.value) || this._aClave(this._hoyISO());
        }
        const q = new URLSearchParams({ desde, hasta });
        try {
            const r = await fetch(ACCESOS_URL + '?' + q, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            const lista = await r.json();
            // Lo de esas fechas manda: lo que ya no está es que se ha borrado
            Object.values(this._porId).forEach(x => { if (x.fecha >= desde && x.fecha <= hasta) delete this._porId[x.id]; });
            lista.forEach(x => { this._porId[x.id] = x; });
            this._guardarCacheRegistros();
            this._renderDia();
            this._renderHistorial();
            return true;
        } catch (e) {
            if (forzar) this._mostrarToast('📴 Sin conexión: se ve lo último que se cargó', 3000);
        }
        this._renderDia();
        this._renderHistorial();
        return false;
    },

    limpiarFiltros() {
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('paDesde', this._isoHaceDias(30));
        v('paHasta', this._hoyISO());
        this.cargarRegistros(true);
    },

    _enHistorial() {
        const desde = this._aClave(document.getElementById('paDesde')?.value) || this._aClave(this._isoHaceDias(30));
        const hasta = this._aClave(document.getElementById('paHasta')?.value) || this._aClave(this._hoyISO());
        const busca = this._claveMatricula(document.getElementById('paBuscar')?.value || '');
        const texto = String(document.getElementById('paBuscar')?.value || '').trim().toLowerCase();
        return Object.values(this._porId)
            .filter(r => r.fecha >= desde && r.fecha <= hasta)
            .filter(r => !texto || (busca && this._claveMatricula(r.matricula).includes(busca))
                || [r.nombre, r.empresa, r.vehiculo, r.departamento].some(x => String(x || '').toLowerCase().includes(texto)))
            .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.entrada || '').localeCompare(a.entrada || ''));
    },

    _renderHistorial() {
        const cont = document.getElementById('paLista');
        if (!cont) return;
        const lista = this._enHistorial();
        if (!lista.length) {
            cont.innerHTML = '<div class="pa-vacio">No hay registros en esas fechas.</div>';
            return;
        }
        let dia = '';
        cont.innerHTML = lista.map(r => {
            const cab = r.fecha !== dia ? `<div class="re-dia">${esc(this._diaLargo(r.fecha))}</div>` : '';
            dia = r.fecha;
            return cab + this._tarjeta(r);
        }).join('');
    },

    // ── Corregir un registro ─────────────────────────────────────────────────

    abrirRegistro(id) {
        const r = this._porId[id];
        if (!r) return;
        this._editando = id;
        const v = (k, val) => { const el = document.getElementById(k); if (el) el.value = val || ''; };
        v('eFecha', this._aISO(r.fecha)); v('eEntrada', r.entrada); v('eSalida', r.salida);
        v('eMatricula', r.matricula); v('eNombre', r.nombre); v('eEmpresa', r.empresa);
        v('eVehiculo', r.vehiculo); v('eDepartamento', r.departamento);
        const hoy = this._aClave(this._hoyISO());
        const puede = ES_GC || (r.creadoPor === this.usuarioActual?.email && r.fecha === hoy);
        const b = document.getElementById('eBorrar');
        if (b) b.hidden = !puede;
        const firma = document.getElementById('eFirma');
        if (firma) firma.textContent = r.creadoPor
            ? `Apuntado por ${r.creadoPor}` + (r.tocadoPor && r.tocadoPor !== r.creadoPor ? ` · corregido por ${r.tocadoPor}` : '')
            : '';
        document.getElementById('regModal').classList.add('show');
    },

    cerrarRegistro() { document.getElementById('regModal').classList.remove('show'); this._editando = null; },

    salidaAhoraEnCuadro() {
        const el = document.getElementById('eSalida');
        if (el) el.value = this._horaAhora();
    },

    async guardarRegistro() {
        const id = this._editando;
        if (!id) return;
        const g = k => (document.getElementById(k)?.value || '').trim();
        const cuerpo = {
            id, fecha: this._aClave(g('eFecha')), entrada: g('eEntrada'), salida: g('eSalida'),
            matricula: g('eMatricula').toUpperCase(), nombre: g('eNombre'), empresa: g('eEmpresa'),
            vehiculo: g('eVehiculo'), departamento: g('eDepartamento'),
        };
        if (cuerpo.fecha.length !== 8 || !/^\d{2}:\d{2}$/.test(cuerpo.entrada)) {
            this._mostrarToast('❌ Falta el día o la hora de entrada', 3000); return;
        }
        if (cuerpo.salida && cuerpo.salida < cuerpo.entrada) {
            this._mostrarToast('❌ La salida no puede ser antes que la entrada', 3500); return;
        }
        try {
            await this._enviarRegistro(cuerpo);
            this.cerrarRegistro();
            this._renderDia();
            this._renderHistorial();
            this._mostrarToast('✅ Registro guardado', 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    borrarRegistro() {
        const id = this._editando;
        const r = this._porId[id];
        if (!r) return;
        this.cerrarRegistro();
        this.mostrarModal('Borrar el registro',
            `¿Borrar la entrada de las ${r.entrada}${r.matricula ? ' de ' + r.matricula : ''}${r.nombre ? ' (' + r.nombre + ')' : ''}?`,
            async () => {
                try {
                    const resp = await fetch(`${ACCESOS_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok) throw new Error(data.error || resp.status);
                    delete this._porId[id];
                    this._guardarCacheRegistros();
                    this._renderDia();
                    this._renderHistorial();
                    this._mostrarToast('🗑️ Registro borrado', 2500);
                } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
            });
    },

    // ── Exportar (solo en la del puesto) ─────────────────────────────────────
    //
    // Lo que se ve en el historial, con el mismo diseño que la hoja "Listado"
    // que se llevaba a mano: el título arriba, la cabecera en azul claro, todo
    // centrado y la fecha solo en la primera fila de cada día. Un mes, un
    // fichero "Control de acceso - Agosto 2026"; varios, uno por año con una
    // hoja por mes. En Google Sheets, Excel o CSV, como en la de conductores.

    MESES: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
            'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    CABECERAS: ['Fecha', 'Nombre y apellidos', 'Matrícula', 'Marca y modelo', 'Empresa',
                'H. Entrada', 'H. Salida', 'Departamento'],
    ANCHOS: [13.7, 25.6, 13, 30, 22.6, 13.9, 13.9, 28.8],

    // Los registros de lo que se está viendo, por meses, del más viejo al más nuevo
    _mesesExport() {
        const lista = this._enHistorial().slice().sort((a, b) =>
            (a.fecha || '').localeCompare(b.fecha || '') || (a.entrada || '').localeCompare(b.entrada || ''));
        const meses = [];
        lista.forEach(r => {
            const k = String(r.fecha).slice(0, 6);
            let m = meses[meses.length - 1];
            if (!m || m.clave !== k) meses.push(m = { clave: k, anio: k.slice(0, 4),
                                                      nombre: this.MESES[+k.slice(4, 6) - 1], registros: [] });
            m.registros.push(r);
        });
        const anios = [...new Set(meses.map(m => m.anio))];
        meses.forEach(m => { m.hoja = anios.length > 1 ? `${m.nombre} ${m.anio}` : m.nombre;
                             m.titulo = `Control de acceso · ${m.nombre} ${m.anio}`; });
        const nombre = meses.length === 1 ? `Control de acceso - ${meses[0].nombre} ${meses[0].anio}`
                     : `Control de acceso - ${anios.length > 1 ? anios[0] + '-' + anios[anios.length - 1] : anios[0]}`;
        return { meses, nombre, total: lista.length };
    },

    exportarRegistros() {
        const { meses, nombre, total } = this._mesesExport();
        if (!total) { this._mostrarToast('No hay registros que exportar', 3000); return; }
        const res = document.getElementById('expResumen');
        if (res) res.textContent = `${total} registros · ${meses.length === 1 ? meses[0].nombre + ' ' + meses[0].anio
            : meses.length + ' meses, una hoja por mes'} · «${nombre}»`;
        document.getElementById('expModal').classList.add('show');
    },

    cerrarExport() { document.getElementById('expModal').classList.remove('show'); },

    _fechaCorta(f) { return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(2, 4)}`; },

    // Las filas de un mes: la fecha solo en la primera de cada día
    _filasMes(m) {
        let dia = '';
        return m.registros.map(r => {
            const f = r.fecha !== dia ? r.fecha : '';
            dia = r.fecha;
            return [f, r.nombre, r.matricula, r.vehiculo, r.empresa, r.entrada, r.salida, r.departamento];
        });
    },

    // ── CSV: una hoja no cabe en otra, así que cada mes va en su bloque ─────

    _csv() {
        const esc = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const { meses } = this._mesesExport();
        const bloques = meses.map(m => [
            m.titulo, this.CABECERAS.join(';'),
            ...this._filasMes(m).map(f => [f[0] ? this._fechaCorta(f[0]) : '', ...f.slice(1)].map(esc).join(';')),
        ].join('\r\n'));
        return '﻿' + bloques.join('\r\n\r\n') + '\r\n';
    },

    // ── Excel (.xlsx), hecho aquí mismo: un ZIP con unos cuantos XML ────────

    _crc32(bytes) {
        let tabla = this._crcTabla;
        if (!tabla) {
            tabla = this._crcTabla = new Int32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                tabla[n] = c;
            }
        }
        let crc = -1;
        for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ tabla[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    },

    _zip(ficheros) {
        const enc = new TextEncoder();
        const partes = [], central = [];
        let offset = 0;
        const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
        const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
        ficheros.forEach(({ nombre, texto }) => {
            const datos = enc.encode(texto);
            const nom = enc.encode(nombre);
            const crc = this._crc32(datos);
            const comun = [...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x2100),
                           ...u32(crc), ...u32(datos.length), ...u32(datos.length), ...u16(nom.length)];
            partes.push(new Uint8Array([...u32(0x04034b50), ...comun, ...u16(0)]), nom, datos);
            central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...comun,
                ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nom);
            offset += 30 + nom.length + datos.length;
        });
        const tamCentral = central.reduce((n, p) => n + p.length, 0);
        const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0),
            ...u16(ficheros.length), ...u16(ficheros.length), ...u32(tamCentral), ...u32(offset), ...u16(0)]);
        const todo = [...partes, ...central, fin];
        const salida = new Uint8Array(todo.reduce((n, p) => n + p.length, 0));
        let i = 0;
        todo.forEach(p => { salida.set(p, i); i += p.length; });
        return salida;
    },

    _xlsx() {
        const { meses } = this._mesesExport();
        const esc = v => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        const col = n => String.fromCharCode(65 + n);
        const texto = (ref, v, st) => v === '' || v == null ? `<c r="${ref}" s="${st}"/>`
            : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        const numero = (ref, v, st) => `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
        // Fechas y horas como las de Excel: días desde 1899-12-30 y fracción de día
        const serial = f => (Date.UTC(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8)) - Date.UTC(1899, 11, 30)) / 86400000;
        const hora = h => { const [a, b] = String(h).split(':').map(Number); return (a * 60 + b) / 1440; };
        const ultima = col(this.CABECERAS.length - 1);

        const hojas = meses.map(m => {
            const filas = [
                `<row r="1" ht="24" customHeight="1">${texto('A1', m.titulo, 5)}</row>`,
                `<row r="2" ht="22.5" customHeight="1">${this.CABECERAS.map((h, i) => texto(col(i) + '2', h, 1)).join('')}</row>`,
                ...this._filasMes(m).map((f, n) => {
                    const r = n + 3;
                    return `<row r="${r}" ht="21" customHeight="1">` + f.map((v, i) => {
                        const ref = col(i) + r;
                        if (i === 0) return v ? numero(ref, serial(v), 3) : `<c r="${ref}" s="2"/>`;
                        if ((i === 5 || i === 6) && /^\d{2}:\d{2}$/.test(v || '')) return numero(ref, hora(v), 4);
                        return texto(ref, v, 2);
                    }).join('') + '</row>';
                }),
            ].join('');
            const anchos = this.ANCHOS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
            return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                + `<cols>${anchos}</cols><sheetData>${filas}</sheetData>`
                + `<mergeCells count="1"><mergeCell ref="A1:${ultima}1"/></mergeCells>`
                + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
                + '<pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>'
                // El título también en la cabecera de la página, al imprimir
                + `<headerFooter><oddHeader>&amp;C&amp;B${esc(m.titulo)}</oddHeader><oddFooter>&amp;CPágina &amp;P de &amp;N</oddFooter></headerFooter>`
                + '</worksheet>';
        });

        const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
        const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const fuente = 'Aptos Narrow';
        return this._zip([
            { nombre: '[Content_Types].xml', texto: X
              + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
              + '<Default Extension="xml" ContentType="application/xml"/>'
              + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
              + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
              + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
              + '</Types>' },
            { nombre: '_rels/.rels', texto: X + `<Relationships xmlns="${REL}">`
              + `<Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
            { nombre: 'xl/workbook.xml', texto: X + `<workbook xmlns="${NS}" xmlns:r="${DOC}"><sheets>`
              + meses.map((m, i) => `<sheet name="${esc(m.hoja).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
              + '</sheets>'
              + `<definedNames>${meses.map((m, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(m.hoja).slice(0, 31)}'!$1:$2</definedName>`).join('')}</definedNames>`
              + '</workbook>' },
            { nombre: 'xl/_rels/workbook.xml.rels', texto: X + `<Relationships xmlns="${REL}">`
              + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
              + `<Relationship Id="rId${hojas.length + 1}" Type="${DOC}/styles" Target="styles.xml"/></Relationships>` },
            { nombre: 'xl/styles.xml', texto: X + `<styleSheet xmlns="${NS}">`
              + '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yy"/><numFmt numFmtId="165" formatCode="h:mm"/></numFmts>'
              + `<fonts count="3"><font><sz val="11"/><name val="${fuente}"/></font>`
              + `<font><b/><sz val="11"/><name val="${fuente}"/></font>`
              + `<font><b/><sz val="14"/><color rgb="FF156082"/><name val="${fuente}"/></font></fonts>`
              + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
              + '<fill><patternFill patternType="solid"><fgColor rgb="FFC0E4F5"/><bgColor indexed="64"/></patternFill></fill></fills>'
              + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              + '<cellXfs count="6">'
              + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
              + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
              + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
              + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
              + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
              + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
            ...hojas.map((texto, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto })),
        ]);
    },

    _guardarArchivo(bytes, nombre, tipo) {
        if (window.AndroidBridge?.saveFileBase64) {
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            window.AndroidBridge.saveFileBase64(btoa(bin), nombre);
            return true;
        }
        if (window.AndroidBridge?.saveFile) return false;   // APK anterior, sin el puente binario
        const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    },

    exportarXLS() {
        const { nombre, total } = this._mesesExport();
        this.cerrarExport();
        const ok = this._guardarArchivo(this._xlsx(), nombre + '.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel; de momento usa CSV', 4500); return; }
        this._mostrarToast(`📗 ${total} registros en Excel`, 3500);
    },

    exportarCSV() {
        const { nombre, total } = this._mesesExport();
        this.cerrarExport();
        const csv = this._csv();
        if (window.AndroidBridge?.saveFile) {
            try { window.AndroidBridge.saveFile(csv, nombre + '.csv'); return; } catch (_) {}
        }
        this._guardarArchivo(new TextEncoder().encode(csv), nombre + '.csv', 'text/csv;charset=utf-8');
        this._mostrarToast(`📊 ${total} registros en CSV`, 3500);
    },

    // Google Sheets: se sube el mismo Excel y Drive lo convierte, con sus
    // hojas por mes y su formato
    async exportarSheets() {
        const { nombre, total } = this._mesesExport();
        this.cerrarExport();
        this._mostrarToast('☁️ Creando la hoja en tu Drive…', 3000);
        try {
            const frontera = 'emt' + Date.now();
            const meta = JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.spreadsheet' });
            const cuerpo = new Blob([
                `--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
                + `--${frontera}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
                this._xlsx(),
                `\r\n--${frontera}--`,
            ]);
            const r = await this._drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + frontera }, body: cuerpo,
            });
            const out = await r.json();
            this._mostrarToast(`✅ ${total} registros en Google Sheets`, 3500);
            if (out.webViewLink) {
                if (window.AndroidBridge?.openExternalUrl) window.AndroidBridge.openExternalUrl(out.webViewLink);
                else window.open(out.webViewLink, '_blank');
            }
        } catch (e) {
            if (e.sinPermiso) this._pedirPermisoDrive();
            else this._mostrarToast('❌ No se ha podido crear la hoja: ' + e.message, 5000);
        }
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

    // Quien ya tiene la aplicación: se abre —por el mismo enlace por el que
    // vuelve de Google— y no se le vuelve a ofrecer. La web no tiene forma de
    // saber por sí sola si está instalada. Si no lo estuviera, Chrome se queda
    // en esta misma página.
    _abrirAppInstalada() {
        if (!/Android/i.test(navigator.userAgent)) return;
        const vuelta = encodeURIComponent(window.location.href);
        window.location.href = `intent://localhost/#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${vuelta};end`;
    },

    elegirModo(modo) {
        try { localStorage.setItem('modoUso', modo); } catch (_) {}
        const pant = document.getElementById('modoScreen');
        if (pant) pant.style.display = 'none';
        if (modo === 'instalada') this._abrirAppInstalada();
        else if (modo === 'apk') this.instalarApp();
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
