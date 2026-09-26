(function(){var t=localStorage.getItem('tema');if(t&&t!=='azul')document.body.classList.add('theme-'+t);})();
'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
// Al entrar solo se piden permisos de los que Google llama corrientes. Con
// uno solo de los "sensibles" sale el aviso de aplicación no verificada, el de
// Configuración avanzada, y ahí se atasca cualquiera. Eran dos: la carpeta
// oculta de Drive, donde vivía el historial, y enviar correo.
//
// La carpeta oculta ya no hace falta: la copia se mudó a un archivo normal
// dentro de "Movilidad Emt", y a eso llega drive.file, que da acceso a lo que
// crea la propia app. Se hizo en dos pasos y no de golpe, porque quitarlo
// antes de mudar la copia deja sin historial a quien no haya actualizado.
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.file profile email';
// Enviar el correo sin salir de la app sí es sensible, así que no se le pide a
// todo el mundo al entrar: se pide aparte, y solo a quien vaya a usarlo.
const GMAIL_SCOPE      = 'https://www.googleapis.com/auth/gmail.send';
const AUTH_SCOPE       = 'profile email';
// Turnos de cada puesto. La hora de entrada registrada decide en cuál cae.
let PUESTOS_DEFINIDOS = ['Son Rossinyol', 'Control', 'Calle', 'Taller', 'Anselmo Clavé'];

const TURNOS_POR_PUESTO = {
    'son rossinyol': [
        { id: 'M', nombre: 'Mañana', desde: '03:45', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
        { id: 'N', nombre: 'Noche',  desde: '21:00', hasta: '04:00' },
    ],
    'control': [
        { id: 'M', nombre: 'Mañana', desde: '05:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '20:00' },
        { id: 'N', nombre: 'Noche',  desde: '20:00', hasta: '24:00' },
    ],
    'taller': [
        { id: 'M', nombre: 'Mañana', desde: '06:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
        { id: 'N', nombre: 'Noche',  desde: '21:00', hasta: '06:00' },
    ],
    'calle': [
        { id: 'M', nombre: 'Mañana', desde: '07:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
    ],
};

// El catálogo que mantiene el gestor manda sobre la tabla de aquí abajo: así
// se pueden cambiar turnos y añadir lugares sin publicar una versión nueva.
let LUGARES_CATALOGO = {};
function aplicarCatalogoLugares(cat) {
    LUGARES_CATALOGO = cat || {};
    Object.entries(LUGARES_CATALOGO).forEach(([k, l]) => {
        // Un turno de 00:00 a 00:00 no es un turno: es lo que queda cuando se
        // le vacían las horas para quitarlo. Se descarta, y si el lugar se
        // queda sin ninguno se respeta —el taller no tiene mañana ni tarde—
        // en vez de recaer en la tabla de aquí arriba.
        if (Array.isArray(l?.turnos)) {
            TURNOS_POR_PUESTO[k] = l.turnos.filter(f => f && f.desde && f.hasta && f.desde !== f.hasta);
        }
        const nombre = l?.nombre;
        if (nombre && !PUESTOS_DEFINIDOS.some(p => p.toLowerCase().normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') === k)) {
            PUESTOS_DEFINIDOS.push(nombre);
        }
    });
}

// De qué aplicación se trata; aquí siempre la de trabajador, pero se lee
// igual que en la otra para que el mismo código valga en las dos.
const ROL_APP = (document.querySelector('meta[name="app-rol"]')?.content || 'trabajador').trim();

const SUPER_USER_EMAIL = 'guillermo.rc82@gmail.com';
const ALLOWLIST_APP    = 'movilidad';
// A dónde devuelve Google la entrada cuando se hace desde la aplicación. Esta
// dirección exacta tiene que estar dada de alta en la consola de Google como
// URI de redirección autorizada: si no coincide, Google no devuelve a nadie.
// De ahí que esté aquí sola, en un sitio, y no repetida por el fichero.
const RETORNO_APP = 'https://emt-palma-movilidad.vercel.app/';
const LUGARES_URL      = 'https://emt-palma-movilidad.vercel.app/api/lugares';
const VERSION_URL      = 'https://emt-palma-movilidad.vercel.app/api/version';
const ANDROID_PACKAGE  = 'com.guillermorc.horasemt';
const RELEASE_PREFIX   = 'build-';
const DRIVE_FILE_NAME  = 'horas-emt.json';
const HORAS_ANUALES    = 777;

const NOCHE_INICIO_MIN = 21 * 60;
const NOCHE_FIN_MIN    = 6  * 60;

const AVATAR_EMOJIS = ['🚌','⭐','🔥','⚡','🌊','🎯','🚀','🦸','🎨','🌈'];
const AVATAR_BG     = ['#667eea','#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e67e22','#764ba2','#e91e63'];
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const app = {
    accessToken: localStorage.getItem('gAccessToken') || null,
    tokenExpiry: parseInt(localStorage.getItem('gTokenExpiry') || '0'),
    refreshToken: localStorage.getItem('gRefreshToken') || null,
    driveFileId: localStorage.getItem('driveFileId') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    horasAnualesCustom: parseFloat(localStorage.getItem('horasAnuales')) || HORAS_ANUALES,
    precioNocheDefault: parseFloat(localStorage.getItem('precioNoche')) || 0,
    precioExtraDefault: parseFloat(localStorage.getItem('precioExtra')) || 0,
    precioFestivoDefault: parseFloat(localStorage.getItem('precioFestivo')) || 0,
    // Antigüedad: se fija una vez en el perfil y de ahí la coge cada nómina.
    fechaAltaDefault: localStorage.getItem('fechaAlta') || '',
    pctBieniosDefault: parseFloat(localStorage.getItem('pctBieniosManual')) || 0,
    modalCallback: null,
    editingId: null,
    prActivo: false,
    festivoActivo: false,
    extraActivo: false,
    vacacionesActivo: false,
    jornadaHoras: parseFloat(localStorage.getItem('jornadaHoras')) || 7.5,
    // Días de la semana que se trabaja. Vacío = todos, que es como se comportaba
    // antes de existir este ajuste.
    diasSemana: (() => { try { const d = JSON.parse(localStorage.getItem('diasSemana') || 'null');
        return Array.isArray(d) ? d : null; } catch (_) { return null; } })(),
    numConductor: localStorage.getItem('numConductor') || '',
    puestoTrabajo: localStorage.getItem('puestoTrabajo') || '',
    backupFreq: localStorage.getItem('backupFreq') || 'cerrar',
    _backupTimer: null,
    _activeTab: 0,
    _dragSrcTab: null,
    _allowedUsersLocal: null,
    tema: localStorage.getItem('tema') || 'azul',
    _historialMap: {},
    _historialFull: {},
    _bgGeoStarted: false,
    _notifEnviadaAt: 0,
    _geoWatcherId: null,
    _lastGeoCheck: 0,
    gpsMode: localStorage.getItem('gpsMode') || 'always',
    gpsInterval: parseInt(localStorage.getItem('gpsInterval') || '60'),
    gpsScheduleFrom: localStorage.getItem('gpsScheduleFrom') || '07:00',
    gpsScheduleTo: localStorage.getItem('gpsScheduleTo') || '09:00',
    _scheduleTimer: null,
    _tokenRefreshTimer: null,
    _toastTimer: null,
    _pendingNotifAction: null,
    notifSound: localStorage.getItem('notifSound') || 'default',
    _updateApkUrl: null,

    async init() {
        this._preguntarConQueApp();
        this._instalarFirmaApi();
        // The update check must run even if any earlier step throws, otherwise a
        // single bug anywhere above strands the user on an old build forever.
        setTimeout(() => { try { this._checkForUpdates(); } catch(_) {} }, 1500);
        this._migrarUbicacionAntigua();
        this.setupUI();
        if (this.darkMode) this.aplicarDarkMode();
        this._restaurarTabs();
        this._initSwipeTabs();
        this._restaurarMensual();
        this._cargarCuadrante();
        this._aplicarModoVacaciones();
        this._buildAvatarGrid();
        this._setupDeepLinkListener();
        this._setupAppLifecycleBackup();
        this._setupNotificationActions(); // must register listener before any async
        this._setupNotifChat();           // y las del chat, por lo mismo
        this._initGoogleAuth();
        this._actualizarVersionDisplay();
    },

    // La dirección de siempre abre la app de los trabajadores, y quien es de
    // gestión no tenía forma de saber que lo suyo está en otra. Así que al
    // entrar por el navegador se pregunta primero. No se pregunta si se viene
    // con un código de Google a medio camino —eso hay que dejarlo pasar—, ni
    // desde la app instalada, ni desde la de escritorio, que ahí ya se eligió.
    _preguntarConQueApp() {
        if (window.Capacitor?.isNativePlatform?.()) return;
        const q = new URLSearchParams(window.location.search);
        if (q.get('app')) return;
        if (q.has('code') || q.has('access_token') || q.has('error')
            || window.location.hash.includes('access_token')) return;
        try {
            if (window.matchMedia?.('(display-mode: standalone)')?.matches
                || window.navigator.standalone) return;
        } catch (_) {}
        const el = document.getElementById('rolScreen');
        if (el) el.style.display = 'flex';
    },

    // Esto se abre desde el navegador, así que lo que hace es llevar a la web
    // que toca. Antes intentaba abrir la aplicación con un enlace de tipo
    // intent que llevaba escrito a dónde ir si no estaba instalada, pero ese
    // "si no está" no lo respetan todos los navegadores: al que no la tenía le
    // salía la pantalla de error y se quedaba sin poder entrar por ningún
    // lado. Quien la tenga instalada la abre desde su icono, que para eso está.
    elegirRol(rol) {
        const ver = (id, si) => { const el = document.getElementById(id); if (el) el.style.display = si ? 'flex' : 'none'; };
        // Gestión son dos, y antes de entrar se pregunta cuál
        if (rol === 'gestion') { ver('rolScreen', false); ver('gestionScreen', true); return; }
        if (rol === 'volver')  { ver('gestionScreen', false); ver('rolScreen', true); return; }
        const webs = {
            'gestion-emt':     '/gestion/',
            'control':         '/control/',
            'gestion-control': '/control/?app=gestion-control',
        };
        if (webs[rol]) { window.location.href = webs[rol]; return; }
        ver('rolScreen', false);
        try { history.replaceState(null, '', '/?app=trabajador'); } catch (_) {}
    },

    _migrarUbicacionAntigua() {
        // La copia ya no está en la carpeta oculta de Drive sino en un
        // archivo normal, el que la versión anterior venía dejando ahí. Se
        // apunta a ese, una sola vez; si este móvil no tiene guardado cuál es,
        // se olvida el viejo y se busca por nombre.
        if (!localStorage.getItem('copiaDriveNormal')) {
            localStorage.setItem('copiaDriveNormal', '1');
            const normal = localStorage.getItem('driveFileIdVisible');
            if (normal) localStorage.setItem('driveFileId', normal);
            else localStorage.removeItem('driveFileId');
            this.driveFileId = localStorage.getItem('driveFileId') || null;
            // Lo mismo donde lo busca el móvil: el registro rápido lo usa con
            // la app cerrada, y se quedaría apuntando a la copia vieja.
            if (this.driveFileId) window.AndroidBridge?.saveToPrefs?.('driveFileId', this.driveFileId);
            else window.AndroidBridge?.removePref?.('driveFileId');
        }
        const old = localStorage.getItem('workLocation');
        if (old && !localStorage.getItem('workLocations')) {
            const loc = JSON.parse(old);
            localStorage.setItem('workLocations', JSON.stringify([{ name: 'Trabajo', lat: loc.lat, lng: loc.lng }]));
            localStorage.removeItem('workLocation');
        }
    },

    _initGoogleAuth() {
        const hashParams = window.location.hash.length > 1
            ? new URLSearchParams(window.location.hash.slice(1)) : null;
        const searchParams = window.location.search.length > 1
            ? new URLSearchParams(window.location.search.slice(1)) : null;

        const code  = searchParams?.get('code');
        const token = hashParams?.get('access_token') || searchParams?.get('access_token');
        const error = hashParams?.get('error') || searchParams?.get('error');

        if (code) {
            const pkgDestino = this._paqueteDestino(searchParams);
            if (this._rebotarAGestion(pkgDestino, searchParams)) return;
            if (this._rebotarAControl(pkgDestino, searchParams)) return;
            history.replaceState(null, '', window.location.pathname);
            // PKCE: exchange code for tokens via Vercel endpoint
            if (!window.Capacitor && /Android/i.test(navigator.userAgent)
                    && this._vieneDeLaApp(searchParams) && searchParams?.get('vuelta') !== '1') {
                // External Chrome on Android — bounce code back to native app via intent.
                // Con salida: si la app no está instalada, Chrome se queda en
                // esta misma página en vez de en su pantalla de error.
                const vuelta = window.location.origin + window.location.pathname
                    + '?code=' + encodeURIComponent(code) + '&vuelta=1';
                const intentUrl = `intent://localhost/?code=${encodeURIComponent(code)}#Intent;scheme=https;package=${pkgDestino};S.browser_fallback_url=${encodeURIComponent(vuelta)};end`;
                document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1565C0;color:#fff;font-family:sans-serif;gap:20px;padding:32px;text-align:center;box-sizing:border-box;"><div style="font-size:56px;">✅</div><h2 style="margin:0;font-size:20px;font-weight:700;">¡Sesión iniciada!</h2><p style="margin:0;opacity:0.85;font-size:15px;">Volviendo a la app...</p><p style="margin:0;font-size:12px;opacity:0.6;">Puedes cerrar esta pestaña</p><a href="${intentUrl}" id="_oauthReturnBtn" style="background:#fff;color:#1565C0;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;margin-top:8px;display:inline-block;">Abrir la aplicación ›</a></div>`;
                setTimeout(() => document.getElementById('_oauthReturnBtn')?.click(), 300);
                setTimeout(() => { try { window.close(); } catch(e) {} }, 1200);
                return;
            }
            this._exchangeCode(code);
            return;
        }

        if (token || error) {
            const pkgDestino = this._paqueteDestino(searchParams);
            history.replaceState(null, '', window.location.pathname);
            if (token) {
                if (!window.Capacitor && /Android/i.test(navigator.userAgent)
                        && this._vieneDeLaApp(searchParams)) {
                    const exp = hashParams?.get('expires_in') || '3600';
                    const intentUrl = `intent://localhost/?access_token=${encodeURIComponent(token)}&expires_in=${exp}#Intent;scheme=https;package=${pkgDestino};end`;
                    document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1565C0;color:#fff;font-family:sans-serif;gap:20px;padding:32px;text-align:center;box-sizing:border-box;"><div style="font-size:56px;">✅</div><h2 style="margin:0;font-size:20px;font-weight:700;">¡Sesión iniciada!</h2><p style="margin:0;opacity:0.85;font-size:15px;">Volviendo a la app...</p><p style="margin:0;font-size:12px;opacity:0.6;">Puedes cerrar esta pestaña</p><a href="${intentUrl}" id="_oauthReturnBtn" style="background:#fff;color:#1565C0;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;margin-top:8px;display:inline-block;">Abrir la aplicación ›</a></div>`;
                    setTimeout(() => document.getElementById('_oauthReturnBtn')?.click(), 300);
                    setTimeout(() => { try { window.close(); } catch(e) {} }, 1200);
                    return;
                }
                const expiresIn = parseInt(hashParams?.get('expires_in') || searchParams?.get('expires_in') || '3600');
                this.driveFileId = null;
                localStorage.removeItem('driveFileId');
                sessionStorage.removeItem('silentReauthAttempted');
                this._saveToken({ access_token: token, expires_in: expiresIn });
                this._loadUserAndStart();
                return;
            }
            if (!window.Capacitor && /Android/i.test(navigator.userAgent)
                    && this._vieneDeLaApp(searchParams)) {
                const failUrl = `intent://localhost/?silent_failed=1#Intent;scheme=https;package=${pkgDestino};end`;
                setTimeout(() => { window.location.href = failUrl; }, 100);
                return;
            }
            this.mostrarAuth();
            this.mostrarMensaje('Error Google: ' + error, 'error');
            return;
        }

        if (this.accessToken && Date.now() < this.tokenExpiry) {
            this._loadUserAndStart();
        } else {
            const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
            const hasSession = !!(localStorage.getItem('gUserEmail') && (this.refreshToken || localStorage.getItem('gUserEmail')));
            if (hasSession && !sessionStorage.getItem('silentReauthAttempted')) {
                sessionStorage.setItem('silentReauthAttempted', '1');
                document.getElementById('authScreen')?.classList.add('hidden');
                this._silentReauth();
            } else {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
            }
        }
    },

    // Escucha appUrlOpen de Capacitor: se dispara cuando la app ya está abierta
    // (arranque en caliente) y recibe un deep-link intent con el token OAuth.
    _setupDeepLinkListener() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        try {
            window.Capacitor.Plugins.App?.addListener('appUrlOpen', (data) => {
                this._processOAuthUrl(data?.url);
            });
            window.Capacitor.Plugins.App?.addListener('backButton', () => {
                if (!this.atras()) window.Capacitor.Plugins.App?.minimizeApp?.();
            });
        } catch (_) {}
    },

    // Atrás cierra lo que haya abierto, de lo último a lo primero, y solo
    // cierra la app cuando ya no queda nada. Antes esto era una lista de tres
    // modales escrita a mano: cualquier cuadro nuevo —una conversación, un
    // lugar, el visor de una foto— se saltaba la lista y cerraba la app.
    atras() {
        // Los visores van por encima de todo
        const visor = [...document.querySelectorAll('.foto-visor.show, .cuad-visor.show')].pop();
        if (visor) {
            visor.classList.remove('show');
            document.getElementById('fotoVisorImg')?.removeAttribute('src');
            return true;
        }
        // De los cuadros abiertos, el de encima: el que más z-index tenga y,
        // a igualdad, el último del documento, que es como se apilan aquí.
        const abiertos = [...document.querySelectorAll('.modal.show')];
        if (abiertos.length) {
            const z = el => parseInt(getComputedStyle(el).zIndex, 10) || 0;
            const arriba = abiertos.reduce((a, b) => (z(b) >= z(a) ? b : a));
            arriba.classList.remove('show');
            return true;
        }
        if (document.getElementById('optionsScreen')?.classList.contains('active')) {
            this.mostrarApp();
            return true;
        }
        // Nada abierto: se devuelve false y decide quien llamó. En el móvil
        // llama Java, que hace moveTaskToBack; aquí no se minimiza nada para
        // no hacerlo dos veces.
        return false;
    },

    _processOAuthUrl(url) {
        if (!url) return;
        try {
            const u = new URL(url);
            if (u.searchParams.get('silent_failed') === '1') {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
                return;
            }
            const code = u.searchParams.get('code');
            if (code) {
                this.driveFileId = null;
                localStorage.removeItem('driveFileId');
                sessionStorage.removeItem('silentReauthAttempted');
                this._exchangeCode(code);
                return;
            }
            const token = u.searchParams.get('access_token');
            if (!token) return;
            const expiresIn = parseInt(u.searchParams.get('expires_in') || '3600');
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            this._saveToken({ access_token: token, expires_in: expiresIn });
            this._loadUserAndStart();
        } catch (_) {}
    },

    // Todas las escrituras a nuestra API van firmadas con el token de Google, y
    // el servidor saca de ahí quién eres en vez de creerse una cabecera. Se
    // engancha en fetch, en un único sitio, para que no se pueda olvidar en
    // ninguna llamada nueva.
    API_BASE: 'https://emt-palma-movilidad.vercel.app/api/',

    _instalarFirmaApi() {
        if (this._fetchOriginal) return;
        this._fetchOriginal = window.fetch.bind(window);
        const app = this;
        window.fetch = async function (recurso, opciones) {
            const url = typeof recurso === 'string' ? recurso : recurso?.url || '';
            // El intercambio de tokens no lleva token, por razones obvias
            if (!url.startsWith(app.API_BASE) || url.startsWith(app.API_BASE + 'auth/')) {
                return app._fetchOriginal(recurso, opciones);
            }
            const op = { ...(opciones || {}) };
            const metodo = (op.method || 'GET').toUpperCase();
            // La firma iba solo en lo que escribe, y hay lecturas que también
            // piden saber quién llama: la nómina de uno mismo y su cuadrante
            // personal, sin ir más lejos. Sin firma el servidor respondía 401
            // y la app se quedaba con lo último que tuviera guardado en el
            // móvil —en uno recién instalado, nada—, así que la nómina había
            // que rellenarla otra vez y no había ninguna que exportar.
            if (metodo !== 'OPTIONS') {
                // Si está caducado se renueva antes: enviarlo vencido sería un
                // 401. Solo al escribir: el sondeo de mensajes pasa por aquí
                // cada minuto y no puede acabar sacando la pantalla de entrar.
                if (metodo !== 'GET' && app.accessToken && Date.now() >= app.tokenExpiry) {
                    try { await app._silentReauth(); } catch (_) {}
                }
                // Las cabeceras pueden venir como objeto o como Headers, y
                // esparcir un Headers da {} y se perdería el Content-Type.
                const h = new Headers(op.headers || {});
                if (app.accessToken) h.set('Authorization', `Bearer ${app.accessToken}`);
                op.headers = h;
            }
            return app._fetchOriginal(recurso, op);
        };
    },

    async _ensureToken() {
        return !!(this.accessToken && Date.now() < this.tokenExpiry);
    },

    _saveToken(response) {
        this.accessToken = response.access_token;
        this.tokenExpiry = Date.now() + (parseInt(response.expires_in) - 60) * 1000;
        localStorage.setItem('gAccessToken', this.accessToken);
        localStorage.setItem('gTokenExpiry', this.tokenExpiry);
        // Lo que Google ha concedido de verdad. Hay permisos que no se piden
        // al entrar, y sin esto la app no tiene forma de saber si los tiene.
        if (typeof response.scope === 'string' && response.scope) {
            localStorage.setItem('gScopes', response.scope);
        }
        if (response.refresh_token) {
            this.refreshToken = response.refresh_token;
            localStorage.setItem('gRefreshToken', this.refreshToken);
        }
        window.AndroidBridge?.saveToPrefs('accessToken', this.accessToken);
        // The notification receiver needs these to renew an expired token on its own
        window.AndroidBridge?.saveToPrefs('tokenExpiry', String(this.tokenExpiry));
        if (this.refreshToken) window.AndroidBridge?.saveToPrefs('refreshToken', this.refreshToken);
        this._scheduleTokenRefresh();
    },

    _scheduleTokenRefresh() {
        clearTimeout(this._tokenRefreshTimer);
        const ms = this.tokenExpiry - Date.now() - 2 * 60 * 1000; // 2 min before expiry
        if (ms <= 0) { this._silentReauth(); return; }
        this._tokenRefreshTimer = setTimeout(() => this._silentReauth(), ms);
    },

    async _loadUserAndStart() {
        this._instalarFirmaApi();
        try {
            const ok = await this._ensureToken();
            if (!ok) { this._silentReauth(); return; }
            const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });
            if (!resp.ok) { this.mostrarAuth(); this.mostrarMensaje('Error al obtener perfil: ' + resp.status, 'error'); return; }
            this.usuarioActual = await resp.json();
            const prevEmail = localStorage.getItem('gUserEmail');
            if (prevEmail && prevEmail.toLowerCase() !== this.usuarioActual.email.toLowerCase()) {
                this._olvidarLoDelAnterior();
                localStorage.setItem('gUserEmail', this.usuarioActual.email);
                // La sesión recién abierta se vuelve a dejar donde la busca el
                // móvil: los avisos y el registro rápido tiran de ahí con la
                // app cerrada, y sin esto se quedarían con la del anterior.
                window.AndroidBridge?.saveToPrefs?.('accessToken', this.accessToken || '');
                window.AndroidBridge?.saveToPrefs?.('tokenExpiry', String(this.tokenExpiry || 0));
                if (this.refreshToken) window.AndroidBridge?.saveToPrefs?.('refreshToken', this.refreshToken);
                // Se recarga porque lo que ya estaba leído sigue en memoria: sin
                // esto seguiría en pantalla el número del anterior, sus precios y
                // sus lugares, y la primera copia los guardaría como del nuevo.
                window.location.reload();
                return;
            }
            localStorage.setItem('gUserEmail', this.usuarioActual.email);
            const authorized = await this._checkUserAuthorized(this.usuarioActual.email);
            if (!authorized) {
                this.mostrarAuth();
                this.mostrarMensaje('❌ La cuenta ' + this.usuarioActual.email + ' no tiene acceso a esta aplicación.', 'error');
                return;
            }
            this.mostrarApp();
            this._pedirBateriaSiHaceFalta();
            this._pintarAvisoCambio();
            this.actualizarBotonesPerfil();
            this._actualizarCabeceraUsuario();
            this._cargarAsignacion();
            setTimeout(() => this._autoRellenarFormulario(), 50);
            this._scheduleTokenRefresh();
            // Los mensajes arrancan por su cuenta, antes y fuera de la carga
            // de datos. Esa empieza leyendo la copia de Drive, y si eso falla
            // o tarda se lleva por delante todo lo que viene detrás —incluidos
            // el sondeo cada minuto y el aviso con la app cerrada, que se
            // ponen en marcha desde ahí dentro—. El resultado era que quien no
            // abría la pestaña de notas no recibía un solo aviso, y los
            // mensajes no tienen nada que ver con Drive.
            this._iniciarSondeoChat();
            this._cargarNotas();
            // Los lugares tampoco tienen nada que ver con Drive. Colgados de
            // la carga de datos, el desplegable de "lugar" se pintaba antes de
            // que llegara el catálogo y salían cuatro de los diez que hay.
            this._cargarLugares();
            this.cargarDatos();
            // Ya está dentro: ahora —y no antes, que desde la pantalla de
            // elegir aplicación no se sabía cuál quería— se le pregunta si
            // se descarga la aplicación o sigue en el navegador.
            this._preguntarModoSiToca();
        } catch(e) {
            this.mostrarAuth();
            this.mostrarMensaje('Error de red: ' + e.message, 'error');
        }
    },

    _generateVerifier() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return btoa(String.fromCharCode(...arr))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async _deriveChallenge(verifier) {
        const enc = new TextEncoder().encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', enc);
        return btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async login(silent = false, permisoExtra = '') {
        const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
        // Dentro de la aplicación la página se sirve desde localhost, y ahí
        // Google no puede devolver a nadie: si por lo que sea no se ha
        // reconocido como aplicación, vale igual la dirección de retorno.
        const enLocal = /^https?:\/\/localhost(:|$)/.test(window.location.origin);
        const redirectUri = (isAndroidNative || enLocal) ? RETORNO_APP
            : window.location.origin + '/';
        const email = this.usuarioActual?.email || localStorage.getItem('gUserEmail') || '';
        const verifier = this._generateVerifier();
        localStorage.setItem('pkceVerifier', verifier);
        const challenge = await this._deriveChallenge(verifier);
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: (DRIVE_SCOPE + ' ' + permisoExtra).trim(),
            code_challenge: challenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            // Solo al pedir un permiso de más: así el que se añade no cuesta
            // los que ya estaban dados. En la entrada normal NO, y es
            // importante: con esto puesto Google mete en la petición todo lo
            // que esa cuenta hubiera concedido alguna vez —incluidos los
            // permisos sensibles de antes— y vuelve a salir el aviso de
            // aplicación no verificada a quien ya había entrado.
            ...(permisoExtra ? { include_granted_scopes: 'true' } : {}),
            // De dónde salió la entrada, además de a qué app vuelve: desde el
            // navegador no hay que rebotar a ninguna app —puede no estar
            // instalada— y hay que entrar ahí mismo.
            state: (isAndroidNative ? 'app:' : 'web:') + ANDROID_PACKAGE,
            // Sin select_account, y con el correo de la última sesión metido
            // de pista, Google entraba con esa cuenta sin preguntar: quien
            // quería cambiar de correo en el mismo móvil no podía. La pista
            // solo vale para renovar por detrás, que ahí sí se sabe de quién.
            prompt: silent ? 'none' : 'select_account consent',
            ...(silent && email ? { login_hint: email } : {})
        });
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
        if (isAndroidNative && window.AndroidBridge?.performOAuthInWebView
                && !sessionStorage.getItem('oauthWebViewFailed')) {
            // La entrada se abre en una pestaña del navegador, fuera de la app:
            // si se vuelve de ella sin sesión es que la han cancelado, y hay
            // que enterarse para no dejar la pantalla colgada en "Conectando".
            if (!silent) sessionStorage.setItem('loginAbierto', '1');
            window.AndroidBridge.performOAuthInWebView(url, silent);
        } else {
            window.location.assign(url);
        }
    },

    // The return page is served by the shared Vercel deployment, which runs apk2's
    // code, so without this every login would come back to apk2. Google echoes
    // `state` verbatim, so it tells us which app to reopen.
    // El verificador PKCE está en localStorage, que se comparte entre / y
    // /gestion/ por ser el mismo origen, así que el intercambio del código
    // funciona igual desde allí.
    _rebotarAGestion(pkgDestino, searchParams) {
        if (!['com.guillermorc.gestionemt','com.guillermorc.devemt'].includes(pkgDestino)) return false;
        if (window.Capacitor?.isNativePlatform?.()) return false;
        // En Android, lo que sale de la app vuelve a la app por su enlace; lo
        // que sale del navegador se queda en el navegador y hay que llevarlo
        // a /gestion/, que si no acaba entrando en la app de trabajador.
        if (/Android/i.test(navigator.userAgent) && this._vieneDeLaApp(searchParams)) return false;
        if (window.location.pathname.startsWith('/gestion')) return false;
        window.location.replace('/gestion/?' + searchParams.toString());
        return true;
    },

    // Lo mismo con las dos del puesto de control de acceso, que viven en
    // /control/. Su almacenamiento va aparte, así que el código lo tiene que
    // cambiar ella: aquí no está el verificador con que se pidió.
    _rebotarAControl(pkgDestino, searchParams) {
        if (!['com.guillermorc.controlemt','com.guillermorc.gcontrolemt'].includes(pkgDestino)) return false;
        if (window.Capacitor?.isNativePlatform?.()) return false;
        if (/Android/i.test(navigator.userAgent) && this._vieneDeLaApp(searchParams)) return false;
        if (window.location.pathname.startsWith('/control')) return false;
        window.location.replace('/control/?' + searchParams.toString());
        return true;
    },

    _paqueteDestino(searchParams) {
        const permitidos = ['com.guillermorc.horasemt','com.guillermorc.gestionemt','com.guillermorc.devemt',
                            // Las dos del puesto de control de acceso: la vuelta de
                            // Google pasa por esta misma página, y sin estar aquí
                            // volvería a la app de los conductores.
                            'com.guillermorc.controlemt','com.guillermorc.gcontrolemt'];
        const s = String(searchParams?.get('state') || '').replace(/^(app|web):/, '');
        return permitidos.includes(s) ? s : ANDROID_PACKAGE;
    },

    // Si la entrada se empezó dentro de la app hay que devolverle la sesión;
    // si se empezó en el navegador, no: rebotar a una app que a lo mejor ni
    // está instalada acaba en la pantalla de error de Chrome, que es lo que
    // pasaba al entrar desde la web con la aplicación desinstalada. Las
    // versiones anteriores solo mandaban el paquete, y esas siempre eran la app.
    _vieneDeLaApp(searchParams) {
        const s = String(searchParams?.get('state') || '');
        if (s.startsWith('app:')) return true;
        if (s.startsWith('web:')) return false;
        return !!s;
    },

    async _exchangeCode(code, isSilent = false) {
        sessionStorage.removeItem('loginAbierto');
        const verifier = localStorage.getItem('pkceVerifier');
        localStorage.removeItem('pkceVerifier');
        if (!verifier) { this.mostrarAuth(); return; }
        const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
        // Dentro de la aplicación la página se sirve desde localhost, y ahí
        // Google no puede devolver a nadie: si por lo que sea no se ha
        // reconocido como aplicación, vale igual la dirección de retorno.
        const enLocal = /^https?:\/\/localhost(:|$)/.test(window.location.origin);
        const redirectUri = (isAndroidNative || enLocal) ? RETORNO_APP
            : window.location.origin + '/';
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/auth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                if (!isSilent) {
                    this.mostrarAuth();
                    this.mostrarMensaje('Error al iniciar sesión: ' + (err.error || resp.status), 'error');
                } else {
                    sessionStorage.removeItem('silentReauthAttempted');
                    this.mostrarAuth();
                }
                return;
            }
            const data = await resp.json();
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            sessionStorage.removeItem('silentReauthAttempted');
            sessionStorage.removeItem('autoLoginAttempted');
            sessionStorage.removeItem('oauthWebViewFailed');
            this._saveToken(data);
            this._loadUserAndStart();
        } catch(e) {
            if (!isSilent) {
                this.mostrarAuth();
                this.mostrarMensaje('Error de red: ' + e.message, 'error');
            } else {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
            }
        }
    },

    async _silentReauth() {
        if (this.refreshToken) {
            try {
                const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: this.refreshToken })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    this._saveToken(data);
                    if (!this.usuarioActual) this._loadUserAndStart();
                    return;
                }
                // Refresh token expired/revoked — clear it and fall through to interactive login
                this.refreshToken = null;
                localStorage.removeItem('gRefreshToken');
            } catch (_) {}
        }
        if (!window.Capacitor?.isNativePlatform?.()) { this.mostrarAuth(); return; }
        this.login(true);
    },

    _onOAuthCode(code, isSilent = false) {
        if (!code) {
            if (!isSilent) sessionStorage.setItem('oauthWebViewFailed', '1');
            sessionStorage.removeItem('silentReauthAttempted');
            if (isSilent && window.Capacitor?.isNativePlatform?.()
                    && !sessionStorage.getItem('autoLoginAttempted')) {
                sessionStorage.setItem('autoLoginAttempted', '1');
                const msg = document.getElementById('splashMsg');
                if (msg) msg.textContent = 'Conectando con Google...';
                this.login(false);
                return;
            }
            sessionStorage.removeItem('autoLoginAttempted');
            this.mostrarAuth();
            return;
        }
        sessionStorage.removeItem('autoLoginAttempted');
        sessionStorage.removeItem('oauthWebViewFailed');
        sessionStorage.removeItem('silentReauthAttempted');
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        this._exchangeCode(code, isSilent);
    },

    _onOAuthResult(token, expiresIn, wasSilent = false) {
        if (!token) {
            if (!wasSilent) sessionStorage.setItem('oauthWebViewFailed', '1');
            sessionStorage.removeItem('silentReauthAttempted');
            // En nativo: si el reauth silencioso falló, lanzar login interactivo
            // automáticamente sin mostrar la pantalla de inicio de sesión.
            if (wasSilent && window.Capacitor?.isNativePlatform?.()
                    && !sessionStorage.getItem('autoLoginAttempted')) {
                sessionStorage.setItem('autoLoginAttempted', '1');
                const msg = document.getElementById('splashMsg');
                if (msg) msg.textContent = 'Conectando con Google...';
                this.login(false);
                return;
            }
            sessionStorage.removeItem('autoLoginAttempted');
            this.mostrarAuth();
            return;
        }
        sessionStorage.removeItem('autoLoginAttempted');
        sessionStorage.removeItem('oauthWebViewFailed');
        sessionStorage.removeItem('silentReauthAttempted');
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        this._saveToken({ access_token: token, expires_in: parseInt(expiresIn) || 3600 });
        this._loadUserAndStart();
    },

    _setupAppLifecycleBackup() {
        const onBackground = () => {
            this._pararSondeoChat();
            if (this.backupFreq !== 'cerrar') return;
            if (this.accessToken && Date.now() < this.tokenExpiry) this._autoBackup();
        };
        const onForeground = () => {
            // Vuelta de la pestaña del navegador sin haber entrado: se enseña
            // la pantalla de entrar en vez de un "Conectando" que no avanza.
            // El margen es para darle tiempo al código a llegar por el enlace.
            if (sessionStorage.getItem('loginAbierto')) {
                setTimeout(() => {
                    if (!sessionStorage.getItem('loginAbierto')) return;
                    sessionStorage.removeItem('loginAbierto');
                    if (this.accessToken && Date.now() < this.tokenExpiry) return;
                    this.mostrarAuth();
                }, 1500);
            }
            // Al volver se miran los mensajes: es lo que hace que salte el
            // aviso cuando la app estaba de fondo.
            this._iniciarSondeoChat();
            // Si se ha entrado tocando el aviso nativo, se abre en las notas
            if (window.AndroidBridge?.getPref?.('abrirNotas') === '1') {
                window.AndroidBridge?.removePref?.('abrirNotas');
                this.switchTab(2);
            }
            if (this.usuarioActual) this._cargarNotas();
            // Y lo que te toca hoy: el gestor puede haberlo cambiado mientras
            // la app estaba de fondo, o sencillamente haber cambiado el día.
            if (this.usuarioActual) this._cargarAsignacion();
            // If RegistrarReceiver updated Drive while in background, refresh the data
            const flag = window.AndroidBridge?.getPref?.('pendingRefresh');
            if (flag === '1' && this.usuarioActual) {
                window.AndroidBridge?.removePref?.('pendingRefresh');
                this.cargarDatos();
            }
            // Check for updates every time the app is opened, even if it was
            // only in the background. The short guard is just so flipping in and
            // out fast does not burn the GitHub API's 60 requests/hour limit.
            const lastCheck = parseInt(sessionStorage.getItem('lastUpdateCheck') || '0');
            if (Date.now() - lastCheck > 90 * 1000) {
                this._checkForUpdates();
            }
        };
        if (window.Capacitor?.isNativePlatform?.()) {
            try {
                window.Capacitor.Plugins.App?.addListener('appStateChange', ({ isActive }) => {
                    if (!isActive) onBackground(); else onForeground();
                });
            } catch (_) {}
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) onBackground(); else onForeground();
        });
        this._iniciarTimerCopia();
    },

    _iniciarTimerCopia() {
        clearInterval(this._backupTimer);
        const periodos = { hora: 60 * 60 * 1000, dia: 24 * 60 * 60 * 1000 };
        const ms = periodos[this.backupFreq];
        if (!ms) return;   // 'cerrar' is handled by the lifecycle listener
        const tick = () => {
            const ultima = parseInt(localStorage.getItem('lastBackupTime') || '0', 10);
            if (Date.now() - ultima < ms) return;
            if (this.accessToken && Date.now() < this.tokenExpiry) this._autoBackup();
        };
        tick();
        this._backupTimer = setInterval(tick, 5 * 60 * 1000);
    },

    guardarFrecuenciaCopia(freq) {
        this.backupFreq = freq;
        localStorage.setItem('backupFreq', freq);
        this._iniciarTimerCopia();
        this._guardarPreferencias();
        const txt = { hora: 'cada hora', dia: 'cada día', cerrar: 'al cerrar la app' }[freq] || freq;
        this._mostrarToast('✅ Copia automática ' + txt, 2500);
    },

    // ── Monthly export to Drive: "Movilidad Emt / <nº> <nombre>" ──────────────

    async _carpetaDrive(nombre, parentId) {
        const q = `name='${nombre.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder'`
                + ` and trashed=false and '${parentId || 'root'}' in parents`;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
        if (resp.ok) {
            const d = await resp.json();
            if (d.files?.length) return d.files[0].id;
        }
        const crear = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nombre,
                mimeType: 'application/vnd.google-apps.folder',
                ...(parentId ? { parents: [parentId] } : {})
            })
        });
        if (!crear.ok) throw new Error('No se pudo crear la carpeta ' + nombre);
        return (await crear.json()).id;
    },

    async _subirJsonADrive(nombreArchivo, contenido, carpetaId) {
        const boundary = '-------horasemt' + Date.now();
        const meta = JSON.stringify({ name: nombreArchivo, parents: [carpetaId] });
        const body = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
                   + `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${contenido}\r\n--${boundary}--`;
        const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}`,
                       'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!resp.ok) throw new Error('Subida fallida: ' + resp.status);
        return resp.json();
    },

    _mesesPendientesExport(historial) {
        const hechos = new Set(JSON.parse(localStorage.getItem('mesesExportados') || '[]'));
        const hoy = new Date();
        const claveMesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
        const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
        const esUltimoDia = hoy.getDate() === ultimoDia;
        const meses = new Set();
        Object.values(historial || {}).forEach(r => {
            if (!r.timestamp) return;
            const d = new Date(r.timestamp);
            meses.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        });
        // A month is exportable once it is over — or today if it is its last day
        return [...meses].filter(m =>
            !hechos.has(m) && (m < claveMesActual || (m === claveMesActual && esUltimoDia))
        ).sort();
    },

    async _exportarMesesPendientes() {
        if (!this.usuarioActual || !this.accessToken) return;
        const historial = this._historialFull || {};
        const pendientes = this._mesesPendientesExport(historial);
        if (!pendientes.length) return;
        try {
            const raiz = await this._carpetaDrive('Movilidad Emt', null);
            const sub  = [this.numConductor, this.usuarioActual.name].filter(Boolean).join(' ')
                       || this.usuarioActual.email;
            const carpeta = await this._carpetaDrive(sub, raiz);
            const hechos = new Set(JSON.parse(localStorage.getItem('mesesExportados') || '[]'));
            for (const mes of pendientes) {
                const delMes = Object.entries(historial)
                    .filter(([, r]) => {
                        const d = new Date(r.timestamp);
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === mes;
                    })
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)
                    .map(([id, r]) => ({ id, ...r }));
                const tot = this._calcTotales(historial);
                const mesJson = JSON.stringify({
                    mes, generado: new Date().toISOString(),
                    conductor: this.numConductor || null,
                    nombre: this.usuarioActual.name || null,
                    email: this.usuarioActual.email,
                    totalHoras: Math.round(delMes.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0) * 10) / 10,
                    horasNocturnas: Math.round(delMes.reduce((s, r) => s + (r.horasNocturnas || 0), 0) * 10) / 10,
                    diasFestivos: delMes.filter(r => r.festivo).length,
                    permisosRetribuidos: delMes.filter(r => r.pr).length,
                    jornadas: delMes
                }, null, 2);
                const completoJson = JSON.stringify({
                    generado: new Date().toISOString(),
                    conductor: this.numConductor || null,
                    nombre: this.usuarioActual.name || null,
                    email: this.usuarioActual.email,
                    horasAnuales: this.horasAnualesCustom,
                jornadaHoras: this.jornadaHoras,
                dias:         this.diasSemana,
                vacaciones:   this._getVacaciones(),
                vacacionesAt: this._vacacionesAt(),
                    totales: tot,
                    historial: Object.entries(historial)
                        .sort((a, b) => a[1].timestamp - b[1].timestamp)
                        .map(([id, r]) => ({ id, ...r }))
                }, null, 2);
                await this._subirJsonADrive(`horas-emt-${mes}.json`, mesJson, carpeta);
                await this._subirJsonADrive(`horas-emt-completo-${mes}.json`, completoJson, carpeta);
                hechos.add(mes);
                localStorage.setItem('mesesExportados', JSON.stringify([...hechos]));
            }
        } catch (_) { /* silent: it retries next time the app opens */ }
    },

    _autoRellenarFormulario() {
        const inicio = localStorage.getItem('lastHoraInicio');
        const fin    = localStorage.getItem('lastHoraFin');
        if (inicio) document.getElementById('horaInicio').value = inicio;
        if (fin)    document.getElementById('horaFin').value    = fin;
        if (inicio && fin) this.calcularHorasPorTiempo();
    },

    setupUI() {
        this._aplicarCuadros();
        this._aplicarCuadrosResumen();
        this._renderLugarJornada();
        this.establecerFechaHoy();
        this.actualizarFecha();
        if (this.precioExtraDefault > 0) {
            const pe = document.getElementById('precioExtraGlobal');
            if (pe) pe.value = this.precioExtraDefault;
        }
        if (this.precioNocheDefault > 0) {
            document.getElementById('precioNocheGlobal').value = this.precioNocheDefault;
        }
        const fa = document.getElementById('fechaAltaGlobal');
        if (fa) fa.value = this.fechaAltaDefault || '';
        const pb = document.getElementById('pctBieniosGlobal');
        if (pb && this.pctBieniosDefault) pb.value = this.pctBieniosDefault;
        this.actualizarEstadoGPS();
        const lastInicio = localStorage.getItem('lastHoraInicio');
        if (lastInicio) document.getElementById('horaInicio').value = lastInicio;
        const lastFin = localStorage.getItem('lastHoraFin');
        if (lastFin) document.getElementById('horaFin').value = lastFin;
        if (lastInicio && lastFin) this.calcularHorasPorTiempo();
    },

    async _driveGet(url) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        return fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    },

    async _drivePatch(url, body) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        return fetch(url, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body)
        });
    },

    // La copia vive dentro de "Movilidad Emt", junto a los resúmenes. Si la
    // carpeta no se deja crear no se pierde la copia: se guarda suelta en
    // Drive, que es mejor que quedarse sin ella.
    async _carpetaCopias() {
        try { return await this._carpetaDrive('Movilidad Emt', null); }
        catch (_) { return null; }
    },

    _recordarFicheroDrive(id) {
        this.driveFileId = id;
        localStorage.setItem('driveFileId', id);
        window.AndroidBridge?.saveToPrefs('driveFileId', id);
    },

    // Una búsqueda fallida no puede pasar por "no hay copia": si pasa, el que
    // llama se cree que el historial está vacío y escribe encima, o crea una
    // segunda copia y la historia se parte en dos.
    async _listarFicherosDrive() {
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?q=name%3D'${DRIVE_FILE_NAME}'%20and%20trashed%3Dfalse`
            + `&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`
        );
        if (!resp.ok) throw new Error('Drive buscar: ' + resp.status);
        const data = await resp.json();
        return Array.isArray(data.files) ? data.files : [];
    },

    async _getDriveFileId() {
        if (this.driveFileId) return this.driveFileId;
        const files = await this._listarFicherosDrive();
        if (!files.length) return null;                 // aún no hay copia
        if (files.length > 1) return this._unirFicherosDrive(files);
        this._recordarFicheroDrive(files[0].id);
        return this.driveFileId;
    },

    // Si han quedado varias copias con el mismo nombre, se juntan todas las
    // jornadas en la más reciente y a las demás se les cambia el nombre, para
    // que la búsqueda deje de encontrarlas y no se vuelva a partir.
    async _unirFicherosDrive(files) {
        const contenidos = [];
        for (const f of files) {
            try {
                const r = await this._driveGet(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
                if (r.ok) contenidos.push({ id: f.id, datos: await r.json() });
            } catch (_) { /* si una no se puede leer, se deja donde está */ }
        }
        if (!contenidos.length) { this._recordarFicheroDrive(files[0].id); return this.driveFileId; }
        const historial = {};
        contenidos.forEach(({ datos }) => {
            Object.entries(datos?.historial || {}).forEach(([id, r]) => {
                // Ante el mismo día repetido gana el que se tocó más tarde
                const ya = historial[id];
                if (!ya || (r?.timestamp || 0) >= (ya.timestamp || 0)) historial[id] = r;
            });
        });
        const principal = contenidos[0];                 // el de modificación más reciente
        const unido = { ...principal.datos, historial };
        unido.horasTrabajadas = this._calcTotales(historial).anualReal;
        this._recordarFicheroDrive(principal.id);
        const antes = Object.keys(principal.datos?.historial || {}).length;
        const ahora = Object.keys(historial).length;
        if (ahora > antes) {
            await this._writeDriveFile(unido);
            this._mostrarToast(`✅ Recuperadas ${ahora - antes} jornada${ahora - antes === 1 ? '' : 's'} de otra copia`, 5000);
        }
        for (const c of contenidos.slice(1)) {
            try {
                await fetch(`https://www.googleapis.com/drive/v3/files/${c.id}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `${DRIVE_FILE_NAME}.copia-${c.id.slice(0, 8)}` })
                });
            } catch (_) { /* si no se puede renombrar, se volverá a unir la próxima vez */ }
        }
        return this.driveFileId;
    },

    // null significa "todavía no hay copia", nunca "no se ha podido leer": un
    // fallo de lectura tiene que doler aquí y no acabar borrando el historial.
    async _readDriveFile() {
        const fileId = await this._getDriveFileId();
        if (!fileId) return null;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        // 403 es la copia vieja, la de la carpeta oculta: ya no se llega a
        // ella, y tratarla como perdida deja que se cree la nueva.
        if (resp.status === 404 || resp.status === 403) {
            // El id guardado ya no vale; se busca otra vez desde cero
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            const otros = await this._listarFicherosDrive();
            if (!otros.length) return null;
            return this._readDriveFile();
        }
        if (!resp.ok) throw new Error('Drive leer: ' + resp.status);
        return resp.json();
    },

    async _writeDriveFile(data) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        const payload = { ...data, preferencias: this._getPreferencias() };
        const json    = JSON.stringify(payload);
        const fileId  = await this._getDriveFileId();

        if (!fileId) {
            const boundary = '-------314159265358979323846';
            const carpeta  = await this._carpetaCopias();
            const meta     = JSON.stringify({ name: DRIVE_FILE_NAME, ...(carpeta ? { parents: [carpeta] } : {}) });
            const body     = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
            const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body
            });
            if (!resp.ok) { const t = await resp.text(); throw new Error('Drive crear: ' + resp.status + ' ' + t.slice(0,120)); }
            const result = await resp.json();
            if (!result.id) throw new Error('Drive crear: sin id en respuesta');
            this.driveFileId = result.id;
            localStorage.setItem('driveFileId', result.id);
            window.AndroidBridge?.saveToPrefs('driveFileId', result.id);
        } else {
            const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: json
            });
            if (!resp.ok) { const t = await resp.text(); throw new Error('Drive actualizar: ' + resp.status + ' ' + t.slice(0,120)); }
        }
        localStorage.setItem('lastBackupTime', Date.now().toString());
    },

    async _autoBackup() {
        const lastBackup = parseInt(localStorage.getItem('lastBackupTime') || '0');
        if (Date.now() - lastBackup < 5 * 60 * 1000) return;
        if (this._autoBackupBusy) return;
        if (!this.accessToken || Date.now() >= this.tokenExpiry) return;
        this._autoBackupBusy = true;
        try {
            const data = await this._readDriveFile();
            if (data) await this._writeDriveFile(data);
        } catch (_) {}
        this._autoBackupBusy = false;
    },

    async hacerCopiaEnDrive() {
        if (!this.usuarioActual) { this._mostrarToast('❌ Inicia sesión primero', 3000); return; }
        this._mostrarToast('☁️ Guardando copia...', 2000);
        try {
            const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            await this._writeDriveFile(data);
            this._mostrarToast('✅ Copia guardada en Google Drive', 3000);
            this._actualizarInfoCopia();
        } catch (e) {
            this._mostrarToast('❌ Error al guardar: ' + e.message, 4000);
        }
    },

    async restaurarDesdeDrive() {
        if (!this.usuarioActual) { this._mostrarToast('❌ Inicia sesión primero', 3000); return; }
        if (!confirm('¿Restaurar datos desde Google Drive?\nSe aplicarán los datos de la última copia guardada.')) return;
        this._mostrarToast('⬇️ Restaurando...', 2000);
        try {
            const data = await this._readDriveFile();
            if (!data) { this._mostrarToast('❌ No se encontró copia en Drive', 3000); return; }
            if (data.preferencias) this._aplicarPreferenciasDesde(data.preferencias);
            this.actualizarUI(data);
            this._mostrarToast('✅ Datos restaurados desde Google Drive', 3000);
            this._actualizarInfoCopia();
        } catch (e) {
            this._mostrarToast('❌ Error al restaurar: ' + e.message, 4000);
        }
    },

    _actualizarInfoCopia() {
        const radio = document.querySelector(`input[name="backupFreq"][value="${this.backupFreq}"]`);
        if (radio) radio.checked = true;
        const bloqueResumen = document.getElementById('resumenMensualField');
        if (bloqueResumen) {
            const soloPara = 'g.rioscorrea@gmail.com';
            bloqueResumen.style.display =
                (this.usuarioActual?.email || '').toLowerCase() === soloPara ? 'flex' : 'none';
        }
        const info = document.getElementById('mesesExportadosInfo');
        if (info) {
            const hechos = JSON.parse(localStorage.getItem('mesesExportados') || '[]');
            info.textContent = hechos.length
                ? `Último mes guardado: ${hechos.sort().slice(-1)[0]}` : '';
        }
        const el = document.getElementById('lastBackupInfo');
        if (!el) return;
        const t = parseInt(localStorage.getItem('lastBackupTime') || '0');
        if (!t) { el.textContent = 'Sin copia registrada aún'; return; }
        const d = new Date(t);
        el.textContent = 'Última copia: ' + d.toLocaleDateString('es-ES')
            + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    },

    async cargarDatos() {
        if (!this.usuarioActual) return;
        try {
            const data = await this._readDriveFile();
            // Que no aparezca copia teniendo este móvil una guardada antes no
            // es "no hay copia": es que no se ha llegado a ella. Pintar el
            // historial vacío haría creer que se ha perdido todo, y encima
            // publicaría ese vacío a gestión. Se trata como fallo de lectura.
            if (!data && localStorage.getItem('lastBackupTime')) {
                throw new Error('no aparece tu copia en Drive');
            }
            if (data?.preferencias) this._aplicarPreferenciasDesde(data.preferencias);
            this.actualizarUI(data || { horasTrabajadas: 0, historial: {} });
            this._lecturaOk = true;
            this._renderGpsSettings();
            this._startScheduleTimer();
            this.verificarUbicacion();
            this._updateGpsState();
            this._exportarMesesPendientes();
            this._publicarResumen();
            this._pedirPermisosIniciales();
            if (this._pendingNotifAction === 'registro-rapido') {
                this._pendingNotifAction = null;
                this._registrarDesdeNotificacion();
            }
        } catch(e) {
            console.error('Error cargando datos:', e);
            // Sin lectura no se pinta un historial vacío: parecería que se ha
            // perdido todo, y encima se publicaría ese vacío a gestión.
            this._lecturaOk = false;
            if (!this._historialFull || !Object.keys(this._historialFull).length) {
                this.actualizarUI({ horasTrabajadas: 0, historial: {} });
            }
            this._mostrarToast('⚠️ No se ha podido leer tu copia: ' + e.message, 6000);
        }
    },

    async registrarHoras() {
        if (!this.usuarioActual) { alert('❌ No hay sesión activa'); return; }
        const horasRaw = document.getElementById('horasInput').value;
        let   horas = parseFloat(horasRaw) || 0;
        const fecha = document.getElementById('fechaInput').value;
        const hastaGrupo = document.getElementById('fechaHastaGroup');
        const hastaVal    = document.getElementById('fechaHastaInput')?.value || '';
        const fechaHasta  = (hastaGrupo && hastaGrupo.style.display !== 'none' && hastaVal) ? hastaVal : fecha;
        const esFestivo      = this.festivoActivo;
        const esVacaciones   = this.vacacionesActivo;
        const esBaja         = this.bajaActiva;
        // Un festivo, un día de vacaciones, una baja o un día que no se fue a
        // trabajar se registran sin horas; lo demás las necesita.
        const sinHoras = esFestivo || esVacaciones || esBaja || this.sinAsistenciaActivo;
        if (!fecha || (!sinHoras && (isNaN(parseFloat(horasRaw)) || horas <= 0))) {
            alert('❌ Introduce fecha y horas válidas'); return;
        }
        if (horas < 0) { alert('❌ Las horas no pueden ser negativas'); return; }
        if (fechaHasta < fecha) { alert('❌ La fecha "hasta" no puede ser anterior a la de inicio'); return; }
        const fechas = this._rangoDeFechas(fecha, fechaHasta);
        if (fechas.length > 62) { alert('❌ El rango es demasiado largo (máximo dos meses)'); return; }
        const horaInicio     = document.getElementById('horaInicio').value;
        let   horaFin        = document.getElementById('horaFin').value;
        // Todos los sitios del día, el del desplegable incluido
        const tramos = this._tramosDelDia();
        const total  = this._jornadaDeLosTramos(tramos);
        if (total) { horaFin = total.fin; horas = total.horas; }
        const esPR           = this.prActivo;
        const esExtra        = this.extraActivo;
        const esSinAsistencia = this.sinAsistenciaActivo;
        const extraDestino   = esExtra ? this._extraDestino() : null;
        const horasNocturnas = parseFloat(document.getElementById('horasNocturnas').value) || 0;
        const precioNoche    = horasNocturnas > 0 ? (parseFloat(document.getElementById('precioNoche').value) || 0) : 0;
        const extraNoche     = Math.round(horasNocturnas * precioNoche * 100) / 100;
        if (horasNocturnas > horas) { alert('❌ Las horas nocturnas no pueden superar las horas totales'); return; }

        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            datos.horasTrabajadas = parseFloat(datos.horasTrabajadas) || 0;
            if (!datos.historial) datos.historial = {};

            // Este botón siempre añade una jornada. Editar es cosa del cuadro de
            // editar, que guarda por su cuenta: mientras esto miraba editingId,
            // abrir el lápiz de una jornada, cerrarlo sin guardar y registrar
            // otra del mismo día borraba la primera y la dejaba en una sola,
            // sin aviso ni rastro.
            // Con un rango se repite la misma jornada en cada día, para ponerse
            // al día con lo que se olvidó de registrar; por defecto es un solo
            // día, así que casi siempre esto da una sola vuelta.
            let guardados = 0, ultimaFechaKey = '';
            for (const fechaDia of fechas) {
                const fechaFormato = new Date(fechaDia + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const fechaKey     = fechaDia.replace(/-/g, '');
                const registroId   = this._nuevoRegistroId(datos.historial, fechaKey);
                datos.historial[registroId] = {
                    fecha: fechaFormato, horas,
                    timestamp: new Date(fechaDia + 'T12:00:00').getTime(),
                    ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
                    ...(horasNocturnas > 0 ? { horasNocturnas, precioNoche, extraNoche } : {}),
                    ...(esPR ? { pr: true } : {}),
                    ...(esFestivo ? { festivo: true } : {}),
                    ...(this.puestoTrabajo ? { puesto: this.puestoTrabajo } : {}),
                    ...(esExtra ? { extraManual: true, extraDestino } : {}),
                    ...(esVacaciones ? { vacaciones: true } : {}),
                    ...(esBaja ? { be: true } : {}),
                    ...(esSinAsistencia ? { sinAsistencia: true } : {}),
                    ...(tramos.length ? { tramos } : {})
                };
                if (esPR && this._prUsados(datos.historial) > this.PR_ANUALES) {
                    delete datos.historial[registroId];
                    if (!guardados) { alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`); return; }
                    break;
                }
                const tot = this._calcTotales(datos.historial);
                if (tot.anualReal > this.horasAnualesCustom + tot.topeExtras) {
                    delete datos.historial[registroId];
                    if (!guardados) {
                        alert(`❌ Superarías el tope anual + 30% de extras (${(this.horasAnualesCustom + tot.topeExtras).toFixed(1)}h)`);
                        return;
                    }
                    break;
                }
                datos.horasTrabajadas = tot.anualReal;
                guardados++;
                ultimaFechaKey = fechaKey;
            }
            if (!guardados) return;

            if (horaInicio && horaFin) {
                if (!datos.prefs) datos.prefs = {};
                datos.prefs.horaInicio = horaInicio;
                datos.prefs.horaFin = horaFin;
            }
            await this._writeDriveFile(datos);
            localStorage.setItem('lastRegisteredDate', ultimaFechaKey);
            window.AndroidBridge?.saveToPrefs('lastRegisteredDate', ultimaFechaKey);
            if (horaInicio) localStorage.setItem('lastHoraInicio', horaInicio);
            const horaFinVal = document.getElementById('horaFin').value;
            if (horaFinVal) localStorage.setItem('lastHoraFin', horaFinVal);
            this._detenerGeofencingNativo();
            this._cancelarNotificacionTrabajo();
            this.actualizarUI(datos);
            this.cancelarEdicion();
            this._publicarResumen();
            // Solo de un día suelto: registrar una semana de golpe es ponerse
            // al día con lo atrasado, no cambiar la jornada de hoy.
            if (fechas.length === 1) {
                this._avisarDesvioAGestion(ultimaFechaKey, this.puestoTrabajo, horaInicio, horaFin);
            }
            this._comprobarLugarPorUbicacion();
            if (fechas.length > 1) {
                this._mostrarToast(guardados < fechas.length
                    ? `✅ Guardados ${guardados} de ${fechas.length} días · se paró al llegar al tope`
                    : `✅ ${guardados} días guardados`, 3000);
            } else {
                // Decir qué ha quedado: con dos jornadas en un día es la única
                // forma de saber si se han guardado las dos.
                const delDia = Object.keys(datos.historial)
                    .filter(id => this._fechaDeId(id) === ultimaFechaKey).length;
                this._mostrarToast(delDia > 1
                    ? `✅ Guardada · ${delDia} jornadas ese día`
                    : '✅ Jornada guardada', 3000);
            }
        } catch(e) {
            alert('❌ Error al guardar: ' + e.message);
        }
    },

    async _guardarDesdeModal() {
        if (!this.usuarioActual || !this.editingId) return;
        const fecha     = document.getElementById('editModalFecha').value;
        let   horas     = parseFloat(document.getElementById('editModalHoras').value);
        const horaInicio= document.getElementById('editModalInicio').value;
        let   horaFin   = document.getElementById('editModalFin').value;
        const puesto    = document.getElementById('editModalLugar')?.value || '';
        // Los lugares de abajo, igual que al registrar: si hay más de uno, la
        // jornada va de la primera entrada a la última salida.
        const tramos    = this._tramosDelDiaDe(this._tramosEdit, puesto, horaInicio, horaFin);
        const total     = this._jornadaDeLosTramos(tramos);
        if (total) { horaFin = total.fin; horas = total.horas; }
        const horasN    = parseFloat(document.getElementById('editModalNocturnas').value) || 0;
        const precioN   = parseFloat(document.getElementById('editModalPrecioN').value) || 0;
        const esPR      = document.getElementById('editModalPR').checked;
        const esFestivo = document.getElementById('editModalFestivo').checked;
        const esExtra   = document.getElementById('editModalExtra').checked;
        const esVac     = document.getElementById('editModalVacaciones').checked;
        const esBe      = document.getElementById('editModalBe').checked;
        const sinAsist  = document.getElementById('editModalSinAsistencia').checked;
        const destExtra = document.querySelector('input[name="editExtraDestino"]:checked')?.value || 'anual';
        const prev      = this._historialMap?.[this.editingId] || {};
        // Festivo, vacaciones, baja y no haber ido son días sin horas.
        const sinJornada = esFestivo || esVac || esBe || sinAsist;
        if (!fecha || (!sinJornada && (isNaN(horas) || horas <= 0))) { alert('❌ Introduce fecha y horas válidas'); return; }

        const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        if (!datos.historial) datos.historial = {};

        delete datos.historial[this.editingId];
        const fechaFormato = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const fechaKey     = fecha.replace(/-/g, '');
        // Keep the same id when the date is unchanged, otherwise allocate a fresh one
        const registroId   = this._fechaDeId(this.editingId) === fechaKey
            ? this.editingId : this._nuevoRegistroId(datos.historial, fechaKey);
        datos.historial[registroId] = {
            fecha: fechaFormato, horas: horas || 0,
            timestamp: new Date(fecha + 'T12:00:00').getTime(),
            ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
            ...(horasN > 0 ? { horasNocturnas: horasN, precioNoche: precioN, extraNoche: Math.round(horasN * precioN * 100) / 100 } : {}),
            ...(esPR ? { pr: true } : {}),
            ...(esFestivo ? { festivo: true } : {}),
            ...(puesto ? { puesto } : {}),
            ...(tramos.length ? { tramos } : {}),
            ...(esExtra ? { extraManual: true, extraDestino: destExtra } : {}),
            ...(esVac ? { vacaciones: true } : {}),
            ...(esBe ? { be: true } : {}),
            ...(sinAsist ? { sinAsistencia: true } : {})
        };
        datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;

        await this._writeDriveFile(datos);
        this.editingId = null;
        this._tramosEdit = [];
        document.getElementById('editModal').classList.remove('show');
        this.actualizarUI(datos);
        this._publicarResumen();
        // Volver al listado, no a la pantalla principal
        this.mostrarHistorialModal();
    },

    async borrarRegistro(id) {
        if (!this.usuarioActual) return;
        if (!confirm('¿Borrar este registro?')) return;
        const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        if (datos.historial && datos.historial[id]) {
            delete datos.historial[id];
            datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
            this._publicarResumen();
            if (this.editingId === id) this.editingId = null;
            this._renderHistorialModal();
        }
    },

    async resetearContador() {
        if (!this.usuarioActual) return;
        const datos = { horasTrabajadas: 0, historial: {} };
        await this._writeDriveFile(datos);
        this.actualizarUI(datos);
        alert('✅ Contador reseteado a 0');
    },

    async borrarCuenta() {
        if (!this.usuarioActual) return;
        const fileId = await this._getDriveFileId();
        if (fileId) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.accessToken}` }
            }).catch(() => {});
        }
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        await this.cerrarSesion();
    },

    async exportarDatos() {
        if (!this.usuarioActual) return;
        const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        const historial = Object.entries(data.historial || {})
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .map(([id, reg]) => ({ id, ...reg }));
        const json = JSON.stringify({
            exportado: new Date().toISOString(),
            usuario: this.usuarioActual.email,
            horasAnuales: this.horasAnualesCustom,
            horasTrabajadas: data.horasTrabajadas || 0,
            historial
        }, null, 2);
        const filename = `horas-emt-${new Date().toISOString().slice(0,10)}.json`;
        const blob = new Blob([json], { type: 'application/json' });
        const file = new File([blob], filename, { type: 'application/json' });
        if (window.Capacitor) {
            if (window.AndroidBridge) {
                window.AndroidBridge.saveFile(json, filename);
            } else {
                this._mostrarExportTexto(json);
            }
            return;
        }
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ title: 'Copia EMT - Movilidad', files: [file] }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.share) {
            try { await navigator.share({ title: 'Copia EMT - Movilidad', text: json }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
            this._mostrarToast('✅ Copia exportada', 3000);
            return;
        } catch(_) {}
        this._mostrarExportTexto(json);
    },

    async importarDatos() {
        if (!this.usuarioActual) return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;';
        document.body.appendChild(input);
        input.addEventListener('change', async (e) => {
            document.body.removeChild(input);
            const file = e.target.files[0]; if (!file) return;
            try {
                const datos = JSON.parse(await file.text());
                if (datos.horasTrabajadas === undefined || !datos.historial) { alert('❌ Archivo no válido.'); return; }
                const historialObj = {};
                if (Array.isArray(datos.historial)) datos.historial.forEach(({ id, ...rest }) => { historialObj[id] = rest; });
                else Object.assign(historialObj, datos.historial);
                const restored = { horasTrabajadas: datos.horasTrabajadas, historial: historialObj };
                await this._writeDriveFile(restored);
                if (datos.horasAnuales) { this.horasAnualesCustom = datos.horasAnuales; localStorage.setItem('horasAnuales', datos.horasAnuales); }
                this.actualizarUI(restored);
                await this._notificarBackup('💾 Copia restaurada', 'Los datos se han importado correctamente');
            } catch(err) { alert('❌ Error al leer el archivo: ' + err.message); }
        });
        input.click();
    },

    // Otro correo en el mismo móvil es otra persona. Lo que dejó aquí el
    // anterior —su número, sus precios, sus lugares, su copia de Drive— no
    // puede quedarse a la vista ni acabar mezclado con lo del que entra. De
    // lo guardado solo se salva la sesión que se acaba de abrir, que si no
    // habría que volver a entrar justo después de haber entrado. En Drive no
    // se toca nada: cada cuenta tiene la suya y la de cada uno sigue donde
    // estaba.
    _olvidarLoDelAnterior() {
        const sesion = {};
        ['gAccessToken', 'gTokenExpiry', 'gRefreshToken'].forEach(k => {
            const v = localStorage.getItem(k);
            if (v !== null) sesion[k] = v;
        });
        try { localStorage.clear(); } catch (_) {}
        Object.entries(sesion).forEach(([k, v]) => localStorage.setItem(k, v));
        try { sessionStorage.clear(); } catch (_) {}
        // Y lo que el móvil guarda por su cuenta, que es lo que usan los avisos
        // y el registro rápido cuando la app no está abierta.
        ['driveFileId', 'lastRegisteredDate', 'jornadaCompleta', 'lugaresHoy',
         'geofenceLocations', 'gpsMode', 'gpsScheduleFrom', 'gpsScheduleTo',
         'notifSound', 'abrirNotas', 'pendingRefresh',
         'accessToken', 'tokenExpiry', 'refreshToken'].forEach(k => {
            try { window.AndroidBridge?.removePref?.(k); } catch (_) {}
        });
        try { window.AndroidBridge?.removeGeofences?.(); } catch (_) {}
        this.driveFileId = null;
    },

    async cerrarSesion() {
        if (this.accessToken) {
            fetch('https://oauth2.googleapis.com/revoke?token=' + this.accessToken, { method: 'POST' }).catch(() => {});
        }
        this.accessToken   = null;
        this.tokenExpiry   = 0;
        this.refreshToken  = null;
        this.usuarioActual = null;
        // Se va todo, no solo la sesión: el móvil puede pasar a otras manos, y
        // salir tiene que dejarlo como estaba antes de entrar.
        this._olvidarLoDelAnterior();
        ['gAccessToken', 'gTokenExpiry', 'gRefreshToken'].forEach(k => localStorage.removeItem(k));
        this.mostrarAuth();
    },

    actualizarBotonesPerfil() {
        const btn = document.getElementById('profileBtn');
        if (!btn) return;
        const photo = localStorage.getItem('avatarPhoto');
        const emoji = localStorage.getItem('avatarEmoji');
        const bg    = localStorage.getItem('avatarBg') || '#1565C0';
        btn.style.cssText = '';
        if (photo) {
            btn.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            btn.style.background = 'transparent'; btn.style.padding = '0'; btn.style.overflow = 'hidden';
        } else if (emoji) {
            btn.textContent = emoji; btn.style.background = bg; btn.style.fontSize = '20px'; btn.style.color = 'white';
        } else {
            const email   = this.usuarioActual?.email || '';
            const name    = this.usuarioActual?.name  || email;
            const palette = ['#667eea','#764ba2','#e74c3c','#27ae60','#f39c12','#3498db'];
            btn.textContent = name.charAt(0).toUpperCase();
            btn.style.background = palette[email.charCodeAt(0) % palette.length];
            btn.style.color = 'white'; btn.style.fontSize = '16px';
        }
    },

    _buildAvatarGrid() {
        const grid = document.getElementById('avatarGrid');
        if (!grid) return;
        grid.innerHTML = '';
        AVATAR_EMOJIS.forEach((emoji, i) => {
            const btn = document.createElement('button');
            btn.className = 'avatar-option'; btn.textContent = emoji; btn.style.background = AVATAR_BG[i];
            btn.addEventListener('click', () => this._seleccionarEmojiAvatar(emoji, AVATAR_BG[i]));
            grid.appendChild(btn);
        });
    },

    _seleccionarEmojiAvatar(emoji, bg) {
        localStorage.setItem('avatarEmoji', emoji); localStorage.setItem('avatarBg', bg); localStorage.removeItem('avatarPhoto');
        document.getElementById('avatarPickerModal').classList.remove('show');
        this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
        this._guardarPreferencias();
    },

    mostrarAvatarPicker() {
        document.getElementById('avatarPickerModal').classList.add('show');
        if (this.darkMode) document.getElementById('avatarModalContent').classList.add('dark');
        const btn = document.getElementById('googlePhotoBtn');
        if (btn) btn.style.display = this.usuarioActual?.picture ? '' : 'none';
    },

    usarFotoGoogle() {
        const url = this.usuarioActual?.picture;
        if (!url) return;
        const largeUrl = url.replace(/=s\d+(-c)?$/, '=s200-c');
        const apply = (src) => {
            localStorage.setItem('avatarPhoto', src);
            localStorage.removeItem('avatarEmoji');
            document.getElementById('avatarPickerModal').classList.remove('show');
            this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
            this._guardarPreferencias();
        };
        if (window.AndroidBridge?.fetchImageBase64) {
            // Descarga via Java para evitar restricciones CORS del WebView
            const cb = '_gphoto_' + Date.now();
            window[cb] = (data) => { delete window[cb]; apply(data || largeUrl); };
            window.AndroidBridge.fetchImageBase64(largeUrl, cb);
        } else {
            apply(largeUrl);
        }
    },

    subirFotoPerfil() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 80; canvas.height = 80;
                    canvas.getContext('2d').drawImage(img, 0, 0, 80, 80);
                    localStorage.setItem('avatarPhoto', canvas.toDataURL('image/jpeg', 0.85));
                    localStorage.removeItem('avatarEmoji');
                    document.getElementById('avatarPickerModal').classList.remove('show');
                    this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
                    this._guardarPreferencias();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    _actualizarAvatarPreview() {
        const el = document.getElementById('profileAvatarPreview');
        if (!el) return;
        const photo = localStorage.getItem('avatarPhoto');
        const emoji = localStorage.getItem('avatarEmoji');
        const bg    = localStorage.getItem('avatarBg') || '#1565C0';
        if (photo) {
            el.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            el.style.background = 'transparent';
        } else if (emoji) {
            el.textContent = emoji; el.style.background = bg; el.style.color = '';
        } else {
            const email   = this.usuarioActual?.email || '';
            const name    = this.usuarioActual?.name  || email;
            const palette = ['#667eea','#764ba2','#e74c3c','#27ae60','#f39c12','#3498db'];
            el.textContent = name.charAt(0).toUpperCase();
            el.style.background = palette[email.charCodeAt(0) % palette.length]; el.style.color = 'white';
        }
    },

    guardarPerfil() {
        this.actualizarBotonesPerfil();
        alert('✅ Perfil guardado');
    },

    establecerFechaHoy() {
        const hoy = new Date();
        const y = hoy.getFullYear();
        const m = String(hoy.getMonth() + 1).padStart(2, '0');
        const d = String(hoy.getDate()).padStart(2, '0');
        const hoyISO = `${y}-${m}-${d}`;
        document.getElementById('fechaInput').value = hoyISO;
        document.getElementById('fechaInput').max   = hoyISO;
        const hasta = document.getElementById('fechaHastaInput');
        if (hasta) hasta.max = hoyISO;
        this.comprobarFestivo();
        this._sincronizarHastaMin();
    },

    // El rango de fechas es para ponerse al día con jornadas atrasadas: por
    // defecto está oculto y solo se registra la de hoy, y hasta vuelve a
    // esconderse después de registrar para no dejarlo puesto por error.
    _toggleRangoFechas() {
        const grupo = document.getElementById('fechaHastaGroup');
        const link  = document.getElementById('fechaRangoToggle');
        if (!grupo) return;
        const abierto = grupo.style.display !== 'none';
        grupo.style.display = abierto ? 'none' : 'flex';
        if (link) link.textContent = abierto ? '📅 Registrar varios días' : '📅 Solo un día';
        if (!abierto) {
            const desde = document.getElementById('fechaInput');
            const hasta = document.getElementById('fechaHastaInput');
            if (desde && hasta && !hasta.value) hasta.value = desde.value;
        }
    },

    _sincronizarHastaMin() {
        const desde = document.getElementById('fechaInput')?.value;
        const hasta = document.getElementById('fechaHastaInput');
        if (!desde || !hasta) return;
        hasta.min = desde;
        if (hasta.value && hasta.value < desde) hasta.value = desde;
    },

    _ocultarRangoFechas() {
        const grupo = document.getElementById('fechaHastaGroup');
        const link  = document.getElementById('fechaRangoToggle');
        const hasta = document.getElementById('fechaHastaInput');
        if (grupo) grupo.style.display = 'none';
        if (link) link.textContent = '📅 Registrar varios días';
        if (hasta) hasta.value = '';
    },

    // Todas las fechas entre dos, las dos incluidas. Con el constructor local
    // de Date el cambio de mes o de año sale solo, sin líos de zona horaria.
    _rangoDeFechas(desde, hasta) {
        const out = [];
        let [y, m, d] = desde.split('-').map(Number);
        for (let guard = 0; guard < 400; guard++) {
            const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            out.push(key);
            if (key >= hasta) break;
            const sig = new Date(y, m - 1, d + 1);
            y = sig.getFullYear(); m = sig.getMonth() + 1; d = sig.getDate();
        }
        return out;
    },

    actualizarFecha() {
        const opts = { weekday: 'long', day: 'numeric', month: 'long' };
        document.getElementById('fechaHoy').textContent = new Date().toLocaleDateString('es-ES', opts);
    },

    mostrarMensaje(msg, tipo) {
        const el = document.getElementById('auth' + (tipo === 'error' ? 'Error' : 'Success'));
        el.textContent = msg; el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 5000);
    },

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

    // Gestionar quién entra es cosa del administrador; al resto ni se le
    // ofrece, aunque el endpoint ya rechace sus cambios con un 403.
    _aplicarVisibilidadAdmin() {
        const esAdmin = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
        const sec = document.getElementById('sectionAcceso');
        if (sec) sec.style.display = esAdmin ? '' : 'none';
    },

    mostrarOpciones() {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        document.getElementById('horasAnualesDisplay').textContent = this.horasAnualesCustom + 'h';
        this._actualizarJornadaDisplay();
        this._actualizarConductorDisplay();
        this._aplicarVisibilidadAdmin();
        this._renderVacaciones();
        document.getElementById('perfilEmail').textContent = this.usuarioActual?.email || '';
        document.getElementById('perfilNombre').textContent = this.usuarioActual?.name || '';
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
        this._actualizarAvatarPreview();
        this._actualizarTemaUI();
        this._actualizarInfoCopia();
    },

    toggleSection(btn) { btn.closest('.ops-section').classList.toggle('open'); },

    _calcHorasNocturnas(inicio, fin) {
        if (!inicio || !fin) return 0;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let a = h1 * 60 + m1;
        let b = h2 * 60 + m2;
        if (b <= a) b += 1440;
        const windows = [[1260, 1440], [1440, 1800]];
        let mins = 0;
        windows.forEach(([ws, we]) => {
            mins += Math.max(0, Math.min(b, we) - Math.max(a, ws));
        });
        return Math.round(mins / 60 * 2) / 2;
    },

    calcularHorasPorTiempo() {
        const inicio = document.getElementById('horaInicio').value;
        const fin    = document.getElementById('horaFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('horasInput').value = horas;
        this._renderTramos();            // cambian las horas sin lugar
        // Las horas nocturnas salen solas del horario: no hay botón que las
        // active, así que si no hay ninguna el cuadro no aparece por ningún
        // lado.
        const nocturnas = this._calcHorasNocturnas(inicio, fin);
        if (nocturnas > 0) {
            document.getElementById('horasNocturnas').value = nocturnas;
            if (this.precioNocheDefault > 0) document.getElementById('precioNoche').value = this.precioNocheDefault;
        } else {
            document.getElementById('horasNocturnas').value = '';
        }
        this.calcularExtra();
    },

    // PR = Permiso Retribuido. Two per calendar year, counted down as they are used.
    PR_ANUALES: 2,

    _prUsados(historial) {
        const año = new Date().getFullYear();
        return Object.values(historial || this._historialFull || {})
            .filter(r => r.pr && new Date(r.timestamp).getFullYear() === año).length;
    },

    _prRestantes(historial) {
        return Math.max(0, this.PR_ANUALES - this._prUsados(historial));
    },

    _actualizarPrUI() {
        const restantes = this._prRestantes();
        const el = document.getElementById('prRestantes');
        if (el) el.textContent = restantes;
        const btn = document.getElementById('prCompact');
        // Still tappable when exhausted (an old one may have been deleted), just dimmed
        if (btn) btn.classList.toggle('agotado', restantes === 0 && !this.prActivo);
    },

    clickPrCompact(auto = false) {
        if (!auto && this.sinAsistenciaActivo) return;
        if (!this.prActivo && this._prRestantes() === 0) {
            alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`);
            return;
        }
        this.prActivo = !this.prActivo;
        document.getElementById('prCompact').classList.toggle('active', this.prActivo);
        document.getElementById('prToggle').checked = this.prActivo;
        this._actualizarPrUI();
    },

    clickFestivo(auto = false) {
        if (!auto && this.sinAsistenciaActivo) return;
        this.festivoActivo = !this.festivoActivo;
        document.getElementById('festivoCompact').classList.toggle('active', this.festivoActivo);
        document.getElementById('festivoToggle').checked = this.festivoActivo;
        // Jornada completa: venir un festivo o un libre son sus horas de
        // jornada, pero solo como propuesta. Si escribe otras, mandan las suyas.
        const campo = document.getElementById('horasInput');
        if (this.festivoActivo && this._esJornadaCompleta() && campo
            && !(parseFloat(campo.value) > 0)) {
            campo.value = this.jornadaHoras;
        }
    },

    // El título del cuadro solo habla de días libres a quien puede trabajarlos
    _actualizarTituloFestivos() {
        const el = document.getElementById('statFestivosLabel');
        if (el) el.textContent = this._esJornadaCompleta()
            ? '🎉 Festivos/días libres' : '🎉 Festivos';
        const caja = document.getElementById('festivoCompact');
        if (caja) caja.title = this._esJornadaCompleta()
            ? 'Festivo o día libre trabajado' : 'Festivo';
    },

    // ── Vacaciones ───────────────────────────────────────────────────────────

    _getVacaciones() { return JSON.parse(localStorage.getItem('vacaciones') || '[]'); },

    _saveVacaciones(v, deGestion) {
        localStorage.setItem('vacaciones', JSON.stringify(v));
        // La marca de tiempo decide quién manda cuando el trabajador y el
        // gestor tocan las vacaciones por separado: gana el cambio más nuevo.
        if (!deGestion) localStorage.setItem('vacacionesAt', String(Date.now()));
        this._guardarPreferencias();
    },

    _vacacionesAt() { return parseInt(localStorage.getItem('vacacionesAt') || '0', 10); },

    // Los días de la semana también los puede cambiar el gestor desde el
    // cuadrante, así que van sellados para que gane el último cambio.
    _diasAt() { return parseInt(localStorage.getItem('diasSemanaAt') || '0', 10); },

    // Grupo de días libres de la jornada completa. Lo asigna gestión; aquí solo
    // se enseña.
    grupoDescanso: parseInt(localStorage.getItem('grupoDescanso') || '0', 10) || null,
    _sellarDias() { localStorage.setItem('diasSemanaAt', String(Date.now())); },

    _etiquetaDias() {
        const d = Array.isArray(this.diasSemana) && this.diasSemana.length ? this.diasSemana : null;
        if (!d) return 'todos';
        const letra = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        return this.DIAS_MEDIA.filter(x => d.includes(x)).map(x => letra[x]).join(' ');
    },

    _hoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },

    // El mismo día de hoy, en el formato compacto de los ids del historial
    // (AAAAMMDD). Con toISOString() el día sale en UTC, que entre la
    // medianoche local y que UTC alcance la suya (hasta 2h con la hora de
    // verano) todavía marca el día de ayer: registrabas hoy pero el aviso de
    // "¿ya has fichado?" seguía sin verlo y avisaba otra vez.
    _hoyId() { return this._hoyISO().replace(/-/g, ''); },

    _periodoVacacionesActivo() {
        const hoy = this._hoyISO();
        return this._getVacaciones().find(v => hoy >= v.desde && hoy <= v.hasta) || null;
    },

    _aplicarModoVacaciones() {
        const per = this._periodoVacacionesActivo();
        document.body.classList.toggle('vacaciones', !!per);
        const sub = document.getElementById('vacBannerSub');
        if (per && sub) {
            const fin  = new Date(per.hasta + 'T12:00:00');
            const dias = Math.max(0, Math.ceil((fin - new Date()) / 86400000));
            sub.textContent = dias === 0 ? 'Último día, a disfrutarlo'
                            : `Te quedan ${dias} día${dias === 1 ? '' : 's'}`;
        }
    },

    async añadirVacaciones() {
        const desde = document.getElementById('vacDesde').value;
        const hasta = document.getElementById('vacHasta').value;
        if (!desde || !hasta) { this._mostrarToast('❌ Indica las dos fechas', 3000); return; }
        if (hasta < desde)    { this._mostrarToast('❌ La fecha final es anterior a la inicial', 3000); return; }
        const v = this._getVacaciones();
        v.push({ desde, hasta });
        v.sort((a, b) => a.desde.localeCompare(b.desde));
        this._saveVacaciones(v);
        document.getElementById('vacDesde').value = '';
        document.getElementById('vacHasta').value = '';
        this._renderVacaciones();
        this._aplicarModoVacaciones();
        this._mostrarToast('🏖️ Vacaciones añadidas', 2500);
        await this._registrarDiasVacaciones(desde, hasta);
    },

    // Cada día del rango que todavía no tenga nada registrado se apunta como
    // vacaciones, sin horario: así la nómina y el resumen anual ya cuentan
    // esos días sin tener que registrarlos uno a uno.
    async _registrarDiasVacaciones(desde, hasta) {
        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            if (!datos.historial) datos.historial = {};
            let tocado = false;
            for (let d = new Date(desde + 'T12:00:00'), fin = new Date(hasta + 'T12:00:00');
                 d <= fin; d.setDate(d.getDate() + 1)) {
                const fechaKey = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
                if (datos.historial[fechaKey]) continue;   // ya hay algo ese día: no se toca
                datos.historial[fechaKey] = {
                    fecha: d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    horas: 0, timestamp: +d, vacaciones: true, deVacaciones: true,
                };
                tocado = true;
            }
            if (!tocado) return;
            datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
        } catch (e) { this._mostrarToast('❌ No se pudieron registrar los días: ' + e.message, 4000); }
    },

    async borrarVacaciones(i) {
        const v = this._getVacaciones();
        const periodo = v[i];
        v.splice(i, 1);
        this._saveVacaciones(v);
        this._renderVacaciones();
        this._aplicarModoVacaciones();
        if (periodo) await this._quitarDiasVacaciones(periodo.desde, periodo.hasta);
    },

    // Solo se quitan los días que se pusieron solos al añadir el periodo: si
    // se ha tocado algo de esa jornada a mano, se deja tal cual.
    async _quitarDiasVacaciones(desde, hasta) {
        try {
            const datos = await this._readDriveFile();
            if (!datos?.historial) return;
            let tocado = false;
            for (let d = new Date(desde + 'T12:00:00'), fin = new Date(hasta + 'T12:00:00');
                 d <= fin; d.setDate(d.getDate() + 1)) {
                const fechaKey = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
                if (datos.historial[fechaKey]?.deVacaciones) { delete datos.historial[fechaKey]; tocado = true; }
            }
            if (!tocado) return;
            datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
        } catch (_) { /* si falla, se quedan los días apuntados; no pasa nada grave */ }
    },

    _renderVacaciones() {
        const cont = document.getElementById('vacList');
        if (!cont) return;
        const v = this._getVacaciones();
        if (!v.length) {
            cont.innerHTML = '<div class="ops-field-sub" style="padding-top:6px;">Sin vacaciones guardadas</div>';
            return;
        }
        const fmt = s => new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day:'2-digit', month:'short' });
        const hoy = this._hoyISO();
        cont.innerHTML = v.map((p, i) => {
            const dias = Math.round((new Date(p.hasta) - new Date(p.desde)) / 86400000) + 1;
            const activo = hoy >= p.desde && hoy <= p.hasta;
            return `<div class="vac-item">
                <span class="vac-item-txt">${activo ? '🏖️ ' : ''}${fmt(p.desde)} → ${fmt(p.hasta)}
                    <span class="vac-item-n">(${dias} día${dias===1?'':'s'})</span></span>
                <button class="vac-del" onclick="app.borrarVacaciones(${i})">×</button>
            </div>`;
        }).join('');
    },

    // ── Exportar mis jornadas ────────────────────────────────────────────────
    // Las horas extra de cada jornada, calculadas igual que en el resumen: en
    // orden cronológico, lo que pasa del tope anual (o lo marcado a mano).
    // Sin esto, la columna de horas extra del informe no traía horas —traía
    // un "Sí"/"" que no había forma de sumar en la hoja.
    _extrasPorRegistro(historial) {
        const orden = Object.entries(historial || {})
            .filter(([, r]) => r.timestamp)
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        const tope = this.horasAnualesCustom;
        let acumulado = 0;
        const out = {};
        orden.forEach(([id, r]) => {
            const h = parseFloat(r.horas) || 0;
            if (r.extraDestino === 'extras') { out[id] = h; return; }
            const efectivas = this._horasEfectivas(this._fechaDeId(id), r);
            const cabe = Math.max(0, tope - acumulado);
            out[id] = Math.round(Math.max(0, efectivas - cabe) * 100) / 100;
            acumulado += efectivas;
        });
        return out;
    },

    // Solo las jornadas de quien usa la app: aquí no hay nadie más
    _filasExport() {
        const filas = [];
        const extrasPorId = this._extrasPorRegistro(this._historialFull);
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            const f = this._fechaDeId(id);
            const lugar = r.puesto || this.puestoTrabajo || '';
            const t = this._turnoDe(lugar, r.horaInicio) || '';
            filas.push({
                fecha: `${f.slice(6,8)}/${f.slice(4,6)}/${f.slice(0,4)}`,
                orden: f, clugar: this._clavePuesto(lugar),
                num: this.numConductor || '', nombre: this.usuarioActual?.name || '',
                puesto: lugar, turno: { M:'Mañana', T:'Tarde', N:'Noche' }[t] || '',
                ini: r.horaInicio || '', fin: r.horaFin || '',
                horas: parseFloat(r.horas) || 0, noct: r.horasNocturnas || 0,
                extra: extrasPorId[id] || 0, festivo: r.festivo ? 'Sí' : '',
                vac: r.vacaciones ? 'Sí' : '', pr: r.pr ? 'Sí' : '',
                be: r.be ? 'Sí' : '',
                nota: r.nota || '',
            });
        });
        // Por fecha y, dentro del mismo día, por hora de entrada. Las jornadas
        // sin horario (vacaciones, festivos no trabajados) van al final del día.
        const entrada = x => x.ini || '99:99';
        filas.sort((a, b) => a.orden.localeCompare(b.orden) || entrada(a).localeCompare(entrada(b)));
        const g = this._filtrosExport();
        return filas.filter(r =>
               (!g.desde || r.orden >= g.desde)
            && (!g.hasta || r.orden <= g.hasta)
            && (!g.lugares || g.lugares.includes(r.clugar)));
    },

    // Todas las jornadas, sin filtrar: es contra lo que se ofrecen las opciones
    _filasTodas() {
        const guardado = this._filtros;
        this._filtros = { desde:'', hasta:'', lugares:null };
        try { return this._filasExport(); } finally { this._filtros = guardado; }
    },

    // Lista vacía = sin jornadas; null = sin filtro (todas)
    _filtrosExport() {
        if (this._filtros) return this._filtros;
        let g = null;
        try { g = JSON.parse(localStorage.getItem('filtrosExportMio') || 'null'); } catch (_) {}
        this._filtros = {
            desde: typeof g?.desde === 'string' ? g.desde : '',
            hasta: typeof g?.hasta === 'string' ? g.hasta : '',
            lugares: Array.isArray(g?.lugares) ? g.lugares : null,
        };
        return this._filtros;
    },

    _guardarFiltros(cambios) {
        this._filtros = { ...this._filtrosExport(), ...cambios };
        localStorage.setItem('filtrosExportMio', JSON.stringify(this._filtros));
        this._renderFiltrosExport();
        this._renderColsExport();
    },

    // Cada opción del selector es una o varias columnas de la hoja
    COLUMNAS_EXPORT: [
        { id:'fecha',      etiqueta:'Fecha completa',        cabeceras:['Fecha'],                  valores:f => [f.fecha] },
        { id:'trabajador', etiqueta:'Trabajador',            cabeceras:['Nº trabajador','Nombre'], valores:f => [f.num, f.nombre] },
        { id:'turno',      etiqueta:'Mañana, tarde o noche', cabeceras:['Turno'],                  valores:f => [f.turno] },
        { id:'lugar',      etiqueta:'Lugar de trabajo',      cabeceras:['Lugar de trabajo'],       valores:f => [f.puesto] },
        { id:'horarios',   etiqueta:'Horarios',              cabeceras:['Entrada','Salida'],       valores:f => [f.ini, f.fin] },
        { id:'horas',      etiqueta:'Horas',                 cabeceras:['Horas'],                  valores:f => [f.horas],  sumable:true },
        { id:'nocturnas',  etiqueta:'Horas nocturnas',       cabeceras:['Nocturnas'],              valores:f => [f.noct],   sumable:true },
        { id:'extras',     etiqueta:'Horas extras',          cabeceras:['Extra'],                  valores:f => [f.extra],  sumable:true },
        { id:'festivos',   etiqueta:'Festivos',              cabeceras:['Festivo'],                valores:f => [f.festivo] },
        { id:'vacaciones', etiqueta:'Vacaciones',            cabeceras:['Vacaciones'],             valores:f => [f.vac] },
        { id:'pr',         etiqueta:'PR',                    cabeceras:['PR'],                     valores:f => [f.pr] },
        { id:'be',         etiqueta:'BE',                    cabeceras:['BE'],                     valores:f => [f.be] },
        { id:'nota',       etiqueta:'Notas de la jornada',   cabeceras:['Nota'],                   valores:f => [f.nota] },
    ],

    _colsElegidas() {
        let guardadas = null;
        try { guardadas = JSON.parse(localStorage.getItem('colsExportMias') || 'null'); } catch (_) {}
        const ids = this.COLUMNAS_EXPORT.map(c => c.id);
        // Sin elección previa se exporta todo, como antes. Una lista vacía sí es
        // una elección: desmarcar "Todo" tiene que dejar las casillas vacías.
        if (!Array.isArray(guardadas)) return ids;
        return guardadas.filter(id => ids.includes(id));
    },

    _colsActivas() {
        const elegidas = this._colsElegidas();
        return this.COLUMNAS_EXPORT.filter(c => elegidas.includes(c.id));
    },

    get CABECERAS_EXPORT() { return this._colsActivas().flatMap(c => c.cabeceras); },

    _valoresFila(f) { return this._colsActivas().flatMap(c => c.valores(f)); },

    // Fila de totales al final de la hoja: suma horas, nocturnas y extras si
    // están elegidas, para no tener que sumarlas a mano ni fiarse de que la
    // hoja las sume bien sola.
    _hayColSumable() { return this._colsActivas().some(c => c.sumable); },

    _filaTotales() {
        const filas = this._filasExport();
        let puestaEtiqueta = false;
        return this._colsActivas().flatMap(c => {
            if (c.sumable) {
                const total = filas.reduce((s, f) => s + (Number(c.valores(f)[0]) || 0), 0);
                return [Math.round(total * 100) / 100];
            }
            if (!puestaEtiqueta) { puestaEtiqueta = true; return ['Total', ...c.cabeceras.slice(1).map(() => '')]; }
            return c.cabeceras.map(() => '');
        });
    },

    // Los tres filtros comparten estructura: cabecera plegable con un resumen
    // de lo elegido, y dentro las opciones.
    _renderFiltrosExport() {
        const cont = document.getElementById('expFiltros');
        if (!cont) return;
        const f = this._filtrosExport();
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const iso = v => v ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : '';
        const corta = v => v ? `${v.slice(6,8)}/${v.slice(4,6)}/${v.slice(0,4)}` : '';

        const todas = this._filasTodas();
        const lugares = [...new Map(todas.map(r => [r.clugar, r.puesto || 'Sin lugar'])).entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'es'));

        const resumenFechas = (!f.desde && !f.hasta) ? 'Todas'
            : `${corta(f.desde) || '…'} – ${corta(f.hasta) || '…'}`;
        const resumen = (sel, total) => !sel ? 'Todos'
            : sel.length === total ? 'Todos' : `${sel.length} de ${total}`;

        const casillas = (grupo, items) => {
            const sel = f[grupo];
            const todo = !sel || sel.length === items.length;
            return `<label class="exp-col exp-todo">
                    <input type="checkbox" ${todo ? 'checked' : ''}
                           onchange="app._todoFiltro('${grupo}', this.checked)"><span>Todos</span></label>`
                + items.map(([valor, etiqueta]) => `<label class="exp-col">
                    <input type="checkbox" data-grupo="${grupo}" value="${esc(valor)}"
                           ${(!sel || sel.includes(valor)) ? 'checked' : ''}
                           onchange="app._marcarFiltro('${grupo}')"><span>${esc(etiqueta)}</span></label>`).join('');
        };

        cont.innerHTML = `
        <div class="exp-sec${this._secExp === 'fechas' ? ' abierta' : ''}">
            <div class="exp-sec-h" onclick="app._abrirSecExport('fechas')">
                <span class="exp-sec-t">📅 Días</span>
                <span class="exp-sec-r">${esc(resumenFechas)}</span><span class="exp-sec-c">▾</span>
            </div>
            <div class="exp-sec-b">
                <div class="exp-fechas">
                    <label>Desde<input type="date" value="${iso(f.desde)}"
                        onchange="app._guardarFiltros({desde:this.value.replace(/-/g,'')})"></label>
                    <label>Hasta<input type="date" value="${iso(f.hasta)}"
                        onchange="app._guardarFiltros({hasta:this.value.replace(/-/g,'')})"></label>
                </div>
                <div class="exp-chips">
                    <button onclick="app._rangoRapido('todo')">Todo</button>
                    <button onclick="app._rangoRapido('mes')">Este mes</button>
                    <button onclick="app._rangoRapido('anterior')">Mes anterior</button>
                    <button onclick="app._rangoRapido('anio')">Este año</button>
                </div>
            </div>
        </div>
        <div class="exp-sec${this._secExp === 'lugar' ? ' abierta' : ''}">
            <div class="exp-sec-h" onclick="app._abrirSecExport('lugar')">
                <span class="exp-sec-t">🧩 Lugares de trabajo</span>
                <span class="exp-sec-r">${resumen(f.lugares, lugares.length)}</span><span class="exp-sec-c">▾</span>
            </div>
            <div class="exp-sec-b">${casillas('lugares', lugares)}</div>
        </div>`;
    },

    _abrirSecExport(id) {
        this._secExp = this._secExp === id ? null : id;   // solo una abierta a la vez
        this._renderFiltrosExport();
    },

    _rangoRapido(cual) {
        const hoy = new Date();
        const cl = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        if (cual === 'todo')  return this._guardarFiltros({ desde:'', hasta:'' });
        if (cual === 'anio')  return this._guardarFiltros({
            desde: cl(new Date(hoy.getFullYear(), 0, 1)), hasta: cl(new Date(hoy.getFullYear(), 11, 31)) });
        const m = hoy.getMonth() - (cual === 'anterior' ? 1 : 0);
        this._guardarFiltros({
            desde: cl(new Date(hoy.getFullYear(), m, 1)),
            hasta: cl(new Date(hoy.getFullYear(), m + 1, 0)) });
    },

    _marcarFiltro(grupo) {
        const todos = [...document.querySelectorAll(`#expFiltros input[data-grupo="${grupo}"]`)];
        const sel = todos.filter(i => i.checked).map(i => i.value);
        // Marcado entero equivale a "sin filtro": así una lista que crezca sigue entrando
        this._guardarFiltros({ [grupo]: sel.length === todos.length ? null : sel });
    },

    _todoFiltro(grupo, marcar) { this._guardarFiltros({ [grupo]: marcar ? null : [] }); },

    _renderColsExport() {
        const cont = document.getElementById('expCols');
        if (!cont) return;
        const elegidas = this._colsElegidas();
        const todo = elegidas.length === this.COLUMNAS_EXPORT.length;
        cont.innerHTML = `<label class="exp-col exp-todo">
                <input type="checkbox" ${todo ? 'checked' : ''} onchange="app._marcarTodoExport(this.checked)">
                <span>Todo</span></label>`
            + this.COLUMNAS_EXPORT.map(c => `<label class="exp-col">
                <input type="checkbox" value="${c.id}" ${elegidas.includes(c.id) ? 'checked' : ''}
                       onchange="app._guardarColsExport()">
                <span>${c.etiqueta}</span></label>`).join('');
        const n = this._filasExport().length;
        const pie = document.getElementById('expResumen');
        if (pie) pie.textContent = n === 1 ? '1 jornada seleccionada' : `${n} jornadas seleccionadas`;
    },

    _guardarColsExport() {
        const ids = [...document.querySelectorAll('#expCols input[value]')]
            .filter(i => i.checked).map(i => i.value);
        localStorage.setItem('colsExportMias', JSON.stringify(ids));
        this._renderColsExport();
    },

    _marcarTodoExport(marcar) {
        localStorage.setItem('colsExportMias', JSON.stringify(
            marcar ? this.COLUMNAS_EXPORT.map(c => c.id) : []));
        this._renderColsExport();
    },

    // Una hoja sin columnas no sirve de nada: mejor avisar que generarla vacía
    _hayColumnas() {
        if (!this._colsElegidas().length) {
            this._mostrarToast('Elige al menos un dato que exportar', 3000); return false;
        }
        if (!this._filasExport().length) {
            this._mostrarToast('Ninguna jornada pasa los filtros', 3000); return false;
        }
        return true;
    },

    exportarRegistro() {
        if (!this._filasExport().length) { this._mostrarToast('No hay jornadas que exportar', 3000); return; }
        this._secExp = null;
        this._renderFiltrosExport();
        this._renderColsExport();
        document.getElementById('expModal').classList.add('show');
        if (this.darkMode) document.getElementById('expModalContent').classList.add('dark');
    },

    _nombreExport(ext) { return `mis-jornadas-${this.numConductor || 'emt'}-${new Date().toISOString().slice(0,10)}.${ext}`; },

    _descargar(contenido, nombre, tipo) {
        if (window.AndroidBridge?.saveFile) { window.AndroidBridge.saveFile(contenido, nombre); return; }
        const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    // ── Excel de verdad (.xlsx) ─────────────────────────────────────────────
    // Antes se guardaba una tabla HTML con extensión .xls. Excel de escritorio
    // la tragaba, pero Office en Android la rechaza con "este archivo no es
    // compatible". Un .xlsx es un ZIP con unos cuantos XML dentro, así que se
    // arma a mano: sin comprimir (método 0) basta y evita meter una librería.

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
            const nom   = enc.encode(nombre);
            const crc   = this._crc32(datos);
            // Bit 11 = nombres en UTF-8; fecha y hora fijas, no aportan nada aquí
            const comun = [...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x2100),
                           ...u32(crc), ...u32(datos.length), ...u32(datos.length),
                           ...u16(nom.length)];
            partes.push(new Uint8Array([...u32(0x04034b50), ...comun, ...u16(0)]), nom, datos);
            // extra, comentario, disco, atributos internos, atributos externos, offset
            central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...comun,
                ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nom);
            offset += 30 + nom.length + datos.length;
        });

        const tamCentral = central.reduce((n, p) => n + p.length, 0);
        const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0),
            ...u16(ficheros.length), ...u16(ficheros.length),
            ...u32(tamCentral), ...u32(offset), ...u16(0)]);

        const todo = [...partes, ...central, fin];
        const total = todo.reduce((n, p) => n + p.length, 0);
        const salida = new Uint8Array(total);
        let i = 0;
        todo.forEach(p => { salida.set(p, i); i += p.length; });
        return salida;
    },

    _colExcel(n) {                       // 0 -> A, 25 -> Z, 26 -> AA
        let s = '';
        for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    },

    _xlsxRegistro() {
        const filasDatos = this._filasExport().map(f => this._valoresFila(f));
        const filas = (this._hayColSumable() && filasDatos.length)
            ? [...filasDatos, this._filaTotales()] : filasDatos;
        return this._xlsxDe('Registro', this.CABECERAS_EXPORT, filas);
    },

    // La misma hoja para cualquier tabla: el registro y las nóminas salen de
    // aquí, que no tiene sentido tener dos veces el mismo ZIP escrito a mano.
    _xlsxDe(hoja, cabeceras, filas) {
        const esc = v => String(v ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

        const celda = (v, col, fila, estilo) => {
            const ref = `${this._colExcel(col)}${fila}`;
            const st  = estilo ? ` s="${estilo}"` : '';
            if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
            const t = esc(v);
            if (t === '') return '';
            return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`;
        };

        const filasXml = [
            `<row r="1">${cabeceras.map((h, i) => celda(h, i, 1, 1)).join('')}</row>`,
            ...filas.map((vals, n) => `<row r="${n + 2}">${vals.map((v, i) => celda(v, i, n + 2, 0)).join('')}</row>`),
        ].join('');

        const ancho = cabeceras.map((h, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${Math.min(34, Math.max(9, h.length + 4))}" customWidth="1"/>`).join('');

        const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
        const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

        return this._zip([
            { nombre: '[Content_Types].xml', texto: X
            + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
            + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
            + `<Default Extension="xml" ContentType="application/xml"/>`
            + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
            + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
            + `</Types>` },
            { nombre: '_rels/.rels', texto: X
            + `<Relationships xmlns="${REL}">`
            + `<Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/>`
            + `</Relationships>` },
            { nombre: 'xl/workbook.xml', texto: X
            + `<workbook xmlns="${NS}" xmlns:r="${DOC}">`
            + `<sheets><sheet name="${esc(hoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
            { nombre: 'xl/_rels/workbook.xml.rels', texto: X
            + `<Relationships xmlns="${REL}">`
            + `<Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/>`
            + `<Relationship Id="rId2" Type="${DOC}/styles" Target="styles.xml"/>`
            + `</Relationships>` },
            { nombre: 'xl/styles.xml', texto: X
            + `<styleSheet xmlns="${NS}">`
            + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>`
            + `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
            + `<fills count="3"><fill><patternFill patternType="none"/></fill>`
            + `<fill><patternFill patternType="gray125"/></fill>`
            + `<fill><patternFill patternType="solid"><fgColor rgb="FF1565C0"/><bgColor indexed="64"/></patternFill></fill></fills>`
            + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
            + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
            + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
            + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
            + `</styleSheet>` },
            { nombre: 'xl/worksheets/sheet1.xml', texto: X
            + `<worksheet xmlns="${NS}">`
            + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
            + `<cols>${ancho}</cols><sheetData>${filasXml}</sheetData></worksheet>` },
        ]);
    },

    _descargarBinario(bytes, nombre, tipo) {
        if (window.AndroidBridge?.saveFileBase64) {
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            window.AndroidBridge.saveFileBase64(btoa(bin), nombre);
            return true;
        }
        if (window.AndroidBridge?.saveFile) return false;   // versión antigua sin el puente
        const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    },

    // Separador ; y coma decimal: es lo que espera Excel en español.
    // El BOM hace que reconozca los acentos.
    _csvDe(cabeceras, filas) {
        const esc = v => {
            const t = String(v ?? '');
            return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const filaCsv = vals => vals.map(v => esc(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';');
        const lineas = [cabeceras.join(';'), ...filas.map(filaCsv)];
        return '﻿' + lineas.join('\r\n') + '\r\n';
    },

    _csvRegistro() {
        const filasDatos = this._filasExport();
        const filas = filasDatos.map(f => this._valoresFila(f));
        if (this._hayColSumable() && filasDatos.length) filas.push(this._filaTotales());
        return this._csvDe(this.CABECERAS_EXPORT, filas);
    },

    exportarCSV() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        this._descargar(this._csvRegistro(), this._nombreExport('csv'), 'text/csv;charset=utf-8;');
        this._mostrarToast(`📊 ${filas.length} jornadas en CSV`, 4000);
    },

    exportarXLS() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        const ok = this._descargarBinario(this._xlsxRegistro(), this._nombreExport('xlsx'),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel; de momento usa CSV', 4500); return; }
        this._mostrarToast(`📗 ${filas.length} jornadas en Excel`, 4000);
    },

    // Drive convierte un CSV en hoja de cálculo si se le pide ese mimeType
    async exportarSheets() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        this._mostrarToast('☁️ Creando hoja en Drive...', 3000);
        try {
            if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
            const frontera = '-------emt' + Date.now();
            const meta = JSON.stringify({
                name: `Mis jornadas EMT ${new Date().toISOString().slice(0,10)}`,
                mimeType: 'application/vnd.google-apps.spreadsheet',
            });
            const cuerpo = `\r\n--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
                + `\r\n--${frontera}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${this._csvRegistro()}`
                + `\r\n--${frontera}--`;
            const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.accessToken}`,
                           'Content-Type': `multipart/related; boundary=${frontera}` },
                body: cuerpo,
            });
            if (!resp.ok) throw new Error('Drive ' + resp.status);
            const r = await resp.json();
            this._mostrarToast(`✅ ${filas.length} jornadas en Google Sheets`, 4000);
            if (r.webViewLink) {
                if (window.AndroidBridge?.openExternalUrl) window.AndroidBridge.openExternalUrl(r.webViewLink);
                else window.open(r.webViewLink, '_blank');
            }
        } catch (e) {
            this._mostrarToast('❌ No se pudo crear la hoja: ' + e.message, 4500);
        }
    },

    // ── Notas ───────────────────────────────────────────────────────────────
    // El trabajador escribe y gestión contesta. La fecha y la hora las pone el
    // servidor, para que no dependan del reloj del móvil.

    NOTAS_URL: 'https://emt-palma-movilidad.vercel.app/api/notas',
    _notas: [],

    // Marcar leído desde el aviso del móvil se apunta en el servidor, no aquí:
    // el móvil manda el visto y ya está. Al abrir la app, esto no lo sabía y
    // la conversación seguía contando como pendiente, así que volvía a sonar y
    // a salir el aviso de algo que ya se había leído. Lo que el servidor dice
    // que he visto yo se da por leído aquí también.
    _fundirVistosDelServidor() {
        const yo = (this.usuarioActual?.email || '').toLowerCase();
        if (!yo) return;
        const leidas = this._leidas();
        let cambia = false;
        (this._notas || []).forEach(n => {
            const v = n?.vistoPor;
            if (!v || (v.email || '').toLowerCase() !== yo) return;
            const cuando = v.en || '';
            if (cuando && cuando > (leidas[n.id] || '')) { leidas[n.id] = cuando; cambia = true; }
        });
        if (cambia) {
            try { localStorage.setItem('convLeidas', JSON.stringify(leidas)); } catch (_) {}
        }
    },

    async _cargarNotas() {
        if (!this.usuarioActual?.email) return;
        try {
            const r = await fetch(`${this.NOTAS_URL}?email=${encodeURIComponent(this.usuarioActual.email)}`,
                { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            this._notas = await r.json();
            localStorage.setItem('notasCache', JSON.stringify(this._notas));
        } catch (_) {
            // Sin red se enseña lo último que se vio
            try { this._notas = JSON.parse(localStorage.getItem('notasCache') || '[]'); } catch (__) {}
        }
        this._fundirVistosDelServidor();
        this._renderNotas();
        // Con la conversación abierta, lo que llegue se ve ahí mismo: antes
        // había que cerrarla y volver a entrar para leer la respuesta.
        if (this._hiloAbierto
            && document.getElementById('hiloModal')?.classList.contains('show')) {
            this._marcarLeida(this._hiloAbierto);
            this._renderHilo();
        }
        this._avisarSiHayNuevos();
        this._atenderChatPendiente();
        this._iniciarSondeoChat();     // idempotente: reinicia el que hubiera
    },

    _fechaNota(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    _renderNotas() {
        const cont = document.getElementById('ntLista');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const verArchivadas = localStorage.getItem('verArchivadas') === '1';
        const todas = this._notas || [];
        const lista = todas.filter(n => !!n.archivada === verArchivadas);
        const nArch = todas.filter(n => n.archivada).length;
        const barra = document.getElementById('ntArchivadas');
        if (barra) {
            barra.innerHTML = `<button class="${verArchivadas ? '' : 'activo'}"
                    onclick="app._verArchivadas(false)">Bandeja ${todas.length - nArch}</button>
                <button class="${verArchivadas ? 'activo' : ''}"
                    onclick="app._verArchivadas(true)">Archivadas ${nArch}</button>`;
        }
        if (!lista.length) {
            cont.innerHTML = `<div class="nt-vacio">${verArchivadas
                ? 'No has archivado ninguna conversación.'
                : 'Todavía no hay conversaciones.'}</div>`;
            return;
        }
        const cnt = document.getElementById('ntCnt');
        if (cnt) {
            const pend = this._totalSinLeer();
            cnt.textContent = pend ? `${pend} sin ver` : 'al día';
        }
        const etiqueta = { visto: 'Vista', pendiente: 'Sin ver' };
        cont.innerHTML = lista.map(n => {
            const ultimo = this._ultimoMensaje(n);
            const clase = n.tipo === 'companero' ? 'companero'
                : this._estaVista(n) ? 'visto' : '';
            const q = esc(n.id).replace(/'/g, "\\'");
            const nueva = this._sinLeer(n);
            return `<div class="cv-card ${clase}${n.archivada ? ' archivada' : ''}${nueva ? ' nueva' : ''}"
                    onclick="app.abrirHilo('${q}')">
                <div class="cv-top">
                    ${nueva ? '<span class="cv-punto"></span>' : ''}
                    <span class="cv-quien">${esc(this._tituloHilo(n))}</span>
                    <span class="cv-fecha">${esc(this._horaCorta(ultimo?.en || n.creado))}</span>
                </div>
                <div class="cv-ultimo">${ultimo ? esc(
                    (this._esMiMensaje(ultimo, n) ? 'Tú: ' : '') + (ultimo.texto || '📎 Adjunto')) : ''}</div>
                <div class="cv-pie">
                    <span class="cv-cnt">${this._mensajesDe(n).length} mensaje${
                        this._mensajesDe(n).length === 1 ? '' : 's'}</span>
                    <span class="cv-cnt">${etiqueta[this._estaVista(n) ? 'visto' : 'pendiente']}</span>
                    <span class="cv-acc" onclick="event.stopPropagation()">
                        <button onclick="app._archivarHilo('${q}',${!n.archivada})">${
                            n.archivada ? 'Recuperar' : 'Archivar'}</button>
                        <button class="borrar" onclick="app._borrarHilo('${q}')">Borrar</button>
                    </span>
                </div>
            </div>`;
        }).join('');
        this._pintarCampana();
    },

    _verArchivadas(si) {
        localStorage.setItem('verArchivadas', si ? '1' : '0');
        this._renderNotas();
    },

// Un adjunto de imagen se ve; lo demás se descarga
    _pintarAdjuntos(lista) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        if (!Array.isArray(lista) || !lista.length) return '';
        return `<div class="nt-adj">` + lista.map(a => a.tipo?.startsWith('image/')
            ? `<img src="${esc(a.datos)}" alt="${esc(a.nombre)}" onclick="app._verFoto('${esc(a.datos)}')">`
            : `<a href="${esc(a.datos)}" download="${esc(a.nombre)}">📎 ${esc(a.nombre)}</a>`).join('') + `</div>`;
    },

    _verFoto(datos) {
        const v = document.getElementById('fotoVisor');
        if (!v) { window.open(datos, '_blank'); return; }
        document.getElementById('fotoVisorImg').src = datos;
        v.classList.add('show');
    },

    // ── A quién va el mensaje: a gestión, al desarrollador o a compañeros ───
    // Se elige igual que en la app de gestión: se marcan en una lista y se
    // escribe una vez. La misma nota puede ir a varios, y cada uno recibe la
    // suya: si contesta, contesta en su conversación y no la ven los demás.

    A_GESTION: '__gestion__',
    _elegidos: [],
    _notaPara: [],
    _directorio: [],

    // Quien lleva la aplicación. Sale con nombre propio en la lista de a
    // quién escribir, en las dos apps, para poder contarle un fallo o pedirle
    // algo sin tener que buscar su correo por ahí.
    DEV_EMAIL: 'g.rioscorrea@gmail.com',
    DEV_NOMBRE: 'Desarrollador',

    _soyElDesarrollador() {
        return (this.usuarioActual?.email || '').toLowerCase() === this.DEV_EMAIL;
    },

    async elegirDestinatario() {
        document.getElementById('destBuscar').value = '';
        this._elegidos = [];
        this._renderDestinatarios();
        document.getElementById('destModal').classList.add('show');
        if (this.darkMode) document.getElementById('destModalContent').classList.add('dark');
        if (!this._directorio.length) {
            try {
                const r = await fetch(`${this.USUARIOS_URL}?directorio=1`, { cache: 'no-store' });
                if (r.ok) {
                    this._directorio = await r.json();
                    localStorage.setItem('directorio', JSON.stringify(this._directorio));
                }
            } catch (_) {
                try { this._directorio = JSON.parse(localStorage.getItem('directorio') || '[]'); } catch (__) {}
            }
            this._renderDestinatarios();
        }
    },

    // Los compañeros que se ven ahora mismo con lo que haya en el buscador.
    // Gestión y el desarrollador van aparte, arriba, y no los toca "Todos":
    // una nota para la plantilla entera no tiene por qué colárseles.
    _companerosVisibles() {
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        const mio = (this.usuarioActual?.email || '').toLowerCase();
        return this._directorio
            .filter(u => (u.email || '').toLowerCase() !== mio)
            .filter(u => (u.email || '').toLowerCase() !== this.DEV_EMAIL)
            .filter(u => !q || `${u.conductor || ''} ${u.nombre || ''}`.toLowerCase().includes(q));
    },

    _fichaDe(email) {
        if (email === this.A_GESTION) return { email, nombre: 'Gestión', conductor: '🛠️' };
        if ((email || '').toLowerCase() === this.DEV_EMAIL) {
            return { email: this.DEV_EMAIL, nombre: this.DEV_NOMBRE, conductor: '💻' };
        }
        return this._directorio.find(u => u.email === email) || null;
    },

    _renderDestinatarios() {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        const lista = this._companerosVisibles();
        const fila = (email, num, nombre) => {
            const on = this._elegidos.includes(email);
            return `<div class="dest-fila${on ? ' on' : ''}"
                onclick="app._alternarDest('${esc(email).replace(/'/g, "\\'")}')">
                <span class="dest-marca">${on ? '✓' : ''}</span>
                <span class="nt-num">${esc(num)}</span>
                <span class="nt-nom">${esc(nombre)}</span></div>`;
        };
        const fijos = (!q || 'gestión gestion'.includes(q) ? fila(this.A_GESTION, '🛠️', 'Gestión') : '')
            + (!this._soyElDesarrollador() && (!q || this.DEV_NOMBRE.toLowerCase().includes(q))
                ? fila(this.DEV_EMAIL, '💻', this.DEV_NOMBRE) : '');
        document.getElementById('destLista').innerHTML = fijos
            + (lista.length ? lista.map(u => fila(u.email, u.conductor || '—', u.nombre || u.email)).join('')
               : (fijos ? '' : `<div class="baja-vacio">${q ? 'Nadie con ese nombre o número'
                    : 'Todavía no hay más compañeros'}</div>`));
        const n = this._elegidos.length;
        const cuantos = document.getElementById('destCuantos');
        if (cuantos) cuantos.textContent = n ? `${n} elegido${n === 1 ? '' : 's'}` : '';
        const seguir = document.getElementById('destSeguir');
        if (seguir) {
            seguir.textContent = n > 1 ? `Escribir a ${n}` : 'Escribir';
            seguir.disabled = n === 0;
            seguir.style.opacity = n === 0 ? '.5' : '';
        }
    },

    _alternarDest(email) {
        const i = this._elegidos.indexOf(email);
        if (i === -1) this._elegidos.push(email); else this._elegidos.splice(i, 1);
        this._renderDestinatarios();
    },

    // "Todos" son los compañeros que se estén viendo: con el buscador en
    // blanco, la plantilla entera; con algo escrito, solo los que encajan.
    _marcarTodosDest(si) {
        const visibles = this._companerosVisibles().map(u => u.email);
        this._elegidos = si
            ? [...new Set([...this._elegidos, ...visibles])]
            : this._elegidos.filter(e => !visibles.includes(e));
        this._renderDestinatarios();
    },

    _escribirALosElegidos() {
        if (!this._elegidos.length) return;
        this._notaPara = this._elegidos.slice();
        document.getElementById('destModal').classList.remove('show');
        const nombres = this._notaPara.map(e => {
            const f = this._fichaDe(e);
            return f ? `${f.conductor ? f.conductor + ' · ' : ''}${f.nombre || f.email}` : e;
        });
        document.getElementById('notaQuien').textContent = nombres.length === 1
            ? nombres[0] : `${nombres.length} destinatarios · cada uno recibirá la suya`;
        document.getElementById('ntTexto').value = '';
        document.getElementById('notaFirma').textContent =
            `Firmarás como ${this.usuarioActual?.name || 'ti'}.`;
        document.getElementById('notaModal').classList.add('show');
        if (this.darkMode) document.getElementById('notaModalContent').classList.add('dark');
    },

    // ── Estar al tanto de los mensajes ───────────────────────────────────────
    // Sin esto las notas solo se recargaban al cambiar de pestaña o al volver
    // a la app: una respuesta podía estar horas en el servidor sin que saltara
    // nada. Ahora se pregunta cada poco, pero solo por la huella —un id y la
    // hora del último mensaje de cada conversación—, que ocupa nada. Los
    // mensajes enteros, con sus fotos, solo se bajan si algo ha cambiado.

    SONDEO_CHAT: 60 * 1000,
    _timerChat: null,
    _huellaChat: null,

    _iniciarSondeoChat() {
        this._pararSondeoChat();
        if (!this.usuarioActual?.email) return;
        this._timerChat = setInterval(() => {
            this._sondearChat();
            // Y si le han cambiado el sitio o la hora. Antes solo se miraba al
            // entrar y al volver a la app, así que con la app abierta un
            // cambio de gestión no llegaba nunca.
            this._cargarAsignacion();
        }, this.SONDEO_CHAT);
        // Y el aviso nativo, que es el que sigue mirando con la app de fondo:
        // el sondeo de aquí arriba solo vive mientras la pantalla esté viva.
        window.AndroidBridge?.activarAvisoChat?.(
            this.usuarioActual.email, false, this.NOTAS_URL);
        // De paso, por dónde preguntar por la jornada de hoy: el mismo aviso
        // nativo mira también si le han cambiado el sitio o la hora.
        window.AndroidBridge?.saveToPrefs?.('asignacionUrl', this.USUARIOS_URL);
        // Y por el cuadrante, para avisar cuando gestión publique el del mes
        window.AndroidBridge?.saveToPrefs?.('cuadranteUrl', this.CUADRANTE_URL);
        // Y con qué nombre firma el visto que se dé desde el propio aviso
        window.AndroidBridge?.saveToPrefs?.('chatNombre', this.usuarioActual.name || '');
    },

    // Hasta dónde he leído, para que el aviso nativo no repita lo ya visto
    _ponerAlDiaElAviso() {
        const visto = (this._notas || [])
            .filter(n => !this._sinLeer(n))
            .map(n => this._ultimoMensaje(n)?.en || '')
            .sort().pop();
        if (visto) window.AndroidBridge?.chatLeidoHasta?.(visto);
    },

    _pararSondeoChat() {
        clearInterval(this._timerChat);
        this._timerChat = null;
    },

    async _sondearChat() {
        if (!this.usuarioActual?.email || document.hidden) return;
        try {
            const r = await fetch(`${this.NOTAS_URL}?resumen=1&email=${encodeURIComponent(this.usuarioActual.email)}`, { cache: 'no-store' });
            if (!r.ok) return;
            const huella = JSON.stringify(await r.json());
            if (huella === this._huellaChat) return;    // nada nuevo, ni se baja
            this._huellaChat = huella;
            await this._cargarNotas();
        } catch (_) { /* sin red se reintenta al siguiente */ }
    },
    // ── Avisos del chat en la barra de Android ───────────────────────────────
    // Un aviso por conversación, que se actualiza si llegan más mensajes y se
    // retira al leerla. Desde él se puede contestar sin abrir la app, o
    // tocarlo para entrar directamente en esa conversación.

    _notificadas: {},          // id de conversación -> hora del último avisado
    _pendienteChat: null,      // lo que se pulsó antes de estar la sesión lista

    // Un id numérico estable por conversación, lejos del 1001 del aviso de
    // trabajo para que no se pisen.
    _idAviso(conv) {
        let h = 0;
        for (let i = 0; i < conv.length; i++) h = (h * 31 + conv.charCodeAt(i)) | 0;
        return 2000 + Math.abs(h % 90000);
    },

    async _setupNotifChat() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            await LN.registerActionTypes({
                types: [{
                    id: 'CHAT_MENSAJE',
                    actions: [
                        // input: true es la respuesta directa de Android, la que
                        // se escribe sin salir de la barra de notificaciones
                        { id: 'chat-responder', title: 'Responder', input: true,
                          inputPlaceholder: 'Escribe tu respuesta…', foreground: false },
                        { id: 'chat-leido', title: 'Marcar leído', foreground: false },
                    ],
                }],
            });
            LN.addListener('localNotificationActionPerformed', (ev) => {
                const conv = ev?.notification?.extra?.conv;
                if (!conv) return;                       // no es del chat
                if (ev.actionId === 'chat-responder' && (ev.inputValue || '').trim()) {
                    this._responderDesdeAviso(conv, ev.inputValue.trim());
                } else if (ev.actionId === 'chat-leido') {
                    this._marcarLeida(conv);
                    this._retirarAviso(conv);
                } else {
                    this._abrirDesdeAviso(conv);
                }
            });
        } catch (e) { console.error('acciones del chat:', e); }
    },

    // Puede llegar con la app recién abierta y sin sesión: se guarda y se
    // atiende en cuanto haya usuario.
    _abrirDesdeAviso(conv) {
        if (!this.usuarioActual) { this._pendienteChat = { abrir: conv }; return; }
        this.mostrarApp();
        this.switchTab(2);
        this._cargarNotas().then(() => this.abrirHilo(conv));
    },

    async _responderDesdeAviso(conv, texto) {
        if (!this.usuarioActual) { this._pendienteChat = { conv, texto }; return; }
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual.email || '' },
                body: JSON.stringify({ id: conv, texto,
                    ...(false ? { gestor: this._nombreGestor() }
                                   : { nombre: this.usuarioActual.name || '' }) }),
            });
            if (!r.ok) return;
            const data = await r.json();
            this._notas = (this._notas || []).map(x => x.id === data.id ? data : x);
            this._marcarLeida(conv);
            this._retirarAviso(conv);
            this._renderNotas();
        } catch (_) { /* sin red, se queda sin mandar */ }
    },

    _atenderChatPendiente() {
        const p = this._pendienteChat;
        if (!p || !this.usuarioActual) return;
        this._pendienteChat = null;
        if (p.abrir) this._abrirDesdeAviso(p.abrir);
        else this._responderDesdeAviso(p.conv, p.texto);
    },

    async _retirarAviso(conv) {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        if (this._notificadas[conv]) {
            delete this._notificadas[conv];
            this._guardarNotificadas();
        }
        try { await LN.cancel({ notifications: [{ id: this._idAviso(conv) }] }); } catch (_) {}
    },

    // Lo ya avisado se guarda: al arrancar, la lista en memoria estaba vacía
    // y la app volvía a lanzar el aviso —con su sonido— de mensajes de los
    // que la barra ya había avisado con la app cerrada. Ese era el segundo
    // sonido al abrir.
    _cargarNotificadas() {
        if (this._notificadasListas) return;
        this._notificadasListas = true;
        try { this._notificadas = JSON.parse(localStorage.getItem('notificadas') || '{}') || {}; }
        catch (_) { this._notificadas = {}; }
    },

    _guardarNotificadas() {
        try { localStorage.setItem('notificadas', JSON.stringify(this._notificadas)); } catch (_) {}
    },

    // El aviso de la barra lo pone la parte nativa, que es la que sigue
    // mirando con la app cerrada y la que puede resolver "Responder" y
    // "Marcar leído" sin abrir nada. Ponerlo también desde aquí sobraba: el
    // mismo mensaje sonaba dos veces, y contestar desde ese aviso abría la
    // app —que es justo lo que no se quiere—. Aquí solo se retiran los de las
    // conversaciones que ya se han leído.
    async _avisarEnLaBarra() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        this._cargarNotificadas();
        const vivas = new Set((this._notas || [])
            .filter(n => !n.archivada && this._sinLeer(n)).map(n => n.id));
        // Se repasan todas, no solo las que avisó esta app: con la app cerrada
        // el aviso lo puso la parte nativa y aquí no consta.
        const candidatas = new Set([
            ...(this._notas || []).map(n => n.id),
            ...Object.keys(this._notificadas),
        ]);
        candidatas.forEach(id => { if (!vivas.has(id)) this._retirarAviso(id); });
    },
    // ── Sin leer ─────────────────────────────────────────────────────────────
    // De cada conversación se guarda la hora del último mensaje que se ha
    // visto. Si llega uno más nuevo y no es mío, está sin leer. Va por móvil,
    // que es donde tiene sentido: lo leído en uno no lo ha leído el otro.

    notifSoundChat: localStorage.getItem('notifSoundChat') || 'default',

    _leidas() {
        try { return JSON.parse(localStorage.getItem('convLeidas') || '{}'); } catch (_) { return {}; }
    },

    _sinLeer(n) {
        const ultimo = this._ultimoMensaje(n);
        if (!ultimo || this._esMiMensaje(ultimo, n)) return false;
        return (ultimo.en || '') > (this._leidas()[n.id] || '');
    },

    _marcarLeida(id) {
        const n = (this._notas || []).find(x => x.id === id);
        const ultimo = this._ultimoMensaje(n);
        if (!ultimo) return;
        // Leído es leído: además de apuntarlo aquí, se le dice al otro. Antes
        // "marcar leído" desde el aviso solo se lo guardaba el móvil y quien
        // había escrito no se enteraba de nada.
        //
        // Lo que no se da por visto es lo que he escrito yo: esto se llama
        // también al recargar con la conversación abierta, y lo estaba
        // marcando "visto por" quien acababa de escribir. Encima con eso la
        // conversación dejaba de contar como pendiente y no saltaba ni la
        // campana ni el aviso del móvil.
        if (!this._esMiMensaje(ultimo, n) && !this._estaVista(n)) {
            this._marcarVisto(id, true, true);
        }
        const l = this._leidas();
        l[id] = ultimo.en || new Date().toISOString();
        localStorage.setItem('convLeidas', JSON.stringify(l));
        this._retirarAviso(id);
        this._ponerAlDiaElAviso();
    },

    _totalSinLeer() {
        return (this._notas || []).filter(n => !n.archivada && this._sinLeer(n)).length;
    },

    _hayCambioSinLeer() {
        try { return !!JSON.parse(localStorage.getItem('cambioJornadaPend') || 'null')?.texto; }
        catch (_) { return false; }
    },

    _pintarCampana() {
        const el = document.getElementById('campanaN');
        if (!el) return;
        // El cambio de jornada sin dar por leído es un aviso más: la campana
        // decía cero teniendo eso ahí esperando.
        const n = this._totalSinLeer() + (this._hayCambioSinLeer() ? 1 : 0);
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hay', n > 0);
    },

    irANotas() {
        this.switchTab(2);
    },

    guardarSonidoChat(sonido) {
        this.notifSoundChat = sonido;
        localStorage.setItem('notifSoundChat', sonido);
        this._guardarPreferencias();
        if (sonido !== 'ninguno') this._previewNotifSound(sonido);
    },

    // Suena una vez cuando aparece algo nuevo, no en cada repintado
    _avisarSiHayNuevos() {
        const n = this._totalSinLeer();
        const antes = this._sinLeerPrevio ?? n;
        this._sinLeerPrevio = n;
        // Lo que ya estaba sin leer al abrir no es nuevo: de eso avisó la
        // barra mientras la app estaba cerrada, y volver a sonar aquí era
        // sonar dos veces por lo mismo. Y si la app no está delante, quien
        // avisa es la barra, no esto.
        if (n > antes && this.notifSoundChat !== 'ninguno' && !document.hidden) {
            try { this._previewNotifSound(this.notifSoundChat); } catch (_) {}
        }
        this._pintarCampana();
        this._avisarEnLaBarra();
    },
    // ── Conversaciones ───────────────────────────────────────────────────────
    // Una nota es un hilo: se abre, se lee entero y se contesta dentro, como
    // en cualquier chat. Se puede archivar para quitarla de en medio sin
    // perderla, o borrarla del todo.

    _hiloAbierto: null,

    _mensajesDe(n) { return Array.isArray(n?.mensajes) ? n.mensajes : []; },

    _ultimoMensaje(n) {
        const m = this._mensajesDe(n);
        return m.length ? m[m.length - 1] : null;
    },

    // Alinear a la derecha lo que he escrito yo
    _esMiMensaje(m, n) {
        if (false) return m.de === 'gestor';
        const mio = (this.usuarioActual?.email || '').toLowerCase();
        if ((m.de || '').toLowerCase() === mio) return true;
        return m.de === 'trabajador' && n.tipo !== 'companero'
            && (n.email || '').toLowerCase() === mio;
    },

    _tituloHilo(n) {
        if (n.tipo === 'companero') {
            const mio = (this.usuarioActual?.email || '').toLowerCase();
            const yoEmpecé = (n.deEmail || '').toLowerCase() === mio;
            return yoEmpecé ? (n.nombre || n.email) : (n.deNombre || n.deEmail);
        }
        if (false) return `${n.conductor ? n.conductor + ' · ' : ''}${n.nombre || n.email}`;
        return 'Gestión';
    },

    abrirHilo(id) {
        const n = (this._notas || []).find(x => x.id === id);
        if (!n) return;
        this._hiloAbierto = id;
        this._marcarLeida(id);
        document.getElementById('hiloTexto').value = '';
        document.getElementById('hiloQuien').textContent = this._tituloHilo(n);
        this._renderHilo();
        this._renderNotas();
        document.getElementById('hiloModal').classList.add('show');
        if (this.darkMode) document.getElementById('hiloModalContent').classList.add('dark');
        // Igual que en WhatsApp: al abrir la conversación, si lo último no es
        // mío y aún no está visto, se marca solo, sin tocar nada.
        const ultimo = this._ultimoMensaje(n);
        if (ultimo && !this._esMiMensaje(ultimo, n) && !this._estaVista(n)) {
            this._marcarVisto(id, true, true);
        }
    },

    _renderHilo() {
        const n = (this._notas || []).find(x => x.id === this._hiloAbierto);
        if (!n) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const cont = document.getElementById('hiloMensajes');
        cont.innerHTML = this._mensajesDe(n).map(m => {
            const mio = this._esMiMensaje(m, n);
            const adj = (m.adjuntos || []).map(a => a.tipo?.startsWith('image/')
                ? `<img src="${esc(a.datos)}" onclick="app._verFoto('${esc(a.datos)}')">`
                : `<a href="${esc(a.datos)}" download="${esc(a.nombre)}">📎 ${esc(a.nombre)}</a>`).join('');
            // Sin saltos ni sangría dentro del globo: el texto va con
            // pre-wrap, así que la propia plantilla se vería como líneas en
            // blanco.
            // El visto del gestor va centrado y sin globo: es un apunte del
            // sistema, no algo que haya escrito nadie.
            if (m.sistema) {
                return `<div class="bub sistema">${esc(m.texto)}`
                    + (m.autor ? ` · ${esc(m.autor)}` : '')
                    + ` · ${esc(this._horaCorta(m.en))}</div>`;
            }
            return `<div class="bub ${mio ? 'mio' : 'suyo'}">`
                + (mio ? '' : `<div class="bub-autor">${esc(m.autor) || (m.de === 'gestor' ? 'Gestión' : '')}</div>`)
                + `<span class="bub-txt">${esc(m.texto)}</span>${adj}`
                + `<div class="bub-hora">${esc(this._horaCorta(m.en))}</div></div>`;
        }).join('') || '<div class="nt-vacio">Sin mensajes</div>';
        // Quién le dio el visto y cuándo, para los dos lados por igual
        const v = n.vistoPor;
        if (v) {
            cont.innerHTML += `<div class="bub sistema">👁 Visto por ${esc(v.nombre) || esc(v.email)}`
                + ` · ${esc(this._horaCorta(v.en))}</div>`;
        }
        cont.scrollTop = cont.scrollHeight;
        this._renderPieHilo(n);
    },

    _horaCorta(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    // El visto ya no es de gestión: lo da cualquiera de los dos y el otro lo
    // ve en su app. Por eso el botón está igual en las dos, y no hay forma de
    // denegar nada: una nota se lee, se contesta o se archiva.
    _estaVista(n) { return n?.estado === 'visto' || !!n?.vistoPor; },

    _renderPieHilo(n) {
        const pie = document.getElementById('hiloPie');
        if (!pie) return;
        pie.innerHTML = `<button class="modal-btn modal-btn-confirm" onclick="app._responderHilo()">Enviar</button>`;
    },

    // El visto ya no lo da nadie a mano: se pone solo, como en WhatsApp, en
    // cuanto se abre una conversación con algo nuevo del otro lado.
    _marcarVisto(id, visto, silencioso) {
        return this._tocarConversacion(id, { visto, nombre: this.usuarioActual?.name || '' },
            silencioso ? null : (visto ? '👁 Dada por vista' : 'Ya no está vista'));
    },

    async _responderHilo() {
        const campo = document.getElementById('hiloTexto');
        const texto = (campo.value || '').trim();
        if (!texto) { this._mostrarToast('Escribe algo o adjunta un archivo', 2500); return; }
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id: this._hiloAbierto, texto,
                    ...(false ? { gestor: this._nombreGestor() }
                        : { nombre: this.usuarioActual?.name || '' }) })
            });
            const data = await r.json();
            if (!r.ok) {
                // Si no se ha guardado, que se note y que el texto no se pierda
                this._mostrarToast('❌ No se ha enviado: ' + (data.error || r.status)
                    + '. Tu mensaje sigue escrito, vuelve a darle a Enviar.', 6000);
                return;
            }
            campo.value = '';
                    this._notas = this._notas.map(x => x.id === data.id ? data : x);
            this._marcarLeida(data.id);
            this._renderHilo();
            this._renderNotas();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    async _tocarConversacion(id, cuerpo, mensaje, borrar) {
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: borrar ? 'DELETE' : 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id, ...cuerpo })
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            this._notas = borrar ? this._notas.filter(x => x.id !== id)
                                 : this._notas.map(x => x.id === id ? data : x);
            if (borrar && this._hiloAbierto === id) {
                document.getElementById('hiloModal').classList.remove('show');
            } else if (this._hiloAbierto === id) {
                this._renderHilo();
            }
            this._renderNotas();
            if (mensaje) this._mostrarToast(mensaje, 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    _archivarHilo(id, archivada) {
        return this._tocarConversacion(id, { archivada },
            archivada ? '📥 Archivada' : 'Devuelta a la bandeja');
    },

    _borrarHilo(id) {
        if (!confirm('¿Borrar esta conversación entera? No se puede deshacer.')) return;
        return this._tocarConversacion(id, {}, '🗑️ Conversación borrada', true);
    },

    async enviarNota() {
        const campo = document.getElementById('ntTexto');
        const texto = (campo?.value || '').trim();
        if (!texto) { this._mostrarToast('Escribe algo', 2500); return; }
        const todos = (this._notaPara || []).slice();
        if (!todos.length) return;
        document.getElementById('notaModal').classList.remove('show');
        const aGestion = todos.includes(this.A_GESTION);
        const para = todos.filter(e => e !== this.A_GESTION);
        const enviar = async cuerpo => {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ texto, ...cuerpo }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || r.status);
            return Array.isArray(data) ? data : [data];
        };
        try {
            const nuevas = [];
            if (para.length) {
                // nombre/conductor describen a quien recibe, que es de quien
                // cuelga la nota; quien la manda va aparte en deNombre.
                nuevas.push(...await enviar({ para, tipo: 'companero',
                    nombres:     para.map(e => this._fichaDe(e)?.nombre || ''),
                    conductores: para.map(e => this._fichaDe(e)?.conductor || ''),
                    deNombre: this.usuarioActual?.name || '',
                    deConductor: this.numConductor || '' }));
            }
            if (aGestion) {
                nuevas.push(...await enviar({ nombre: this.usuarioActual?.name || '',
                    conductor: this.numConductor || '' }));
            }
            if (campo) campo.value = '';
            this._notas = [...nuevas, ...this._notas];
            this._renderNotas();
            this._mostrarToast(nuevas.length === 1
                ? '📨 Nota enviada' : `📨 Nota enviada a ${nuevas.length}`, 3000);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
    },

    // ── Mi nómina ────────────────────────────────────────────────────────────
    // La rellena el gestor y aquí solo se mira: lo que ha cobrado cada mes,
    // con lo que ha trabajado al lado y la diferencia con el mes anterior.
    // El servidor solo devuelve la de uno mismo; pedir la de otro no lleva a
    // ninguna parte porque el correo sale del token, no de la petición.

    NOMINAS_URL: 'https://emt-palma-movilidad.vercel.app/api/nominas',
    _misNominas: null,
    _miNomMes: null,

    _mesDeHoy() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    _mesMas(mes, n) {
        const d = new Date(+mes.slice(0, 4), +mes.slice(4, 6) - 1 + n, 1, 12);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    _nombreMes(mes) {
        const m = String(mes || '');
        return `${MESES_ES[+m.slice(4, 6) - 1]} ${m.slice(0, 4)}`;
    },

    _eur(n) {
        return (Math.round((Number(n) || 0) * 100) / 100)
            .toFixed(2).replace('.', ',') + ' €';
    },

    miNomMes(paso) {
        this._miNomMes = this._mesMas(this._miNomMes || this._mesDeHoy(), paso);
        this._renderMiNomina();
    },

    async _cargarMisNominas() {
        this._miNomMes = this._miNomMes || this._mesDeHoy();
        if (!this.usuarioActual?.email) return;
        this._renderMiNomina();                 // lo que haya, ya
        try {
            const url = `${this.NOMINAS_URL}?mio=${encodeURIComponent(this.usuarioActual.email)}`;
            let r = await fetch(url, { cache: 'no-store' });
            // Con la sesión caducada el servidor no sabe de quién es la
            // nómina. Se renueva y se vuelve a pedir, que es mejor que
            // enseñarla vacía y hacerle rellenarla otra vez.
            if (r.status === 401 && this.refreshToken) {
                await this._silentReauth();
                r = await fetch(url, { cache: 'no-store' });
            }
            if (!r.ok) throw new Error(r.status);
            this._misNominas = await r.json() || {};
            localStorage.setItem('misNominas', JSON.stringify(this._misNominas));
        } catch (_) {
            // Sin red vale lo último que se vio: una nómina no cambia sola
            if (!this._misNominas) {
                try { this._misNominas = JSON.parse(localStorage.getItem('misNominas') || 'null'); }
                catch (__) { this._misNominas = null; }
            }
        }
        this._nomEditando = null;
        this._renderMiNomina();
    },

    // ── Rellenarla ───────────────────────────────────────────────────────────
    // Los días y las horas salen de lo que ha registrado; lo demás lo pone él:
    // los precios de su convenio, los porcentajes, los bienios y el sindicato.
    // Un mes nuevo parte del anterior, que casi nunca cambia.

    editarMiNomina() {
        const mes = this._miNomMes;
        const anterior = this._mesMas(mes, -1);
        const g = this._misNominas?.[mes] || this._misNominas?.[anterior] || {};
        const C = this.CONVENIO;
        this._nomEditando = {
            precios: {
                porDia: { ...C.porDia, ...(g.precios?.porDia || {}) },
                delMes: { ...C.delMes, ...(g.precios?.delMes || {}) },
            },
            // La fecha de alta y, si no hay fecha, el % manual salen del
            // perfil (Opciones › Perfil) — se ponen una vez y valen para
            // todas las nóminas.
            desde:     g.desde || this.fechaAltaDefault || '',
            pctBienios: Number(g.pctBienios ?? this.pctBieniosDefault ?? 0),
            // El sindicato se paga siempre, 12 € por defecto; si se deja de
            // pagar se pone a 0 a mano y ese 0 es lo que sigue arrastrándose.
            sindicato: Number(g.sindicato ?? 12),
            prorrata:  Number(g.prorrata ?? 0),
            // Julio y diciembre llevan la paga extra activada por defecto;
            // solo se guarda cuando se desactiva a mano ese mes.
            pagaExtra: g.pagaExtra !== false,
            tipos:     { ...this.TIPOS_NOMINA, ...(g.tipos || {}) },
            // Sin nada guardado se quedan a undefined y los pone el cálculo a
            // partir de los registros; en cuanto se escriben, mandan.
            dias:      { asistencia: g.dias?.asistencia },
            extra:     { h: g.extra?.h, p: Number(g.extra?.p ?? this.precioExtraDefault ?? 0) },
            noct:      { h: g.noct?.h,  p: Number(g.noct?.p ?? this.precioNocheDefault ?? 0) },
            extras:    (g.extras || []).map(e => ({ ...e })),
            nota:      g.nota || '',
        };
        this._renderMiNomina();
    },

    _toggleMiPagaExtra(on) {
        this._nomEditando.pagaExtra = !!on;
        this._renderMiNomina();
    },

    cancelarMiNomina() { this._nomEditando = null; this._renderMiNomina(); },

    _setMiNom(campo, valor) {
        const n = Number(String(valor).replace(',', '.')) || 0;
        const partes = campo.split('.');
        let o = this._nomEditando;
        if (partes.length > 1 && !o[partes[0]]) o[partes[0]] = {};
        while (partes.length > 1) o = o[partes.shift()];
        o[partes[0]] = n;
        this._renderMiNomina();
    },

    _setMiExtra(k, campo, valor) {
        if (!this._nomEditando.extras[k]) return;
        this._nomEditando.extras[k][campo] = campo === 'i'
            ? (Number(String(valor).replace(',', '.')) || 0) : valor;
        this._renderMiNomina();
    },

    _nuevoMiExtra() { this._nomEditando.extras.push({ c: '', i: 0 }); this._renderMiNomina(); },
    _quitarMiExtra(k) { this._nomEditando.extras.splice(k, 1); this._renderMiNomina(); },

    async _guardarMiNomina() {
        const cuerpo = { mes: this._miNomMes, email: this.usuarioActual?.email,
            ...this._nomEditando,
            extras: (this._nomEditando.extras || []).filter(e => String(e.c || '').trim()),
            nota: document.getElementById('miNomNota')?.value || '' };
        try {
            const r = await fetch(this.NOMINAS_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo),
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            this._misNominas = this._misNominas || {};
            // La respuesta trae el mes entero, con todos los que lo tengan
            // rellenado ese mes: hay que coger solo la mía, si no se quedaba
            // con el mapa entero en vez de la nómina, y el sindicato a 0 (o
            // cualquier otro cambio) se deshacía nada más guardar.
            this._misNominas[this._miNomMes] = data?.[this._miNomMes]?.[this.usuarioActual?.email] || cuerpo;
            localStorage.setItem('misNominas', JSON.stringify(this._misNominas));
            this._nomEditando = null;
            this._renderMiNomina();
            this._mostrarToast('💶 Nómina guardada', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // Borrarla no borra las jornadas: solo lo que se escribió a mano. Si hace
    // falta otra vez, "Rellenarla" vuelve a partir de los registros.
    async eliminarMiNomina() {
        const mes = this._miNomMes;
        if (!confirm(`¿Eliminar la nómina de ${this._nombreMes(mes)}?\n\nLas jornadas no se tocan; si la quieres otra vez, pulsa "Rellenarla".`)) return;
        try {
            const r = await fetch(this.NOMINAS_URL, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mes, email: this.usuarioActual?.email }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            if (this._misNominas) delete this._misNominas[mes];
            localStorage.setItem('misNominas', JSON.stringify(this._misNominas || {}));
            this._nomEditando = null;
            this._renderMiNomina();
            this._mostrarToast('🗑️ Nómina eliminada', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // El mismo convenio y el mismo cálculo que en gestión: si cada app hiciera
    // sus cuentas, tarde o temprano dirían cosas distintas.
    // El convenio de partida, sacado de una nómina de media jornada. Todo es
    // editable: la completa cobra otra cosa, y el convenio se actualiza.
    CONVENIO: {
        // El de vacaciones va sin la antigüedad: esta se le suma aparte, que
        // también sube el día de vacaciones y la hora extra. En la nómina de
        // junio, 26,83 son estos 25,5551 con el 5 % encima.
        porDia: { base: 772.58 / 30, vacaciones: 375.66 / 14 / 1.05, asistencia: 4.19 },
        delMes: { noAbsorbible: 136.21, transporte: 68.02, ajuste: 130.01,
                  ajuste2: 6.44, responsabilidad: 51.77 },
    },
    // La nómina va a meses de 30 días, no a los del calendario
    DIAS_NOMINA: 30,
    // El complemento de responsabilidad/calidad es nuevo: se empieza a cobrar
    // en la nómina de julio de 2026, y antes de esa no aparece.
    DESDE_RESPONSABILIDAD: '202607',
    TIPOS_NOMINA: { cc: 4.70, desempleo: 1.55, fp: 0.10, mei: 0.15, irpf: 15.00 },

    // Horas extras que registró ese mes
    _horasExtraDelMes(mes) {
        let h = 0;
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id).slice(0, 6) === mes && r.extraManual) h += parseFloat(r.horas) || 0;
        });
        return Math.round(h * 100) / 100;
    },

    // Los días de cada cosa salen de lo que ha registrado: las vacaciones, el
    // permiso retribuido y los días de asistencia. El salario base son los que
    // quedan del mes.
    _diasDeNomina(mes) {
        const vac = new Set(), pr = new Set(), baja = new Set(), trabajados = new Set();
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            const f = this._fechaDeId(id);
            if (f.slice(0, 6) !== mes) return;
            if (r.vacaciones) vac.add(f);
            else if (r.pr)    pr.add(f);
            else if (r.be)    baja.add(f);
            // "No fui a trabajar": cuenta como jornada, pero sin el plus de
            // asistencia, que es justo lo que premia estar presente.
            else if (r.sinAsistencia) { /* no lleva plus, pero tampoco resta del base */ }
            else if ((parseFloat(r.horas) || 0) > 0) trabajados.add(f);
        });
        const vacaciones = Math.min(this.DIAS_NOMINA, vac.size);
        const permiso    = Math.min(this.DIAS_NOMINA - vacaciones, pr.size);
        // El plus de asistencia se cobra por día efectivo: los que ha trabajado
        // y los de permiso retribuido. Los de baja son día efectivo para el
        // salario —por eso no se descuentan del base— pero no llevan plus.
        const asistencia = trabajados.size + permiso;
        return { vacaciones, permiso, asistencia, baja: baja.size,
                 base: Math.max(0, this.DIAS_NOMINA - vacaciones - permiso) };
    },

    // Horas nocturnas registradas ese mes
    _horasNocturnasDelMes(mes) {
        let h = 0;
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id).slice(0, 6) === mes) h += parseFloat(r.horasNocturnas) || 0;
        });
        return Math.round(h * 100) / 100;
    },

    // La antigüedad manda sobre los bienios: con la fecha de entrada puesta,
    // el porcentaje cambia solo el mes que toca y no hay que acordarse.
    // Es un 5 % del salario base del mes entero por tramo: en la nómina de
    // julio, 38,63 son justo el 5 % de 772,58.
    TRAMOS_ANTIGUEDAD: [
        { anios: 24, pct: 60 }, { anios: 20, pct: 50 }, { anios: 16, pct: 40 },
        { anios: 12, pct: 30 }, { anios:  8, pct: 20 }, { anios:  4, pct: 10 },
        { anios:  0, pct:  5 },
    ],

    // Años cumplidos el último día del mes que se está pagando
    _aniosEnLaEmpresa(desde, mes) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || ''))) return null;
        const d = new Date(desde + 'T12:00:00');
        if (isNaN(d)) return null;
        const fin = new Date(+mes.slice(0, 4), +mes.slice(4, 6), 0, 12);
        let a = fin.getFullYear() - d.getFullYear();
        const cumpleYa = (fin.getMonth() > d.getMonth())
            || (fin.getMonth() === d.getMonth() && fin.getDate() >= d.getDate());
        if (!cumpleYa) a--;
        return Math.max(0, a);
    },

    _pctAntiguedad(desde, mes) {
        const a = this._aniosEnLaEmpresa(desde, mes);
        if (a === null) return null;
        return this.TRAMOS_ANTIGUEDAD.find(t => a >= t.anios).pct;
    },

    // Julio y diciembre llevan paga extra por defecto, dentro de la misma
    // nómina; en Cambiar datos se puede desactivar para ese mes.
    _esMesExtra(mes) {
        const m = String(mes || '').slice(4, 6);
        return m === '07' || m === '12';
    },

    _calcNomina(mes, n) {
        const D = this.DIAS_NOMINA;
        const g = n || {};
        const conPagaExtra = this._esMesExtra(mes) && g.pagaExtra !== false;
        // Los precios guardados mandan sobre los de partida
        const C = {
            porDia: { ...this.CONVENIO.porDia, ...(g.precios?.porDia || {}) },
            delMes: { ...this.CONVENIO.delMes, ...(g.precios?.delMes || {}) },
        };
        const dias = this._diasDeNomina(mes);
        const diasAsist = Number(g.dias?.asistencia ?? dias.asistencia) || 0;
        const hExtra    = Number(g.extra?.h ?? this._horasExtraDelMes(mes)) || 0;
        // El precio de la hora extra y de la nocturna salen de Ajustes › Trabajo,
        // así no hay que volver a escribirlos en cada nómina.
        const pExtra    = Number(g.extra?.p ?? this.precioExtraDefault ?? 0) || 0;
        const hNoct     = Number(g.noct?.h ?? this._horasNocturnasDelMes(mes)) || 0;
        const pNoct     = Number(g.noct?.p ?? this.precioNocheDefault ?? 0) || 0;
        // Con la fecha de entrada puesta manda la antigüedad; si no, lo que
        // se haya escrito a mano. Ambas salen del perfil si la nómina no
        // guarda las suyas propias.
        const desde     = g.desde || this.fechaAltaDefault || '';
        const pctAnt    = this._pctAntiguedad(desde, mes);
        const tipos     = { ...this.TIPOS_NOMINA, ...(g.tipos || {}) };
        const r2 = v => Math.round(v * 100) / 100;

        const porDia = (c, d, p) => ({ c, d, p: r2(p), i: r2(d * p) });
        const delMes = (c, i) => ({ c, d: D, p: r2(i / D), i: r2(i) });

        // El orden es el de la nómina en papel
        const pctBienios = pctAnt !== null ? pctAnt
            : Math.max(0, Math.min(60, Number(g.pctBienios ?? this.pctBieniosDefault ?? 0) || 0));

        const devengos = [porDia('Salario Base', dias.base, C.porDia.base)];
        // La antigüedad sube el día de vacaciones y la hora extra, no solo el
        // salario base.
        const conAnt = v => v * (1 + pctBienios / 100);
        if (dias.vacaciones) devengos.push(porDia('Vacaciones', dias.vacaciones, conAnt(C.porDia.vacaciones)));
        if (dias.permiso)    devengos.push(porDia('Permiso retribuido', dias.permiso, C.porDia.base));
        // Los bienios son un porcentaje del salario base del mes entero, no de
        // los días que haya trabajado: en junio, con catorce de vacaciones,
        // siguen siendo los mismos 38,63 que en julio.
        if (pctBienios) devengos.push({
            ...delMes('Bienios', D * C.porDia.base * pctBienios / 100),
            pctBienios, anios: this._aniosEnLaEmpresa(desde, mes) });
        devengos.push(delMes('Comp. No Absorbible', C.delMes.noAbsorbible));
        devengos.push(delMes('Plus Transporte', C.delMes.transporte));
        devengos.push(delMes('Complemento Ajuste convenio', C.delMes.ajuste));
        devengos.push(delMes('Complemento convenio', C.delMes.ajuste2));
        // Fijo, pero solo desde que existe
        if (mes >= this.DESDE_RESPONSABILIDAD) {
            devengos.push(delMes('Compl. Responsabilidad/Calidad', C.delMes.responsabilidad));
        }
        if (diasAsist) devengos.push(porDia('Complemento Asistencia', diasAsist, C.porDia.asistencia));
        // Estas dos van siempre, aunque sean 0: si aparecen y desaparecen
        // según el mes, la nómina entera sube o baja una línea al pasar de
        // una a otra.
        devengos.push({ c: 'Complemento horas nocturnas', d: hNoct, p: r2(pNoct),
                         i: r2(hNoct * pNoct), horas: true });
        devengos.push({ c: 'Horas extras', d: hExtra, p: r2(conAnt(pExtra)),
                         i: r2(hExtra * conAnt(pExtra)), horas: true });
        // La paga extra es un salario base más, con su antigüedad, sin los
        // demás complementos: se suma encima de lo de siempre ese mes.
        if (conPagaExtra) {
            devengos.push(delMes('Paga extra - Salario base', D * C.porDia.base));
            if (pctBienios) devengos.push(delMes('Paga extra - Antigüedad', D * C.porDia.base * pctBienios / 100));
        }
        (g.extras || []).forEach(e => {
            if (e && String(e.c || '').trim()) devengos.push({ c: e.c, d: 0, p: 0, i: r2(Number(e.i) || 0) });
        });

        const devengado = r2(devengos.reduce((t, l) => t + l.i, 0));
        const prorrata  = r2(Number(g.prorrata ?? 0));
        const base      = r2(devengado + prorrata);
        const sindicato = r2(Number(g.sindicato ?? 12));
        const pct = (c, sobre, p) => ({ c, base: sobre, pct: p, i: r2(sobre * p / 100) });
        const deducciones = [
            pct('Aportac. Contingencias Comunes', base, tipos.cc),
            pct('Desempleo', base, tipos.desempleo),
            pct('Formación Profesional', base, tipos.fp),
            pct('Aportac. Mecanismo de equidad', base, tipos.mei),
            pct('IRPF Cta. Ajena Dinerarios', devengado, tipos.irpf),
        ];
        // Siempre va, aunque sea 0: si aparece y desaparece según el mes, la
        // nómina entera sube o baja una línea al pasar de uno a otro, igual
        // que pasaba antes con las horas nocturnas y las extras.
        deducciones.push({ c: 'Sindicato/s', base: 0, pct: 0, i: sindicato });
        const aDeducir = r2(deducciones.reduce((t, l) => t + l.i, 0));
        return { dias, devengos, deducciones, devengado, prorrata, base, aDeducir,
                 liquido: r2(devengado - aDeducir), precios: C, tipos, sindicato,
                 pctBienios, pctAnt, anios: this._aniosEnLaEmpresa(desde, mes), desde,
                 hExtra, pExtra, hNoct, pNoct, diasAsist,
                 esMesExtra: this._esMesExtra(mes), conPagaExtra };
    },

    _renderMiNomina() {
        const cont = document.getElementById('miNomina');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const mes = this._miNomMes = this._miNomMes || this._mesDeHoy();
        const titulo = document.getElementById('miNomMes');
        if (titulo) titulo.textContent = this._nombreMes(mes);

        const editando = this._nomEditando;
        const n = editando || this._misNominas?.[mes];
        if (!n) {
            cont.innerHTML = `<div class="nom-tarjeta"><div class="nom-vacio">
                Todavía no has rellenado la nómina de ${esc(this._nombreMes(mes))}.</div>
                <button class="btn-main" onclick="app.editarMiNomina()">Rellenarla</button></div>`;
            return;
        }
        const c = this._calcNomina(mes, n);
        // Los precios del convenio salen de dividir, así que traen una ristra
        // de decimales que no dice nada: se enseñan con cuatro como mucho.
        const num = v => {
            const x = Number(v);
            if (!isFinite(x)) return String(v);
            return String(Math.round(x * 10000) / 10000).replace('.', ',');
        };
        const linea = (l, resta) => `<div class="nom-l${resta ? ' resta' : ''}">
            <span class="nom-l-c">${esc(l.c)}${l.pctBienios ? ` <small>${l.pctBienios} %${
                l.anios !== null && l.anios !== undefined ? ` · ${l.anios} años` : ''}</small>` : ''
                }${l.d ? ` <small>${num(l.d)}${l.horas ? 'h' : ''} × ${num(l.p)}</small>`
                : l.pct ? ` <small>${num(l.pct)} %</small>` : ''}</span>
            <span class="nom-l-i">${resta ? '−' : ''}${this._eur(l.i)}</span></div>`;

        // Las casillas solo salen al rellenarla; mirando queda la nómina limpia
        const campo = (etiqueta, valor, ruta, sufijo) => !editando ? '' :
            `<div class="nom-edit"><span>${etiqueta}</span>
                <input type="text" inputmode="decimal" value="${num(valor)}"
                       onchange="app._setMiNom('${ruta}', this.value)">${
                sufijo ? `<em>${sufijo}</em>` : ''}</div>`;

        const P = c.precios;
        const pagaExtraToggle = !editando || !this._esMesExtra(mes) ? '' : `
            <div class="nom-sec">Paga extra</div>
            <div class="nom-row-check">
                <label><input type="checkbox" ${n.pagaExtra !== false ? 'checked' : ''}
                    onchange="app._toggleMiPagaExtra(this.checked)"> Incluir la paga extra de este mes</label>
            </div>`;
        const ajustes = !editando ? '' : `
            ${pagaExtraToggle}
            <div class="nom-sec">Tu convenio</div>
            ${campo('Salario base', P.porDia.base, 'precios.porDia.base', '€/día')}
            ${campo('Vacaciones <small>sin antigüedad</small>', P.porDia.vacaciones, 'precios.porDia.vacaciones', '€/día')}
            ${campo('Asistencia', P.porDia.asistencia, 'precios.porDia.asistencia', '€/día')}
            ${campo('Comp. No Absorbible', P.delMes.noAbsorbible, 'precios.delMes.noAbsorbible', '€/mes')}
            ${campo('Plus Transporte', P.delMes.transporte, 'precios.delMes.transporte', '€/mes')}
            ${campo('Ajuste convenio', P.delMes.ajuste, 'precios.delMes.ajuste', '€/mes')}
            ${campo('Complemento convenio', P.delMes.ajuste2, 'precios.delMes.ajuste2', '€/mes')}
            ${campo('Responsabilidad/Calidad', P.delMes.responsabilidad, 'precios.delMes.responsabilidad', '€/mes')}
            <div class="nom-sec">Antigüedad</div>
            ${c.desde
                ? `<div class="nom-nota">Entraste en la empresa el <b>${esc(c.desde)}</b>
                     (Opciones › Perfil).${c.pctAnt !== null
                     ? ` Con ${c.anios} año${c.anios === 1 ? '' : 's'} te toca un
                        <b>${c.pctAnt} %</b> de antigüedad, que sube también el día de
                        vacaciones y la hora extra. Cambia solo cuando cumplas años.` : ''}</div>`
                : `<div class="nom-nota">Sin fecha de alta puesta en Opciones › Perfil, la
                     antigüedad se aplica con el <b>${num(c.pctBienios)} %</b> manual que
                     hayas puesto allí.</div>`}
            <div class="nom-sec">Este mes</div>
            ${campo('Horas extras', c.hExtra, 'extra.h', 'horas')}
            <div class="nom-nota">Hora extra a <b>${num(c.pExtra)} €</b>, el precio que hay
                puesto en Ajustes › Trabajo.</div>
            ${campo('Horas nocturnas', c.hNoct, 'noct.h', 'horas')}
            <div class="nom-nota">Hora nocturna a <b>${num(c.pNoct)} €</b>, el precio que hay
                puesto en Ajustes › Trabajo.</div>
            ${campo('Días de asistencia', c.diasAsist, 'dias.asistencia', 'días')}
            ${(n.extras || []).map((e, k) => `<div class="nom-edit">
                <input type="text" style="flex:1" value="${esc(e.c)}" placeholder="Otro concepto"
                       onchange="app._setMiExtra(${k},'c',this.value)">
                <input type="text" inputmode="decimal" value="${num(e.i ?? 0)}"
                       onchange="app._setMiExtra(${k},'i',this.value)">
                <button class="nom-x" onclick="app._quitarMiExtra(${k})">✕</button></div>`).join('')}
            <button class="nom-mas" onclick="app._nuevoMiExtra()">➕ Añadir concepto</button>
            <div class="nom-sec">Porcentajes</div>
            ${campo('Contingencias comunes', c.tipos.cc, 'tipos.cc', '%')}
            ${campo('Desempleo', c.tipos.desempleo, 'tipos.desempleo', '%')}
            ${campo('Formación profesional', c.tipos.fp, 'tipos.fp', '%')}
            ${campo('Mecanismo de equidad', c.tipos.mei, 'tipos.mei', '%')}
            ${campo('IRPF', c.tipos.irpf, 'tipos.irpf', '%')}
            ${campo('Sindicato/s', c.sindicato, 'sindicato', '€')}
            <div class="edit-field" style="margin-top:10px;"><label>Nota</label>
                <input type="text" id="miNomNota" value="${esc(n.nota || '')}"
                       placeholder="Lo que quieras recordar"></div>
            ${this._misNominas?.[mes] ? `<button class="nom-mas" style="color:#e74c3c;border-color:#e74c3c;"
                onclick="app.eliminarMiNomina()">🗑️ Eliminar esta nómina</button>` : ''}
            <div class="nom-botones">
                <button class="nom-cancel" onclick="app.cancelarMiNomina()">Cancelar</button>
                <button class="btn-main" onclick="app._guardarMiNomina()">Guardar</button>
            </div>`;

        cont.innerHTML = `<div class="nom-tarjeta">
            <div class="nom-liquido nom-liquido-top">
                <span class="nom-liquido-l">Líquido</span>
                <span class="nom-liquido-v">${this._eur(c.liquido)}</span></div>
            <div class="nom-sec">Devengos</div>
            ${c.devengos.map(l => linea(l, false)).join('')}
            <div class="nom-sec">Deducciones</div>
            ${c.deducciones.map(l => linea(l, true)).join('')}
            <div class="nom-l" style="font-weight:800;"><span class="nom-l-c">A deducir</span>
                <span class="nom-l-i">−${this._eur(c.aDeducir)}</span></div>
            <div class="nom-sec">Base de cotización</div>
            <div class="nom-l"><span class="nom-l-c">${c.prorrata
                ? 'Devengado + prorrata de pagas extra' : 'Devengado'}</span>
                <span class="nom-l-i">${this._eur(c.base)}</span></div>
            <div class="nom-sec">Días del mes</div>
            <div class="nom-datos">
                <span class="nom-dato"><b>${c.dias.base}</b> de salario base</span>
                ${c.dias.vacaciones ? `<span class="nom-dato"><b>${c.dias.vacaciones}</b> de vacaciones</span>` : ''}
                ${c.dias.permiso ? `<span class="nom-dato"><b>${c.dias.permiso}</b> de permiso</span>` : ''}
                ${c.diasAsist ? `<span class="nom-dato"><b>${c.diasAsist}</b> de asistencia</span>` : ''}
                ${c.hExtra ? `<span class="nom-dato"><b>${num(c.hExtra)}</b> horas extras</span>` : ''}
            </div>
            ${!editando && n.nota ? `<div class="nom-sec">Nota</div>
                <div class="nom-l"><span class="nom-l-c" style="white-space:normal;">${esc(n.nota)}</span></div>` : ''}
            ${ajustes}
            ${!editando ? `<button class="nom-mas" style="margin-top:12px;"
                onclick="app.editarMiNomina()">✎ Cambiar los datos</button>` : ''}
            <div class="nom-extra-barra" style="margin-top:14px;">
                <button class="nom-extra-btn" onclick="app.mostrarCompararNominas()">⚖️ Comparar nóminas</button>
                <button class="nom-extra-btn" onclick="app.mostrarExportarNominas()">📊 Exportar</button>
            </div>
        </div>`;
    },

    // La diferencia entre dos nóminas, concepto a concepto. La usan tanto el
    // "frente al mes anterior" de siempre como el comparador manual.
    _diffNominas(claveA, A, claveB, B) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const aMapa = c => {
            const m = {};
            c.devengos.forEach(l => { m[l.c] = (m[l.c] || 0) + l.i; });
            c.deducciones.forEach(l => { m[l.c] = (m[l.c] || 0) - l.i; });
            return m;
        };
        const MA = aMapa(A), MB = aMapa(B);
        const fila = (c, d) => {
            const clase = d > 0 ? 'sube' : d < 0 ? 'baja' : 'igual';
            return `<div class="nom-cmp"><span class="nom-cmp-c">${esc(c)}</span>
                <span class="nom-cmp-v ${clase}">${d > 0 ? '+' : ''}${this._eur(d)}</span></div>`;
        };
        return fila(`Líquido (${esc(this._nombreMes(claveB))}: ${this._eur(B.liquido)})`,
                   Math.round((A.liquido - B.liquido) * 100) / 100)
            + [...new Set([...Object.keys(MA), ...Object.keys(MB)])]
                .map(c => fila(c, Math.round(((MA[c] ?? 0) - (MB[c] ?? 0)) * 100) / 100)).join('');
    },

    // ── Comparar dos nóminas cualquiera ─────────────────────────────────────
    mostrarCompararNominas() {
        this._renderSelectoresComparar();
        document.getElementById('compararNomModal').classList.add('show');
        if (this.darkMode) document.getElementById('compararNomModalContent').classList.add('dark');
    },

    _clavesNominasGuardadas() {
        return Object.keys(this._misNominas || {}).sort();
    },

    _renderSelectoresComparar() {
        const claves = this._clavesNominasGuardadas();
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const opciones = claves.map(k => `<option value="${k}">${esc(this._nombreMes(k))}</option>`).join('');
        const selA = document.getElementById('cmpNomA');
        const selB = document.getElementById('cmpNomB');
        if (!selA || !selB) return;
        selA.innerHTML = opciones;
        selB.innerHTML = opciones;
        if (claves.length)     selA.value = claves[claves.length - 1];
        if (claves.length > 1) selB.value = claves[claves.length - 2];
        this._renderCompararNominas();
    },

    _renderCompararNominas() {
        const cont = document.getElementById('compararNomResultado');
        if (!cont) return;
        const claveA = document.getElementById('cmpNomA')?.value;
        const claveB = document.getElementById('cmpNomB')?.value;
        if (!claveA || !claveB) { cont.innerHTML = ''; return; }
        if (claveA === claveB) { cont.innerHTML = '<div class="nom-vacio">Elige dos nóminas distintas.</div>'; return; }
        const A = this._calcNomina(claveA, this._misNominas[claveA]);
        const B = this._calcNomina(claveB, this._misNominas[claveB]);
        cont.innerHTML = this._diffNominas(claveA, A, claveB, B);
    },

    // ── Exportar las nóminas ─────────────────────────────────────────────────
    // Una fila por concepto, igual que se ve en la propia nómina, con un
    // bloque por cada nómina elegida.
    CABECERAS_EXPORT_NOM: ['Nómina / concepto', 'Días u horas', 'Precio', 'Importe'],

    _nomExportSel: null,   // null = todas

    _nomExportElegidas() {
        const claves = this._clavesNominasGuardadas();
        return this._nomExportSel ? claves.filter(c => this._nomExportSel.has(c)) : claves;
    },

    _renderSelectorExportNom() {
        const cont = document.getElementById('expNomLista');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const claves = this._clavesNominasGuardadas();
        const elegidas = this._nomExportElegidas();
        const todo = elegidas.length === claves.length;
        cont.innerHTML = `<label class="exp-col exp-todo">
                <input type="checkbox" ${todo ? 'checked' : ''} onchange="app._marcarTodoExportNom(this.checked)">
                <span>Todas</span></label>`
            + claves.map(clave => `<label class="exp-col">
                <input type="checkbox" value="${clave}" ${elegidas.includes(clave) ? 'checked' : ''}
                       onchange="app._toggleExportNom('${clave}',this.checked)">
                <span>${esc(this._nombreMes(clave))}</span></label>`).join('');
    },

    _toggleExportNom(clave, on) {
        if (!this._nomExportSel) this._nomExportSel = new Set(this._clavesNominasGuardadas());
        if (on) this._nomExportSel.add(clave); else this._nomExportSel.delete(clave);
        this._renderSelectorExportNom();
    },

    _marcarTodoExportNom(on) {
        this._nomExportSel = on ? null : new Set();
        this._renderSelectorExportNom();
    },

    // El mismo desglose que se ve en la nómina —devengos, deducciones, base de
    // cotización, días del mes, líquido—, uno detrás de otro por cada nómina
    // elegida. El "Devengado" no lleva fila propia: ya sale una vez, dentro de
    // la base de cotización, igual que en la pantalla.
    _filasExportNom() {
        const filas = [];
        this._nomExportElegidas().forEach(clave => {
            const n = this._misNominas[clave] || {};
            const c = this._calcNomina(clave, n);
            filas.push([`Nómina: ${this._nombreMes(clave)}`, '', '', '']);
            filas.push(['Devengos', '', '', '']);
            c.devengos.forEach(l => filas.push([l.c, l.d ? `${l.d}${l.horas ? 'h' : ''}` : '', l.p || '', l.i]));
            filas.push(['Deducciones', '', '', '']);
            c.deducciones.forEach(l => filas.push([l.c, l.pct ? `${l.pct} %` : '', '', -l.i]));
            filas.push(['A deducir', '', '', -c.aDeducir]);
            filas.push([c.prorrata
                ? 'Base de cotización · Devengado + prorrata de pagas extra'
                : 'Base de cotización · Devengado', '', '', c.base]);
            filas.push(['Días del mes', '', '', '']);
            filas.push(['· De salario base', c.dias.base, '', '']);
            if (c.dias.vacaciones) filas.push(['· De vacaciones', c.dias.vacaciones, '', '']);
            if (c.dias.permiso)    filas.push(['· De permiso', c.dias.permiso, '', '']);
            if (c.diasAsist)       filas.push(['· De asistencia', c.diasAsist, '', '']);
            if (c.hExtra)          filas.push(['· Horas extras', `${c.hExtra}h`, '', '']);
            if (n.nota)            filas.push(['Nota', n.nota, '', '']);
            filas.push(['Líquido', '', '', c.liquido]);
            filas.push(['', '', '', '']);
        });
        return filas;
    },

    // ── La nómina en PDF, con pinta de nómina ────────────────────────────────
    // Un CSV o un Excel valen para cuadrar números, pero lo que uno enseña o
    // archiva es un recibo: su cabecera, sus datos, los devengos y las
    // deducciones cada uno en su tabla y el líquido destacado abajo. Se dibuja
    // aquí mismo, sin librerías de fuera: un PDF es texto, y así la app no
    // depende de nada que haya que bajarse ni deja de funcionar sin red.

    // Anchos de Helvetica —milésimas de punto— de los caracteres 32 a 126.
    // Hacen falta para alinear los importes a la derecha: sin medir el texto
    // las columnas de la tabla bailan.
    _PDF_ANCHOS: {
        n: '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584',
        b: '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584',
    },

    // Para medir, una letra con tilde ocupa lo que la letra sin ella.
    _PDF_LLANO: { 'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n','Á':'A','É':'E',
                  'Í':'I','Ó':'O','Ú':'U','Ü':'U','Ñ':'N','ç':'c','Ç':'C','€':'0','·':'.',
                  'º':'o','ª':'a','¿':'?','¡':'!','–':'-','—':'-','“':'"','”':'"','‘':"'",'’':"'" },

    // Lo que no es Latin-1 tiene su propio sitio en la tabla que entienden los
    // lectores de PDF; el euro, sin ir más lejos.
    _PDF_WINANSI: { '€':0x80,'‚':0x82,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'‰':0x89,'‹':0x8b,
                    'Œ':0x8c,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,
                    '™':0x99,'›':0x9b,'œ':0x9c,'Ÿ':0x9f },

    _pdfTabla(negrita) {
        const k = negrita ? 'b' : 'n';
        this._pdfCache = this._pdfCache || {};
        if (!this._pdfCache[k]) this._pdfCache[k] = this._PDF_ANCHOS[k].split(' ').map(Number);
        return this._pdfCache[k];
    },

    _pdfMedir(t, tam, negrita) {
        const tabla = this._pdfTabla(negrita);
        let mil = 0;
        for (const ch of String(t ?? '')) {
            const c = (this._PDF_LLANO[ch] || ch).charCodeAt(0);
            mil += (c >= 32 && c <= 126) ? tabla[c - 32] : 556;
        }
        return mil * tam / 1000;
    },

    // El texto, tal como va dentro del PDF: lo que no es ASCII se escapa en
    // octal, así el fichero entero es ASCII y cuadrar la tabla de posiciones
    // —que va en bytes— no tiene trampa.
    _pdfTxt(t) {
        let out = '';
        for (const ch of String(t ?? '')) {
            const c = ch.codePointAt(0);
            if (c >= 32 && c <= 126) { out += '()\\'.includes(ch) ? '\\' + ch : ch; continue; }
            const b = (c >= 0xA0 && c <= 0xFF) ? c : (this._PDF_WINANSI[ch] ?? null);
            out += b === null ? '?' : '\\' + b.toString(8).padStart(3, '0');
        }
        return out;
    },

    _pdfNominas() {
        const A = 595.28, AL = 841.89, M = 42, ANCHO = A - 2 * M;
        const AZUL = [0.055, 0.396, 0.753], HONDO = [0.051, 0.278, 0.631];
        const TINTA = [0.13, 0.16, 0.20], GRIS = [0.45, 0.50, 0.56];
        const BLANCO = [1, 1, 1], CLARO = [0.82, 0.88, 0.95];
        const FONDO = [0.965, 0.976, 0.988], CEBRA = [0.976, 0.984, 0.992];
        const AMBAR = [0.85, 0.6, 0.08];

        const paginas = [];
        let ops = [];
        const n3 = v => (Math.round(v * 1000) / 1000);
        const rgb = c => c.map(n3).join(' ');
        const caja = (x, arriba, w, h, c) => ops.push(
            `${rgb(c)} rg ${x.toFixed(2)} ${(AL - arriba - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
        const raya = (x1, x2, arriba, c, grosor) => ops.push(
            `${rgb(c)} RG ${grosor} w ${x1.toFixed(2)} ${(AL - arriba).toFixed(2)} m `
            + `${x2.toFixed(2)} ${(AL - arriba).toFixed(2)} l S`);
        const txt = (t, x, base, tam, neg, c) => ops.push(
            `BT /F${neg ? 2 : 1} ${tam} Tf ${rgb(c)} rg 1 0 0 1 ${x.toFixed(2)} `
            + `${(AL - base).toFixed(2)} Tm (${this._pdfTxt(t)}) Tj ET`);
        const der = (t, x, base, tam, neg, c) => txt(t, x - this._pdfMedir(t, tam, neg), base, tam, neg, c);

        // Cortar un texto largo por palabras para que quepa a lo ancho
        const partir = (t, ancho, tam) => {
            const fuera = [];
            let linea = '';
            String(t || '').split(/\s+/).forEach(p => {
                const prueba = linea ? linea + ' ' + p : p;
                if (this._pdfMedir(prueba, tam, false) <= ancho) { linea = prueba; return; }
                if (linea) fuera.push(linea);
                linea = p;
            });
            if (linea) fuera.push(linea);
            return fuera;
        };

        // Con el punto de los miles: en un papel, 2.468,58 € y no 2468,58 €.
        const eur = v => this._eur(v)
            .replace(/\d+(?=,)/, entera => entera.replace(/\B(?=(\d{3})+$)/g, '.'));
        // Con coma, como el resto de la app: 3.5 h o 4.7 % desentonan en un
        // papel donde todos los importes van con coma.
        const num = v => String(v ?? '').replace('.', ',');
        const hoy = new Date().toLocaleDateString('es-ES',
            { day: '2-digit', month: '2-digit', year: 'numeric' });

        const claves = this._nomExportElegidas();
        const yo = this.usuarioActual || {};

        claves.forEach(clave => {
            const g = this._misNominas[clave] || {};
            const c = this._calcNomina(clave, g);
            const anio = +clave.slice(0, 4), mesN = +clave.slice(4, 6);
            const ultimo = new Date(anio, mesN, 0).getDate();
            const dd = n => String(n).padStart(2, '0');

            ops = [];
            paginas.push(ops);
            let y;

            // Cabecera. Se repite igual si la nómina necesita una segunda hoja.
            const cabecera = (sigue) => {
                caja(0, 0, A, 92, AZUL);
                caja(0, 92, A, 3, HONDO);
                txt('EMT · Movilidad', M, 40, 19, true, BLANCO);
                txt('Recibo individual de salarios', M, 58, 9.5, false, CLARO);
                txt('Documento informativo del trabajador', M, 74, 7.5, false, CLARO);
                der(this._nombreMes(clave) + (sigue ? ' (continúa)' : ''), A - M, 42, 15, true, BLANCO);
                der(`${dd(1)}/${dd(mesN)}/${anio} — ${dd(ultimo)}/${dd(mesN)}/${anio}`,
                    A - M, 58, 9, false, CLARO);
                der(`${c.dias.base + c.dias.vacaciones + c.dias.permiso} días de salario`,
                    A - M, 73, 8, false, CLARO);
                y = 110;
            };

            const pie = () => {
                raya(M, A - M, AL - 52, CLARO, 0.7);
                txt(`Generado con EMT · Movilidad el ${hoy}. Copia del trabajador: no sustituye`
                    + ' a la nómina que entrega la empresa.', M, AL - 38, 7.2, false, GRIS);
                der(`Hoja ${paginas.length}`, A - M, AL - 38, 7.2, false, GRIS);
            };

            // Si lo que viene no cabe, hoja nueva con la misma cabecera
            const sitio = alto => {
                if (y + alto <= AL - 62) return;
                pie();
                ops = [];
                paginas.push(ops);
                cabecera(true);
            };

            cabecera(false);

            // ── Quién y de cuándo ────────────────────────────────────────────
            caja(M, y, ANCHO, 62, FONDO);
            caja(M, y, 3.5, 62, AZUL);
            const dato = (etiqueta, valor, x, fila) => {
                txt(etiqueta.toUpperCase(), x, y + (fila ? 40 : 18), 6.8, true, GRIS);
                txt(valor || '—', x, y + (fila ? 53 : 31), 10, false, TINTA);
            };
            const antig = c.pctBienios
                ? `${c.anios || 0} año${(c.anios || 0) === 1 ? '' : 's'} · ${num(c.pctBienios)} %`
                : 'Sin antigüedad';
            dato('Trabajador',     yo.name || '—',            M + 16,  0);
            dato('Nº de conductor', this.numConductor || '—', M + 250, 0);
            dato('Días del mes',   String(this.DIAS_NOMINA),  M + 390, 0);
            dato('Correo',         yo.email || '—',           M + 16,  1);
            dato('Antigüedad',     antig,                     M + 250, 1);
            dato('Alta',           c.desde ? c.desde.split('-').reverse().join('/') : '—', M + 390, 1);
            y += 62 + 18;

            // ── Una tabla ────────────────────────────────────────────────────
            const xCant = M + 300, xPrecio = M + 402, xImporte = M + ANCHO - 12;
            const tabla = (titulo, cabs, filas, total) => {
                sitio(24 + 19 + filas.length * 15.4 + 22);
                txt(titulo, M, y, 10.5, true, AZUL);
                y += 10;
                caja(M, y, ANCHO, 19, AZUL);
                txt(cabs[0], M + 12, y + 13, 7.6, true, BLANCO);
                der(cabs[1], xCant, y + 13, 7.6, true, BLANCO);
                der(cabs[2], xPrecio, y + 13, 7.6, true, BLANCO);
                der(cabs[3], xImporte, y + 13, 7.6, true, BLANCO);
                y += 19;
                filas.forEach((f, i) => {
                    sitio(15.4);
                    if (i % 2) caja(M, y, ANCHO, 15.4, CEBRA);
                    txt(f[0], M + 12, y + 10.8, 8.6, false, TINTA);
                    der(f[1], xCant, y + 10.8, 8.6, false, GRIS);
                    der(f[2], xPrecio, y + 10.8, 8.6, false, GRIS);
                    der(f[3], xImporte, y + 10.8, 8.6, true, TINTA);
                    y += 15.4;
                });
                sitio(22);
                caja(M, y, ANCHO, 22, [0.93, 0.95, 0.975]);
                raya(M, A - M, y, CLARO, 0.8);
                txt(total[0], M + 12, y + 14.5, 9.2, true, TINTA);
                der(total[1], xImporte, y + 14.5, 10.5, true, TINTA);
                y += 22 + 15;
            };

            tabla('Devengos', ['Concepto', 'Cantidad', 'Precio', 'Importe'],
                c.devengos.map(l => [
                    l.c,
                    l.d ? `${num(l.d)}${l.horas ? ' h' : ''}` : '',
                    l.p ? eur(l.p) : '',
                    eur(l.i),
                ]),
                ['Total devengado', eur(c.devengado)]);

            tabla('Deducciones', ['Concepto', 'Base', 'Tipo', 'Importe'],
                c.deducciones.map(l => [
                    l.c,
                    l.base ? eur(l.base) : '',
                    l.pct ? `${num(l.pct)} %` : '',
                    '-' + eur(l.i),
                ]),
                ['Total a deducir', '-' + eur(c.aDeducir)]);

            // ── Base de cotización y líquido ─────────────────────────────────
            sitio(30 + 54);
            caja(M, y, ANCHO, 26, FONDO);
            txt(c.prorrata ? 'Base de cotización · devengado + prorrata de pagas extra'
                           : 'Base de cotización · devengado',
                M + 12, y + 17, 8.6, false, GRIS);
            der(eur(c.base), xImporte, y + 17, 9.5, true, TINTA);
            y += 26 + 10;

            caja(M, y, ANCHO, 54, HONDO);
            txt('LÍQUIDO A PERCIBIR', M + 16, y + 24, 11, true, BLANCO);
            txt('Total devengado menos el total a deducir', M + 16, y + 39, 7.6, false, CLARO);
            der(eur(c.liquido), xImporte, y + 35, 22, true, BLANCO);
            y += 54 + 18;

            // ── El detalle del mes, en letra pequeña ─────────────────────────
            const detalle = [`${c.dias.base} días de salario base`];
            if (c.dias.vacaciones) detalle.push(`${c.dias.vacaciones} de vacaciones`);
            if (c.dias.permiso)    detalle.push(`${c.dias.permiso} de permiso retribuido`);
            if (c.diasAsist)       detalle.push(`${c.diasAsist} con complemento de asistencia`);
            if (c.hExtra)          detalle.push(`${num(c.hExtra)} h extras`);
            if (c.hNoct)           detalle.push(`${num(c.hNoct)} h nocturnas`);
            if (c.conPagaExtra)    detalle.push('incluye paga extra');
            sitio(24);
            txt('EL MES', M, y, 6.8, true, GRIS);
            y += 13;
            partir(detalle.join(' · '), ANCHO, 8.6).forEach(l => {
                sitio(12);
                txt(l, M, y, 8.6, false, TINTA);
                y += 12;
            });

            if (g.nota) {
                y += 10;
                const lineas = partir(g.nota, ANCHO - 26, 8.6);
                sitio(20 + lineas.length * 12);
                caja(M, y, ANCHO, 14 + lineas.length * 12, [0.99, 0.97, 0.90]);
                caja(M, y, 3.5, 14 + lineas.length * 12, AMBAR);
                let yy = y + 15;
                lineas.forEach(l => { txt(l, M + 14, yy, 8.6, false, TINTA); yy += 12; });
                y += 14 + lineas.length * 12;
            }

            pie();
        });

        return this._pdfEnsamblar(paginas, A, AL);
    },

    _pdfEnsamblar(paginas, A, AL) {
        const objs = [null, null];              // 1 catálogo, 2 índice de hojas
        const add = cuerpo => { objs.push(cuerpo); return objs.length; };
        const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const hojas = paginas.map(ops => {
            const flujo = ops.join('\n');
            const cont = add(`<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`);
            return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A.toFixed(2)} ${AL.toFixed(2)}]`
                + ` /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cont} 0 R >>`);
        });
        objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[1] = `<< /Type /Pages /Kids [${hojas.map(n => n + ' 0 R').join(' ')}]`
                + ` /Count ${hojas.length} >>`;

        let pdf = '%PDF-1.4\n';
        const donde = [];
        objs.forEach((cuerpo, i) => {
            donde.push(pdf.length);
            pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
        });
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
             + donde.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
             + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        // Todo el PDF es ASCII a propósito, así que un carácter es un byte y
        // las posiciones que acabamos de apuntar cuadran.
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
        return bytes;
    },

    exportarNomPDF() {
        if (!this._hayNomElegidas()) return;
        document.getElementById('expNomModal').classList.remove('show');
        const ok = this._descargarBinario(this._pdfNominas(),
            this._nombreExport('pdf').replace('jornadas', 'nominas'), 'application/pdf');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar en PDF', 4500); return; }
        this._mostrarToast('📄 Nóminas exportadas en PDF', 4000);
    },

    mostrarExportarNominas() {
        if (!this._clavesNominasGuardadas().length) { this._mostrarToast('No hay nóminas que exportar', 3000); return; }
        this._nomExportSel = null;
        this._renderSelectorExportNom();
        document.getElementById('expNomModal').classList.add('show');
        if (this.darkMode) document.getElementById('expNomModalContent').classList.add('dark');
    },

    _hayNomElegidas() {
        if (!this._nomExportElegidas().length) { this._mostrarToast('Elige al menos una nómina', 3000); return false; }
        return true;
    },

    exportarNomCSV() {
        if (!this._hayNomElegidas()) return;
        document.getElementById('expNomModal').classList.remove('show');
        this._descargar(this._csvDe(this.CABECERAS_EXPORT_NOM, this._filasExportNom()),
            this._nombreExport('csv').replace('jornadas', 'nominas'), 'text/csv;charset=utf-8;');
        this._mostrarToast('📊 Nóminas exportadas en CSV', 4000);
    },

    exportarNomXLS() {
        if (!this._hayNomElegidas()) return;
        document.getElementById('expNomModal').classList.remove('show');
        const ok = this._descargarBinario(this._xlsxDe('Nóminas', this.CABECERAS_EXPORT_NOM, this._filasExportNom()),
            this._nombreExport('xlsx').replace('jornadas', 'nominas'),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel; de momento usa CSV', 4500); return; }
        this._mostrarToast('📗 Nóminas exportadas en Excel', 4000);
    },

    async exportarNomSheets() {
        if (!this._hayNomElegidas()) return;
        document.getElementById('expNomModal').classList.remove('show');
        this._mostrarToast('☁️ Creando hoja en Drive...', 3000);
        try {
            if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
            const frontera = '-------emt' + Date.now();
            const meta = JSON.stringify({
                name: `Mis nóminas EMT ${new Date().toISOString().slice(0,10)}`,
                mimeType: 'application/vnd.google-apps.spreadsheet',
            });
            const cuerpo = `\r\n--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
                + `\r\n--${frontera}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${this._csvDe(this.CABECERAS_EXPORT_NOM, this._filasExportNom())}`
                + `\r\n--${frontera}--`;
            const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.accessToken}`,
                           'Content-Type': `multipart/related; boundary=${frontera}` },
                body: cuerpo,
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error?.message || resp.status);
            this._mostrarToast('☁️ Hoja creada en Drive', 3000);
            if (data.webViewLink) window.open(data.webViewLink, '_blank');
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // ── Enviar un export por email ───────────────────────────────────────────
    // Un navegador no puede mandar un correo con adjunto por su cuenta: si el
    // móvil sabe compartir archivos, se comparte a la app de correo que se
    // elija con el fichero ya puesto; si no, se descarga y se abre el correo
    // para adjuntarlo a mano. Los contactos son solo para no escribir el
    // correo cada vez.
    _contactosEmail() {
        try {
            const l = JSON.parse(localStorage.getItem('contactosEmail') || '[]');
            return Array.isArray(l) ? l : [];
        } catch (_) { return []; }
    },

    _guardarContactosEmail(lista) {
        localStorage.setItem('contactosEmail', JSON.stringify([...new Set(lista)]));
    },

    prepararEmailRegistro() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        this.mostrarEnviarEmail(this._csvRegistro(), this._nombreExport('csv'),
            'text/csv;charset=utf-8;', 'Mis jornadas');
    },

    // Por correo va el PDF: es el que se puede enseñar. El CSV y el Excel
    // siguen ahí para quien quiera cuadrar números en una hoja de cálculo.
    prepararEmailNominas() {
        if (!this._hayNomElegidas()) return;
        document.getElementById('expNomModal').classList.remove('show');
        this.mostrarEnviarEmail(this._pdfNominas(),
            this._nombreExport('pdf').replace('jornadas', 'nominas'),
            'application/pdf', 'Mis nóminas');
    },

    mostrarEnviarEmail(contenido, nombre, tipo, asunto) {
        this._emailPendiente = { contenido, nombre, tipo, asunto };
        this._renderContactosEmail();
        document.getElementById('emailModal').classList.add('show');
        if (this.darkMode) document.getElementById('emailModalContent').classList.add('dark');
    },

    _renderContactosEmail() {
        const cont = document.getElementById('emailContactos');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const lista = this._contactosEmail();
        cont.innerHTML = lista.length ? lista.map(email => `<div class="email-contacto">
                <span onclick="app._enviarAContacto('${esc(email)}')">${esc(email)}</span>
                <button onclick="app._borrarContactoEmail('${esc(email)}')" title="Quitar">×</button>
            </div>`).join('')
            : '<div class="ops-field-sub" style="padding:8px 16px;">Sin contactos guardados todavía.</div>';
    },

    _borrarContactoEmail(email) {
        this._guardarContactosEmail(this._contactosEmail().filter(e => e !== email));
        this._renderContactosEmail();
    },

    _nuevoContactoEmail() {
        const input = document.getElementById('emailNuevo');
        const email = (input?.value || '').trim();
        if (!email || !email.includes('@')) { this._mostrarToast('Pon un correo válido', 2500); return; }
        this._guardarContactosEmail([...this._contactosEmail(), email]);
        input.value = '';
        this._renderContactosEmail();
    },

    _enviarSoloEmail() {
        const email = (document.getElementById('emailNuevo')?.value || '').trim();
        if (!email || !email.includes('@')) { this._mostrarToast('Pon un correo válido', 2500); return; }
        this._enviarAContacto(email);
    },

    // Un MIME de verdad con el adjunto dentro, codificado en base64url como
    // pide la API de Gmail. El texto y el binario (el .xlsx) se codifican
    // igual: a base64 normal para el cuerpo de la parte, y todo el mensaje a
    // base64url para el campo "raw".
    _base64(datos) {
        if (typeof datos === 'string') return btoa(unescape(encodeURIComponent(datos)));
        let bin = '';
        for (let i = 0; i < datos.length; i += 8192) bin += String.fromCharCode.apply(null, datos.subarray(i, i + 8192));
        return btoa(bin);
    },

    _base64Url(texto) {
        return btoa(unescape(encodeURIComponent(texto)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    async _enviarGmailApi(destino, asunto, cuerpoTexto, archivo) {
        if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
        const boundary = 'mixed_' + Date.now();
        const asuntoCod = `=?UTF-8?B?${this._base64(asunto)}?=`;
        const mime = `To: ${destino}\r\n`
            + `Subject: ${asuntoCod}\r\n`
            + `MIME-Version: 1.0\r\n`
            + `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`
            + `--${boundary}\r\n`
            + `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`
            + `${cuerpoTexto}\r\n\r\n`
            + `--${boundary}\r\n`
            + `Content-Type: ${archivo.tipo}; name="${archivo.nombre}"\r\n`
            + `Content-Disposition: attachment; filename="${archivo.nombre}"\r\n`
            + `Content-Transfer-Encoding: base64\r\n\r\n`
            + `${this._base64(archivo.contenido)}\r\n`
            + `--${boundary}--`;
        const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: this._base64Url(mime) }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || String(resp.status));
        }
    },

    // El permiso de Gmail no se pide al entrar, a propósito: es de los que
    // hacen salir el aviso de aplicación no verificada, y no tiene sentido que
    // lo vea todo el mundo por algo que casi nadie usa. Google dice en cada
    // token qué ha concedido de verdad, así que se mira antes de intentarlo:
    // enterarse por un error a medio envío no explica nada. Sin esa lista
    // —sesión de antes de que se guardara— se prueba igual, que ya dirá Google.
    _puedeEnviarGmail() {
        const dados = localStorage.getItem('gScopes');
        if (dados === null) return true;
        return dados.split(/\s+/).includes(GMAIL_SCOPE);
    },

    async _enviarAContacto(email) {
        const p = this._emailPendiente;
        if (!p) return;
        document.getElementById('emailModal').classList.remove('show');

        if (!this._puedeEnviarGmail()) {
            if (confirm(
                  'ENVIAR EL CORREO DESDE LA PROPIA APLICACIÓN\n\n'
                + 'Para esto hay que darle permiso a Gmail. Se pide solo aquí, '
                + 'cuando hace falta, y solo a quien lo vaya a usar.\n\n'
                + 'QUÉ VAS A VER\n'
                + 'Google abrirá una pantalla diciendo que "no ha verificado esta '
                + 'aplicación". Sale porque es una aplicación de casa, hecha para '
                + 'la EMT, que no está en ninguna tienda y no ha pasado por la '
                + 'revisión de Google. No quiere decir que sea peligrosa.\n\n'
                + 'QUÉ TIENES QUE TOCAR\n'
                + '1. Configuración avanzada\n'
                + '2. Ir a emt-palma-movilidad.vercel.app\n'
                + '3. Permitir\n\n'
                + 'QUÉ PUEDE HACER CON ESE PERMISO\n'
                + 'Solo enviar el correo que tú le mandes enviar, con tu archivo '
                + 'adjunto. No puede leer tu correo, ni abrirlo, ni borrar nada. '
                + 'El desarrollador es guillermo.rc82@gmail.com, el mismo que sale '
                + 'en la pantalla de Google.\n\n'
                + 'SI PREFIERES NO DARLO\n'
                + 'No pasa absolutamente nada. Lo único que no podrás es enviarlo '
                + 'desde aquí: el archivo se comparte igual con la aplicación de '
                + 'correo que uses, ya adjunto, y lo mandas tú.\n\n'
                + '¿Se lo damos?')) {
                this.login(false, GMAIL_SCOPE);
                return;
            }
            return this._compartirAdjunto(email, p);
        }

        this._mostrarToast('✉️ Enviando...', 2000);
        try {
            await this._enviarGmailApi(email,
                p.asunto, `Te adjunto ${p.nombre}.`,
                { nombre: p.nombre, tipo: p.tipo, contenido: p.contenido });
            this._mostrarToast(`✅ Enviado a ${email}`, 3000);
            return;
        } catch (e) {
            console.error('Gmail API:', e.message);
            // Google contesta con un tocho en inglés cuando el proyecto no
            // tiene activado el envío de correo. No es culpa de quien lo usa
            // ni se arregla desde aquí, así que al menos que se entienda.
            if (/has not been used in project|is disabled|accessNotConfigured/i.test(e.message || '')) {
                this._mostrarToast('❌ El envío de correo no está activado en la cuenta de Google '
                    + 'de la aplicación. Avisa a gestión. Mientras, se comparte el archivo.', 8000);
                return this._compartirAdjunto(email, p);
            }
            if (/insufficient|permission|scope/i.test(e.message || '')) {
                // Lo que creíamos saber del permiso no vale: que se vuelva a
                // preguntar la próxima vez en vez de dar por hecho que está.
                localStorage.removeItem('gScopes');
                if (confirm('Google no ha dejado enviarlo: falta el permiso de Gmail.\n\n'
                    + '¿Entras otra vez para dárselo? Mientras, se comparte el archivo '
                    + 'con la app de correo que elijas.')) {
                    this.login(false, GMAIL_SCOPE);
                    return;
                }
            } else {
                this._mostrarToast('❌ No se pudo enviar: ' + e.message, 4000);
            }
        }
        return this._compartirAdjunto(email, p);
    },

    // Compartir el archivo ya adjuntado, con la app de correo que elija. Antes
    // esto acababa descargándolo y abriendo un correo vacío: se llegaba a la
    // app de correo y el archivo no estaba, había que ir a buscarlo a
    // Descargas y adjuntarlo a mano, que es justo lo que no se quería.
    async _compartirAdjunto(email, p) {
        if (window.AndroidBridge?.compartirArchivo) {
            try {
                window.AndroidBridge.compartirArchivo(
                    p.nombre, p.tipo, this._base64(p.contenido), p.asunto, email || '');
                return;
            } catch (_) { /* si el móvil no puede, queda lo de abajo */ }
        }
        try {
            const blob = new Blob([p.contenido], { type: p.tipo });
            const file = new File([blob], p.nombre, { type: p.tipo });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: p.asunto, text: `Para ${email}` });
                return;
            }
        } catch (_) { return; }   // el usuario cerró la hoja de compartir: no pasa nada
        // Último recurso: se descarga y se abre el correo para adjuntarlo a mano
        this._descargar(p.contenido, p.nombre, p.tipo);
        const asunto = encodeURIComponent(p.asunto);
        const cuerpo = encodeURIComponent(`Te adjunto ${p.nombre}, que se acaba de descargar.`);
        window.open(`mailto:${email}?subject=${asunto}&body=${cuerpo}`, '_blank');
        this._mostrarToast('📎 No se ha podido adjuntar solo — está en Descargas, adjúntalo al correo que se ha abierto', 6500);
    },

    // ── Lugar de trabajo de la jornada ───────────────────────────────────────
    // El lugar se elige aquí, y quien pasa por varios sitios en el día —los de
    // calle— puede apuntar cada uno con su horario. La primera entrada y la
    // última salida no hace falta escribirlas: son las de la jornada.

    _tramos: [],
    _tramosEdit: [],

    _lugaresConocidos() {
        const cat = Object.values(LUGARES_CATALOGO || {}).map(l => l?.nombre).filter(Boolean);
        const todos = [...cat];
        [this.puestoTrabajo, this._lugarDeHoy(),
         ...this._tramos.map(t => t.p), ...this._tramosEdit.map(t => t.p)].forEach(p => {
            if (p && !todos.some(x => this._clavePuesto(x) === this._clavePuesto(p))) todos.push(p);
        });
        return todos;
    },

    _opcionesLugar(actual) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        return '<option value="">Sin lugar</option>' + this._lugaresConocidos().map(p =>
            `<option${this._clavePuesto(p) === this._clavePuesto(actual) ? ' selected' : ''}>${esc(p)}</option>`).join('');
    },

    // El lugar que viene puesto al ir a registrar: el que te hayan asignado
    // para hoy. En cuanto lo cambias tú —o te sitúa el GPS en otro sitio— manda
    // lo tuyo, pero solo por hoy: mañana vuelve a proponerte lo asignado.
    _lugarPropuesto() {
        if (localStorage.getItem('lugarElegidoEl') === this._hoyClave()) return this.puestoTrabajo;
        return this._lugarDeHoy();
    },

    _renderLugarJornada() {
        const sel = document.getElementById('lugarJornada');
        const propuesto = this._lugarPropuesto();
        if (sel) sel.innerHTML = this._opcionesLugar(propuesto);
        // Lo que se ve es lo que se registra: si se propone el asignado, ese
        // es el que tiene que viajar con la jornada.
        if (this._clavePuesto(propuesto) !== this._clavePuesto(this.puestoTrabajo)) {
            this.puestoTrabajo = propuesto;
            localStorage.setItem('puestoTrabajo', propuesto);
            this._actualizarConductorDisplay();
        }
        this._renderTramos();
    },

    _cambiarLugarJornada(v) {
        this.puestoTrabajo = v || '';
        localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
        this._marcarLugarElegidoHoy();
        this._actualizarCabeceraUsuario();
        this._actualizarConductorDisplay();
        this._renderTramos();
    },

    // Hoy mando yo sobre lo asignado; mañana se vuelve a proponer lo asignado
    _marcarLugarElegidoHoy() {
        localStorage.setItem('lugarElegidoEl', this._hoyClave());
    },

    _nuevoTramo() {
        this._tramos.push({ p: this.puestoTrabajo || '', i: '', o: '' });
        this._renderTramos();
    },

    _setTramo(k, campo, valor) {
        if (!this._tramos[k]) return;
        this._tramos[k][campo] = valor;
        this._renderTramos();
    },

    _quitarTramo(k) { this._tramos.splice(k, 1); this._renderTramos(); },

    // Horas del día ya repartidas en los tramos de abajo. Cada uno empieza,
    // si no se le pone hora, donde acabó el anterior: el de arriba para el
    // primero. La salida siempre se escribe, porque entre un tramo y el
    // siguiente puede haber un hueco sin trabajar y nadie puede adivinarlo.
    _tramosConHorasDe(tramosArr, finPrincipal) {
        let antes = finPrincipal;
        return tramosArr.map(t => {
            const con = { ...t, i: t.i || antes, o: t.o || '' };
            if (con.o) antes = con.o;
            return con;
        });
    },

    _tramosConHoras() {
        return this._tramosConHorasDe(this._tramos, document.getElementById('horaFin')?.value || '');
    },

    // Todos los sitios del día, el de arriba incluido.
    //
    // El lugar de trabajo del formulario es el primer sitio de la jornada:
    // desde la hora de entrada hasta que empieza el siguiente. Sin contarlo,
    // de un día repartido solo viajaban los sitios de abajo y la primera
    // parte —la que casi siempre es la más larga— no aparecía en ningún lado:
    // ni en las jornadas anteriores, ni en el cuadro de lugares de gestión.
    _tramosDelDiaDe(tramosArr, puestoPrincipal, iniPrincipal, finPrincipal) {
        // Con las horas basta. Un tramo sin lugar es un rato trabajado que aún
        // no se sabe dónde va, no un tramo a medias: pidiéndole también el
        // lugar se tiraba sin avisar y esas horas no aparecían en ningún sitio.
        const extras = this._tramosConHorasDe(tramosArr, finPrincipal).filter(t => t.i && t.o && t.i !== t.o);
        if (!extras.length) return [];
        // El de arriba va de su entrada a su salida, ni un minuto más. Antes
        // se estiraba hasta que empezaba el siguiente tramo, así que un día
        // partido —mañana, comer, tarde— cobraba también las horas de en
        // medio: de 9 a 12:30 y de 15:30 a 19 salían 10 horas en vez de 7.
        return [{ p: puestoPrincipal || '', i: iniPrincipal, o: finPrincipal }, ...extras]
            .filter(t => t.i && t.o && t.i !== t.o)
            .map(t => ({ p: t.p || '', i: t.i, o: t.o }));
    },

    _tramosDelDia() {
        return this._tramosDelDiaDe(this._tramos, this.puestoTrabajo,
            document.getElementById('horaInicio')?.value || '', document.getElementById('horaFin')?.value || '');
    },

    // Con el día repartido, la jornada va de la primera entrada a la última
    // salida y las horas son las de todos los sitios juntos: antes se quedaba
    // con lo que pusiera arriba y el resto del día no contaba.
    _jornadaDeLosTramos(tramos) {
        if (!tramos.length) return null;
        const horas = tramos.reduce((t, x) => t + this._horasEntre(x.i, x.o), 0);
        return { fin: tramos[tramos.length - 1].o, horas: Math.round(horas * 100) / 100 };
    },

    _horasRepartidas() {
        return this._tramosConHoras().reduce((s, t) =>
            s + (t.i && t.o ? this._horasEntre(t.i, t.o) : 0), 0);
    },

    _renderTramos() {
        const cont = document.getElementById('tramosLista');
        if (!cont) return;
        const conHoras = this._tramosConHoras();
        cont.innerHTML = this._tramos.map((t, k) => `<div class="tramo">
            <select onchange="app._setTramo(${k},'p',this.value)">${this._opcionesLugar(t.p)}</select>
            <input type="time" value="${t.i}" placeholder="entrada"
                onchange="app._setTramo(${k},'i',this.value)" title="En blanco: donde acabó el anterior">
            <input type="time" value="${t.o}"
                onchange="app._setTramo(${k},'o',this.value)" title="La hora a la que se sale de este sitio">
            <button class="tramo-x" onclick="app._quitarTramo(${k})">×</button>
        </div>`).join('');
        const resto = document.getElementById('lugarResto');
        if (!resto) return;
        if (!this._tramos.length) { resto.textContent = ''; resto.classList.remove('falta'); return; }
        // El día entero, con el lugar de arriba incluido: es lo que se va a
        // guardar, así que es lo que hay que enseñar.
        const todos = this._tramosDelDia();
        const total = this._jornadaDeLosTramos(todos);
        const h = n => String(Math.round(n * 100) / 100).replace('.', ',') + 'h';
        const sitios = todos.map(t => `${h(this._horasEntre(t.i, t.o))}${
            t.p ? ' en ' + t.p : ' sin lugar'}`).join(' · ');
        resto.classList.remove('falta');
        resto.textContent = total ? `${sitios} · ${h(total.horas)} en total` : sitios;
        // Y la casilla de horas, al día con lo repartido. La de salida no se
        // toca: es la de este primer sitio, y pisarla con el final del día
        // alargaba el tramo de arriba hasta el último tramo de la tarde.
        if (total) {
            const horasInput = document.getElementById('horasInput');
            // La casilla es numérica: con coma se queda en blanco y luego no
            // deja registrar porque cree que no hay horas.
            if (horasInput) horasInput.value = String(total.horas);
        }
    },

    // Los mismos tramos de arriba, pero para el cuadro de editar una jornada
    // ya guardada: antes se abría sin ellos y guardar la dejaba con un solo
    // lugar, aunque tuviera dos o más.
    _nuevoTramoEdit() {
        const puesto = document.getElementById('editModalLugar')?.value || '';
        this._tramosEdit.push({ p: puesto, i: '', o: '' });
        this._renderTramosEdit();
    },

    _setTramoEdit(k, campo, valor) {
        if (!this._tramosEdit[k]) return;
        this._tramosEdit[k][campo] = valor;
        this._renderTramosEdit();
    },

    _quitarTramoEdit(k) { this._tramosEdit.splice(k, 1); this._renderTramosEdit(); },

    _renderTramosEdit() {
        const cont = document.getElementById('editModalTramosLista');
        if (!cont) return;
        cont.innerHTML = this._tramosEdit.map((t, k) => `<div class="tramo">
            <select onchange="app._setTramoEdit(${k},'p',this.value)">${this._opcionesLugar(t.p)}</select>
            <input type="time" value="${t.i}" placeholder="entrada"
                onchange="app._setTramoEdit(${k},'i',this.value)" title="En blanco: donde acabó el anterior">
            <input type="time" value="${t.o}"
                onchange="app._setTramoEdit(${k},'o',this.value)" title="La hora a la que se sale de este sitio">
            <button class="tramo-x" onclick="app._quitarTramoEdit(${k})">×</button>
        </div>`).join('');
        const resto = document.getElementById('editModalLugarResto');
        if (!resto) return;
        if (!this._tramosEdit.length) { resto.textContent = ''; return; }
        const puesto = document.getElementById('editModalLugar')?.value || '';
        const ini    = document.getElementById('editModalInicio')?.value || '';
        const fin    = document.getElementById('editModalFin')?.value || '';
        const todos  = this._tramosDelDiaDe(this._tramosEdit, puesto, ini, fin);
        const total  = this._jornadaDeLosTramos(todos);
        const h = n => String(Math.round(n * 100) / 100).replace('.', ',') + 'h';
        const sitios = todos.map(t => `${h(this._horasEntre(t.i, t.o))}${
            t.p ? ' en ' + t.p : ' sin lugar'}`).join(' · ');
        resto.textContent = total ? `${sitios} · ${h(total.horas)} en total` : sitios;
    },

    // ── Cuadros del registro ─────────────────────────────────────────────────
    // Cada uno se puede quitar y se pueden colocar en el orden que se quiera.
    // El orden se aplica con CSS, así que los cuadros siguen en su sitio en el
    // HTML y sus manejadores no cambian.

    CUADROS: [
        { id: 'sinAsistencia', el: 'noAsistCompact', nom: '🚫 No fui a trabajar' },
        { id: 'pr',      el: 'prCompact',         nom: 'PR · permiso retribuido' },
        { id: 'festivo', el: 'festivoCompact',    nom: '🎉 Festivos' },
        { id: 'extra',   el: 'extraCompact',      nom: '⏱️ Horas extras' },
        { id: 'vac',     el: 'vacacionesCompact', nom: '🏖️ Vacaciones' },
        { id: 'be',      el: 'beCompact',         nom: '🩺 BE · baja' },
    ],

    _configCuadros() {
        let c = null;
        try { c = JSON.parse(localStorage.getItem('cuadrosRegistro') || 'null'); } catch (_) {}
        const todos = this.CUADROS.map(x => x.id);
        // Lo guardado manda, pero un cuadro nuevo no debe quedarse fuera por
        // haber configurado esto antes de que existiera.
        const orden = [...(c?.orden || []).filter(id => todos.includes(id))];
        todos.forEach(id => { if (!orden.includes(id)) orden.push(id); });
        return { orden, ocultos: (c?.ocultos || []).filter(id => todos.includes(id)) };
    },

    _guardarCuadros(c) {
        localStorage.setItem('cuadrosRegistro', JSON.stringify(c));
        this._aplicarCuadros();
        this._renderCuadros();
    },

    _aplicarCuadros() {
        const { orden, ocultos } = this._configCuadros();
        orden.forEach((id, i) => {
            const def = this.CUADROS.find(x => x.id === id);
            const el = document.getElementById(def?.el) || document.querySelector(`[data-cuadro="${id}"]`);
            if (!el) return;
            el.style.order = i;
            el.hidden = ocultos.includes(id);
        });
    },

    mostrarCuadros() {
        this._renderCuadros();
        document.getElementById('cuadrosModal').classList.add('show');
        if (this.darkMode) document.getElementById('cuadrosModalContent').classList.add('dark');
    },

    _renderCuadros() {
        const { orden, ocultos } = this._configCuadros();
        document.getElementById('cuadrosLista').innerHTML = orden.map((id, i) => {
            const def = this.CUADROS.find(x => x.id === id);
            const off = ocultos.includes(id);
            return `<div class="cu-fila${off ? ' off' : ''}">
                <input type="checkbox" ${off ? '' : 'checked'} onchange="app._verCuadro('${id}',this.checked)">
                <span class="cu-nom">${def.nom}</span>
                <button class="cu-mov" onclick="app._moverCuadro('${id}',-1)" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button class="cu-mov" onclick="app._moverCuadro('${id}',1)" ${i === orden.length - 1 ? 'disabled' : ''}>▼</button>
            </div>`;
        }).join('');
    },

    _verCuadro(id, visible) {
        const c = this._configCuadros();
        c.ocultos = visible ? c.ocultos.filter(x => x !== id) : [...new Set([...c.ocultos, id])];
        this._guardarCuadros(c);
    },

    _moverCuadro(id, paso) {
        const c = this._configCuadros();
        const i = c.orden.indexOf(id), j = i + paso;
        if (i < 0 || j < 0 || j >= c.orden.length) return;
        [c.orden[i], c.orden[j]] = [c.orden[j], c.orden[i]];
        this._guardarCuadros(c);
    },

    _cuadrosPorDefecto() {
        localStorage.removeItem('cuadrosRegistro');
        this._aplicarCuadros();
        this._renderCuadros();
    },

    // ── Cuadros grandes de arriba ────────────────────────────────────────────
    // Los seis de siempre, pero se pueden ocultar y arrastrar para ordenarlos:
    // si solo hacen falta cuatro, los otros dos se quitan de en medio.
    CUADROS_STATS: [
        { id: 'restantes',  el: 'statCardRestantes',  nom: 'Restantes del año' },
        { id: 'trabajadas', el: 'statCardTrabajadas', nom: 'Horas trabajadas' },
        { id: 'mes',        el: 'statCardMes',        nom: 'Este mes' },
        { id: 'noct',       el: 'statCardNoct',       nom: '🌙 Nocturnas' },
        { id: 'festivos',   el: 'statCardFestivos',   nom: '🎉 Festivos' },
        { id: 'extras',     el: 'statCardExtras',     nom: '⏱️ Horas extras' },
    ],

    _configCuadrosResumen() {
        let c = null;
        try { c = JSON.parse(localStorage.getItem('cuadrosResumen') || 'null'); } catch (_) {}
        const todos = this.CUADROS_STATS.map(x => x.id);
        const orden = [...(c?.orden || []).filter(id => todos.includes(id))];
        todos.forEach(id => { if (!orden.includes(id)) orden.push(id); });
        return { orden, ocultos: (c?.ocultos || []).filter(id => todos.includes(id)) };
    },

    _guardarCuadrosResumen(c) {
        localStorage.setItem('cuadrosResumen', JSON.stringify(c));
        this._aplicarCuadrosResumen();
        this._renderCuadrosResumen();
    },

    _aplicarCuadrosResumen() {
        const { orden, ocultos } = this._configCuadrosResumen();
        orden.forEach((id, i) => {
            const def = this.CUADROS_STATS.find(x => x.id === id);
            const el = document.getElementById(def?.el) || document.querySelector(`[data-cuadro="${id}"]`);
            if (!el) return;
            el.style.order = i;
            el.hidden = ocultos.includes(id);
        });
    },

    mostrarCuadrosResumen() {
        this._renderCuadrosResumen();
        document.getElementById('cuadrosResumenModal').classList.add('show');
        if (this.darkMode) document.getElementById('cuadrosResumenModalContent').classList.add('dark');
    },

    _renderCuadrosResumen() {
        const { orden, ocultos } = this._configCuadrosResumen();
        document.getElementById('cuadrosResumenLista').innerHTML = orden.map(id => {
            const def = this.CUADROS_STATS.find(x => x.id === id);
            const off = ocultos.includes(id);
            return `<div class="cu-fila${off ? ' off' : ''}" draggable="true" data-id="${id}"
                    ondragstart="app._cuadroResumenDragStart(event)" ondragend="app._cuadroResumenDragEnd(event)"
                    ondragover="app._cuadroResumenDragOver(event)" ondragleave="app._cuadroResumenDragLeave(event)"
                    ondrop="app._cuadroResumenDrop(event)">
                <span class="cu-drag">⠿</span>
                <input type="checkbox" ${off ? '' : 'checked'} onchange="app._verCuadroResumen('${id}',this.checked)">
                <span class="cu-nom">${def.nom}</span>
            </div>`;
        }).join('');
    },

    _verCuadroResumen(id, visible) {
        const c = this._configCuadrosResumen();
        c.ocultos = visible ? c.ocultos.filter(x => x !== id) : [...new Set([...c.ocultos, id])];
        this._guardarCuadrosResumen(c);
    },

    _cuadroResumenDragStart(e) {
        this._dragSrcCuadroResumen = e.currentTarget;
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id);
    },

    _cuadroResumenDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('#cuadrosResumenLista .cu-fila').forEach(f => f.classList.remove('drag-over'));
    },

    _cuadroResumenDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
    },

    _cuadroResumenDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    },

    _cuadroResumenDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const src = this._dragSrcCuadroResumen;
        const dst = e.currentTarget;
        if (!src || src === dst) return;
        const cont = document.getElementById('cuadrosResumenLista');
        const filas = [...cont.children];
        const si = filas.indexOf(src), di = filas.indexOf(dst);
        if (si < di) cont.insertBefore(src, dst.nextSibling);
        else cont.insertBefore(src, dst);
        const c = this._configCuadrosResumen();
        c.orden = [...cont.querySelectorAll('.cu-fila')].map(f => f.dataset.id);
        this._guardarCuadrosResumen(c);
    },

    _cuadrosResumenPorDefecto() {
        localStorage.removeItem('cuadrosResumen');
        this._aplicarCuadrosResumen();
        this._renderCuadrosResumen();
    },

    // ── Baja (BE) ────────────────────────────────────────────────────────────
    // Un día de baja se apunta sin horas, y cuenta como jornada hecha contra el
    // objetivo anual: media jornada 3,5h y jornada completa las suyas.
    HORAS_BAJA: 3.5,
    bajaActiva: false,

    _horasBaja() {
        return this._esJornadaCompleta() ? (this.jornadaHoras || 7) : this.HORAS_BAJA;
    },

    clickBe(auto = false) {
        if (!auto && this.sinAsistenciaActivo) return;
        this.bajaActiva = !this.bajaActiva;
        document.getElementById('beCompact').classList.toggle('active', this.bajaActiva);
        document.getElementById('beToggle').checked = this.bajaActiva;
        if (this.bajaActiva) {
            document.getElementById('horasInput').value = '0';
            this._mostrarToast(`🩺 Día de baja: cuentan ${String(this._horasBaja()).replace('.', ',')}h`, 3000);
        }
    },

    clickVacaciones(auto = false) {
        if (!auto && this.sinAsistenciaActivo) return;
        this.vacacionesActivo = !this.vacacionesActivo;
        document.getElementById('vacacionesCompact').classList.toggle('active', this.vacacionesActivo);
        document.getElementById('vacacionesToggle').checked = this.vacacionesActivo;
        // A vacation day is logged with no hours
        if (this.vacacionesActivo) document.getElementById('horasInput').value = '0';
    },

    clickExtra(auto = false) {
        if (!auto && this.sinAsistenciaActivo) return;
        this.extraActivo = !this.extraActivo;
        document.getElementById('extraCompact').classList.toggle('active', this.extraActivo);
        document.getElementById('extraToggle').checked = this.extraActivo;
        document.getElementById('extraPanel').classList.toggle('visible', this.extraActivo);
        const lbl = document.getElementById('extraOptAnual');
        if (lbl) lbl.textContent = this.horasAnualesCustom + 'h';
    },

    _extraDestino() {
        return document.querySelector('input[name="extraDestino"]:checked')?.value || 'anual';
    },

    mostrarCambiarJornada() {
        // Lo que cambia las reglas es si es media jornada o completa, así que se
        // elige entre las dos en vez de escribir un número a ojo.
        this._volverJornada();
        // Media jornada no son solo 3,5h: si tiene otras puestas, la fila lo
        // enseña y queda marcada. Antes con 4h no se marcaba ninguna y al
        // entrar por la de 3,5 se le borraba su valor.
        const media = this._esMedia(this.jornadaHoras);
        const txt = document.getElementById('jmMediaTxt');
        if (txt) txt.textContent = (media ? String(this.jornadaHoras).replace('.', ',') : '3,5') + ' h';
        document.getElementById('jmMedia')?.classList.toggle('sel', media);
        document.getElementById('jmCompleta')?.classList.toggle('sel', !media);
        document.getElementById('jornadaModal').classList.add('show');
        if (this.darkMode) document.getElementById('jornadaModalContent').classList.add('dark');
    },

    elegirJornadaOtra() {
        const v = prompt('¿Cuántas horas tiene tu jornada?\n\nPuedes usar decimales: 3,5 o 3.5', this.jornadaHoras);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.\nEjemplo: 3,5 o 7'); return; }
        this.elegirJornada(n);
    },

    // La media jornada no se hace todos los días, así que al elegirla se
    // pregunta cuáles y cuántas horas en vez de darlo por supuesto.
    _esMedia(n) { return n < this.JORNADA_COMPLETA; },

    // Desde Trabajo se va derecho a los días, sin pasar por elegir jornada
    mostrarDiasJornada() {
        document.getElementById('jornadaModal').classList.add('show');
        if (this.darkMode) document.getElementById('jornadaModalContent').classList.add('dark');
        this._pasoDiasJornada(this.jornadaHoras);
    },

    _volverJornada() {
        document.getElementById('jornadaDias').hidden = true;
        document.getElementById('jornadaPie').hidden = true;
        document.querySelector('#jornadaModal .modal-body').hidden = false;
    },

    _pasoDiasJornada(n) {
        this._jornadaTmp = n;
        this._diasTmp = Array.isArray(this.diasSemana)
            ? this.diasSemana.filter(d => this.DIAS_MEDIA.includes(d))
            : [1, 2, 3, 4, 5];
        document.querySelector('#jornadaModal .modal-body').hidden = true;
        document.getElementById('jornadaDias').hidden = false;
        document.getElementById('jornadaPie').hidden = false;
        document.getElementById('jmHoras').value = String(n).replace('.', ',');
        this._renderSemana();
    },

    // La media jornada se reparte de lunes a domingo
    DIAS_MEDIA: [1, 2, 3, 4, 5, 6, 0],

    _renderSemana() {
        const nombres = ['D','L','M','X','J','V','S'];
        document.getElementById('jmSemana').innerHTML = this.DIAS_MEDIA
            .map(d => `<button class="${this._diasTmp.includes(d) ? 'on' : ''}"
                onclick="app._toggleDiaSemana(${d})">${nombres[d]}</button>`).join('');
        const h = this._leerDecimal(document.getElementById('jmHoras').value) || 0;
        const n = this._diasTmp.length;
        document.getElementById('jmResumen').textContent = n
            ? `${n} día${n === 1 ? '' : 's'} a la semana · ${(n * h).toFixed(1).replace('.', ',')}h semanales`
            : 'Marca al menos un día';
    },

    _toggleDiaSemana(d) {
        const i = this._diasTmp.indexOf(d);
        if (i === -1) this._diasTmp.push(d); else this._diasTmp.splice(i, 1);
        this._renderSemana();
    },

    async _guardarDiasJornada() {
        const h = this._leerDecimal(document.getElementById('jmHoras').value);
        if (h === null || h <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        if (!this._diasTmp.length) { this._mostrarToast('Marca al menos un día', 3000); return; }
        this.diasSemana = this._diasTmp.slice().sort();
        localStorage.setItem('diasSemana', JSON.stringify(this.diasSemana));
        this._sellarDias();
        this._volverJornada();
        await this.elegirJornada(h, true);
    },

    async elegirJornada(n, saltarPaso) {
        // Al entrar por la fila de media jornada se conservan sus horas, que
        // pueden no ser 3,5; solo se usa el valor de la fila si venía de la
        // jornada completa.
        if (this._esMedia(n) && !saltarPaso) {
            return this._pasoDiasJornada(this._esMedia(this.jornadaHoras) ? this.jornadaHoras : n);
        }
        document.getElementById('jornadaModal').classList.remove('show');
        if (n === this.jornadaHoras && saltarPaso !== true) return;
        this.jornadaHoras = n;
        localStorage.setItem('jornadaHoras', String(n));
        // La jornada completa no lleva días fijos: se trabaja lo que toque. Lo
        // manda la jornada anual, no las horas del día: el que hace 7h tres
        // días a la semana va por las 777h y sí tiene días fijos.
        if (this._esJornadaCompleta()) { this.diasSemana = null; localStorage.removeItem('diasSemana'); this._sellarDias(); }
        this._actualizarJornadaDisplay();
        await this._guardarPreferencias(true);
        localStorage.removeItem('resumenHuella');    // que se publique el cambio
        this.cargarDatos();
        this._mostrarToast(`✅ Jornada: ${n}h`, 2500);
    },

    _actualizarJornadaDisplay() {
        const el = document.getElementById('jornadaHorasDisplay');
        if (el) el.textContent = this.jornadaHoras + 'h';
        this._actualizarCampoFestivo();
    },

    // El último dígito es el de control y va tras el guión. El cuerpo puede ser
    // de 3 o de 4 dígitos: 209-1 y 1418-3 son los dos válidos. Devuelve null si
    // no encaja, '' si se ha dejado en blanco.
    _normalizarConductor(v) {
        const digitos = String(v ?? '').replace(/\D/g, '');
        if (!String(v ?? '').trim()) return '';
        if (digitos.length !== 4 && digitos.length !== 5) return null;
        return digitos.slice(0, -1) + '-' + digitos.slice(-1);
    },

    mostrarCambiarConductor() {
        const v = prompt('Número de trabajador.\n\nPuedes escribirlo con o sin guión: 14183 o 1418-3, 2091 o 209-1',
            this.numConductor || '');
        if (v === null) return;
        const val = this._normalizarConductor(v);
        if (val === null) {
            alert('❌ Formato incorrecto. Deben ser 4 o 5 dígitos.\nEjemplo: 209-1 o 1418-3');
            return;
        }
        this.numConductor = val;
        localStorage.setItem('numConductor', val);
        this._actualizarConductorDisplay();
        this._actualizarCabeceraUsuario();
        this._guardarPreferencias();
    },

    _actualizarConductorDisplay() {
        const el = document.getElementById('conductorDisplay');
        if (el) el.textContent = [this.numConductor || 'Sin asignar', this.puestoTrabajo].filter(Boolean).join(' · ');
    },

    // ── Lo que te toca hoy ───────────────────────────────────────────────────
    // Debajo del número de conductor sale a qué hora entras y dónde. El lugar
    // va por fecha: si un día te mandan a otro sitio, ese día sale ese y al
    // siguiente vuelve solo al del mes, sin que nadie tenga que deshacerlo.

    _asignacion: (() => {
        try { return JSON.parse(localStorage.getItem('asignacionHoy') || 'null'); } catch (_) { return null; }
    })(),

    _hoyClave() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    },

    // Vale la de hoy; la de ayer no dice nada de hoy
    _asignacionDeHoy() {
        const a = this._asignacion;
        return (a && a.fecha === this._hoyClave()) ? a : null;
    },

    // Dónde trabajas hoy. Si el servidor ya ha dicho lo de hoy, vale eso y solo
    // eso: ahí dentro ya está resuelto el orden —lo puesto para esa fecha por
    // encima del lugar de siempre—, así que tomar por detrás el valor que haya
    // quedado en el móvil solo serviría para arrastrar el sitio de otro día.
    // Sin respuesta todavía, se tira de lo último que se supo.
    _lugarDeHoy() {
        const a = this._asignacionDeHoy();
        return a ? (a.lugar || '') : (this.puestoTrabajo || '');
    },

    // Si gestión le cambia el sitio o la hora, se le avisa, que si no se
    // entera cuando ya va de camino al lugar de antes. Solo cuenta el cambio
    // sobre lo que ya sabía de ese mismo día: al pasar de un día a otro lo
    // normal es que la jornada sea distinta, y eso no es ninguna novedad.
    _avisarCambioDeJornada(antes, ahora) {
        if (!antes || !ahora || antes.fecha !== ahora.fecha) return;
        const horas = a => (a?.horario?.i && a?.horario?.f) ? `${a.horario.i}–${a.horario.f}` : '';
        const lugarAntes = (antes.lugar || '').trim();
        const lugarAhora = (ahora.lugar || '').trim();
        const horaAntes  = horas(antes);
        const horaAhora  = horas(ahora);
        const cambiaLugar = this._clavePuesto(lugarAntes) !== this._clavePuesto(lugarAhora);
        const cambiaHora  = horaAntes !== horaAhora;
        // Que se la hayan vuelto a asignar cuenta como cambio aunque quede
        // igual que antes: alguien ha tocado su jornada y tiene que enterarse.
        const reasignada  = (antes.rev || 0) !== (ahora.rev || 0);
        if (cambiaLugar) {
            // Elegir el lugar a mano manda sobre lo asignado, pero solo sobre
            // lo que había asignado entonces: si gestión lo cambia después,
            // manda el cambio. Sin esto, a quien hubiera tocado el lugar hoy
            // —o a quien se lo hubiera puesto el GPS— le seguía saliendo el
            // sitio viejo en Registro mientras arriba ya ponía el nuevo.
            localStorage.removeItem('lugarElegidoEl');
            this._renderLugarJornada();
            this._actualizarCabeceraUsuario();
        }
        if (!cambiaLugar && !cambiaHora && !reasignada) return;

        const partes = [];
        if (cambiaLugar || (reasignada && !cambiaHora)) partes.push(lugarAhora || 'sin lugar');
        if (cambiaHora  || (reasignada && !cambiaLugar)) partes.push(horaAhora || 'sin horario');
        const cuerpo = 'Se te asigna este servicio y horario: ' + partes.join(' · ')
            + '. Confirma como leído. Gracias.';
        this._mostrarToast('📍 ' + cuerpo, 7000);
        // Y se queda un aviso en pantalla hasta que lo dé por leído: lo que
        // gestión necesita saber no es que se lo mandaron, es que se enteró.
        try {
            localStorage.setItem('cambioJornadaPend',
                JSON.stringify({ clave: this._claveJornada(ahora), texto: cuerpo }));
        } catch (_) {}
        this._pintarAvisoCambio();

        // En el móvil el aviso de la barra lo pone la parte nativa, que es la
        // que sigue mirando con la app cerrada; aquí solo se avisa en pantalla
        // para no dar el mismo recado dos veces. En la web no hay nativa.
        if (window.AndroidBridge) return;
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.schedule) return;
        try {
            LN.schedule({ notifications: [{
                id: 2101,
                title: 'Te han cambiado la jornada de hoy',
                body: cuerpo,
                smallIcon: 'ic_stat_chat',
            }] });
        } catch (_) { /* sin aviso en la barra queda el de la pantalla */ }
    },

    _avisoVisto() {
        try { return JSON.parse(localStorage.getItem('avisoVisto') || 'null'); }
        catch (_) { return null; }
    },

    // Los avisos con la app cerrada van con una alarma que el ahorro de batería
    // se lleva por delante en bastantes móviles, y entonces no llega nada y no
    // hay forma de saber por qué. Se pide una sola vez, recién instalada, que
    // es cuando se entiende para qué es.
    _pedirBateriaSiHaceFalta() {
        if (!window.AndroidBridge?.pedirBateriaSinRestriccion) return;
        if (localStorage.getItem('bateriaPedida')) return;
        try {
            if (window.AndroidBridge.bateriaSinRestriccion?.() !== false) {
                localStorage.setItem('bateriaPedida', '1');
                return;
            }
        } catch (_) { return; }
        // Con un respiro: recién abierta la app hay bastante en pantalla ya
        setTimeout(() => {
            if (localStorage.getItem('bateriaPedida')) return;
            localStorage.setItem('bateriaPedida', '1');
            if (confirm('Para que te lleguen los avisos con la aplicación cerrada '
                + '—los mensajes y los cambios de jornada— el móvil tiene que dejarla '
                + 'funcionar en segundo plano. Por defecto no la deja.\n\n'
                + '¿Lo permites ahora? Es un toque, y no gasta apenas: la aplicación '
                + 'solo mira cada cinco minutos.')) {
                try { window.AndroidBridge.pedirBateriaSinRestriccion(); } catch (_) {}
            }
        }, 3000);
    },

    _pintarAvisoCambio() {
        // La campana cuenta esto también, así que se repinta con el aviso
        this._pintarCampana();
        const el = document.getElementById('cambioJornadaAviso');
        if (!el) return;
        let pend = null;
        try { pend = JSON.parse(localStorage.getItem('cambioJornadaPend') || 'null'); } catch (_) {}
        if (!pend?.texto) { el.style.display = 'none'; return; }
        const txt = document.getElementById('cambioJornadaTxt');
        if (txt) txt.textContent = pend.texto;
        el.classList.toggle('dark', !!this.darkMode);
        el.style.display = 'flex';
    },

    // Se avisa a gestión por donde ya llegan los avisos: una nota. Así le
    // salta en el móvil aunque tenga la app cerrada, y de paso queda dicho por
    // escrito quién se enteró y cuándo.
    async confirmarCambioJornada() {
        let pend = null;
        try { pend = JSON.parse(localStorage.getItem('cambioJornadaPend') || 'null'); } catch (_) {}
        if (!pend?.texto) { this._pintarAvisoCambio(); return; }
        localStorage.removeItem('cambioJornadaPend');
        this._pintarAvisoCambio();
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({
                    texto: `✅ He leído el cambio de jornada: ${pend.texto}`,
                    nombre: this.usuarioActual?.name || '',
                    conductor: this.numConductor || '',
                })
            });
            if (!r.ok) throw new Error(String(r.status));
            const data = await r.json();
            this._notas = [data, ...(this._notas || [])];
            this._renderNotas();
            // Y se queda apuntado para que gestión lo vea como visto en su
            // lista de trabajadores, no solo como una nota más.
            try {
                localStorage.setItem('avisoVisto',
                    JSON.stringify({ clave: pend.clave || '', texto: pend.texto }));
            } catch (_) {}
            this._publicarResumen();
            this._mostrarToast('✅ Gestión ya sabe que lo has leído', 3000);
        } catch (e) {
            // Que no se pierda por un corte de red: vuelve el aviso y se
            // intenta otra vez cuando quiera.
            try { localStorage.setItem('cambioJornadaPend', JSON.stringify(pend)); } catch (_) {}
            this._pintarAvisoCambio();
            this._mostrarToast('❌ No se ha podido avisar a gestión: ' + e.message, 4500);
        }
    },

    // Un cuarto de hora arriba o abajo no es cambiar de horario, es fichar
    // como cualquiera. Es el mismo margen con el que gestión marca los días
    // que no cuadran, para que las dos apps digan lo mismo.
    MARGEN_AVISO: 15,

    // Si lo registrado no cuadra con lo asignado, gestión tiene que enterarse
    // para darlo por bueno o corregirlo. Se avisa por donde ya llegan los
    // avisos —una nota—, así le salta en el móvil aunque tenga la app cerrada.
    async _avisarDesvioAGestion(fechaKey, lugar, inicio, fin) {
        const a = this._asignacionDeHoy();
        if (!a || a.fecha !== fechaKey) return;          // solo de hoy
        const lugarPlan = (a.lugar || '').trim();
        const plan = a.horario || null;
        const cambiaLugar = !!lugarPlan
            && this._clavePuesto(lugarPlan) !== this._clavePuesto(lugar || '');
        const enMin = v => {
            const [h, m] = String(v || '').split(':').map(Number);
            return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
        };
        const dif = (x, y) => {
            const a1 = enMin(x), b1 = enMin(y);
            return (a1 === null || b1 === null) ? 0 : Math.abs(a1 - b1);
        };
        const cambiaHora = !!(plan?.i && plan?.f && inicio && fin)
            && (dif(inicio, plan.i) > this.MARGEN_AVISO || dif(fin, plan.f) > this.MARGEN_AVISO);
        if (!cambiaLugar && !cambiaHora) return;

        // Corregir dos veces la misma jornada no son dos avisos
        const clave = `${fechaKey}|${lugar || ''}|${inicio || ''}-${fin || ''}`;
        if (localStorage.getItem('desvioAvisado') === clave) return;
        localStorage.setItem('desvioAvisado', clave);

        const partes = [];
        if (cambiaLugar) partes.push(`en ${lugar || 'sin lugar'}, y tocaba en ${lugarPlan}`);
        if (cambiaHora)  partes.push(`de ${inicio} a ${fin}, y tocaba de ${plan.i} a ${plan.f}`);
        try {
            await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({
                    texto: `⚠️ He registrado la jornada de hoy ${partes.join(' y ')}. Confírmalo si está bien.`,
                    nombre: this.usuarioActual?.name || '',
                    conductor: this.numConductor || '',
                })
            });
        } catch (_) { /* sin red no se avisa; el desajuste sigue saliendo en gestión */ }
    },

    // La misma huella que guarda la parte nativa, para que las dos hablen de
    // lo mismo: día, lugar y horas.
    _claveJornada(a) {
        const h = (a?.horario?.i && a?.horario?.f) ? `${a.horario.i}–${a.horario.f}` : '';
        // Con el sello de cuándo se asignó: quitarle la jornada y volver a
        // ponerle la misma es un cambio, aunque el antes y el después se
        // parezcan. Sin esto no llegaba ningún aviso.
        return `${a?.fecha || ''}|${a?.lugar || ''}|${h}|${a?.rev || 0}`;
    },

    async _cargarAsignacion() {
        const email = this.usuarioActual?.email;
        if (!email) return;
        try {
            const r = await fetch(`${this.USUARIOS_URL}?mio=${encodeURIComponent(email)}`,
                { cache: 'no-store' });
            if (!r.ok) return;
            const a = await r.json();
            if (!a || !a.fecha) return;
            const antes = this._asignacion;
            this._asignacion = a;
            localStorage.setItem('asignacionHoy', JSON.stringify(a));
            this._avisarCambioDeJornada(antes, a);
            // Lo que ya ha visto la app no se lo tiene que volver a decir el
            // aviso nativo cuando despierte dentro de un rato.
            window.AndroidBridge?.saveToPrefs?.('jornadaVista', this._claveJornada(a));
            this._actualizarCabeceraUsuario();
            // Si lo que propone el formulario ha cambiado, se repinta; si no,
            // se deja en paz por si está a medio rellenar.
            const sel = document.getElementById('lugarJornada');
            if (sel && this._clavePuesto(sel.value) !== this._clavePuesto(this._lugarPropuesto())) {
                this._renderLugarJornada();
            }
        } catch (_) { /* sin red se queda lo último que se supo */ }
    },

    _actualizarCabeceraUsuario() {
        const nom = document.getElementById('cabeceraNombre');
        if (nom) nom.textContent = this.usuarioActual?.name || '';
        const num = document.getElementById('cabeceraNum');
        if (num) num.textContent = this.numConductor || '';
        // Quien lleva la aplicación entra aquí a probarla, y la cabecera lo
        // dice: con tres aplicaciones parecidas abiertas, conviene saber en
        // cuál se está y con qué cuenta.
        const tit = document.getElementById('cabeceraTitulo');
        if (tit) {
            tit.textContent = this._soyElDesarrollador()
                ? '⚙️ Desarrollador EMT - Movilidad' : '🚌 EMT - Movilidad';
        }

        const a = this._asignacionDeHoy();
        const lugar = this._lugarDeHoy();
        const hor = document.getElementById('cabeceraHorario');
        const lug = document.getElementById('cabeceraLugar');
        // De baja, de vacaciones o libre no hay horario que enseñar
        const mudo = a && (a.baja || a.vacaciones || a.libre);
        const horas = !mudo && a?.horario?.i && a?.horario?.f
            ? `${a.horario.i}–${a.horario.f}` : '';
        if (hor) hor.textContent = horas ? `🕒 ${horas}` : '';
        if (lug) {
            lug.textContent = lugar ? (horas ? ` · ${lugar}` : lugar) : '';
            lug.classList.toggle('fuera', !!a?.excepcion);
            lug.title = a?.excepcion ? 'Hoy te toca en otro sitio' : '';
        }
        this._pintarCompaneros();
    },

    // ── Con quién trabajas ───────────────────────────────────────────────────
    // El lugar de la cabecera se pone verde cuando hay alguien más ahí hoy, y
    // al tocarlo se ve quién es.

    COMPANEROS_TTL: 10 * 60 * 1000,

    _claveCompaneros() {
        return `${this._clavePuesto(this._lugarDeHoy())}|${this._hoyISO()}`;
    },

    _companerosEnCache() {
        try {
            const c = JSON.parse(localStorage.getItem('companeros') || 'null');
            if (c && c.clave === this._claveCompaneros() && Date.now() - c.at < this.COMPANEROS_TTL) return c;
        } catch (_) {}
        return null;
    },

    async _cargarCompaneros(forzar) {
        if (!this._lugarDeHoy()) return null;
        const cache = this._companerosEnCache();
        if (cache && !forzar) return cache;
        const resp = await fetch(`${this.USUARIOS_URL}?lugar=${encodeURIComponent(this._lugarDeHoy())}`,
            { cache: 'no-store' });
        if (!resp.ok) throw new Error(resp.status);
        const data = await resp.json();
        const c = { clave: this._claveCompaneros(), at: Date.now(), gente: data.gente || [] };
        localStorage.setItem('companeros', JSON.stringify(c));
        return c;
    },

    // Verde solo si hay alguien más: si va solo, la cabecera no cambia
    _pintarCompaneros() {
        const lug = document.getElementById('cabeceraLugar');
        if (!lug) return;
        const c = this._companerosEnCache();
        // El naranja de "hoy vas a otro sitio" manda sobre el verde
        lug.classList.toggle('juntos', !!c && c.gente.length > 1
            && !lug.classList.contains('fuera'));
        if (!c && this._lugarDeHoy()) {
            this._cargarCompaneros().then(() => this._pintarCompaneros()).catch(() => {});
        }
    },

    async verCompaneros() {
        const donde = this._lugarDeHoy();
        if (!donde) {
            this._mostrarToast('Todavía no tienes lugar de trabajo', 3000);
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, x => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[x]));
        document.getElementById('compTitulo').textContent = `👥 Hoy en ${donde}`;
        document.getElementById('compLista').innerHTML = '<div class="comp-vacio">Cargando…</div>';
        document.getElementById('compModal').classList.add('show');
        if (this.darkMode) document.getElementById('compModalContent').classList.add('dark');
        let c;
        try { c = await this._cargarCompaneros(true); }
        catch (_) {
            document.getElementById('compLista').innerHTML =
                '<div class="comp-vacio">No se ha podido consultar. Inténtalo luego.</div>';
            return;
        }
        this._pintarCompaneros();
        const gente = c.gente || [];
        document.getElementById('compLista').innerHTML = gente.length
            ? gente.map(g => {
                const yo = g.email && this.usuarioActual?.email
                    && g.email.toLowerCase() === this.usuarioActual.email.toLowerCase();
                const h = g.horario;
                return `<div class="comp-fila${yo ? ' yo' : ''}">
                    <span class="comp-num">${esc(g.conductor) || '—'}</span>
                    <span class="comp-nom">${esc(g.nombre) || 'Sin nombre'}${yo ? ' (tú)' : ''}</span>
                    ${h ? `<span class="comp-hora${h.real ? '' : ' plan'}">${esc(h.i)}${
                        h.f ? '–' + esc(h.f) : ''}</span>` : ''}
                </div>`;
            }).join('')
              + (gente.length > 1
                    ? ''
                    : '<div class="comp-vacio">Hoy no hay nadie más aquí.</div>')
            : '<div class="comp-vacio">Hoy no hay nadie asignado aquí.</div>';
    },

    // Record ids are YYYYMMDD for the first entry of a day, then YYYYMMDD-2, -3…
    _nuevoRegistroId(historial, fechaKey) {
        if (!historial[fechaKey]) return fechaKey;
        let n = 2;
        while (historial[`${fechaKey}-${n}`]) n++;
        return `${fechaKey}-${n}`;
    },

    _fechaDeId(id) { return String(id).slice(0, 8); },

    // Horas que cuentan para las anuales. Un festivo trabajado cuenta sus horas
    // como cualquier otro día; uno sin trabajar cuenta como jornada entera.
    //
    // De ahí sale, sin hacer nada especial, lo que marca la ley para la media
    // jornada: trabaja de lunes a viernes, y un festivo en miércoles le deja la
    // semana en 14h trabajadas + 3,5h del festivo = 17,5h, mientras que uno en
    // sábado le suma 3,5h encima de la semana entera = 21h.
    _horasEfectivas(fecha, reg) {
        const h = parseFloat(reg.horas) || 0;
        // Un día de baja sin horas cuenta como jornada hecha contra el objetivo
        if (reg.be && h === 0) return this._horasBaja();
        if (reg.festivo && h === 0) return this.jornadaHoras;
        // Las vacaciones no cuentan como jornada hecha: no acercan al tope
        // anual. Un día de vacaciones sin horas suma cero, que es lo que hace
        // este return de aquí abajo; si además se trabajó, cuentan esas horas.
        return h;
    },

    _hayRegistroEnFecha(fechaKey) {
        return Object.keys(this._historialFull || {}).some(id => this._fechaDeId(id) === fechaKey);
    },

    // Single source of truth for all hour totals, derived from the history
    _calcTotales(historial) {
        let anual = 0, extrasManual = 0, festivo = 0, diasFestivos = 0, diasExtra = 0;
        const completa = this._esJornadaCompleta();
        Object.entries(historial || {}).forEach(([id, r]) => {
            const h = parseFloat(r.horas) || 0;
            // Venir a trabajar un festivo o un libre se cobra como día extra
            // El día extra solo lo cobra la jornada completa: la media jornada
            // no trabaja festivos ni libres, se le descuentan y ya está.
            if (h > 0 && completa && (r.festivo || r.extraDestino === 'extras')) diasExtra++;
            if (r.extraDestino === 'extras') { extrasManual += h; return; }
            const efectivas = this._horasEfectivas(this._fechaDeId(id), r);
            if (r.festivo) { festivo += efectivas; diasFestivos++; }
            anual += efectivas;
        });
        const tope    = this.horasAnualesCustom;
        const topeExt = Math.round(tope * 0.30 * 10) / 10;
        const exceso  = Math.max(0, anual - tope);
        const r1 = n => Math.round(n * 10) / 10;
        return {
            anual:     r1(Math.min(anual, tope)),
            anualReal: r1(anual),
            extras:    r1(extrasManual + exceso),
            topeExtras: topeExt,
            festivo:   r1(festivo),
            diasFestivos,
            diasExtra,
            importeDiasExtra: r1(diasExtra * this.precioFestivoDefault),
            restantes: r1(Math.max(0, tope - anual))
        };
    },

    // Easter Sunday (Meeus/Jones/Butcher algorithm)
    _domingoPascua(year) {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4;
        const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mes = Math.floor((h + l - 7 * m + 114) / 31);
        const dia = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, mes - 1, dia);
    },

    // Holidays for Palma de Mallorca: national + Balearic + local
    _festivosPalma(year) {
        const f = {};
        const key = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const add = (mmdd, nombre) => { f[mmdd] = nombre; };
        // Nacionales
        add('01-01', 'Año Nuevo');
        add('01-06', 'Reyes');
        add('05-01', 'Fiesta del Trabajo');
        add('08-15', 'Asunción');
        add('10-12', 'Fiesta Nacional');
        add('11-01', 'Todos los Santos');
        add('12-06', 'Constitución');
        add('12-08', 'Inmaculada');
        add('12-25', 'Navidad');
        // Baleares
        add('03-01', 'Dia de les Illes Balears');
        add('12-26', 'Sant Esteve');
        // Palma
        add('01-20', 'Sant Sebastià');
        // Móviles (Semana Santa)
        const pascua = this._domingoPascua(year);
        const vSanto = new Date(pascua); vSanto.setDate(pascua.getDate() - 2);
        const lPascua = new Date(pascua); lPascua.setDate(pascua.getDate() + 1);
        add(key(vSanto),  'Viernes Santo');
        add(key(lPascua), 'Lunes de Pascua');
        return f;
    },

    _nombreFestivo(fechaStr) {
        if (!fechaStr) return null;
        const [y, m, d] = fechaStr.split('-');
        return this._festivosPalma(parseInt(y, 10))[`${m}-${d}`] || null;
    },

    comprobarFestivo() {
        const fecha = document.getElementById('fechaInput').value;
        const hint  = document.getElementById('festivoHint');
        const nombre = this._nombreFestivo(fecha);
        if (hint) {
            hint.textContent = nombre ? `· 🎉 ${nombre}` : '';
            hint.style.display = nombre ? 'inline' : 'none';
        }
        if (nombre && !this.festivoActivo) this.clickFestivo(true);
    },

    // Lo mismo en el cuadro de editar: si ese día es festivo, queda marcado
    // solo. Que un día lo sea no depende de acordarse de marcarlo.
    _comprobarFestivoEdit() {
        const f = document.getElementById('editModalFecha')?.value;
        if (!f || !this._nombreFestivo(f)) return;
        const cb = document.getElementById('editModalFestivo');
        if (cb && !cb.checked) { cb.checked = true; this._pintarTogglesEdit(); }
    },


    // Swipe horizontal para cambiar de pestaña. Se ignora si el gesto empieza
    // sobre algo desplazable en horizontal (p. ej. el cuadrante ampliado).
    // Un dedo que empieza sobre algo que se desplaza de lado —las filas de
    // filtros, el cuadrante ampliado— es para mover eso, no para cambiar de
    // pestaña ni de día. Antes se tragaba el gesto y los filtros medio ocultos
    // no había manera de sacarlos.
    _sobreCarrusel(destino, hasta) {
        for (let el = destino; el && el !== hasta && el.nodeType === 1; el = el.parentElement) {
            if (el.scrollWidth - el.clientWidth < 12) continue;
            const desborde = getComputedStyle(el).overflowX;
            if (desborde === 'auto' || desborde === 'scroll') return true;
        }
        return false;
    },


    switchTab(idx) {
        this._activeTab = idx;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.tab, 10) === idx);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'tabPanel' + idx);
        });
        if (idx === 1) { this._cargarCuadrante(); this._renderHistorialModal(); }
        if (idx === 2) this._cargarNotas();
        if (idx === 3) this._cargarMisNominas();
    },

    // El dedo puede arrastrar tanto sobre el orden visual de la barra
    // (puede estar reordenada) como quedarse quieto sobre algo que se
    // desplaza de lado (el propio _sobreCarrusel se encarga de eso).
    _initSwipeTabs() {
        const cont = document.getElementById('appContent');
        if (!cont || cont._swipeTabs) return;
        cont._swipeTabs = true;
        let x0 = 0, y0 = 0, activo = false;
        cont.addEventListener('touchstart', e => {
            if (e.touches.length !== 1 || this._sobreCarrusel(e.target, cont)) { activo = false; return; }
            x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; activo = true;
        }, { passive: true });
        cont.addEventListener('touchend', e => {
            if (!activo) return;
            activo = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - x0, dy = t.clientY - y0;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            const btns = [...document.querySelectorAll('#tabBar .tab-btn')];
            const actualIdx = btns.findIndex(b => b.classList.contains('active'));
            if (actualIdx === -1) return;
            const destino = dx < 0 ? actualIdx + 1 : actualIdx - 1;
            if (destino < 0 || destino >= btns.length) return;
            this.switchTab(parseInt(btns[destino].dataset.tab, 10));
        }, { passive: true });
    },

    _tabDragStart(e) {
        this._dragSrcTab = e.currentTarget;
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.tab);
    },

    _tabDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('drag-over'));
        this._guardarOrdenTabs();
    },

    _guardarOrdenTabs() {
        const orden = [...document.querySelectorAll('#tabBar .tab-btn')].map(b => b.dataset.tab);
        localStorage.setItem('tabOrder', JSON.stringify(orden));
    },

    _restaurarTabs() {
        const bar = document.getElementById('tabBar');
        if (!bar) return;
        try {
            const orden = JSON.parse(localStorage.getItem('tabOrder') || 'null');
            if (Array.isArray(orden)) {
                orden.forEach(t => {
                    const btn = bar.querySelector(`.tab-btn[data-tab="${t}"]`);
                    if (btn) bar.appendChild(btn);
                });
            }
        } catch(_) {}
        // Al abrir la app se empieza siempre en Registro, que es a lo que se
        // entra. Se guardaba la última pestaña y se volvía a ella, así que
        // quien había mirado la nómina o el historial se encontraba eso al
        // abrir y tenía que ir a buscar el registro.
        this.switchTab(0);
    },

    _tabDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
    },

    _tabDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    },

    _tabDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const src = this._dragSrcTab;
        const dst = e.currentTarget;
        if (!src || src === dst) return;
        const bar = document.getElementById('tabBar');
        const tabs = [...bar.children];
        const si = tabs.indexOf(src);
        const di = tabs.indexOf(dst);
        if (si < di) bar.insertBefore(src, dst.nextSibling);
        else bar.insertBefore(src, dst);
        this._guardarOrdenTabs();
    },

    calcularExtra() {
        const hN = parseFloat(document.getElementById('horasNocturnas').value) || 0;
        const precio = parseFloat(document.getElementById('precioNoche').value) || 0;
        document.getElementById('nocheExtra')?.classList.toggle('visible', hN > 0);
        const badge = document.getElementById('horasNocheBadge');
        if (badge) {
            badge.classList.toggle('visible', hN > 0);
            badge.textContent = hN > 0 ? `🌙 ${String(hN).replace('.', ',')}h` : '';
        }
        document.getElementById('nocheResumen').textContent =
            (hN > 0 && precio > 0) ? `Extra: ${hN}h × ${precio}€ = ${(hN * precio).toFixed(2)}€` : '';
    },

    // "No fui a trabajar": ese día no cobra el plus de asistencia, pero las
    // horas puestas siguen contando como jornada efectiva, igual que
    // cualquier otro día.
    sinAsistenciaActivo: false,

    clickSinAsistencia() {
        this.sinAsistenciaActivo = !this.sinAsistenciaActivo;
        document.getElementById('noAsistCompact')?.classList.toggle('active', this.sinAsistenciaActivo);
        const cb = document.getElementById('sinAsistenciaToggle');
        if (cb) cb.checked = this.sinAsistenciaActivo;
        // No haber ido es un día sin horas, igual que vacaciones o una baja:
        // se ponen a cero solas en vez de tener que borrarlas a mano.
        if (!this.sinAsistenciaActivo) {
            // Al desmarcarlo se recuperan las horas que salen del horario: se
            // habían puesto a cero al marcarlo y se quedaban así, con lo que
            // registrar después la jornada de verdad daba cero horas.
            this.calcularHorasPorTiempo?.();
        }
        if (this.sinAsistenciaActivo) {
            const h = document.getElementById('horasInput');
            if (h) h.value = '0';
            this.calcularExtra?.();
            // Y no es un día de PR, ni de vacaciones, ni de baja, ni de horas
            // extras: lo que estuviera marcado se quita y lo demás se apaga.
            if (this.prActivo)        this.clickPrCompact(true);
            if (this.extraActivo)     this.clickExtra(true);
            if (this.vacacionesActivo) this.clickVacaciones(true);
            if (this.bajaActiva)      this.clickBe(true);
        }
        this._pintarBloqueoToggles();
    },

    // El festivo sigue marcándose solo cuando la fecha lo es, así que los
    // apagados solo valen para los toques a mano: el que llama desde dentro
    // pasa `auto` y no se le bloquea.
    _pintarBloqueoToggles() {
        const no = !!this.sinAsistenciaActivo;
        ['prCompact', 'festivoCompact', 'extraCompact', 'vacacionesCompact', 'beCompact']
            .forEach(id => document.getElementById(id)?.classList.toggle('bloqueado', no));
    },

    calcularExtraModal() {
        const hN = parseFloat(document.getElementById('editModalNocturnas').value) || 0;
        const precio = parseFloat(document.getElementById('editModalPrecioN').value) || 0;
        document.getElementById('editModalExtraLabel').textContent =
            (hN > 0 && precio > 0) ? `+${(hN * precio).toFixed(2)}€ extra nocturno` : '';
    },

    calcularHorasModalPorTiempo() {
        const inicio = document.getElementById('editModalInicio').value;
        const fin    = document.getElementById('editModalFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('editModalHoras').value = horas;
        const nocturnas = this._calcHorasNocturnas(inicio, fin);
        document.getElementById('editModalNocturnas').value = nocturnas || '';
        if (nocturnas > 0 && this.precioNocheDefault > 0 && !document.getElementById('editModalPrecioN').value)
            document.getElementById('editModalPrecioN').value = this.precioNocheDefault;
        this.calcularExtraModal();
        this._renderTramosEdit();
    },

    guardarUltimaHoraInicio() { const val = document.getElementById('horaInicio').value; if (val) { localStorage.setItem('lastHoraInicio', val); this._guardarPreferencias(); } },
    guardarUltimaHoraFin()    { const val = document.getElementById('horaFin').value;    if (val) { localStorage.setItem('lastHoraFin', val);    this._guardarPreferencias(); } },

    guardarSonidoNotif(sound) {
        this.notifSound = sound;
        localStorage.setItem('notifSound', sound);
        window.AndroidBridge?.saveToPrefs('notifSound', sound);
        this._guardarPreferencias();
        this._previewNotifSound(sound);
    },

    _previewNotifSound(sound) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const bell = (freq, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.value = freq;
                g.gain.setValueAtTime(0.55, t0);
                g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur + 0.05);
            };
            const tone = (freq, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.value = freq;
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.5, t0 + 0.012);
                g.gain.linearRampToValueAtTime(0.5, t0 + dur - 0.07);
                g.gain.linearRampToValueAtTime(0, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur);
            };
            const sweep = (f1, f2, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.setValueAtTime(f1, t0);
                osc.frequency.linearRampToValueAtTime(f2, t0 + dur);
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.45, t0 + 0.02);
                g.gain.linearRampToValueAtTime(0.45, t0 + dur - 0.08);
                g.gain.linearRampToValueAtTime(0, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur);
            };
            const t = ctx.currentTime + 0.05;
            switch (sound) {
                case 'notif_ding':    bell(880, t, 1.0); break;
                case 'notif_campana': bell(660, t, 0.5); bell(880, t + 0.42, 0.75); break;
                case 'notif_alerta':  tone(440, t, 0.20); tone(660, t+0.25, 0.20); tone(880, t+0.50, 0.30); break;
                case 'notif_silbido': sweep(800, 1400, t, 0.42); sweep(1400, 800, t+0.40, 0.38); break;
                case 'notif_doble':   tone(880, t, 0.30); tone(880, t+0.42, 0.30); break;
                case 'notif_fanfare': tone(440, t, 0.20); tone(550, t+0.22, 0.20); tone(660, t+0.44, 0.20); bell(880, t+0.66, 0.60); break;
                case 'notif_suave':   bell(330, t, 1.2); break;
                default:              bell(880, t, 0.7);
            }
        } catch(_) {}
    },

    limpiarInput() {
        // Limpiar desmarca todo y recupera el horario del día anterior. No debe
        // reabrir el cajón nocturno aunque ese horario lo sea. El festivo se
        // desmarca como los demás; si la fecha es festiva de verdad, vuelve a
        // marcarse solo un poco más abajo.
        this.establecerFechaHoy();
        this._ocultarRangoFechas();
        const lastInicio = localStorage.getItem('lastHoraInicio') || '';
        const lastFin    = localStorage.getItem('lastHoraFin') || '';
        document.getElementById('horaInicio').value = lastInicio;
        document.getElementById('horaFin').value    = lastFin;
        document.getElementById('nocheExtra').classList.remove('visible');
        document.getElementById('horasNocturnas').value = '';
        document.getElementById('precioNoche').value    = '';
        document.getElementById('nocheResumen').textContent = '';
        const badge = document.getElementById('horasNocheBadge');
        if (badge) { badge.classList.remove('visible'); badge.textContent = ''; }
        this.sinAsistenciaActivo = false;
        document.getElementById('noAsistCompact')?.classList.remove('active');
        const nat = document.getElementById('sinAsistenciaToggle'); if (nat) nat.checked = false;
        this.prActivo = false;
        document.getElementById('prCompact').classList.remove('active');
        document.getElementById('prToggle').checked = false;
        this.vacacionesActivo = false;
        document.getElementById('vacacionesCompact')?.classList.remove('active');
        const vt = document.getElementById('vacacionesToggle'); if (vt) vt.checked = false;
        this.extraActivo = false;
        document.getElementById('extraCompact')?.classList.remove('active');
        const et = document.getElementById('extraToggle'); if (et) et.checked = false;
        document.getElementById('extraPanel')?.classList.remove('visible');
        this.bajaActiva = false;
        document.getElementById('beCompact')?.classList.remove('active');
        const bt = document.getElementById('beToggle'); if (bt) bt.checked = false;
        this._tramos = [];
        this._renderLugarJornada();
        // Horas del horario recuperado, sin activar nada nocturno
        document.getElementById('horasInput').value = (lastInicio && lastFin)
            ? this._horasEntre(lastInicio, lastFin) : '';
        this.festivoActivo = false;
        document.getElementById('festivoCompact').classList.remove('active');
        document.getElementById('festivoToggle').checked = false;
        this.comprobarFestivo();                 // vuelve a marcarlo si la fecha es festiva
        this._pintarBloqueoToggles();
    },

    _horasEntre(inicio, fin) {
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        return Math.round(mins / 60 * 2) / 2;
    },

    cancelarEdicion() { this.editingId = null; this.limpiarInput(); },

    mostrarHistorialModal() {
        this.switchTab(1);
        this._renderHistorialModal();
    },

    _mesesColapsados: new Set(JSON.parse(localStorage.getItem('mesesColapsados') || '[]')),

    _toggleMes(mesKey) {
        if (this._mesesColapsados.has(mesKey)) this._mesesColapsados.delete(mesKey);
        else this._mesesColapsados.add(mesKey);
        localStorage.setItem('mesesColapsados', JSON.stringify([...this._mesesColapsados]));
        this._renderHistorialModal();
    },

    _renderHistorialModal() {
        const list = document.getElementById('historialModalList');
        list.innerHTML = '';
        const registros = Object.entries(this._historialMap).sort((a, b) => b[1].timestamp - a[1].timestamp);
        if (registros.length === 0) {
            list.innerHTML = '<li style="text-align:center;padding:24px;color:#95a5a6;font-size:13px;">Sin registros</li>';
            return;
        }
        let mesActual = null;
        registros.forEach(([id, reg]) => {
            // Month separator
            const d = new Date(reg.timestamp);
            const mesKey = `${d.getFullYear()}-${d.getMonth()}`;
            if (mesKey !== mesActual) {
                mesActual = mesKey;
                const delMes = registros
                    .filter(([, r]) => { const x = new Date(r.timestamp); return `${x.getFullYear()}-${x.getMonth()}` === mesKey; });
                const totMes = delMes.reduce((s, [, r]) => s + (parseFloat(r.horas) || 0), 0);
                const nocMes = delMes.reduce((s, [, r]) => s + (parseFloat(r.horasNocturnas) || 0), 0);
                const mesesCalc = this._calcTodosMeses(this._historialMap);
                const extMes = mesesCalc[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`]?.horasExtras || 0;
                const cab = document.createElement('li');
                cab.className = 'hm-mes';
                cab.dataset.mes = mesKey;
                const colapsado = this._mesesColapsados.has(mesKey);
                const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
                cab.innerHTML = `<span class="hm-mes-chev">${colapsado ? '▸' : '▾'}</span>`
                    + `<span class="hm-mes-n">${MESES_ES[d.getMonth()]} ${d.getFullYear()}</span>`
                    + `<span class="hm-mes-tot">`
                    + (extMes > 0 ? `<span class="hm-mes-ext">⏱️${r1(extMes)}h</span>` : '')
                    + (nocMes > 0 ? `<span class="hm-mes-noc">🌙${r1(nocMes)}h</span>` : '')
                    + `${r1(totMes)}h`
                    + `<span class="hm-mes-c">${delMes.length}</span></span>`;
                cab.addEventListener('click', () => this._toggleMes(mesKey));
                list.appendChild(cab);
            }
            if (this._mesesColapsados.has(mesKey)) return;
            const li = document.createElement('li');
            // Colored left stripe: festivo > extra > nocturno > PR
            let stripeClass = '';
            if (reg.vacaciones) stripeClass = 'hm-stripe-vacaciones';
            else if (reg.festivo) stripeClass = 'hm-stripe-festivo';
            else if (reg.extraManual) stripeClass = 'hm-stripe-extra';
            else if (reg.horasNocturnas) stripeClass = 'hm-stripe-noche';
            else if (reg.pr) stripeClass = 'hm-stripe-pr';
            li.className = stripeClass;
            li.style.cssText = 'padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #efefef;gap:8px;';
            const nocheStr = reg.horasNocturnas
                ? `<div style="font-size:10px;color:#856404;font-weight:600;">🌙 ${reg.horasNocturnas}h noct. · +${(reg.extraNoche||0).toFixed(2)}€</div>` : '';
            const horario = (reg.horaInicio && reg.horaFin)
                ? `<span style="color:#95a5a6;font-size:10px;font-style:italic;">${reg.horaInicio}–${reg.horaFin}</span>` : '';
            // Las jornadas viejas no lo llevan guardado: se usa el lugar actual
            const lugar = reg.puesto || this.puestoTrabajo;
            const lugarStr = lugar
                ? `<span style="color:var(--g1);font-size:10px;font-weight:700;">${lugar}</span>` : '';
            // Un día repartido entre varios sitios enseñaba solo el primero, y
            // el resto de la jornada no aparecía por ningún lado.
            const tramos = Array.isArray(reg.tramos) ? reg.tramos.filter(t => t && t.i && t.o) : [];
            const tramosStr = tramos.length > 1
                ? `<div class="hm-tramos">${tramos.map(t =>
                    `<span>📍 ${t.p ? String(t.p).replace(/</g, '&lt;') : 'sin lugar'} ${t.i}–${t.o}</span>`).join('')}</div>` : '';
            const prBadge     = reg.pr      ? `<span class="pr-badge">PR</span>` : '';
            const festivoBadge= reg.festivo ? `<span class="festivo-badge">🎉 Festivo</span>` : '';
            const vacBadge    = reg.vacaciones ? `<span class="vacaciones-badge">🏖️ Vacaciones</span>` : '';
            const beBadge     = reg.be ? `<span class="be-badge">🩺 BE ${
                String(this._horasBaja()).replace('.', ',')}h</span>` : '';
            const extraBadge  = reg.extraManual
                ? `<span class="extra-badge">⏱️ ${reg.extraDestino === 'extras' ? 'Extra' : 'Anual'}</span>` : '';
            li.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="color:#7f8c8d;font-weight:700;font-size:12px;">${reg.fecha}</span>
                        ${horario}
                        <span style="background:linear-gradient(135deg,var(--g1),var(--g2));color:white;padding:3px 9px;border-radius:20px;font-weight:700;font-size:10px;">${reg.horas}h</span>
                        ${lugarStr}
                        ${prBadge}${festivoBadge}${extraBadge}${vacBadge}${beBadge}
                    </div>
                    ${tramosStr}
                    ${nocheStr}
                    ${reg.nota ? `<div class="hm-nota-txt">📝 ${reg.nota.replace(/</g,'&lt;')}</div>` : ''}
                </div>
                <div style="display:flex;gap:5px;flex-shrink:0;">
                    <button class="hm-nota" style="background:${reg.nota ? '#f39c12' : '#95a5a6'};color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">📝</button>
                    <button class="hm-edit" style="background:#3498db;color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">✏️</button>
                    <button class="hm-del"  style="background:#e74c3c;color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">×</button>
                </div>`;
            li.querySelector('.hm-nota').addEventListener('click', () => this.editarNota(id));
            li.querySelector('.hm-edit').addEventListener('click', () => {
                this.editarRegistro(id);
            });
            li.querySelector('.hm-del').addEventListener('click', () => this.borrarRegistro(id));
            list.appendChild(li);
        });
    },

    async editarNota(id) {
        const reg = this._historialMap[id];
        if (!reg) return;
        const v = prompt(`Nota para la jornada del ${reg.fecha}:\n\n(déjala vacía para borrarla)`, reg.nota || '');
        if (v === null) return;
        const nota = v.trim().slice(0, 300);
        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            if (!datos.historial?.[id]) { this._mostrarToast('❌ No se encontró la jornada', 3000); return; }
            if (nota) datos.historial[id].nota = nota;
            else delete datos.historial[id].nota;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
            this._renderHistorialModal();
            this._mostrarToast(nota ? '✅ Nota guardada' : 'Nota borrada', 2500);
        } catch (e) {
            this._mostrarToast('❌ Error al guardar la nota', 3000);
        }
    },

    // Cerrar el cuadro sin guardar deja de contar como editar
    cerrarEdicion() {
        this.editingId = null;
        this._tramosEdit = [];
        document.getElementById('editModal').classList.remove('show');
    },

    // Los mismos seis de la pantalla de registrar. Se pintan a mano porque el
    // cuadro no reusa los de allí: allí guardan estado en la app y aquí solo
    // valen para el registro que se está tocando.
    _CUADROS_EDIT: [
        ['SinAsistencia', 'editNoAsistCompact'],
        ['PR',            'editPrCompact'],
        ['Festivo',       'editFestivoCompact'],
        ['Extra',         'editExtraCompact'],
        ['Vacaciones',    'editVacCompact'],
        ['Be',            'editBeCompact'],
    ],

    _toggleEdit(nombre) {
        const el = document.getElementById('editModal' + nombre);
        if (!el) return;
        // Igual que al registrar: si no se fue a trabajar, lo demás no se toca
        const noFue = document.getElementById('editModalSinAsistencia')?.checked;
        if (noFue && nombre !== 'SinAsistencia') return;
        el.checked = !el.checked;
        if (nombre === 'SinAsistencia' && el.checked) {
            ['PR', 'Extra', 'Vacaciones', 'Be'].forEach(n => {
                const otro = document.getElementById('editModal' + n);
                if (otro) otro.checked = false;
            });
        }
        // Vacaciones y baja son días sin jornada: se ponen las horas a cero,
        // igual que al registrar.
        if (el.checked && (nombre === 'Vacaciones' || nombre === 'Be' || nombre === 'SinAsistencia')) {
            const h = document.getElementById('editModalHoras');
            if (h) h.value = '0';
        } else if (!el.checked && nombre === 'SinAsistencia') {
            // Desmarcarlo devuelve las horas del horario, que se habían puesto
            // a cero al marcarlo y se quedaban así.
            this.calcularHorasModalPorTiempo?.();
        }
        this._pintarTogglesEdit();
    },

    _pintarTogglesEdit() {
        const noFue = !!document.getElementById('editModalSinAsistencia')?.checked;
        this._CUADROS_EDIT.forEach(([nombre, cuadro]) => {
            const el = document.getElementById('editModal' + nombre);
            const c  = document.getElementById(cuadro);
            if (!el || !c) return;
            c.classList.toggle('active', el.checked);
            c.classList.toggle('bloqueado', noFue && nombre !== 'SinAsistencia');
        });
        const extra = document.getElementById('editModalExtra')?.checked;
        document.getElementById('editExtraPanel')?.classList.toggle('visible', !!extra);
        const lbl = document.getElementById('editExtraOptAnual');
        if (lbl) lbl.textContent = this.horasAnualesCustom + 'h';
    },

    editarRegistro(id) {
        const reg = this._historialMap[id];
        if (!reg) return;
        this.editingId = id;
        const f = this._fechaDeId(id);
        const fecha = `${f.slice(0,4)}-${f.slice(4,6)}-${f.slice(6,8)}`;
        document.getElementById('editModalFecha').value    = fecha;
        document.getElementById('editModalHoras').value    = reg.horas;
        document.getElementById('editModalInicio').value   = reg.horaInicio || '';
        document.getElementById('editModalFin').value      = reg.horaFin    || '';
        document.getElementById('editModalNocturnas').value= reg.horasNocturnas || '';
        document.getElementById('editModalPrecioN').value  = reg.precioNoche    || '';
        document.getElementById('editModalExtraLabel').textContent =
            reg.horasNocturnas ? `+${(reg.extraNoche || 0).toFixed(2)}€ extra nocturno` : '';
        document.getElementById('editModalPR').checked = !!reg.pr;
        document.getElementById('editModalFestivo').checked = !!reg.festivo;
        document.getElementById('editModalExtra').checked = !!reg.extraManual;
        document.getElementById('editModalVacaciones').checked = !!reg.vacaciones;
        document.getElementById('editModalBe').checked = !!reg.be;
        document.getElementById('editModalSinAsistencia').checked = !!reg.sinAsistencia;
        const dest = document.querySelector(
            `input[name="editExtraDestino"][value="${reg.extraDestino === 'extras' ? 'extras' : 'anual'}"]`);
        if (dest) dest.checked = true;
        this._comprobarFestivoEdit();
        this._pintarTogglesEdit();
        const selLugar = document.getElementById('editModalLugar');
        if (selLugar) selLugar.innerHTML = this._opcionesLugar(reg.puesto || '');
        // Si la jornada tenía más de un lugar, aquí es donde se pierdían al
        // editar: el cuadro no los pintaba y guardar los borraba.
        this._tramosEdit = Array.isArray(reg.tramos) ? reg.tramos.map(t => ({ ...t })) : [];
        this._renderTramosEdit();
        document.getElementById('editModal').classList.add('show');
        if (this.darkMode) document.getElementById('editModalContent').classList.add('dark');
    },

    // El cuadro de horas extras empieza mirando el año, y el de nocturnas el
    // mes; tocarlos alterna al otro periodo, y vuelve a tocarlos, al de antes.
    _vistaStatExtra: 'anio',
    _vistaStatNoct: 'mes',

    _toggleStatExtra() {
        this._vistaStatExtra = this._vistaStatExtra === 'anio' ? 'mes' : 'anio';
        this._renderStatsExtraNoct();
    },

    _toggleStatNoct() {
        this._vistaStatNoct = this._vistaStatNoct === 'mes' ? 'anio' : 'mes';
        this._renderStatsExtraNoct();
    },

    _horasNocturnasAnuales(historial) {
        let h = 0;
        Object.values(historial || {}).forEach(r => { h += parseFloat(r.horasNocturnas) || 0; });
        return Math.round(h * 10) / 10;
    },

    _renderStatsExtraNoct() {
        const historial = this._historialFull || {};
        const t = this._calcTotales(historial);
        const ahora = new Date();
        const key = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
        const mes = this._calcTodosMeses(historial)[key] || { nocturnas: 0, horasExtras: 0 };

        const elE  = document.getElementById('statExtras');
        const elES = document.getElementById('statExtrasSub');
        if (this._vistaStatExtra === 'anio') {
            if (elE) elE.textContent = t.extras.toFixed(1);
            if (elES) {
                const importe = this.precioExtraDefault > 0
                    ? ` · ${(t.extras * this.precioExtraDefault).toFixed(2)}€` : '';
                elES.textContent = `de ${t.topeExtras.toFixed(1)}h${importe}`;
            }
        } else {
            if (elE) elE.textContent = mes.horasExtras.toFixed(1);
            if (elES) {
                const importe = this.precioExtraDefault > 0
                    ? ` · ${(mes.horasExtras * this.precioExtraDefault).toFixed(2)}€` : '';
                elES.textContent = `este mes${importe}`;
            }
        }

        const elN  = document.getElementById('statMesNoche');
        const elNS = document.getElementById('statMesNocheSub');
        if (this._vistaStatNoct === 'mes') {
            if (elN) elN.textContent = mes.nocturnas.toFixed(1);
            if (elNS) elNS.textContent = 'horas este mes';
        } else {
            if (elN) elN.textContent = this._horasNocturnasAnuales(historial).toFixed(1);
            if (elNS) elNS.textContent = 'horas del año';
        }
    },

    _calcMesStats(historial, año, mes) {
        const entries = Object.values(historial).filter(r => {
            const d = new Date(r.timestamp);
            return d.getFullYear() === año && d.getMonth() + 1 === mes;
        });
        return {
            horas:     Math.round(entries.reduce((s, r) => s + r.horas, 0) * 10) / 10,
            nocturnas: Math.round(entries.reduce((s, r) => s + (r.horasNocturnas || 0), 0) * 10) / 10,
            extra:     Math.round(entries.reduce((s, r) => s + (r.extraNoche || 0), 0) * 100) / 100,
            dias:      entries.length
        };
    },

    _calcTodosMeses(historial) {
        const meses = {};
        // Chronological pass: hours past the annual cap are overtime, and this is
        // the only way to attribute them to the month they actually happened in.
        const orden = Object.entries(historial || {})
            .filter(([, r]) => r.timestamp)
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .map(([id, r]) => ({ ...r, _fecha: this._fechaDeId(id) }));
        const tope = this.horasAnualesCustom;
        let acumulado = 0;
        orden.forEach(reg => {
            const d   = new Date(reg.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!meses[key]) meses[key] = { horas:0, nocturnas:0, extra:0, horasExtras:0, dias:0, label:'', año:d.getFullYear(), mes:d.getMonth()+1 };
            const h = parseFloat(reg.horas) || 0;
            let extrasReg;
            if (reg.extraDestino === 'extras') {
                extrasReg = h;                       // marked as overtime by hand
            } else {
                const efectivas = this._horasEfectivas(reg._fecha, reg);
                const cabe = Math.max(0, tope - acumulado);
                extrasReg = Math.max(0, efectivas - cabe);
                acumulado += efectivas;
            }
            meses[key].horas       = Math.round((meses[key].horas     + h) * 10) / 10;
            meses[key].nocturnas   = Math.round((meses[key].nocturnas + (reg.horasNocturnas||0)) * 10) / 10;
            meses[key].extra       = Math.round((meses[key].extra     + (reg.extraNoche||0)) * 100) / 100;
            meses[key].horasExtras = Math.round((meses[key].horasExtras + extrasReg) * 10) / 10;
            meses[key].dias++;
            meses[key].label = `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
        });
        return meses;
    },

    actualizarUI(datos) {
        this._historialFull = datos.historial || {};
        // El aviso nativo corre con la app cerrada y no puede mirar aquí, así
        // que se le deja escrito en qué lugares ya se ha registrado hoy.
        this._publicarLugaresHoy();
        const t         = this._calcTotales(this._historialFull);
        const horas     = t.anual;
        const restantes = t.restantes;
        const pct       = (t.anualReal / this.horasAnualesCustom) * 100;
        // Ocultar el banner de proximidad si ya hay registro hoy
        const _todayId = this._hoyId();
        if (this._hayRegistroEnFecha(_todayId)) {
            document.getElementById('workBanner')?.classList.remove('show');
            localStorage.setItem('lastRegisteredDate', _todayId);
        }
        document.getElementById('horasTrabajadas').textContent = horas.toFixed(1);
        document.getElementById('horasRestantes').textContent  = restantes.toFixed(1);
        document.getElementById('porcentaje').textContent = Math.min(Math.round(pct), 100);
        document.getElementById('progressFill').style.width = Math.min(pct, 100) + '%';
        if (pct >= 100) document.getElementById('progressFill').style.background = 'linear-gradient(90deg,#27ae60,#229954)';
        // Festivos
        const pctExt = t.topeExtras > 0 ? (t.extras / t.topeExtras) * 100 : 0;
        const elF = document.getElementById('statFestivos');
        const elFS= document.getElementById('statFestivosSub');
        if (elF)  elF.textContent  = t.festivo.toFixed(1);
        if (elFS) {
            const dias = t.diasFestivos === 1 ? '1 día festivo' : `${t.diasFestivos} días festivos`;
            elFS.textContent = t.importeDiasExtra > 0
                ? `${dias} · ${t.diasExtra} día${t.diasExtra === 1 ? '' : 's'} extra: ${t.importeDiasExtra.toFixed(2)}€`
                : dias;
        }
        const barExt = document.getElementById('progressFillExtra');
        if (barExt) barExt.style.width = Math.min(pctExt, 100) + '%';
        this._actualizarPrUI();
        const pctExtEl = document.getElementById('porcentajeExtra');
        if (pctExtEl) pctExtEl.textContent = Math.min(Math.round(pctExt), 100);
        const ahora = new Date();
        const mesStats = this._calcMesStats(this._historialFull, ahora.getFullYear(), ahora.getMonth() + 1);
        const elMesH = document.getElementById('statMesHoras');
        if (elMesH) elMesH.textContent = mesStats.horas.toFixed(1);
        this._renderStatsExtraNoct();
        this._renderMensual(this._historialFull);
        this.actualizarHistorial(datos.historial || {});
        if (datos.prefs?.horaInicio && !localStorage.getItem('lastHoraInicio')) {
            localStorage.setItem('lastHoraInicio', datos.prefs.horaInicio);
            document.getElementById('horaInicio').value = datos.prefs.horaInicio;
        }
        if (datos.prefs?.horaFin && !localStorage.getItem('lastHoraFin')) {
            localStorage.setItem('lastHoraFin', datos.prefs.horaFin);
            document.getElementById('horaFin').value = datos.prefs.horaFin;
            if (datos.prefs.horaInicio) this.calcularHorasPorTiempo();
        }
    },

    actualizarHistorial(historial) {
        this._historialMap = {};
        Object.entries(historial).forEach(([id, reg]) => { this._historialMap[id] = reg; });
        const count = Object.keys(historial).length;
        const badge = document.getElementById('historialCount');
        if (badge) badge.textContent = count > 0 ? `${count} registros` : 'Sin registros';
    },


    // ── Cuadrante ────────────────────────────────────────────────────────────

    CUADRANTE_URL: 'https://emt-palma-movilidad.vercel.app/api/cuadrante',

    async _cargarCuadrante() {
        // El propio primero —si ha subido uno, es el que quiere ver—, y si no
        // hay, el que haya publicado gestión.
        let data = null;
        if (this.usuarioActual?.email && await this._ensureToken()) {
            try {
                const rp = await fetch(`${this.CUADRANTE_URL}?mio=1`, {
                    cache: 'no-store',
                    headers: { Authorization: `Bearer ${this.accessToken}` },
                });
                if (rp.ok) {
                    const p = await rp.json();
                    if (p?.imagen) data = p;
                }
            } catch (_) {}
        }
        try {
            // El de gestión se pide siempre, aunque ya se tenga uno propio: es
            // el que hay que mirar para saber si han publicado uno nuevo.
            let dePlantilla = null;
            const resp = await fetch(this.CUADRANTE_URL, { cache: 'no-store' });
            if (resp.ok) dePlantilla = await resp.json();
            this._avisarCuadranteNuevo(dePlantilla);
            if (!data) data = dePlantilla;
            this._pintarCuadrante(data);
            if (data?.imagen) localStorage.setItem('cuadranteCache', JSON.stringify(data));
        } catch (_) {
            // Offline: fall back to the last one we saw
            try {
                const cache = JSON.parse(localStorage.getItem('cuadranteCache') || 'null');
                if (cache) this._pintarCuadrante(cache);
            } catch (__) {}
        }
    },

    // Cuando gestión publica el cuadrante del mes, que se entere. La primera
    // vez no avisa de nada: se apunta lo que hay y a partir de ahí, lo nuevo.
    _avisarCuadranteNuevo(data) {
        // En el móvil de esto se encarga la parte nativa, que es la que sigue
        // mirando con la app cerrada. Llevar aquí la cuenta de lo ya avisado
        // solo serviría para pisarle la suya: si la app abre antes de que le
        // toque mirar, se daría por avisado algo que nadie ha avisado.
        if (window.AndroidBridge) return;
        const cuando = data?.publicadoPor ? (data.actualizado || '') : '';
        if (!cuando) return;
        const visto = localStorage.getItem('cuadranteVisto') || '';
        localStorage.setItem('cuadranteVisto', cuando);
        if (!visto || cuando <= visto) return;
        const texto = 'Ya está el cuadrante del mes. Míralo en Historial.';
        this._mostrarToast('🗓️ ' + texto, 6000);
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.schedule) return;
        try {
            LN.schedule({ notifications: [{
                id: 2102,
                title: 'Cuadrante del mes publicado',
                body: texto,
                smallIcon: 'ic_stat_chat',
            }] });
        } catch (_) { /* queda el aviso de la pantalla */ }
    },

    _pintarCuadrante(data) {
        const img   = document.getElementById('cuadImg');
        const vacio = document.getElementById('cuadVacio');
        const fecha = document.getElementById('cuadFecha');
        const hay = !!(data && data.imagen);
        if (img)   { img.style.display = hay ? 'block' : 'none'; if (hay) img.src = data.imagen; }
        if (vacio) vacio.style.display = hay ? 'none' : 'flex';
        if (fecha) {
            // La fecha solo tiene sentido para el que ha publicado gestión;
            // el que ha subido cada uno para sí mismo no la lleva.
            fecha.textContent = hay && data.publicadoPor && data.actualizado
                ? new Date(data.actualizado).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
                : '';
        }
    },

    async _onCuadranteFileElegido(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('❌ Elige una imagen'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = async () => {
                const MAX = 1400;
                const escala = Math.min(1, MAX / Math.max(img.width, img.height));
                const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                let calidad = 0.82, dataUrl = canvas.toDataURL('image/jpeg', calidad);
                while (dataUrl.length > 430 * 1024 && calidad > 0.35) {
                    calidad -= 0.12;
                    dataUrl = canvas.toDataURL('image/jpeg', calidad);
                }
                if (dataUrl.length > 430 * 1024) { alert('❌ La imagen sigue siendo muy grande'); return; }
                try {
                    if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
                    const resp = await fetch(`${this.CUADRANTE_URL}?mio=1`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imagen: dataUrl, nombre: file.name }),
                    });
                    const data = await resp.json();
                    if (!resp.ok) { alert('❌ ' + (data.error || resp.status)); return; }
                    this._pintarCuadrante(data);
                    localStorage.setItem('cuadranteCache', JSON.stringify(data));
                    this._mostrarToast?.('✅ Cuadrante subido', 2500);
                } catch (err) {
                    alert('❌ No se pudo subir: ' + err.message);
                }
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    },

    // ── El cuadrante en grande ───────────────────────────────────────────────
    // Ampliar con dos dedos y moverse por la imagen no salía gratis: el visor
    // va sobre una capa fija, y sobre eso el navegador no aplica su propio
    // zoom. Lo que había —una clase que ponía la imagen al 260 % y confiaba en
    // el scroll de la caja— no respondía al pellizco y, con la caja centrada,
    // tampoco dejaba llegar al borde de arriba ni al de la izquierda. Así que
    // el gesto se lleva aquí: pellizco, arrastre y doble toque, moviendo la
    // imagen con transform.
    _cuadZoom: null,

    verCuadranteGrande() {
        const img = document.getElementById('cuadImg');
        if (!img?.src) return;
        document.getElementById('cuadVisorImg').src = img.src;
        document.getElementById('cuadVisor').classList.add('show');
        this._montarVisorCuadrante();
        this._cuadPoner(1, 0, 0);
    },

    cerrarCuadranteGrande() {
        document.getElementById('cuadVisor')?.classList.remove('show');
        this._cuadPoner(1, 0, 0);
    },

    // Deja la imagen donde toca, sin salirse: ampliada se puede arrastrar lo
    // que sobra por cada lado y ni un pixel más; a tamaño normal va centrada.
    _cuadPoner(k, x, y) {
        const img = document.getElementById('cuadVisorImg');
        const visor = document.getElementById('cuadVisor');
        if (!img || !visor) return;
        const z = this._cuadZoom = this._cuadZoom || {};
        z.k = Math.min(6, Math.max(1, k));
        const sobraX = Math.max(0, (img.clientWidth  * z.k - visor.clientWidth)  / 2);
        const sobraY = Math.max(0, (img.clientHeight * z.k - visor.clientHeight) / 2);
        z.x = Math.min(sobraX, Math.max(-sobraX, x));
        z.y = Math.min(sobraY, Math.max(-sobraY, y));
        img.style.transform =
            `translate(-50%, -50%) translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.k.toFixed(3)})`;
        const ayuda = document.getElementById('cuadVisorAyuda');
        if (ayuda) ayuda.textContent = z.k > 1.02
            ? 'Arrastra para moverte · doble toque para reducir'
            : 'Pellizca o haz doble toque para ampliar';
    },

    _montarVisorCuadrante() {
        const visor = document.getElementById('cuadVisor');
        const img = document.getElementById('cuadVisorImg');
        if (!visor || !img || visor.dataset.montado) return;
        visor.dataset.montado = '1';
        this._cuadZoom = { k: 1, x: 0, y: 0 };

        const dedos = e => [...e.touches];
        const separacion = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const centro = t => t.length > 1
            ? { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 }
            : { x: t[0].clientX, y: t[0].clientY };
        // El punto que se toca, medido desde el centro del visor: es el que
        // tiene que quedarse quieto mientras se pellizca.
        const relativo = p => {
            const c = visor.getBoundingClientRect();
            return { x: p.x - (c.left + c.width / 2), y: p.y - (c.top + c.height / 2) };
        };

        let sep0 = 0, k0 = 1, ancla = null, desde = null, movido = 0, ultimoToque = 0;

        visor.addEventListener('touchstart', e => {
            const t = dedos(e);
            const z = this._cuadZoom;
            movido = 0;
            if (t.length === 2) {
                sep0 = separacion(t) || 1;
                k0 = z.k;
                const c = relativo(centro(t));
                // Dónde cae ese punto dentro de la imagen, con el aumento de
                // ahora: es lo que hay que respetar al cambiarlo.
                ancla = { pantalla: c, img: { x: (c.x - z.x) / z.k, y: (c.y - z.y) / z.k } };
                e.preventDefault();
            } else if (t.length === 1) {
                desde = { x: t[0].clientX - z.x, y: t[0].clientY - z.y };
            }
        }, { passive: false });

        visor.addEventListener('touchmove', e => {
            const t = dedos(e);
            const z = this._cuadZoom;
            if (t.length === 2 && ancla) {
                const k = k0 * (separacion(t) / sep0);
                const c = relativo(centro(t));
                this._cuadPoner(k, c.x - ancla.img.x * Math.min(6, Math.max(1, k)),
                                   c.y - ancla.img.y * Math.min(6, Math.max(1, k)));
                movido = 99;
                e.preventDefault();
            } else if (t.length === 1 && desde && z.k > 1.02) {
                movido += Math.abs(t[0].clientX - desde.x - z.x) + Math.abs(t[0].clientY - desde.y - z.y);
                this._cuadPoner(z.k, t[0].clientX - desde.x, t[0].clientY - desde.y);
                e.preventDefault();
            }
        }, { passive: false });

        visor.addEventListener('touchend', e => {
            if (e.touches.length === 0) { ancla = null; desde = null; }
            if (e.touches.length === 1) {
                // Levantar un dedo del pellizco: el que queda sigue arrastrando
                const z = this._cuadZoom;
                desde = { x: e.touches[0].clientX - z.x, y: e.touches[0].clientY - z.y };
                ancla = null;
            }
        });

        // Doble toque: amplía donde se ha tocado, o vuelve a tamaño normal
        img.addEventListener('click', ev => {
            ev.stopPropagation();
            const ahora = Date.now();
            const doble = ahora - ultimoToque < 320;
            ultimoToque = ahora;
            if (!doble || movido > 12) return;
            const z = this._cuadZoom;
            if (z.k > 1.02) { this._cuadPoner(1, 0, 0); return; }
            const c = relativo({ x: ev.clientX, y: ev.clientY });
            this._cuadPoner(2.6, -c.x * 1.6, -c.y * 1.6);
        });

        // En el ordenador, con la rueda
        visor.addEventListener('wheel', ev => {
            ev.preventDefault();
            const z = this._cuadZoom;
            const k = z.k * (ev.deltaY < 0 ? 1.15 : 1 / 1.15);
            const c = relativo({ x: ev.clientX, y: ev.clientY });
            const enImg = { x: (c.x - z.x) / z.k, y: (c.y - z.y) / z.k };
            const kk = Math.min(6, Math.max(1, k));
            this._cuadPoner(kk, c.x - enImg.x * kk, c.y - enImg.y * kk);
        }, { passive: false });

        // Tocar el fondo cierra; tocar la imagen, no
        visor.addEventListener('click', ev => {
            if (ev.target === visor) this.cerrarCuadranteGrande();
        });
    },


    // ── Resumen para la app de gestión ───────────────────────────────────────

    USUARIOS_URL: 'https://emt-palma-movilidad.vercel.app/api/usuarios',

    // Turno según la hora de entrada habitual: mañana 6–13, tarde 13–20
    _minutos(hhmm) {
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
    },

    // Normaliza "Son Rossinyol", "SON ROSSINYOL", "son rossinyol " al mismo valor
    _clavePuesto(puesto) {
        return String(puesto || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },

    // Turno según el puesto y la hora de entrada registrada. Si el puesto no
    // está en la tabla, se cae al criterio antiguo (mañana antes de las 13h).
    // La noche es 21:00–06:00 en cualquier lugar. Mañana y tarde admiten una
    // hora de margen: entrar una hora antes sigue siendo mañana y salir una
    // hora más tarde sigue siendo tarde. En los lugares que entran de
    // madrugada (Son Rossinyol a las 3:45) la noche termina donde empieza su
    // mañana con el margen, o de lo contrario se las tragaría enteras.
    NOCHE_DESDE: 21 * 60,
    NOCHE_HASTA: 6 * 60,
    MARGEN_TURNO: 60,

    _franjasDe(puesto) {
        return (TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || []).filter(f => f.id !== 'N');
    },

    // La franja de noche tal y como la tiene puesta ese lugar, si la tiene
    _nocheDe(puesto) {
        const n = (TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || []).find(f => f.id === 'N');
        return (n && this._minutos(n.desde) !== null && this._minutos(n.hasta) !== null) ? n : null;
    },

    // Hora a la que deja de ser de noche en este lugar: nunca más tarde de las 6
    _amanecerDe(puesto) {
        const m = this._franjasDe(puesto).find(f => f.id === 'M');
        const ini = m ? this._minutos(m.desde) : null;
        if (ini === null) return this.NOCHE_HASTA;
        return Math.min(this.NOCHE_HASTA, Math.max(0, ini - this.MARGEN_TURNO));
    },

    // Una franja puede cruzar la medianoche —la noche siempre lo hace—, así
    // que se estira hasta el día siguiente antes de comparar.
    _dentroDeFranja(min, f, margen) {
        const desde = this._minutos(f?.desde), hasta = this._minutos(f?.hasta);
        if (desde === null || hasta === null || desde === hasta) return false;
        let a = desde - margen, b = hasta + margen;
        if (b <= a) b += 1440;
        let cur = min;
        if (cur < a) cur += 1440;
        return cur >= a && cur < b;
    },

    // Manda la hora que tenga puesta el lugar: Son Rossinyol y Control entran
    // de noche a las 20:00, y dándola por hecha a las 21:00 esas entradas
    // caían en la tarde. El turno de noche se quedaba sin nadie y el cuadro
    // de lugares marcaba "sin cubrir" con el trabajador dentro.
    _esNoche(min, puesto) {
        const n = this._nocheDe(puesto);
        if (n) return this._dentroDeFranja(min, n, 0);
        return min >= this.NOCHE_DESDE || min < this._amanecerDe(puesto);
    },

    _turnoDe(puesto, horaInicio) {
        const ini = this._minutos(horaInicio);
        if (ini === null) return '';
        const todas = TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || [];
        // Primero la hora clavada, y solo si no encaja en ninguna se admite
        // la hora de margen: entrar un poco antes o salir un poco después
        // sigue siendo el mismo turno.
        for (const f of todas) if (this._dentroDeFranja(ini, f, 0)) return f.id;
        for (const f of todas) if (this._dentroDeFranja(ini, f, this.MARGEN_TURNO)) return f.id;
        if (this._esNoche(ini, puesto)) return 'N';
        return ini < 13 * 60 ? 'M' : 'T';
    },

    _turnoHabitual(delMes) {
        // Turno del último día con horario registrado, según el puesto asignado
        const conHora = delMes.filter(r => r.horaInicio).sort((a, b) => b.timestamp - a.timestamp);
        if (!conHora.length) return '';
        return this._turnoDe(this.puestoTrabajo, conHora[0].horaInicio);
    },

    async _cargarLugares() {
        try {
            const r = await fetch(LUGARES_URL, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            const data = await r.json();
            if (data && typeof data === 'object') {
                aplicarCatalogoLugares(data);
                localStorage.setItem('lugaresCatalogo', JSON.stringify(data));
            }
        } catch (_) {
            // Sin red se tira de lo último que se vio, que es mejor que nada
            try { aplicarCatalogoLugares(JSON.parse(localStorage.getItem('lugaresCatalogo') || '{}')); } catch (_) {}
        }
        // Y se repinta: el desplegable puede llevar un rato en pantalla con la
        // lista corta de antes de que llegara el catálogo.
        this._refrescarOpcionesLugar();
    },

    _refrescarOpcionesLugar() {
        const sel = document.getElementById('lugarJornada');
        if (sel) {
            const elegido = sel.value || this._lugarPropuesto();
            sel.innerHTML = this._opcionesLugar(elegido);
            sel.value = elegido || '';
        }
        const edit = document.getElementById('editModalLugar');
        if (edit) {
            const elegido = edit.value;
            edit.innerHTML = this._opcionesLugar(elegido);
            edit.value = elegido || '';
        }
        try { this._renderTramos(); } catch (_) {}
    },

    // Lugar del catálogo cuya ubicación cae más cerca, dentro de su radio. Si
    // hay varios en el mismo sitio (control y taller comparten nave) gana el de
    // prioridad más alta, que es donde suele estar la gente.
    _lugarPorUbicacion(lat, lng) {
        let mejor = null;
        Object.values(LUGARES_CATALOGO || {}).forEach(l => {
            const u = l?.ubicacion;
            if (!u) return;
            const d = this.calcularDistancia(lat, lng, u.lat, u.lng);
            if (d > u.radio) return;
            if (!mejor || (l.prioridad || 0) > mejor.prioridad
                || ((l.prioridad || 0) === mejor.prioridad && d < mejor.d)) {
                mejor = { nombre: l.nombre, prioridad: l.prioridad || 0, d };
            }
        });
        return mejor;
    },

    _posicionActual() {
        return new Promise(resolve => {
            const Geo = window.Capacitor?.Plugins?.Geolocation || navigator.geolocation;
            if (!Geo) return resolve(null);
            let hecho = false;
            const ok = c => { if (!hecho) { hecho = true; resolve({ lat: c.coords?.latitude ?? c.latitude, lng: c.coords?.longitude ?? c.longitude }); } };
            const fallo = () => { if (!hecho) { hecho = true; resolve(null); } };
            try {
                if (Geo.getCurrentPosition.length === 0) Geo.getCurrentPosition().then(ok).catch(fallo);
                else Geo.getCurrentPosition(ok, fallo, { enableHighAccuracy: true, timeout: 8000 });
            } catch (_) { fallo(); }
            setTimeout(fallo, 9000);
        });
    },

    // Al registrar, si estás en un lugar conocido y no es el que tienes puesto,
    // se te pregunta. Confirmarlo lo cambia también en gestión.
    async _comprobarLugarPorUbicacion() {
        if (!Object.keys(LUGARES_CATALOGO || {}).length) return;
        const pos = await this._posicionActual();
        if (!pos) return;
        const cerca = this._lugarPorUbicacion(pos.lat, pos.lng);
        if (!cerca) return;
        const puesto = this.puestoTrabajo;
        if (this._clavePuesto(cerca.nombre) === this._clavePuesto(puesto)) return;
        // Donde estás manda sobre lo que hayas elegido: si el GPS te sitúa en
        // otro sitio, cuenta ese. Se avisa, no se pregunta.
        this.puestoTrabajo = cerca.nombre;
        localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
        this._marcarLugarElegidoHoy();
        this._actualizarCabeceraUsuario();
        this._actualizarConductorDisplay();
        this._renderLugarJornada();
        localStorage.removeItem('resumenHuella');     // forzar que se vuelva a publicar
        this._publicarResumen();
        this._mostrarToast(puesto
            ? `📍 El GPS te sitúa en ${cerca.nombre}: cuenta ese, no ${puesto}`
            : `📍 Lugar: ${cerca.nombre}`, 5000);
    },

    async _publicarResumen() {
        if (!this.usuarioActual?.email) return;
        if (this._lecturaOk === false) return;   // no mandar lo que no se ha podido leer
        try {
            const hist = this._historialFull || {};
            const ahora = new Date();
            const delMes = Object.values(hist).filter(r => {
                const d = new Date(r.timestamp);
                return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth();
            });
            const t = this._calcTotales(hist);
            // Horario de hoy si lo hay; si no, el del último día registrado.
            // Gestión lo usa para ver si el puesto queda cubierto.
            const hoyId = this._hoyId();
            const deHoy = Object.entries(hist)
                .filter(([id]) => this._fechaDeId(id) === hoyId)
                .map(([, r]) => r);
            const ultimo = deHoy.length ? deHoy[deHoy.length - 1]
                : Object.values(hist).sort((a, b) => b.timestamp - a.timestamp)[0];
            // Jornadas del año en curso, compactas: gestión las agrupa por mes.
            // Claves cortas a propósito, son ~220 al año por trabajador.
            // Desde el 1 de enero del año en curso
            const desde = new Date(ahora.getFullYear(), 0, 1).getTime();
            const jornadas = Object.entries(hist)
                .filter(([, r]) => r.timestamp && r.timestamp >= desde)
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .map(([id, r]) => ({
                    f: this._fechaDeId(id),
                    h: parseFloat(r.horas) || 0,
                    i: r.horaInicio || '',
                    o: r.horaFin || '',
                    n: r.horasNocturnas || 0,
                    pu: r.puesto || this.puestoTrabajo || '',
                    ...(r.extraManual ? { x: r.extraDestino === 'extras' ? 1 : 2 } : {}),
                    ...(r.festivo ? { fe: 1 } : {}),
                    ...(r.vacaciones ? { v: 1 } : {}),
                    ...(r.be ? { b: 1 } : {}),
                    ...(Array.isArray(r.tramos) && r.tramos.length ? { tr: r.tramos } : {}),
                    ...(r.pr ? { p: 1 } : {}),
                }));
            const payload = {
                nombre:       this.usuarioActual.name || '',
                conductor:    this.numConductor || '',
                // Lo último que ha dado por leído, para que gestión lo vea en
                // su lista y no solo le llegue la nota. El servidor solo le
                // pone hora cuando cambia, así que mandarlo siempre no mueve
                // la que ya tenía.
                ...(this._avisoVisto() ? { avisoVisto: this._avisoVisto() } : {}),
                avatar:       localStorage.getItem('avatarPhoto') || null,
                version:      (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '',
                horasMes:     Math.round(delMes.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0) * 10) / 10,
                horasTotales: t.anualReal,
                horasAnuales: this.horasAnualesCustom,
                diasMes:      delMes.length,
                jornadaHoras: this.jornadaHoras,
                dias:         this.diasSemana || null,
                diasAt:       this._diasAt(),
                // Las vacaciones también viajaban solo hacia el trabajador: el
                // servidor las arbitra por fecha, pero nunca le llegaban.
                vacaciones:   this._getVacaciones(),
                vacacionesAt: this._vacacionesAt(),
                turno:        this._turnoHabitual(delMes),
                horaInicio:   ultimo?.horaInicio || '',
                horaFin:      ultimo?.horaFin || '',
                horarioDe:    deHoy.length ? 'hoy' : 'anterior',
                jornadas,
            };
            // Publicar cuando algo cambie de verdad, no una vez al día: si no, al
            // actualizar la app el nuevo número de versión no llegaba a gestión
            // hasta el día siguiente. Sin cambios no se escribe nada.
            const huella = JSON.stringify([payload.version, payload.horasMes, payload.horasTotales,
                                           payload.diasMes, payload.turno, payload.conductor, payload.horasAnuales,
                                           payload.jornadaHoras, JSON.stringify(payload.dias), JSON.stringify(payload.vacaciones),
                                           payload.nombre, payload.horaInicio, payload.horaFin,
                                           payload.horarioDe, jornadas.length,
                                           jornadas.length ? jornadas[jornadas.length - 1].f : '',
                                           new Date().toISOString().slice(0, 10)]);
            if (localStorage.getItem('resumenHuella') === huella) return;
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual.email },
                body: JSON.stringify(payload)
            });
            if (resp.ok) {
                localStorage.setItem('resumenHuella', huella);
                const mio = await resp.json();
                if (Array.isArray(mio?.vacaciones)
                    && (mio.vacacionesAt || 0) > this._vacacionesAt()) {
                    localStorage.setItem('vacacionesAt', String(mio.vacacionesAt));
                    this._saveVacaciones(mio.vacaciones, true);
                    this._renderVacaciones();
                    this._aplicarModoVacaciones();
                }
                if ((mio?.diasAt || 0) > this._diasAt()) {
                    localStorage.setItem('diasSemanaAt', String(mio.diasAt));
                    this.diasSemana = Array.isArray(mio.dias) ? mio.dias : null;
                    if (this.diasSemana) localStorage.setItem('diasSemana', JSON.stringify(this.diasSemana));
                    else localStorage.removeItem('diasSemana');
                }
                const grupo = Number(mio?.grupo) || null;
                if (grupo !== this.grupoDescanso) {
                    this.grupoDescanso = grupo;
                    if (grupo) localStorage.setItem('grupoDescanso', String(grupo));
                    else localStorage.removeItem('grupoDescanso');
                    this._actualizarCampoFestivo();
                }
                if (mio?.puesto !== undefined) {
                    this.puestoTrabajo = mio.puesto || '';
                    localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
                    this._actualizarCabeceraUsuario();
                    this._actualizarConductorDisplay();
                }
            }
        } catch (_) { /* silencioso: se reintenta al día siguiente */ }
    },

    toggleMensual() {
        const sec = document.getElementById('mensualSection');
        if (!sec) return;
        const cerrada = sec.classList.toggle('cerrada');
        localStorage.setItem('mensualCerrada', cerrada ? '1' : '0');
    },

    _restaurarMensual() {
        if (localStorage.getItem('mensualCerrada') === '1')
            document.getElementById('mensualSection')?.classList.add('cerrada');
    },

    _renderMensual(historial) {
        const container = document.getElementById('mensualTable');
        if (!container) return;
        const meses = this._calcTodosMeses(historial);
        const keys  = Object.keys(meses).sort((a, b) => b.localeCompare(a)).slice(0, 6);
        if (keys.length === 0) { container.innerHTML = '<div style="text-align:center;color:#95a5a6;font-size:12px;padding:8px;">Sin datos</div>'; return; }
        container.innerHTML = keys.map(k => {
            const m = meses[k];
            const objetivo = this.horasAnualesCustom / 12;
            const barPct   = Math.min((m.horas / objetivo) * 100, 100);
            // Split the bar proportionally, so the orange slice reflects how much
            // of that month's hours were overtime even when the bar is saturated
            const ratioExt = m.horas > 0 ? Math.min(m.horasExtras / m.horas, 1) : 0;
            const extPct   = barPct * ratioExt;
            const normPct  = barPct - extPct;
            return `<div class="mes-row">
                <div class="mes-label">${m.label}</div>
                <div class="mes-bar-wrap">
                    <div class="mes-bar" style="width:${normPct}%"></div>
                    <div class="mes-bar-extra" style="width:${extPct}%"></div>
                </div>
                <div class="mes-vals">
                    <span>${m.horas}h</span>
                    ${m.horasExtras > 0 ? `<span class="mes-extras-h">⏱️${m.horasExtras}h</span>` : ''}
                    ${m.horasExtras > 0 && this.precioExtraDefault > 0 ? `<span class="mes-extras-e">+${(m.horasExtras * this.precioExtraDefault).toFixed(2)}€</span>` : ''}
                    ${m.nocturnas > 0 ? `<span class="mes-noche">🌙${m.nocturnas}h</span>` : ''}
                    ${m.extra > 0    ? `<span class="mes-extra">+${m.extra.toFixed(2)}€</span>` : ''}
                </div>
            </div>`;
        }).join('');
    },

    revisarSuma() {
        const t = parseFloat(document.getElementById('horasTrabajadas').textContent);
        const r = parseFloat(document.getElementById('horasRestantes').textContent);
        const s = t + r;
        if (Math.abs(s - this.horasAnualesCustom) < 0.1) alert(`✅ Suma correcta!\n\nTrabajadas: ${t}h\nRestantes: ${r}h`);
        else alert(`❌ Error!\n\nTrabajadas: ${t}h\nRestantes: ${r}h\nTotal: ${s}h\nEsperado: ${this.horasAnualesCustom}h`);
    },

    toggleDarkMode() {
        this.darkMode = !this.darkMode;
        localStorage.setItem('darkMode', this.darkMode);
        this.darkMode ? this.aplicarDarkMode() : this.removerDarkMode();
        this._guardarPreferencias();
    },

    aplicarDarkMode() {
        document.body.classList.add('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#avatarModalContent']
            .forEach(s => { const e = document.querySelector(s); if(e) e.classList.add('dark'); });
        document.querySelector('.container')?.classList.add('dark');
    },

    removerDarkMode() {
        document.body.classList.remove('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#avatarModalContent']
            .forEach(s => { const e = document.querySelector(s); if(e) e.classList.remove('dark'); });
        document.querySelector('.container')?.classList.remove('dark');
    },

    seleccionarTema(tema) {
        this.tema = tema;
        localStorage.setItem('tema', tema);
        this.aplicarTema(tema);
        this._guardarPreferencias();
        this._actualizarTemaUI();
    },

    aplicarTema(tema) {
        document.body.classList.remove('theme-verde','theme-fuego','theme-acero','theme-rojo');
        if (tema && tema !== 'azul') document.body.classList.add('theme-' + tema);
    },

    _actualizarTemaUI() {
        ['azul','verde','fuego','acero','rojo'].forEach(t => {
            const dot = document.getElementById('dot-' + t);
            if (dot) dot.classList.toggle('active', t === this.tema);
        });
    },

    async guardarPrecioExtra() {
        const precio = this._leerDecimal(document.getElementById('precioExtraGlobal').value) || 0;
        this.precioExtraDefault = precio;
        localStorage.setItem('precioExtra', String(precio));
        // Esperar al guardado: cargarDatos relee Drive, y si aún tenía el valor
        // viejo lo volvía a aplicar encima del que se acababa de escribir.
        await this._guardarPreferencias(true);
        this.cargarDatos();
    },

    async guardarPrecioFestivo() {
        const precio = this._leerDecimal(document.getElementById('precioFestivoGlobal').value) || 0;
        this.precioFestivoDefault = precio;
        localStorage.setItem('precioFestivo', String(precio));
        // Sin flush, salir de Ajustes antes de los 2 s del guardado diferido
        // dejaba el precio solo en el móvil, y al reabrir Drive lo pisaba.
        // Esperar al guardado: cargarDatos relee Drive, y si aún tenía el valor
        // viejo lo volvía a aplicar encima del que se acababa de escribir.
        await this._guardarPreferencias(true);
        this.cargarDatos();
    },

    // Quién trabaja festivos y libres no se puede deducir de las horas de la
    // jornada: hay un grupo que hace 7h tres días a la semana y va por las
    // mismas reglas que la media jornada. Lo que los separa son las anuales.
    ANUALES_COMPLETA: 1700,
    // A partir de aquí es jornada completa; por debajo, media
    JORNADA_COMPLETA: 7,

    _esJornadaCompleta() {
        return this.horasAnualesCustom >= this.ANUALES_COMPLETA;
    },

    _actualizarCampoFestivo() {
        const campo = document.getElementById('campoPrecioFestivo');
        if (campo) campo.hidden = !this._esJornadaCompleta();
        const inp = document.getElementById('precioFestivoGlobal');
        if (inp && this.precioFestivoDefault > 0) inp.value = this.precioFestivoDefault;

        // Los días fijos son cosa de quien va por las 777h —tanto el de 3,5h
        // como el que hace 7h tres días—, y el grupo de libres, de la jornada
        // completa. Nunca se enseñan los dos.
        const completa = this._esJornadaCompleta();
        this._actualizarTituloFestivos();
        const btnDias = document.getElementById('btnDiasJornada');
        if (btnDias) btnDias.hidden = completa;
        const txtDias = document.getElementById('diasJornadaDisplay');
        if (txtDias) txtDias.textContent = this._etiquetaDias();

        const campoGr = document.getElementById('campoGrupoDescanso');
        if (campoGr) campoGr.hidden = !completa;
        const txtGr = document.getElementById('grupoDescansoDisplay');
        if (txtGr) txtGr.textContent = this.grupoDescanso ? 'Grupo ' + this.grupoDescanso : 'sin asignar';
    },

    async guardarPrecioNoche() {
        const precio = this._leerDecimal(document.getElementById('precioNocheGlobal').value) || 0;
        this.precioNocheDefault = precio;
        localStorage.setItem('precioNoche', precio);
        await this._guardarPreferencias(true);
    },

    async guardarFechaAlta() {
        const valor = document.getElementById('fechaAltaGlobal')?.value || '';
        this.fechaAltaDefault = valor;
        localStorage.setItem('fechaAlta', valor);
        this._renderMiNomina();
        await this._guardarPreferencias(true);
    },

    async guardarPctBieniosManual() {
        const pct = this._leerDecimal(document.getElementById('pctBieniosGlobal').value) || 0;
        this.pctBieniosDefault = pct;
        localStorage.setItem('pctBieniosManual', String(pct));
        this._renderMiNomina();
        await this._guardarPreferencias(true);
    },

    mostrarCambiarAnuales() {
        document.querySelectorAll('#anualesModal .jm-op').forEach(op => {
            const c = op.querySelector('.jm-check');
            op.classList.toggle('sel', !!c && parseFloat(c.dataset.an) === this.horasAnualesCustom);
        });
        document.getElementById('anualesModal').classList.add('show');
        if (this.darkMode) document.getElementById('anualesModalContent').classList.add('dark');
    },

    elegirAnualesOtra() {
        const v = prompt('¿Cuántas horas quieres trabajar al año?', this.horasAnualesCustom);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        this.elegirAnuales(n);
    },

    async elegirAnuales(n) {
        document.getElementById('anualesModal').classList.remove('show');
        if (n === this.horasAnualesCustom) return;
        this.horasAnualesCustom = n;
        localStorage.setItem('horasAnuales', String(n));
        const el = document.getElementById('horasAnualesDisplay');
        if (el) el.textContent = n + 'h';
        this._actualizarCampoFestivo();      // el precio del día extra depende de esto
        await this._guardarPreferencias(true);
        this.cargarDatos();
        this._mostrarToast(`✅ Horas anuales: ${n}h`, 2500);
    },

    confirmarResetear() {
        this.mostrarModal('⚠️ Resetear Contador', '¿Estás seguro? Se pondrán todas las horas a 0.', this.resetearContador.bind(this));
    },

    mostrarModal(titulo, mensaje, callback) {
        document.getElementById('modalTitle').textContent   = titulo;
        document.getElementById('modalMessage').textContent = mensaje;
        document.getElementById('modal').classList.add('show');
        this.modalCallback = callback;
    },

    cerrarModal()       { document.getElementById('modal').classList.remove('show'); this.modalCallback = null; },
    async confirmarModal() { if (this.modalCallback) await this.modalCallback(); this.cerrarModal(); },

    confirmarBorrarCuenta() {
        this.mostrarModal('⚠️ Borrar datos', 'Se eliminarán todos tus registros de Drive y se cerrará la sesión.', this.borrarCuenta.bind(this));
    },

    // Cuándo volver a avisar de que estás en el trabajo:
    //   'cada' — en cada lugar del día, pero no otra vez donde ya registraste
    //   'una'  — una sola vez al día, y solo en el lugar de siempre
    avisoLugar: localStorage.getItem('avisoLugar') || 'cada',

    // Los lugares en los que ya ha registrado hoy, por nombre. De aquí sale
    // que no vuelva a avisar donde ya ha fichado pero sí en uno nuevo.
    _lugaresRegistradosHoy() {
        const hoy = this._hoyId();
        const sitios = new Set();
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id) !== hoy) return;
            if (r.puesto) sitios.add(this._clavePuesto(r.puesto));
            (r.tramos || []).forEach(t => { if (t?.p) sitios.add(this._clavePuesto(t.p)); });
        });
        // Y la ubicación guardada que corresponda a cada uno, por si el aviso
        // nativo compara por el nombre que se le puso al GPS.
        this._getWorkLocations().forEach((loc, i) => {
            if (sitios.has(this._clavePuesto(this._nombreDeUbicacion(i)))) {
                sitios.add(this._clavePuesto(loc.name || ''));
            }
        });
        sitios.delete('');
        return sitios;
    },

    // Cómo se llama de verdad la ubicación `i`: el nombre que se le puso al
    // guardarla puede no ser el del cuadrante —"Trabajo" contra "Control"—, y
    // comparando esos nombres el aviso no callaba nunca. Si cae dentro de un
    // lugar del catálogo, manda el nombre del catálogo.
    _nombreDeUbicacion(i) {
        const loc = this._getWorkLocations()[i];
        if (!loc) return '';
        let mejor = '', cerca = Infinity;
        Object.values(LUGARES_CATALOGO || {}).forEach(l => {
            if (!l?.ubicacion || !l?.nombre) return;
            const d = this.calcularDistancia(loc.lat, loc.lng, l.ubicacion.lat, l.ubicacion.lng);
            if (d < Math.max(300, l.ubicacion.radio || 0) && d < cerca) { cerca = d; mejor = l.nombre; }
        });
        return mejor || loc.name || '';
    },

    // ¿Está ya cubierto el día? Con la jornada entera registrada —o estando
    // de vacaciones, de baja o de festivo— no queda nada que avisar. Va por
    // delante de la comparación por lugares a propósito: esa depende de que
    // el nombre de la ubicación guardada coincida con el de la jornada, y
    // cuando no coincidían el aviso no callaba en todo el día.
    _jornadaCompletaHoy() {
        const hoy = this._hoyId();
        let horas = 0, sinJornada = false;
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id) !== hoy) return;
            if (r.vacaciones || r.be || r.festivo || r.sinAsistencia) sinJornada = true;
            horas += parseFloat(r.horas) || 0;
        });
        return sinJornada || horas >= (this.jornadaHoras || 7.5) - 0.01;
    },

    // ¿Toca avisar por este lugar? `i` es su sitio en la lista de ubicaciones.
    _tocaAvisar(i) {
        const hoy = this._hoyId();
        if (this._jornadaCompletaHoy()) return false;
        // Una jornada a medias es la que se ha empezado y no se ha cerrado:
        // mientras no tenga salida, sigue teniendo sentido avisar.
        if (this.avisoLugar === 'una') {
            if (i !== 0) return false;
            return localStorage.getItem('lastRegisteredDate') !== hoy
                && !this._hayRegistroEnFecha(hoy);
        }
        const nombre = this._clavePuesto(this._nombreDeUbicacion(i));
        if (!nombre) return !this._hayRegistroEnFecha(hoy);
        return !this._lugaresRegistradosHoy().has(nombre);
    },

    // Lo mismo, para el aviso nativo que corre con la app cerrada
    _publicarLugaresHoy() {
        const hoy = this._hoyId();
        const sitios = [...this._lugaresRegistradosHoy()].join('|');
        window.AndroidBridge?.saveToPrefs?.('avisoLugar', this.avisoLugar);
        window.AndroidBridge?.saveToPrefs?.('lugaresHoy', `${hoy}~${sitios}`);
        // Con el día ya cubierto el aviso nativo tampoco tiene que saltar, y
        // con la app cerrada esto es lo único que puede mirar.
        window.AndroidBridge?.saveToPrefs?.('jornadaCompleta',
            this._jornadaCompletaHoy() ? hoy : '');
    },

    _getWorkLocations() { return JSON.parse(localStorage.getItem('workLocations') || '[]'); },
    _saveWorkLocations(locs) { localStorage.setItem('workLocations', JSON.stringify(locs)); },

    async guardarUbicacionTrabajo() {
        const name = prompt('Nombre de esta ubicación (ej: EMT Madrid, Depósito):');
        if (!name) return;
        if (!navigator.geolocation) { alert('❌ Tu dispositivo no soporta geolocalización'); return; }
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) await LN.requestPermissions().catch(() => {});
        else if ('Notification' in window && Notification.permission === 'default')
            await Notification.requestPermission();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const locs = this._getWorkLocations();
                locs.push({ name: name.trim(), lat: pos.coords.latitude, lng: pos.coords.longitude });
                this._saveWorkLocations(locs);
                this._guardarPreferencias();
                this.actualizarEstadoGPS();
                this._renderWorkLocations();
                alert(`✅ "${name.trim()}" guardada. Recibirás notificación al llegar.`);
                if (!this._bgGeoStarted) this._iniciarGeofencingNativo();
            },
            () => alert('❌ No se pudo obtener la ubicación. Activa el GPS.')
        );
    },

    borrarUbicacion(index) {
        const locs = this._getWorkLocations();
        if (!confirm(`¿Eliminar "${locs[index].name}"?`)) return;
        locs.splice(index, 1);
        this._saveWorkLocations(locs);
        this._guardarPreferencias();
        if (locs.length === 0) document.getElementById('workBanner').classList.remove('show');
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
    },

    async editarUbicacion(index) {
        const locs = this._getWorkLocations();
        const loc  = locs[index];
        const nuevoNombre = prompt('Nombre de la ubicación:', loc.name);
        if (nuevoNombre === null) return;
        if (!nuevoNombre.trim()) { alert('❌ El nombre no puede estar vacío'); return; }
        loc.name = nuevoNombre.trim();
        const actualizarGPS = confirm('¿Actualizar también las coordenadas GPS a tu posición actual?');
        if (actualizarGPS) {
            await new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    (pos) => { loc.lat = pos.coords.latitude; loc.lng = pos.coords.longitude; resolve(); },
                    ()    => { alert('❌ No se pudo obtener la ubicación'); resolve(); }
                );
            });
        }
        locs[index] = loc;
        this._saveWorkLocations(locs);
        this._guardarPreferencias();
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
    },

    _renderWorkLocations() {
        const container = document.getElementById('workLocationsList');
        if (!container) return;
        const locs = this._getWorkLocations();
        if (locs.length === 0) {
            container.innerHTML = '<div style="font-size:12px;color:#95a5a6;padding:4px 0;">Sin ubicaciones guardadas</div>';
            return;
        }
        const isDark = this.darkMode;
        container.innerHTML = locs.map((loc, i) => {
            const latStr = loc.lat.toFixed(5);
            const lngStr = loc.lng.toFixed(5);
            const mapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
            return `
            <div style="background:${isDark?'#111827':'#f8f9ff'};border:1px solid ${isDark?'#2d3561':'#e0e4ff'};border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:${isDark?'#e0e0e0':'#2c3e50'};">📍 ${loc.name}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="app.editarUbicacion(${i})" style="background:var(--ac);color:white;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600;">✏️ Editar</button>
                        <button onclick="app.borrarUbicacion(${i})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600;">🗑️</button>
                    </div>
                </div>
                <div style="font-size:11px;color:#7f8c8d;margin-bottom:4px;">🌐 ${latStr}, ${lngStr}</div>
                <a href="${mapUrl}" target="_blank" rel="noopener" style="font-size:11px;color:var(--ac);text-decoration:none;font-weight:600;">📌 Ver en Google Maps →</a>
            </div>`;
        }).join('');
    },

    actualizarEstadoGPS() {
        const locs = this._getWorkLocations();
        const el   = document.getElementById('gpsStatus');
        if (!el) return;
        if (locs.length > 0) {
            el.textContent = `✅ ${locs.length} ubicación${locs.length > 1 ? 'es' : ''} guardada${locs.length > 1 ? 's' : ''}`;
            el.className = 'gps-badge saved';
        } else {
            el.textContent = 'Sin ubicaciones'; el.className = 'gps-badge none';
        }
    },

    verificarUbicacion() {
        const locs = this._getWorkLocations();
        if (locs.length === 0 || !navigator.geolocation) return;
        if (this.gpsMode === 'off') return;
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            const i = locs.findIndex(loc =>
                this.calcularDistancia(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lng) < 300);
            if (i === -1 || !this._tocaAvisar(i)) return;
            document.getElementById('workBanner').classList.add('show');
            this._enviarNotificacionTrabajo();
        }, () => {});
    },

    async _enviarNotificacionTrabajo() {
        if (window.AndroidBridge?.scheduleWorkNotification) {
            const inicio = localStorage.getItem('lastHoraInicio') || '';
            const fin    = localStorage.getItem('lastHoraFin') || '';
            window.AndroidBridge.scheduleWorkNotification(inicio, fin);
            return;
        }
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                const notif = {
                    id: 1001,
                    title: '📍 EMT - Movilidad',
                    body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                    actionTypeId: 'TRABAJO_CERCANO',
                };
                if (this.notifSound && this.notifSound !== 'default') {
                    notif.sound = this.notifSound;
                    notif.channelId = this.notifSound;
                }
                await LN.schedule({ notifications: [notif] });
            } catch(e) { console.error('Notification error:', e); }
            return;
        }
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification('📍 EMT - Movilidad', {
                body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'trabajo-cercano', requireInteraction: true,
                actions: [{ action: 'abrir', title: 'Abrir app' }]
            });
        } catch(_) {
            new Notification('📍 EMT - Movilidad', { body: 'Parece que estás en el trabajo.', icon: '/icons/icon-192.png' });
        }
    },

    async _iniciarGeofencingNativo() {
        const BGGeo = window.Capacitor?.Plugins?.BackgroundGeolocation;
        if (!BGGeo) return;
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) { try { await LN.requestPermissions(); } catch(_) {} }
        try {
            this._geoWatcherId = await BGGeo.addWatcher({
                backgroundMessage: '',
                backgroundTitle: 'EMT - Movilidad',
                requestPermissions: true,
                stale: false,
                distanceFilter: 200
            }, (location, error) => {
                if (error || !location) return;
                const ahora = Date.now();
                if (ahora - this._lastGeoCheck < this.gpsInterval * 60 * 1000) return;
                this._lastGeoCheck = ahora;
                const locs = this._getWorkLocations();
                if (locs.length === 0) return;
                const cual = locs.findIndex(loc =>
                    this.calcularDistancia(location.latitude, location.longitude, loc.lat, loc.lng) < 300
                );
                if (cual !== -1 && this._tocaAvisar(cual)) {
                    this._notifEnviadaAt = ahora;
                    const inicio = localStorage.getItem('lastHoraInicio') || '';
                    const fin    = localStorage.getItem('lastHoraFin') || '';
                    if (window.AndroidBridge?.scheduleWorkNotification) {
                        window.AndroidBridge.scheduleWorkNotification(inicio, fin);
                    } else {
                        this._enviarNotificacionLlegadaNativa();
                    }
                }
            });
            this._bgGeoStarted = true;
        } catch(e) {
            console.error('Background geo error:', e);
        }
    },

    async _detenerGeofencingNativo() {
        const BGGeo = window.Capacitor?.Plugins?.BackgroundGeolocation;
        if (!BGGeo || !this._geoWatcherId) return;
        try {
            await BGGeo.removeWatcher({ id: this._geoWatcherId });
        } catch(e) {
            console.error('removeWatcher error:', e);
        }
        this._geoWatcherId = null;
        this._bgGeoStarted = false;
    },

    async _enviarNotificacionLlegadaNativa() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            const notif = {
                id: 1001,
                title: '📍 EMT - Movilidad',
                body: 'Parece que estás en el trabajo. ¿Registras la jornada de hoy?',
                actionTypeId: 'TRABAJO_CERCANO',
            };
            if (this.notifSound && this.notifSound !== 'default') {
                notif.sound = this.notifSound;
                notif.channelId = this.notifSound;
            }
            await LN.schedule({ notifications: [notif] });
        } catch(e) {
            console.error('Notification error:', e);
        }
    },

    async _cancelarNotificacionTrabajo() {
        window.AndroidBridge?.cancelWorkNotification?.();
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try { await LN.cancel({ notifications: [{ id: 1001 }] }); } catch(_) {}
    },

    async _setupNotificationActions() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            await LN.registerActionTypes({
                types: [{
                    id: 'TRABAJO_CERCANO',
                    actions: [
                        { id: 'registro-rapido', title: '✅ Registrar jornada', foreground: false },
                        { id: 'otro-horario',    title: '🕐 Otro horario' }
                    ]
                }]
            });
            LN.addListener('localNotificationActionPerformed', (ev) => {
                if (ev.actionId === 'registro-rapido') {
                    if (this.usuarioActual) {
                        this._registrarDesdeNotificacion();
                    } else {
                        this._pendingNotifAction = 'registro-rapido';
                    }
                } else {
                    this._pendingNotifAction = null;
                    this.mostrarApp();
                    document.getElementById('workBanner')?.classList.remove('show');
                    setTimeout(() => document.getElementById('horasInput')?.focus(), 200);
                }
            });
        } catch(e) {
            console.error('registerActionTypes error:', e);
        }
    },

    async _registrarDesdeNotificacion() {
        const horaInicio = localStorage.getItem('lastHoraInicio');
        const horaFin    = localStorage.getItem('lastHoraFin');
        if (!horaInicio || !horaFin || !this.usuarioActual) return;
        const [h1, m1] = horaInicio.split(':').map(Number);
        const [h2, m2] = horaFin.split(':').map(Number);
        let minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (minutos <= 0) minutos += 24 * 60;
        const horas = Math.round(minutos / 6) / 10;
        const fecha = this._hoyISO();
        const registroId = fecha.replace(/-/g, '');
        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            datos.horasTrabajadas = parseFloat(datos.horasTrabajadas) || 0;
            if (!datos.historial) datos.historial = {};
            if (datos.historial[registroId]) {
                this._mostrarToast('⚠️ Ya hay un registro para hoy', 3000);
                return;
            }
            datos.horasTrabajadas = Math.round((datos.horasTrabajadas + horas) * 10) / 10;
            datos.historial[registroId] = {
                fecha: new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                horas,
                timestamp: new Date(fecha + 'T12:00:00').getTime(),
                horaInicio,
                horaFin
            };
            await this._writeDriveFile(datos);
            localStorage.setItem('lastRegisteredDate', registroId);
            window.AndroidBridge?.saveToPrefs('lastRegisteredDate', registroId);
            this._detenerGeofencingNativo();
            this._cancelarNotificacionTrabajo();
            this.actualizarUI(datos);
            this._mostrarToast(`✅ ${horas}h registradas (${horaInicio}–${horaFin})`, 4000);
            this._publicarResumen();
        } catch(e) {
            this._mostrarToast('❌ Error al registrar: ' + e.message, 4000);
        }
    },

    // Un repaso a la cadena entera de los avisos, en cristiano. "No me llegan
    // las notificaciones" puede romperse en seis sitios distintos y desde
    // fuera todos se ven igual: esto dice en cuál.
    async diagnosticarAvisos() {
        const L = [];
        const nativo = !!window.Capacitor?.isNativePlatform?.();
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        L.push(nativo ? '✅ App instalada en el móvil'
                      : '⚠️ Estás en el navegador: los avisos de la barra solo van en la app del móvil');

        let permiso = '?';
        try { permiso = (await LN?.checkPermissions?.())?.display || '?'; } catch (_) {}
        if (permiso === 'granted') L.push('✅ Permiso de notificaciones concedido');
        else {
            L.push('❌ Permiso de notificaciones: ' + permiso
                 + '\n   → Ajustes del móvil › Aplicaciones › esta app › Notificaciones');
        }

        if (nativo && window.AndroidBridge?.bateriaSinRestriccion) {
            let libre = true;
            try { libre = window.AndroidBridge.bateriaSinRestriccion() !== false; } catch (_) {}
            L.push(libre ? '✅ El ahorro de batería la deja en paz'
                         : '❌ El ahorro de batería la está frenando'
                         + '\n   → Ajustes › Aplicaciones › esta app › Batería › Sin restricciones');
        }

        // Lo que necesita la parte que mira con la app cerrada
        const pref = k => { try { return window.AndroidBridge?.getPref?.(k) || ''; } catch (_) { return ''; } };
        if (nativo) {
            const listo = !!pref('chatEmail') && !!pref('chatUrl');
            L.push(listo ? '✅ El aviso con la app cerrada está armado'
                         : '❌ El aviso con la app cerrada no está armado'
                         + '\n   → Cierra la app del todo y vuelve a abrirla');
            // Lo que de verdad dice si esto funciona: cuándo miró por última
            // vez sin que nadie abriera la app. Si es "nunca" o hace horas,
            // el móvil no la está dejando trabajar de fondo.
            let ultimo = 0;
            try { ultimo = Number(window.AndroidBridge?.ultimoAvisoFondo?.() || 0); } catch (_) {}
            if (!ultimo) {
                L.push('❌ Todavía no ha mirado ni una vez con la app cerrada'
                     + '\n   → Déjala cerrada un cuarto de hora y vuelve a este repaso');
            } else {
                const min = Math.round((Date.now() - ultimo) / 60000);
                L.push(min <= 3
                    ? `✅ Mirando al minuto (última vez hace ${min} min)`
                    : (min <= 30 ? '⚠️' : '❌')
                      + ` Última comprobación de fondo: hace ${min} min`
                      + '\n   → El vigilante no está en marcha: cierra la app del todo,'
                      + ' vuelve a abrirla y quítale el ahorro de batería');
            }
        }

        const sinLeer = this._totalSinLeer();
        L.push(`📬 Conversaciones sin leer ahora mismo: ${sinLeer}`);

        // Y el de verdad: por el mismo camino que uno real
        let prueba = '';
        if (LN?.schedule && nativo) {
            const aviso = { id: 9998, title: 'Prueba de aviso',
                            body: 'Si ves esto en la barra, los avisos funcionan.',
                            smallIcon: 'ic_stat_chat' };
            try {
                await LN.schedule({ notifications: [aviso] });
                prueba = '✅ Aviso de prueba lanzado: míralo en la barra';
            } catch (e) {
                prueba = '❌ El móvil ha rechazado el aviso: ' + (e?.message || e);
            }
        } else {
            prueba = '⚠️ Sin app del móvil no se puede probar la barra';
        }
        L.push(prueba);

        alert('AVISOS — REPASO\n\n' + L.join('\n\n'));
    },

    async probarNotificacion() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                await LN.requestPermissions();
                const notif = {
                    id: 9999,
                    title: '🔔 EMT - Movilidad — prueba',
                    body: 'Las notificaciones funcionan correctamente.',
                };
                if (this.notifSound && this.notifSound !== 'default') {
                    notif.sound = this.notifSound;
                    notif.channelId = this.notifSound;
                }
                await LN.schedule({ notifications: [notif] });
            } catch(e) {
                alert('❌ Error al enviar notificación: ' + e.message);
            }
            return;
        }
        if (!('Notification' in window)) { alert('❌ Tu navegador no soporta notificaciones'); return; }
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { alert('❌ Permiso de notificación denegado'); return; }
        }
        if (Notification.permission === 'denied') { alert('❌ Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.'); return; }
        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('🔔 EMT - Movilidad — prueba', {
                body: 'Las notificaciones funcionan correctamente.',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'test-notif'
            });
        } catch(_) {
            new Notification('🔔 EMT - Movilidad — prueba', { body: 'Las notificaciones funcionan correctamente.', icon: '/icons/icon-192.png' });
        }
    },

    _getPreferencias() {
        return {
            darkMode: this.darkMode,
            tema: this.tema,
            avatarEmoji: localStorage.getItem('avatarEmoji') || null,
            avatarBg: localStorage.getItem('avatarBg') || null,
            avatarPhoto: localStorage.getItem('avatarPhoto') || null,
            gpsMode: this.gpsMode,
            gpsInterval: this.gpsInterval,
            gpsScheduleFrom: this.gpsScheduleFrom,
            gpsScheduleTo: this.gpsScheduleTo,
            precioNocheDefault: this.precioNocheDefault,
            precioExtraDefault: this.precioExtraDefault,
            precioFestivoDefault: this.precioFestivoDefault,
            fechaAltaDefault: this.fechaAltaDefault,
            pctBieniosDefault: this.pctBieniosDefault,
            horasAnualesCustom: this.horasAnualesCustom,
            jornadaHoras: this.jornadaHoras,
            diasSemana: this.diasSemana || null,
            numConductor: this.numConductor,
            backupFreq: this.backupFreq,
            vacaciones: this._getVacaciones(),
            workLocations: this._getWorkLocations(),
            notifSound: this.notifSound,
            notifSoundChat: this.notifSoundChat
        };
    },

    _aplicarPreferenciasDesde(prefs) {
        if (prefs.darkMode !== undefined && prefs.darkMode !== this.darkMode) {
            this.darkMode = prefs.darkMode;
            localStorage.setItem('darkMode', String(prefs.darkMode));
            prefs.darkMode ? this.aplicarDarkMode() : this.removerDarkMode();
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = this.darkMode;
        }
        if (prefs.tema && prefs.tema !== this.tema) {
            this.tema = prefs.tema;
            localStorage.setItem('tema', prefs.tema);
            this.aplicarTema(prefs.tema);
        }
        if (prefs.avatarPhoto) {
            localStorage.setItem('avatarPhoto', prefs.avatarPhoto);
            localStorage.removeItem('avatarEmoji');
        } else if (prefs.avatarEmoji) {
            localStorage.setItem('avatarEmoji', prefs.avatarEmoji);
            if (prefs.avatarBg) localStorage.setItem('avatarBg', prefs.avatarBg);
            localStorage.removeItem('avatarPhoto');
        }
        if (prefs.gpsMode) { this.gpsMode = prefs.gpsMode; localStorage.setItem('gpsMode', prefs.gpsMode); }
        if (prefs.gpsInterval) { this.gpsInterval = prefs.gpsInterval; localStorage.setItem('gpsInterval', String(prefs.gpsInterval)); }
        if (prefs.gpsScheduleFrom) { this.gpsScheduleFrom = prefs.gpsScheduleFrom; localStorage.setItem('gpsScheduleFrom', prefs.gpsScheduleFrom); }
        if (prefs.gpsScheduleTo) { this.gpsScheduleTo = prefs.gpsScheduleTo; localStorage.setItem('gpsScheduleTo', prefs.gpsScheduleTo); }
        if (prefs.precioNocheDefault !== undefined && prefs.precioNocheDefault !== null) {
            this.precioNocheDefault = prefs.precioNocheDefault;
            localStorage.setItem('precioNoche', String(prefs.precioNocheDefault));
            const el = document.getElementById('precioNocheGlobal');
            if (el) el.value = prefs.precioNocheDefault;
        }
        if (prefs.precioFestivoDefault !== undefined && prefs.precioFestivoDefault !== null) {
            this.precioFestivoDefault = prefs.precioFestivoDefault;
            localStorage.setItem('precioFestivo', String(prefs.precioFestivoDefault));
            const el = document.getElementById('precioFestivoGlobal');
            if (el) el.value = prefs.precioFestivoDefault;
        }
        if (prefs.precioExtraDefault !== undefined && prefs.precioExtraDefault !== null) {
            this.precioExtraDefault = prefs.precioExtraDefault;
            localStorage.setItem('precioExtra', String(prefs.precioExtraDefault));
            const el = document.getElementById('precioExtraGlobal');
            if (el) el.value = prefs.precioExtraDefault;
        }
        if (prefs.fechaAltaDefault !== undefined && prefs.fechaAltaDefault !== null) {
            this.fechaAltaDefault = prefs.fechaAltaDefault;
            localStorage.setItem('fechaAlta', prefs.fechaAltaDefault);
            const el = document.getElementById('fechaAltaGlobal');
            if (el) el.value = prefs.fechaAltaDefault;
        }
        if (prefs.pctBieniosDefault !== undefined && prefs.pctBieniosDefault !== null) {
            this.pctBieniosDefault = prefs.pctBieniosDefault;
            localStorage.setItem('pctBieniosManual', String(prefs.pctBieniosDefault));
            const el = document.getElementById('pctBieniosGlobal');
            if (el) el.value = prefs.pctBieniosDefault;
        }
        if (Array.isArray(prefs.vacaciones)) {
            localStorage.setItem('vacaciones', JSON.stringify(prefs.vacaciones));
            this._aplicarModoVacaciones();
        }
        if (prefs.backupFreq) {
            this.backupFreq = prefs.backupFreq;
            localStorage.setItem('backupFreq', prefs.backupFreq);
        }
        if (typeof prefs.numConductor === 'string') {
            this.numConductor = prefs.numConductor;
            localStorage.setItem('numConductor', prefs.numConductor);
            this._actualizarCabeceraUsuario();
        }
        if (prefs.jornadaHoras) {
            this.jornadaHoras = prefs.jornadaHoras;
            localStorage.setItem('jornadaHoras', String(prefs.jornadaHoras));
        }
        // Los días de la media jornada viajaban solo en localStorage: al
        // reinstalar se perdían aunque el resto de ajustes volviera.
        if (Array.isArray(prefs.diasSemana)) {
            this.diasSemana = prefs.diasSemana;
            localStorage.setItem('diasSemana', JSON.stringify(prefs.diasSemana));
        } else if (prefs.diasSemana === null) {
            this.diasSemana = null;
            localStorage.removeItem('diasSemana');
        }
        if (prefs.horasAnualesCustom) {
            this.horasAnualesCustom = prefs.horasAnualesCustom;
            localStorage.setItem('horasAnuales', String(prefs.horasAnualesCustom));
        }
        if (Array.isArray(prefs.workLocations) && prefs.workLocations.length > 0) {
            this._saveWorkLocations(prefs.workLocations);
        }
        if (prefs.notifSound) {
            this.notifSound = prefs.notifSound;
            localStorage.setItem('notifSound', prefs.notifSound);
        }
        this.actualizarBotonesPerfil();
    },

    _mostrarToast(msg, duration = 3000, onClick = null) {
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:rgba(21,101,192,0.95);color:#fff;padding:11px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:9999;max-width:85vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.25);cursor:pointer;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.display = 'block';
        toast.style.opacity = '1';
        toast.onclick = onClick || null;
        clearTimeout(this._toastTimer);
        if (duration > 0) {
            this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => { toast.style.display = 'none'; }, 300); }, duration);
        }
    },

    async _notificarBackup(titulo, cuerpo) {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                await LN.schedule({ notifications: [{ id: 2001, title: titulo, body: cuerpo }] });
                return;
            } catch(e) {}
        }
        this._mostrarToast('✅ ' + cuerpo, 4000);
    },

    _updateGpsState() {
        const locs = this._getWorkLocations();
        if (window.AndroidBridge?.registerGeofences) {
            if (locs.length === 0 || this.gpsMode === 'off') {
                window.AndroidBridge.removeGeofences();
            } else {
                if (window.AndroidBridge.hasBackgroundLocationPermission?.() === false) {
                    window.AndroidBridge.requestLocationPermissions?.();
                }
                window.AndroidBridge.registerGeofences(JSON.stringify(locs));
            }
            return;
        }
        if (locs.length === 0 || this.gpsMode === 'off') { this._detenerGeofencingNativo(); return; }
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) { this._detenerGeofencingNativo(); return; }
        if (!this._bgGeoStarted) this._iniciarGeofencingNativo();
    },

    _isInGpsSchedule() {
        const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
        const cur = new Date().getHours() * 60 + new Date().getMinutes();
        const from = toMin(this.gpsScheduleFrom);
        const to = toMin(this.gpsScheduleTo);
        return from <= to ? (cur >= from && cur <= to) : (cur >= from || cur <= to);
    },

    _startScheduleTimer() {
        clearInterval(this._scheduleTimer);
        this._scheduleTimer = setInterval(() => this._updateGpsState(), 5 * 60 * 1000);
    },

    guardarGpsConfig() {
        const mode = document.querySelector('input[name="gpsMode"]:checked')?.value || 'always';
        const aviso = document.querySelector('input[name="avisoLugar"]:checked')?.value || 'cada';
        this.avisoLugar = aviso;
        localStorage.setItem('avisoLugar', aviso);
        const interval = parseInt(document.getElementById('gpsIntervalSelect')?.value || '60');
        const from = document.getElementById('gpsFrom')?.value || '07:00';
        const to = document.getElementById('gpsTo')?.value || '09:00';
        this.gpsMode = mode; this.gpsInterval = interval;
        this.gpsScheduleFrom = from; this.gpsScheduleTo = to;
        localStorage.setItem('gpsMode', mode);
        localStorage.setItem('gpsInterval', String(interval));
        localStorage.setItem('gpsScheduleFrom', from);
        localStorage.setItem('gpsScheduleTo', to);
        window.AndroidBridge?.saveToPrefs('gpsMode', mode);
        this._publicarLugaresHoy();
        window.AndroidBridge?.saveToPrefs('gpsScheduleFrom', from);
        window.AndroidBridge?.saveToPrefs('gpsScheduleTo', to);
        this._renderGpsSettings();
        this._updateGpsState();
        this._guardarPreferencias();
    },

    _renderGpsSettings() {
        const av = document.querySelector(`input[name="avisoLugar"][value="${this.avisoLugar}"]`);
        if (av) av.checked = true;
        const radio = document.querySelector(`input[name="gpsMode"][value="${this.gpsMode}"]`);
        if (radio) radio.checked = true;
        const sel = document.getElementById('gpsIntervalSelect');
        if (sel) sel.value = String(this.gpsInterval);
        const fromEl = document.getElementById('gpsFrom');
        if (fromEl) fromEl.value = this.gpsScheduleFrom;
        const toEl = document.getElementById('gpsTo');
        if (toEl) toEl.value = this.gpsScheduleTo;
        const chatSel = document.getElementById('notifSoundChat');
        if (chatSel) chatSel.value = this.notifSoundChat;
        this._pintarCampana();
        const soundSel = document.getElementById('notifSoundSelect');
        if (soundSel) soundSel.value = this.notifSound;
        const intervalRow = document.getElementById('gpsIntervalRow');
        const scheduleRow = document.getElementById('gpsScheduleRow');
        if (intervalRow) intervalRow.style.display = this.gpsMode === 'off' ? 'none' : '';
        if (scheduleRow) scheduleRow.style.display = this.gpsMode === 'schedule' ? '' : 'none';
    },

    // inmediato=true guarda ya y devuelve la promesa, para poder esperar a que
    // esté en Drive antes de releer (si no, la recarga trae el valor viejo y
    // pisa el que se acaba de cambiar).
    _guardarPreferencias(inmediato = false) {
        clearTimeout(this._prefSaveTimer);
        const guardar = async () => {
            if (!this.usuarioActual) return;
            try {
                const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
                const hi = localStorage.getItem('lastHoraInicio');
                const hf = localStorage.getItem('lastHoraFin');
                if (hi && hf) {
                    if (!data.prefs) data.prefs = {};
                    data.prefs.horaInicio = hi;
                    data.prefs.horaFin = hf;
                }
                await this._writeDriveFile(data);
            } catch(e) { console.error('Error guardando preferencias:', e); }
            // Cambios como el número de trabajador o el avatar pasan por aquí.
            // _publicarResumen solo escribe si algo del resumen cambió de verdad,
            // así que engancharlo aquí cubre todos los casos sin duplicar avisos.
            this._publicarResumen();
        };
        if (inmediato) return guardar();
        this._prefSaveTimer = setTimeout(guardar, 2000);
        return Promise.resolve();
    },

    // Acepta coma o punto: en el teclado español "3,5" se escribe con coma y
    // parseFloat('3,5') daría 3.
    _leerDecimal(v) {
        const n = parseFloat(String(v).replace(',', '.').trim());
        return isNaN(n) ? null : n;
    },

    async _pedirPermisosIniciales() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) { try { await LN.requestPermissions(); } catch(_) {} }
        this._crearCanalesNotificacion();
        if (window.AndroidBridge?.requestLocationPermissions) {
            window.AndroidBridge.requestLocationPermissions();
        } else {
            const Geo = window.Capacitor?.Plugins?.Geolocation;
            if (Geo) { try { await Geo.requestPermissions({ permissions: ['location', 'coarseLocation'] }); } catch(_) {} }
        }
    },

    _crearCanalesNotificacion() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.createChannel) return;
        const channels = [
            { id: 'notif_ding',    name: 'Ding',        sound: 'notif_ding' },
            { id: 'notif_campana', name: 'Campana',      sound: 'notif_campana' },
            { id: 'notif_alerta',  name: 'Alerta',       sound: 'notif_alerta' },
            { id: 'notif_silbido', name: 'Silbido',      sound: 'notif_silbido' },
            { id: 'notif_doble',   name: 'Doble pitido', sound: 'notif_doble' },
            { id: 'notif_fanfare', name: 'Fanfare',      sound: 'notif_fanfare' },
            { id: 'notif_suave',   name: 'Suave',        sound: 'notif_suave' },
        ];
        channels.forEach(ch => {
            LN.createChannel({ ...ch, importance: 5, visibility: 1 }).catch(() => {});
        });
    },

    calcularDistancia(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    registrarJornadaHoy() {
        document.getElementById('workBanner').classList.remove('show');
        this._detenerGeofencingNativo();
        this._cancelarNotificacionTrabajo();
        const horaInicio = localStorage.getItem('lastHoraInicio');
        const horaFin    = localStorage.getItem('lastHoraFin');
        if (horaInicio && horaFin && this.usuarioActual) {
            this._registrarDesdeNotificacion();
        } else {
            this.establecerFechaHoy();
            this.mostrarApp();
            document.getElementById('horasInput').focus();
        }
    },

    // ── CONTROL DE ACCESO ──────────────────────────────────────────────────────

    async _checkUserAuthorized(email) {
        if (email.toLowerCase() === SUPER_USER_EMAIL.toLowerCase()) return true;
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) return true;
            const allowed = await resp.json();
            if (!Array.isArray(allowed) || allowed.length === 0) return true;
            return allowed.map(e => e.toLowerCase()).includes(email.toLowerCase());
        } catch(e) { return true; }
    },

    async _cargarUsuariosAcceso() {
        const el = document.getElementById('allowedUsersList');
        if (!el) return;
        el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">Cargando...</div>';
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) throw new Error(resp.status);
            this._allowedUsersLocal = await resp.json();
            this._renderAllowedUsers();
        } catch(e) {
            el.innerHTML = '<div style="color:#e74c3c;font-size:12px;">Error al cargar lista</div>';
        }
    },

    _renderAllowedUsers() {
        const el = document.getElementById('allowedUsersList');
        if (!el) return;
        const emails = this._allowedUsersLocal || [];
        if (emails.length === 0) {
            el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">Lista vacía — cualquier cuenta puede entrar</div>';
            return;
        }
        el.innerHTML = emails.map(email =>
            `<div class="access-user-item">
                <span class="access-user-email">${email}</span>
                <button class="access-user-remove" onclick="app._removeUserAcceso('${email.replace(/'/g,"\\'")}\')" title="Eliminar">✕</button>
            </div>`
        ).join('');
    },

    async _addUserAcceso() {
        const input = document.getElementById('newUserEmail');
        const email = (input?.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) { this._mostrarToast('❌ Introduce un correo válido'); return; }
        const btn = document.querySelector('#sectionAcceso .ops-body button[onclick*="_addUserAcceso"]');
        if (btn) btn.disabled = true;
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, app: ALLOWLIST_APP })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status)); return; }
            this._allowedUsersLocal = data.emails;
            this._renderAllowedUsers();
            if (input) input.value = '';
            this._mostrarToast('✅ Usuario añadido');
        } catch(e) { this._mostrarToast('❌ Error: ' + e.message); }
        finally { if (btn) btn.disabled = false; }
    },

    async _removeUserAcceso(email) {
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, app: ALLOWLIST_APP })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status)); return; }
            this._allowedUsersLocal = data.emails;
            this._renderAllowedUsers();
            this._mostrarToast('Usuario eliminado');
        } catch(e) { this._mostrarToast('❌ Error: ' + e.message); }
    },

    // ────────────────────────────────────────────────────────────────────────────

    _buildNumToVersion(n) {
        return 'v' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
    },

    _actualizarVersionDisplay() {
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        const n = parseInt(String(APP_VERSION).replace('build-', '')) || 0;
        if (!n) return;
        const el = document.getElementById('versionDisplay');
        if (el) el.textContent = 'Versión ' + this._buildNumToVersion(n);
    },

    // GitHub permite 60 peticiones/hora sin autenticar y la app consulta en cada
    // apertura, así que se comparte una caché corta entre el chequeo de
    // actualizaciones y la lista de versiones para no agotarlas.
    async _releases(forzar) {
        const CACHE = 'releasesCache', EDAD = 'releasesCacheAt';
        if (!forzar) {
            const t = parseInt(sessionStorage.getItem(EDAD) || '0', 10);
            if (Date.now() - t < 5 * 60 * 1000) {
                try { return { ok: true, lista: JSON.parse(sessionStorage.getItem(CACHE) || '[]') }; }
                catch (_) {}
            }
        }
        const resp = await fetch('https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=100');
        if (!resp.ok) {
            // 403 aquí casi siempre es el límite por hora, no un permiso
            return { ok: false, status: resp.status, limite: resp.status === 403 };
        }
        const lista = await resp.json();
        try {
            sessionStorage.setItem(CACHE, JSON.stringify(lista));
            sessionStorage.setItem(EDAD, String(Date.now()));
        } catch (_) {}
        return { ok: true, lista };
    },

    // Qué build pueden instalar los trabajadores. Devuelve {ok:false} cuando no
    // se ha podido leer: en ese caso no se ofrece nada, porque antes un fallo de
    // red dejaba `publicada` a null y la app pasaba a ofrecer la más reciente,
    // saltándose el reparto escalonado justo cuando no había señal.
    async _buildPublicado() {
        try {
            const r = await fetch(VERSION_URL, { cache: 'no-store' });
            if (r.ok) {
                // El fichero guarda un número por app —trabajadores y gestión
                // tienen su propia numeración de builds— para que publicar
                // una no toque el reparto de la otra.
                const build = (await r.json())?.worker ?? null;
                localStorage.setItem('buildPublicado', JSON.stringify(build));
                return { ok: true, build };
            }
        } catch (_) { /* se intenta con lo último que se leyó */ }
        const guardado = localStorage.getItem('buildPublicado');
        if (guardado === null) return { ok: false };
        try { return { ok: true, build: JSON.parse(guardado) }; }
        catch (_) { return { ok: false }; }
    },

    // ── Descargar la aplicación desde el navegador ──────────────────────────
    //
    // Antes esto instalaba la web como aplicación de Chrome. Eso dejaba un
    // icono que abría el navegador disfrazado: sin avisos con la aplicación
    // cerrada y sin nada de lo que trae el APK. Ahora lo que se ofrece es el
    // APK de verdad, cogido de la última versión que le toque a esta
    // aplicación —trabajador, gestión y desarrollador tienen cada una sus
    // propias etiquetas y su propio reparto escalonado—.
    async _urlApkMasReciente() {
        try {
            const res = await this._releases();
            if (!res.ok) return null;
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            // Al administrador se le ofrece la última aunque no esté
            // publicada, igual que en el aviso de actualización.
            const soyGestor = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
            let publicada = null;
            if (!soyGestor) {
                const pub = await this._buildPublicado();
                if (!pub.ok) return null;
                publicada = pub.build;
            }
            let release = null, mejor = 0;
            (Array.isArray(res.lista) ? res.lista : []).forEach(r => {
                const m = re.exec(r.tag_name || '');
                if (!m) return;
                const n = parseInt(m[1], 10);
                if (publicada !== null && n > publicada) return;
                if (n > mejor) { mejor = n; release = r; }
            });
            if (!release) return null;
            const asset = release.assets?.find(a => a.name.endsWith('.apk'));
            // Sin APK adjunto se abre la página de la versión: desde ahí
            // puede bajarlo a mano en vez de quedarse sin nada.
            return { url: asset?.browser_download_url || release.html_url,
                     version: this._buildNumToVersion(mejor) };
        } catch (_) { return null; }
    },

    _debePreguntarModo() {
        if (_enLaApp()) return false;
        const enIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        // En iPhone el APK no sirve de nada, así que no se le pregunta.
        if (enIOS) return false;
        // Aquí se miraba si venía de la aplicación instalada de Chrome para
        // no preguntar. Al revés: quien tiene esa es justo a quien hay que
        // decirle que lo que quiere es el APK.
        return !localStorage.getItem('modoUso');
    },

    _preguntarModoSiToca() {
        if (!this._debePreguntarModo()) {
            try { window._ofrecerInstalarSiToca?.(); } catch (_) {}
            return;
        }
        const pant = document.getElementById('modoScreen');
        if (!pant) { try { window._ofrecerInstalarSiToca?.(); } catch (_) {} return; }
        pant.style.display = '';
        // Qué versión se va a descargar, para que no sea un salto al vacío.
        this._urlApkMasReciente().then(apk => {
            const sub = document.getElementById('modoApkSub');
            if (sub && apk?.version) sub.textContent = 'Última versión: ' + apk.version;
        }).catch(() => {});
    },

    elegirModo(modo) {
        try { localStorage.setItem('modoUso', modo); } catch (_) {}
        const pant = document.getElementById('modoScreen');
        if (pant) pant.style.display = 'none';
        // El cartel de abajo se queda en los dos casos: si se ha descargado
        // el APK y algo ha fallado, sigue teniendo el botón a mano.
        try { window._ofrecerInstalarSiToca?.(); } catch (_) {}
        if (modo === 'apk') this.instalarApp();
    },

    async _checkForUpdates(showFeedback = false) {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        sessionStorage.setItem('lastUpdateCheck', String(Date.now()));
        try {
            // Both apps publish releases to the same repo, so pick only the ones
            // tagged for this app instead of whatever release is newest overall.
            const res = await this._releases(showFeedback);
            if (!res.ok) {
                if (showFeedback) this._mostrarToast(res.limite
                    ? '⏳ GitHub ha limitado las consultas. Prueba en unos minutos.'
                    : '❌ No se pudo comprobar (error ' + res.status + ')', 4500);
                return;
            }
            const lista = res.lista;
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            // El administrador recibe la última aunque no esté publicada, para
            // poder probarla antes de repartirla; al resto solo se les ofrece
            // la que el gestor haya publicado.
            const soyGestor = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
            let publicada = null;
            if (!soyGestor) {
                const pub = await this._buildPublicado();
                if (!pub.ok) {
                    if (showFeedback) this._mostrarToast(
                        '⏳ No se ha podido comprobar qué versión toca instalar. Prueba más tarde.', 4500);
                    return;
                }
                publicada = pub.build;
            }
            let release = null, latestNum = 0, latestTag = '';
            (Array.isArray(lista) ? lista : []).forEach(r => {
                const m = re.exec(r.tag_name || '');
                if (!m) return;
                const n = parseInt(m[1], 10);
                // Sin versión publicada se comporta como antes: la más reciente
                if (publicada !== null && n > publicada) return;
                if (n > latestNum) { latestNum = n; release = r; latestTag = r.tag_name; }
            });
            const currentNum = parseInt(String(APP_VERSION).replace('build-', '')) || 0;
            if (latestNum === 0) {
                // No hay ninguna versión aplicable: o no hay releases, o todas
                // son posteriores a la que el gestor ha publicado. En ninguno de
                // los dos casos hay nada que instalar, así que no es un error.
                if (showFeedback) this._mostrarToast('✅ Tienes instalada la última versión disponible');
                return;
            }
            if (latestNum > currentNum) {
                const asset = release.assets?.find(a => a.name.endsWith('.apk'));
                this._updateApkUrl = asset?.browser_download_url || release.html_url;
                const texto  = `${this._buildNumToVersion(latestNum)} disponible (tienes ${this._buildNumToVersion(currentNum)})`;
                const banner = document.getElementById('updateBanner');
                const msg    = document.getElementById('updateBannerMsg');
                if (msg) msg.textContent = texto;
                if (banner) banner.style.display = 'flex';
                // Auto-popup unless snoozed. "Más tarde" only postpones it for a
                // few hours — never permanently, or a single dismissal would
                // strand the user on an old build.
                this._updateLatestNum = latestNum;
                const modal    = document.getElementById('updateModal');
                const modalMsg = document.getElementById('updateModalMsg');
                const snooze   = parseInt(localStorage.getItem('updateSnooze_' + latestNum) || '0', 10);
                if (modal && (showFeedback || Date.now() >= snooze)) {
                    if (modalMsg) modalMsg.textContent = texto;
                    modal.style.display = 'flex';
                }
            } else if (showFeedback) {
                // Tener una versión posterior a la publicada tampoco es un
                // problema: simplemente no hay actualización que ofrecer.
                this._mostrarToast('✅ Tienes instalada la última versión disponible ('
                    + this._buildNumToVersion(currentNum) + ')');
            }
        } catch(_) {
            if (showFeedback) this._mostrarToast('❌ No se pudo comprobar la versión');
        }
    },

    _posponerActualizacion() {
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
        if (this._updateLatestNum) {
            localStorage.setItem('updateSnooze_' + this._updateLatestNum,
                String(Date.now() + 8 * 60 * 60 * 1000));
        }
    },

    _descargarActualizacion() {
        const url = this._updateApkUrl;
        if (!url) return;
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
        const overlay = document.getElementById('updateProgressOverlay');
        if (overlay) overlay.style.display = 'flex';
        const bar = document.getElementById('updateProgressBar');
        const pct = document.getElementById('updateProgressPct');
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (bar) bar.style.width = '0%';
        if (pct) pct.textContent = '0%';
        if (txt) txt.textContent = 'Descargando nueva versión...';
        if (closeBtn) closeBtn.style.display = 'none';
        if (window.AndroidBridge?.downloadAndInstallApk) {
            window.AndroidBridge.downloadAndInstallApk(url);
        } else {
            if (overlay) overlay.style.display = 'none';
            window.open(url, '_system');
        }
    },

    _onUpdateProgress(pct) {
        const bar = document.getElementById('updateProgressBar');
        const pctEl = document.getElementById('updateProgressPct');
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (pct >= 100) {
            if (txt) txt.textContent = 'Instalando... el sistema pedirá confirmación.';
            if (closeBtn) closeBtn.style.display = 'inline-block';
        }
    },

    _onUpdateError() {
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (txt) txt.textContent = 'Error al descargar. Inténtalo de nuevo.';
        if (closeBtn) closeBtn.style.display = 'inline-block';
    },

    _mostrarExportTexto(json) {
        const uid = 'exp-' + Date.now();
        const overlay = document.createElement('div');
        overlay.id = uid + '-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
        overlay.innerHTML = `
            <div style="background:var(--card);border-radius:16px;padding:20px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;gap:12px">
                <div style="font-weight:700;font-size:16px">Copia de seguridad</div>
                <div style="font-size:12px;color:var(--text-secondary)">Copia este texto y guárdalo en un archivo .json</div>
                <textarea id="${uid}" readonly style="flex:1;min-height:200px;font-family:monospace;font-size:11px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);resize:none"></textarea>
                <div style="display:flex;gap:8px">
                    <button id="${uid}-copy" style="flex:1;padding:10px;border-radius:8px;background:var(--primary);color:#fff;border:none;cursor:pointer">Copiar</button>
                    <button onclick="document.getElementById('${uid}-overlay').remove()" style="flex:1;padding:10px;border-radius:8px;background:var(--border);border:none;cursor:pointer">Cerrar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById(uid).value = json;
        document.getElementById(uid + '-copy').onclick = () => {
            navigator.clipboard.writeText(json).then(() => {
                document.getElementById(uid + '-copy').textContent = '✅ Copiado';
            });
        };
    }
};

app.init();

const _isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const _isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

// Ofrecer la descarga antes de entrar no vale para nada: desde la pantalla de
// "¿con cuál entras?" no se sabe cuál de las dos aplicaciones quiere, y son
// dos distintas. Así que el cartel espera a que haya iniciado sesión: para
// entonces ya está en la suya. Tampoco sale encima de la pantalla en la que
// está eligiendo si se la descarga.
// Dentro del APK no hay nada que ofrecer: ya la tiene instalada. Ni el
// cartel de abajo, ni la opción de Opciones, ni la pantalla de "¿cómo
// quieres usarla?".
function _enLaApp() {
    return !!(window.Capacitor?.isNativePlatform?.() || window.AndroidBridge);
}

function _puedeOfrecerInstalar() {
    if (_enLaApp()) return false;
    if (_isStandalone) return false;
    for (const id of ['rolScreen', 'modoScreen']) {
        const p = document.getElementById(id);
        if (p && getComputedStyle(p).display !== 'none') return false;
    }
    return !!(typeof app !== 'undefined' && app?.usuarioActual?.email);
}

window._ofrecerInstalarSiToca = function() {
    _showInstallBanner(_isIOS);
};

function _showInstallBanner(ios) {
    if (!_puedeOfrecerInstalar()) return;
    const banner = document.getElementById('installBanner');
    const msg = document.getElementById('installBannerMsg');
    if (msg) msg.textContent = ios
        ? 'Toca Compartir ↑ → "Añadir a inicio"'
        : 'Descarga el APK: avisa aunque esté cerrada';
    const bannerBtn = document.getElementById('installBannerBtn');
    if (bannerBtn) bannerBtn.style.display = ios ? 'none' : '';
    if (banner) banner.classList.add('show');
    const sec = document.getElementById('installSection');
    if (sec) sec.style.display = '';
}

// Chrome ofrece por su cuenta instalar la web como aplicación suya. Eso es
// justo lo que no queremos —el icono abriría el navegador disfrazado—, así
// que se le corta el paso y el único ofrecimiento es el APK.
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); });

// Descargar el APK de la última versión que le toque.
app.instalarApp = async function() {
    if (_isIOS) {
        alert('En iPhone no hay aplicación que instalar.\n\nPara tenerla a mano:\n1. Toca Compartir (□↑)\n2. "Añadir a pantalla de inicio"');
        return;
    }
    const btn = document.getElementById('installBannerBtn');
    const antes = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Buscando…'; btn.disabled = true; }
    const apk = await app._urlApkMasReciente();
    if (btn) { btn.textContent = antes; btn.disabled = false; }
    if (!apk) {
        app._mostrarToast?.('❌ No se ha podido encontrar la aplicación para descargar. Prueba en unos minutos.', 5000);
        return;
    }
    app._mostrarToast?.('⬇️ Descargando ' + apk.version + '…', 4000);
    // Los APK de GitHub vienen con Content-Disposition: se descargan sin
    // sacarle de la página.
    window.location.href = apk.url;
};
app.ocultarInstallBanner = function() { const b = document.getElementById('installBanner'); if (b) b.classList.remove('show'); };
