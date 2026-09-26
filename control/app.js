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
// Aquí no se guarda nada en Drive ni se manda ningún correo, así que se piden
// los permisos justos: quién eres. Con cualquiera de los que Google llama
// sensibles saldría el aviso de aplicación no verificada.
const AUTH_SCOPE = 'profile email';

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

const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const app = {
    accessToken: localStorage.getItem('cAccessToken') || null,
    tokenExpiry: parseInt(localStorage.getItem('cTokenExpiry') || '0'),
    refreshToken: localStorage.getItem('cRefreshToken') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
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
        this._instalarFirmaApi();
        // La comprobación de versión va aparte y con retraso: si algo de arriba
        // falla, quien la tenga instalada no puede quedarse clavado para
        // siempre en una versión vieja por culpa de eso.
        setTimeout(() => { try { this._checkForUpdates(); } catch (_) {} }, 1500);
        if (this.darkMode) document.body.classList.add('dark');
        this._pintarTurnos();
        this._setupDeepLinkListener();
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
            this.mostrarApp();
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
            this._nuevoParteDeHoy();
            this.cargarPartes();
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
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        const q = document.getElementById('opsQuien');
        if (q) q.textContent = this.usuarioActual?.email || '';
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

    irA(n) {
        this._tab = n;
        document.querySelectorAll('.tab').forEach((el, i) => el.classList.toggle('active', i === n));
        document.querySelectorAll('.tab-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === String(n)));
        document.getElementById('contenido').scrollTop = 0;
        if (n === 1) this.cargarPartes();
    },

    _pintarQuien() {
        const el = document.getElementById('cabeceraSub');
        if (el) el.textContent = this.usuarioActual?.name || this.usuarioActual?.email || '';
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
        const el = document.getElementById('versionTxt');
        if (el) el.textContent = n ? 'Versión ' + this._buildNumToVersion(n) : 'Versión de pruebas';
    },

    async _releases() {
        const CACHE = 'releasesCache', EDAD = 'releasesCacheAt';
        const t = parseInt(sessionStorage.getItem(EDAD) || '0', 10);
        if (Date.now() - t < 5 * 60 * 1000) {
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
        if (!window.Capacitor?.isNativePlatform?.()) return;
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        try {
            const res = await this._releases();
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
