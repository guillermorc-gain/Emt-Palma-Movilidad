// En la web las dos apps se sirven desde el mismo dominio, y localStorage va
// por origen, no por ruta: sin esto gestión y la app de los trabajadores se
// pisarían la sesión, el historial y los ajustes. En el móvil cada APK tiene su
// propio almacenamiento, así que no hace falta y se deja tal cual.
(function aislarAlmacenamiento() {
    try {
        if (window.Capacitor?.isNativePlatform?.()) return;
        const real = window.localStorage;
        const P = 'gestion:';
        const shim = {
            getItem:    k => real.getItem(P + k),
            setItem:    (k, v) => real.setItem(P + k, v),
            removeItem: k => real.removeItem(P + k),
            clear:      () => Object.keys(real).filter(k => k.startsWith(P)).forEach(k => real.removeItem(k)),
            key:        i => Object.keys(real).filter(k => k.startsWith(P))[i]?.slice(P.length) ?? null,
            get length() { return Object.keys(real).filter(k => k.startsWith(P)).length; },
        };
        Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
    } catch (_) { /* si el navegador no deja, se sigue con el de siempre */ }
})();

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
let DIAS_POR_LUGAR = {};
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
        if (Array.isArray(l?.dias) && l.dias.length) DIAS_POR_LUGAR[k] = l.dias;
        else delete DIAS_POR_LUGAR[k];
        const nombre = l?.nombre;
        if (nombre && !PUESTOS_DEFINIDOS.some(p => p.toLowerCase().normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') === k)) {
            PUESTOS_DEFINIDOS.push(nombre);
        }
    });
}

// De qué aplicación se trata. La de desarrollador se compila del mismo sitio
// que la de gestión, así que lo único que las distingue es esta etiqueta, que
// el propio montaje cambia. Sin ella, gestión.
const ROL_APP = (document.querySelector('meta[name="app-rol"]')?.content || 'gestion').trim();

const SUPER_USER_EMAIL = 'g.rioscorrea@gmail.com';
const ALLOWLIST_APP    = 'gestion';
// A dónde devuelve Google la entrada cuando se hace desde la aplicación. Esta
// dirección exacta tiene que estar dada de alta en la consola de Google como
// URI de redirección autorizada: si no coincide, Google no devuelve a nadie.
// De ahí que esté aquí sola, en un sitio, y no repetida por el fichero.
const RETORNO_APP = 'https://emt-palma-movilidad.vercel.app/';
const LUGARES_URL      = 'https://emt-palma-movilidad.vercel.app/api/lugares';
const VERSION_URL      = 'https://emt-palma-movilidad.vercel.app/api/version';
// La de desarrollador se compila de aquí mismo: mismo código, otro paquete y
// otra numeración de versiones, para poder tener las dos instaladas a la vez
// y probar en una sin tocar la que usa la gente.
const ES_APP_DEV       = ROL_APP === 'desarrollador';
const ANDROID_PACKAGE  = ES_APP_DEV ? 'com.guillermorc.devemt' : 'com.guillermorc.gestionemt';
const RELEASE_PREFIX   = ES_APP_DEV ? 'dev-build-' : 'gestion-build-';
const DRIVE_FILE_NAME  = 'gestion-emt-movilidad.json';
const HORAS_ANUALES    = 777;

const NOCHE_INICIO_MIN = 21 * 60;
const NOCHE_FIN_MIN    = 6  * 60;

const AVATAR_EMOJIS = ['🚌','⭐','🔥','⚡','🌊','🎯','🚀','🦸','🎨','🌈'];
const AVATAR_BG     = ['#667eea','#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e67e22','#764ba2','#e91e63'];
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Personalizar la app más allá del color y el modo oscuro: el tamaño del
// texto, la cabecera, las pestañas, las animaciones y la pantalla de inicio.
// Se guarda junto y se aplica como clases en <html>, antes de pintar nada.
const PERSONAL_DEF = { texto: 'normal', cabecera: 'degradado', pestanas: 'todo',
                       animaciones: true, inicio: 'normal', pestanaInicio: '0',
                       estilo: 'clasico', fuente: 'sistema', tema: '' };
const ZOOM_TEXTO = { pequeno: 0.9, normal: 1, grande: 1.12, muygrande: 1.25 };
function leerPersonal() {
    try { return { ...PERSONAL_DEF, ...JSON.parse(localStorage.getItem('personal') || '{}') }; }
    catch (_) { return { ...PERSONAL_DEF }; }
}
function aplicarPersonal(p) {
    const h = document.documentElement;
    const z = ZOOM_TEXTO[p.texto] || 1;
    // El texto crece con todo lo demás: la app está medida en píxeles
    h.style.zoom = z === 1 ? '' : String(z);
    h.style.setProperty('--z', String(z));
    h.classList.toggle('p-zoom', z !== 1);
    h.classList.toggle('p-cab-liso', p.cabecera === 'liso');
    h.classList.toggle('p-solo-iconos', p.pestanas === 'iconos');
    h.classList.toggle('p-sin-anim', p.animaciones === false);
    h.classList.toggle('p-inicio-rapido', p.inicio === 'rapido');
    aplicarEstiloYFuente(p);
}

// ── Estilo y tipografía (Opciones → Apariencia) ──────────────────────────
// El estilo cambia la forma de todo sin tocar cada regla a mano: se recorren
// las hojas de estilo y, para las que llevan esquinas, sombras o degradados,
// se añade una copia retocada que solo vale con ese estilo puesto. Lo redondo
// de verdad (50 %) y las píldoras se dejan como están.
const ESTILOS_FORMA = {
    redondeado: { radio: r => Math.min(Math.round(r * 1.7), 26) },
    recto:      { radio: r => Math.min(r, 3) },
    plano:      { radio: r => Math.round(r * 0.6), plano: true },
};
function reglasDeEstilo(nombre) {
    const e = ESTILOS_FORMA[nombre];
    if (!e) return '';
    const pre = `html[data-estilo="${nombre}"]`;
    const conPrefijo = sel => sel.split(/,(?![^(]*\))/).map(s => {
        s = s.trim();
        if (/^html\b/.test(s)) return s.replace(/^html/, pre);
        if (/^:root\b/.test(s)) return s.replace(/^:root/, pre);
        return pre + ' ' + s;
    }).join(', ');
    const radio = v => {
        if (!v || /%|var\(|calc\(/.test(v)) return null;
        const nums = v.match(/[\d.]+px/g);
        if (!nums || nums.some(n => parseFloat(n) >= 50)) return null;
        const nuevo = v.replace(/([\d.]+)px/g, (_, n) => e.radio(parseFloat(n)) + 'px');
        return nuevo === v ? null : nuevo;
    };
    const primerColor = g => {
        const m = /(?:^|\s)linear-gradient\((.*)\)/.exec(g || '');
        if (!m) return null;
        const partes = m[1].split(/,(?![^(]*\))/).map(x => x.trim());
        const stop = /deg$|^to\s/.test(partes[0]) ? partes[1] : partes[0];
        return stop ? stop.replace(/\s+-?[\d.]+(%|px)?$/, '') : null;
    };
    const recorrer = reglas => {
        let out = '';
        for (const r of reglas) {
            if (r.type === 4 && r.cssRules) {          // @media
                const dentro = recorrer(r.cssRules);
                if (dentro) out += `@media ${r.conditionText || r.media.mediaText}{${dentro}}`;
                continue;
            }
            if (r.type !== 1 || !r.selectorText) continue;
            const decl = [];
            const imp = p => r.style.getPropertyPriority(p) ? ' !important' : '';
            const br = radio(r.style.borderRadius);
            if (br) decl.push(`border-radius:${br}${imp('border-radius')}`);
            if (e.plano) {
                if (r.style.boxShadow && r.style.boxShadow !== 'none') decl.push('box-shadow:none !important');
                // Con variables de color el navegador no separa el fondo en
                // partes y solo lo da entero
                const bg = r.style.backgroundImage || r.style.background || '';
                if (/linear-gradient/.test(bg) && !/repeating/.test(bg)) {
                    const c = primerColor(bg);
                    if (c) decl.push(`background:${c}${imp('background-image')}`);
                }
            }
            if (decl.length) out += `${conPrefijo(r.selectorText)}{${decl.join(';')}}`;
        }
        return out;
    };
    let css = '';
    for (const hoja of document.styleSheets) {
        if (hoja.ownerNode?.id === 'pEstiloCss') continue;
        try { css += recorrer(hoja.cssRules); } catch (_) { /* hoja de otro sitio */ }
    }
    return css;
}
// Las marcas que cierran las apps de fondo por su cuenta, y qué tocar en
// cada una para que los avisos lleguen con la app cerrada.
const MARCAS_BATERIA = [
    { re: /xiaomi|redmi|poco/, nombre: 'Xiaomi',
      pasos: 'Activa «Inicio automático» para esta aplicación. Después, en su ficha › Ahorro de batería, elige «Sin restricciones».' },
    { re: /huawei|honor/, nombre: 'Huawei / Honor',
      pasos: 'En «Inicio de aplicaciones», desactiva «Gestionar automáticamente» para esta aplicación y deja activadas las tres opciones.' },
    { re: /oppo|realme|oneplus/, nombre: 'OPPO / realme / OnePlus',
      pasos: 'Activa «Permitir inicio automático». Después, en su ficha › Batería, activa «Permitir actividad en segundo plano».' },
    { re: /vivo|iqoo/, nombre: 'vivo',
      pasos: 'Activa «Inicio automático». Después, en Batería, permite el consumo en segundo plano.' },
    { re: /samsung/, nombre: 'Samsung',
      pasos: 'En la ficha de la aplicación › Batería, elige «Sin restricciones», y comprueba que no esté en «Aplicaciones en suspensión profunda».' },
    { re: /asus/, nombre: 'ASUS',
      pasos: 'Activa el «Inicio automático» de esta aplicación en el gestor del móvil.' },
];
// ── Temas (Opciones → Apariencia → Tema) ─────────────────────────────────
// Un tema cambia la app entera: colores, tipografía, formas y cabecera. Los
// colores fijos de las hojas de estilo (el blanco de las tarjetas, el gris
// del texto, los bordes…) se reasignan a los del tema recorriendo las reglas,
// igual que el estilo; lo demás (tipografía, cabecera) va en el CSS de cada
// tema. Cada uno tiene su versión clara y su versión oscura: la suya
// de siempre y la de alt, que cambia los colores de fondo y de texto.
const TEMAS_APP = {
    medianoche:   { nombre: 'Medianoche', oscuro: true, estilo: '', muestra: ['#0b1020', '#22d3ee', '#6366f1'],
                    bg: '#0b1020', card: '#141c33', soft: '#1a2444', tint: '#1b2d6b', ink: '#dce6ff', sub: '#8b9ac4', line: '#26345e', acento: '#22d3ee',
                    alt: { bg: '#eef2fb', card: '#ffffff', soft: '#e6ecf8', tint: '#dfe6fb', ink: '#16203d', sub: '#5d6a8f', line: '#d5dcef', tab: '#ffffff', on: '#4f46e5', acento: '#4338ca' } },
    amanecer:     { nombre: 'Amanecer', oscuro: false, estilo: 'redondeado', muestra: ['#fff7f0', '#ff8a4c', '#ff5f7e'],
                    bg: '#fff7f0', card: '#ffffff', soft: '#fff0e6', tint: '#ffe7d8', ink: '#3b2a24', sub: '#9b7d70', line: '#ffd9c2', acento: '#c2410c',
                    alt: { bg: '#1f1512', card: '#2a1d18', soft: '#33231d', tint: '#4a2a1f', ink: '#ffe9dc', sub: '#c09a88', line: '#4a342a', tab: '#1a1210', on: '#ff8a4c', acento: '#ff9a66' } },
    bosque:       { nombre: 'Bosque', oscuro: false, estilo: 'plano', muestra: ['#f1efe6', '#2f5a3e', '#6b8f47'],
                    bg: '#f1efe6', card: '#fbfaf5', soft: '#ece8da', tint: '#e3ecdc', ink: '#233127', sub: '#6f7a68', line: '#dcd7c5', acento: '#2f5a3e',
                    alt: { bg: '#141c16', card: '#1c261f', soft: '#223027', tint: '#2a3d2f', ink: '#e3eadb', sub: '#9aa892', line: '#2f3f33', tab: '#121914', on: '#8fbf6a', acento: '#8fbf6a' } },
    oceano:       { nombre: 'Océano', oscuro: false, estilo: 'redondeado', muestra: ['#e0f7fa', '#00a6b8', '#1565c0'],
                    bg: '#e6f6fa', card: 'rgba(255, 255, 255, 0.8)', soft: '#dff1f7', tint: '#d3eef6', ink: '#0f3b4c', sub: '#5b7f8f', line: '#c9e3ec', acento: '#0a6f94',
                    alt: { bg: '#06222e', card: '#0b2f3d', soft: '#0f3848', tint: '#10455a', ink: '#d6f3fb', sub: '#7fb0c0', line: '#15485a', tab: '#072630', on: '#3fd0e0', acento: '#3fd0e0' } },
    grafito:      { nombre: 'Grafito', oscuro: true, estilo: 'recto', muestra: ['#1a1b1e', '#f4c542', '#34353a'],
                    bg: '#1a1b1e', card: '#232428', soft: '#2a2b30', tint: '#3a3320', ink: '#e6e3dc', sub: '#9a978f', line: '#34353a', acento: '#f4c542',
                    alt: { bg: '#f2f1ee', card: '#ffffff', soft: '#eae8e3', tint: '#f7eecd', ink: '#26272b', sub: '#6d6b66', line: '#dedbd3', tab: '#ffffff', on: '#a87c0d', acento: '#8a6508' } },
    pastel:       { nombre: 'Pastel', oscuro: false, estilo: 'redondeado', muestra: ['#f6f3ff', '#c9b8ff', '#a8e6cf'],
                    bg: '#f6f3ff', card: '#ffffff', soft: '#f1edff', tint: '#ece6ff', ink: '#3d3654', sub: '#8a83a3', line: '#e5defa', acento: '#6d4fe0',
                    alt: { bg: '#1e1b2e', card: '#28243d', soft: '#2f2a48', tint: '#3a3358', ink: '#ece6ff', sub: '#a79fc4', line: '#3d3660', tab: '#1a1728', on: '#c9b8ff', acento: '#c9b8ff' } },
    retro:        { nombre: 'Retro 80', oscuro: true, estilo: 'recto', muestra: ['#1b0f33', '#ff3cac', '#ffd319'],
                    bg: '#1b0f33', card: '#251548', soft: '#2d1a57', tint: '#3a2468', ink: '#f3e9ff', sub: '#b7a3d9', line: '#784ba0', acento: '#ffd319',
                    alt: { bg: '#fff0fa', card: '#ffffff', soft: '#fbe6f5', tint: '#f3e0ff', ink: '#2b1640', sub: '#7a5c96', line: '#e9c6f0', tab: '#ffffff', on: '#d10f86', acento: '#b00d72' } },
    mediterraneo: { nombre: 'Mediterráneo', oscuro: false, estilo: '', muestra: ['#fbfaf7', '#1d4e89', '#c8553d'],
                    bg: '#fbfaf7', card: '#ffffff', soft: '#f4f1ea', tint: '#e8eef6', ink: '#1d3557', sub: '#6b7a8f', line: '#e7e2d8', acento: '#1d4e89',
                    alt: { bg: '#0f1a2b', card: '#16243a', soft: '#1b2c46', tint: '#1d3557', ink: '#e8eef6', sub: '#93a4bd', line: '#26395a', tab: '#0d1726', on: '#7fb2f0', acento: '#7fb2f0' } },
};
// Los colores fijos de la app, por su papel (en claro y en oscuro)
const COLORES_FIJOS = {
    fondo: {
        card: ['white', 'rgb(255, 255, 255)', 'rgb(30, 42, 58)'],
        soft: ['rgb(240, 240, 240)', 'rgb(238, 241, 246)', 'rgb(244, 246, 249)', 'rgb(238, 242, 247)', 'rgb(232, 234, 240)', 'rgb(245, 247, 250)',
               'rgb(22, 32, 46)', 'rgb(35, 43, 69)', 'rgb(22, 31, 46)', 'rgb(29, 39, 56)', 'rgb(45, 53, 97)'],
        bg:   ['rgb(17, 24, 39)'],
        tint: ['rgb(234, 242, 253)', 'rgb(20, 40, 63)'],
    },
    texto: {
        ink: ['rgb(44, 62, 80)', 'rgb(51, 51, 51)', 'rgb(85, 85, 85)', 'rgb(224, 224, 224)', 'rgb(230, 237, 243)'],
        sub: ['rgb(127, 140, 141)', 'rgb(149, 165, 166)', 'rgb(90, 107, 125)', 'rgb(93, 109, 126)', 'rgb(160, 160, 160)',
              'rgb(200, 207, 224)', 'rgb(147, 161, 179)', 'rgb(125, 133, 144)'],
    },
    borde: {
        line: ['rgb(223, 228, 234)', 'rgb(232, 234, 240)', 'rgb(207, 216, 227)', 'rgb(242, 242, 242)', 'rgb(239, 239, 239)',
               'rgb(240, 240, 240)', 'rgb(224, 224, 224)', 'rgb(45, 53, 97)', 'rgb(245, 245, 245)', 'rgb(236, 240, 241)'],
    },
};
// En oscuro o en claro: lo que se eligió en Modo oscuro para el tema, o
// si no se tocó, su versión de siempre
function temaEnOscuro(p) {
    return typeof p.temaOscuro === 'boolean' ? p.temaOscuro : !!TEMAS_APP[p.tema]?.oscuro;
}
function reglasDeTema(id, oscuro) {
    const base = TEMAS_APP[id];
    if (!base) return '';
    const otra = !!base.alt && oscuro !== base.oscuro;
    const t = otra ? { ...base, ...base.alt } : base;
    const mapa = {};
    Object.entries(COLORES_FIJOS).forEach(([tipo, roles]) => {
        mapa[tipo] = {};
        Object.entries(roles).forEach(([rol, lista]) => lista.forEach(c => { mapa[tipo][c] = t[rol]; }));
    });
    const pre = `html[data-tema="${id}"]`;
    // Con :where el tema no suma prioridad: cada regla suya pesa lo mismo
    // que la que cambia, y así no pisa a las más concretas (el botón
    // elegido, el activo…), que se quedaban con el fondo de los demás.
    const cond = `:where([data-tema="${id}"])`;
    const conPrefijo = sel => sel.split(/,(?![^(]*\))/).map(x => {
        x = x.trim();
        if (/^html\b/.test(x)) return x.replace(/^html/, 'html' + cond);
        if (/^:root\b/.test(x)) return x.replace(/^:root/, ':root' + cond);
        return `:where(${pre}) ${x}`;
    }).join(', ');
    const props = [['color', 'texto'], ['background-color', 'fondo'],
                   ['border-top-color', 'borde'], ['border-right-color', 'borde'],
                   ['border-bottom-color', 'borde'], ['border-left-color', 'borde']];
    const recorrer = reglas => {
        let out = '';
        for (const r of reglas) {
            if (r.type === 4 && r.cssRules) {
                const dentro = recorrer(r.cssRules);
                if (dentro) out += `@media ${r.conditionText || r.media.mediaText}{${dentro}}`;
                continue;
            }
            if (r.type !== 1 || !r.selectorText || /#splashScreen|rol-|modo/.test(r.selectorText)) continue;
            const decl = [];
            props.forEach(([p, tipo]) => {
                const v = r.style.getPropertyValue(p);
                const nuevo = v && mapa[tipo][v];
                if (nuevo) decl.push(`${p}:${nuevo}${r.style.getPropertyPriority(p) ? ' !important' : ''}`);
            });
            // El color del tema usado como letra: el de relleno (--g1) no se
            // lee en todas las versiones, así que va el acento del tema
            const letra = r.style.getPropertyValue('color');
            if (t.acento && /var\(--g[12]\)/.test(letra)) {
                decl.push(`color:${t.acento}${r.style.getPropertyPriority('color') ? ' !important' : ''}`);
            }
            // El fondo dado con la abreviatura y un color solo
            const bg = r.style.getPropertyValue('background');
            if (bg && !r.style.getPropertyValue('background-color') && mapa.fondo[bg.trim()]) {
                decl.push(`background:${mapa.fondo[bg.trim()]}`);
            }
            if (decl.length) out += `${conPrefijo(r.selectorText)}{${decl.join(';')}}`;
        }
        return out;
    };
    let css = '';
    for (const hoja of document.styleSheets) {
        if (['pEstiloCss', 'pTemaCss'].includes(hoja.ownerNode?.id)) continue;
        try { css += recorrer(hoja.cssRules); } catch (_) {}
    }
    // El fondo y la barra de pestañas de la otra versión
    if (otra) css += `${pre}[data-modo] .container{background:${t.bg} !important}`
                  + `${pre}[data-modo]{--tema-tab:${t.tab};--tema-on:${t.on}}`;
    return css;
}
// Sin tema y en oscuro, el azul de la app como letra no se lee sobre las
// tarjetas oscuras: esas letras pasan a un azul claro. Se saca de las hojas
// de estilo, como los temas, para no tener que ir regla por regla.
function letraDeAcentoEnOscuro() {
    if (document.getElementById('pAcentoOscuro')) return;
    const pre = 'html:not([data-tema]) body.dark';
    const reglas = [];
    const recorrer = lista => {
        for (const r of lista) {
            if (r.type === 4 && r.cssRules) { recorrer(r.cssRules); continue; }
            if (r.type !== 1 || !r.selectorText) continue;
            if (!/var\(--g[12]\)/.test(r.style.getPropertyValue('color'))) continue;
            const sel = r.selectorText.split(/,(?![^(]*\))/).map(x => x.trim())
                .filter(x => !/^(html|:root|body)\b/.test(x)).map(x => `${pre} ${x}`).join(', ');
            if (sel) reglas.push(`${sel}{color:#6fb1ff !important}`);
        }
    };
    for (const hoja of document.styleSheets) {
        if (['pEstiloCss', 'pTemaCss'].includes(hoja.ownerNode?.id)) continue;
        try { recorrer(hoja.cssRules); } catch (_) {}
    }
    const el = document.createElement('style');
    el.id = 'pAcentoOscuro';
    el.textContent = reglas.join('');
    document.head.appendChild(el);
}

function aplicarTemaApp(p) {
    letraDeAcentoEnOscuro();
    const h = document.documentElement;
    const id = TEMAS_APP[p.tema] ? p.tema : '';
    if (id) h.dataset.tema = id; else delete h.dataset.tema;
    const oscuro = !!id && temaEnOscuro(p);
    if (id) h.dataset.modo = oscuro ? 'oscuro' : 'claro'; else delete h.dataset.modo;
    const clave = id + (oscuro ? ':oscuro' : ':claro');
    let el = document.getElementById('pTemaCss');
    if (!id) { if (el) el.textContent = ''; return; }
    if (el?.dataset.de === clave) return;
    if (!el) { el = document.createElement('style'); el.id = 'pTemaCss'; document.head.appendChild(el); }
    el.textContent = reglasDeTema(id, oscuro);
    el.dataset.de = clave;
}
function aplicarEstiloYFuente(p) {
    const h = document.documentElement;
    const tema = TEMAS_APP[p.tema];
    aplicarTemaApp(p);
    // Con un tema puesto, la forma y la letra son las suyas
    const deseado = tema ? tema.estilo : p.estilo;
    const estilo = ESTILOS_FORMA[deseado] ? deseado : '';
    if (estilo) h.dataset.estilo = estilo; else delete h.dataset.estilo;
    if (!tema && p.fuente && p.fuente !== 'sistema') h.dataset.fuente = p.fuente; else delete h.dataset.fuente;
    let el = document.getElementById('pEstiloCss');
    if (!estilo) { if (el) el.textContent = ''; return; }
    if (el?.dataset.de === estilo) return;
    if (!el) { el = document.createElement('style'); el.id = 'pEstiloCss'; document.head.appendChild(el); }
    el.textContent = reglasDeEstilo(estilo);
    el.dataset.de = estilo;
}
try { aplicarPersonal(leerPersonal()); } catch (_) {}

// Los sonidos para elegir. Cada uno son tramos seguidos: [Hz, segundos,
// forma, Hz final]; con Hz 0 es un silencio. El montaje del APK hace los
// ficheros con los mismos tramos, así que la prueba suena igual que el aviso.
const SONIDOS = [
    { id: 'notif_ding', nombre: 'Ding', tramos: [[880, 1.0, 'bell']] },
    { id: 'notif_campana', nombre: 'Campana', tramos: [[660, 0.5, 'bell'], [880, 0.75, 'bell']] },
    { id: 'notif_alerta', nombre: 'Alerta', tramos: [[440, 0.2], [0, 0.05], [660, 0.2], [0, 0.05], [880, 0.3]] },
    { id: 'notif_silbido', nombre: 'Silbido', tramos: [[800, 0.42, 'sweep', 1400], [1400, 0.38, 'sweep', 800]] },
    { id: 'notif_doble', nombre: 'Doble pitido', tramos: [[880, 0.3], [0, 0.12], [880, 0.3]] },
    { id: 'notif_fanfare', nombre: 'Fanfare', tramos: [[440, 0.2], [550, 0.2], [660, 0.2], [880, 0.6, 'bell']] },
    { id: 'notif_suave', nombre: 'Suave', tramos: [[330, 1.2, 'bell']] },
    { id: 'notif_xilofono', nombre: 'Xilófono', tramos: [[523, 0.16, 'bell'], [659, 0.16, 'bell'], [784, 0.16, 'bell'], [1047, 0.5, 'bell']] },
    { id: 'notif_dingdong', nombre: 'Ding-dong', tramos: [[784, 0.55, 'bell'], [622, 0.9, 'bell']] },
    { id: 'notif_burbuja', nombre: 'Burbuja', tramos: [[400, 0.12, 'sweep', 900], [0, 0.06], [500, 0.14, 'sweep', 1150]] },
    { id: 'notif_claxon', nombre: 'Claxon', tramos: [[392, 0.22], [0, 0.08], [392, 0.45]] },
    { id: 'notif_arpa', nombre: 'Arpa', tramos: [[1047, 0.14, 'bell'], [880, 0.14, 'bell'], [784, 0.14, 'bell'], [659, 0.14, 'bell'], [523, 0.6, 'bell']] },
    { id: 'notif_triple', nombre: 'Triple pitido', tramos: [[1200, 0.1], [0, 0.08], [1200, 0.1], [0, 0.08], [1200, 0.1]] },
    { id: 'notif_sirena', nombre: 'Sirena', tramos: [[600, 0.35, 'sweep', 1000], [1000, 0.35, 'sweep', 600], [600, 0.35, 'sweep', 1000], [1000, 0.35, 'sweep', 600]] },
    { id: 'notif_gota', nombre: 'Gota', tramos: [[1500, 0.12, 'sweep', 500], [0, 0.05], [1200, 0.35, 'bell']] },
    { id: 'notif_marimba', nombre: 'Marimba', tramos: [[523, 0.22, 'bell'], [784, 0.22, 'bell'], [659, 0.5, 'bell']] },
    { id: 'notif_cristal', nombre: 'Cristal', tramos: [[2093, 0.9, 'bell']] },
    { id: 'notif_moneda', nombre: 'Moneda', tramos: [[988, 0.08], [1319, 0.45, 'bell']] },
    { id: 'notif_pajaro', nombre: 'Pájaro', tramos: [[2000, 0.08, 'sweep', 2600], [0, 0.05], [2200, 0.08, 'sweep', 2800], [0, 0.05], [2400, 0.12, 'sweep', 3000]] },
];
// Suena un sonido de la tabla en el navegador, para probarlo al elegirlo
function sonarTramos(id) {
    const s = SONIDOS.find(x => x.id === id);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!s || !AC) return false;
    const ctx = new AC();
    let t = ctx.currentTime + 0.05;
    s.tramos.forEach(([f, d, forma, f2]) => {
        if (f) {
            const osc = ctx.createOscillator(); const g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.frequency.setValueAtTime(f, t);
            if (forma === 'sweep') osc.frequency.linearRampToValueAtTime(f2 || f, t + d);
            const sube = Math.min(0.012, d / 4);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.5, t + sube);
            if (forma === 'bell') g.gain.exponentialRampToValueAtTime(0.001, t + d);
            else {
                g.gain.setValueAtTime(0.5, t + Math.max(sube, d - Math.min(0.07, d / 3)));
                g.gain.linearRampToValueAtTime(0, t + d);
            }
            osc.start(t); osc.stop(t + d + 0.02);
        }
        t += d;
    });
    return true;
}

// La matrícula con sus guiones aunque se escriban sin ellos: las de ahora,
// 1234ABC → 1234-ABC, y las de provincia de antes, PM1234AB → PM-1234-AB.
// Lo que no tenga una de esas formas (extranjeras, remolques…) se deja
// como se escribió, solo en mayúsculas.
function formatoMatricula(m) {
    const t = String(m || '').trim().toUpperCase();
    const k = t.replace(/[^A-Z0-9]/g, '');
    let x = /^(\d{4})([A-Z]{3})$/.exec(k);
    if (x) return `${x[1]}-${x[2]}`;
    x = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/.exec(k);
    if (x) return `${x[1]}-${x[2]}-${x[3]}`;
    return t;
}

const app = {
    accessToken: localStorage.getItem('gAccessToken') || null,
    tokenExpiry: parseInt(localStorage.getItem('gTokenExpiry') || '0'),
    refreshToken: localStorage.getItem('gRefreshToken') || null,
    driveFileId: localStorage.getItem('driveFileId') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    horasAnualesCustom: parseFloat(localStorage.getItem('horasAnuales')) || HORAS_ANUALES,
    precioNocheDefault: parseFloat(localStorage.getItem('precioNoche')) || 0,
    modalCallback: null,
    editingId: null,
    prActivo: false,
    festivoActivo: false,
    extraActivo: false,
    vacacionesActivo: false,
    jornadaHoras: parseFloat(localStorage.getItem('jornadaHoras')) || 7.5,
    numConductor: localStorage.getItem('numConductor') || '',
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

    // Las dos aplicaciones son el mismo código, así que hay que decir cuál es
    // antes de que se vea nada: en la entrada, en la bienvenida y en el
    // logotipo, con la misma chapita que lleva el icono del móvil.
    _pintarIdentidadApp() {
        if (ROL_APP !== 'desarrollador') return;
        const poner = (id, texto) => {
            const el = document.getElementById(id);
            if (el) el.textContent = texto;
        };
        poner('authTitulo', 'Desarrollador EMT - Palma (Movilidad)');
        poner('authSub', 'Pruebas y mantenimiento · EMT Palma');
        poner('splashRol', '⚙️ Desarrollador');
        const btn = document.getElementById('tabBtnPartes');
        if (btn) btn.style.display = '';
        const ayuda = document.getElementById('sectionAyuda');
        if (ayuda) ayuda.style.display = 'none';
        const logo = document.getElementById('authLogo');
        if (logo) logo.src = 'icons/icon-dev-192.png';
        document.title = 'Desarrollador EMT - Palma (Movilidad)';
    },

    async init() {
        this._alVolverAutorizado();
        this._pintarIdentidadApp();
        this._instalarFirmaApi();
        this._ponerBotonesEmoji();
        this._vigilarEnvios();
        this._vigilarPestanas();
        // The update check must run even if any earlier step throws, otherwise a
        // single bug anywhere above strands the user on an old build forever.
        setTimeout(() => { try { this._checkForUpdates(); } catch(_) {} }, 1500);
        this._migrarUbicacionAntigua();
        this.setupUI();
        if (this.darkMode) this.aplicarDarkMode();
        this._aplicarModoDelTema();
        this._restaurarTabs();
        this._initSwipeTabs();
        this._restaurarMensual();
        this._restaurarSecciones();
        this._cargarCuadrante();
        this._aplicarModoVacaciones();
        this._buildAvatarGrid();
        this._setupDeepLinkListener();
        this._iniciarSondeoTrabajadores();
        this._setupAppLifecycleBackup();
        this._setupNotificationActions(); // must register listener before any async
        this._setupNotifChat();           // y las del chat, por lo mismo
        this._initGoogleAuth();
        this._actualizarVersionDisplay();
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
                const conQue = this.usuarioActual.email;
                this.mostrarAuth();
                // En la de desarrollador se dice con cuál hay que entrar: el
                // problema siempre es haber elegido otra cuenta sin querer,
                // y "no tiene acceso" a secas no ayuda a caer en ello.
                const pedida = !ES_APP_DEV && await this._pedirAccesoAlDepartamento('gestion');
                this.mostrarMensaje(ES_APP_DEV
                    ? `❌ Has entrado con ${conQue}. Esta aplicación es solo para ${SUPER_USER_EMAIL}.`
                    : pedida ? `⏳ La cuenta ${conQue} está pendiente de autorización. Tienes que esperar a que el desarrollador la autorice: `
                      + 'cuando lo haga te llegará un correo con un enlace para seguir desde aquí (mira también en spam).'
                    : `❌ La cuenta ${conQue} no tiene acceso a esta aplicación.`, 'error');
                // Y que la próxima vez vuelva a preguntar la cuenta: si se queda
                // guardada la sesión, al abrir entra sola otra vez con la que no
                // vale y se vuelve a quedar a medias sin decir por qué. Salvo si
                // está esperando la autorización: entonces se guarda, para que
                // el enlace del correo le deje ya dentro.
                if (pedida) return;
                this.accessToken  = null;
                this.tokenExpiry  = 0;
                this.refreshToken = null;
                ['gAccessToken', 'gTokenExpiry', 'gRefreshToken', 'gUserEmail']
                    .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
                return;
            }
            this.mostrarApp();
            this._avisarRecienAutorizado();
            this._caComprobarAcceso();
            this._cargarSolicitudes();
            this._tutorialPrimeraVez();
            this.actualizarBotonesPerfil();
            this._actualizarCabeceraUsuario();
            this._aplicarPermisosGestor();
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
            this._cargarNotasGestor();
            this.cargarDatos();
            // Ya está dentro: ahora —y no antes de saber en cuál de las dos
            // aplicaciones está— se le pregunta si se descarga la aplicación
            // o sigue en el navegador.
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
            if (this.usuarioActual) this._cargarNotasGestor();
            // Puede haber cambiado algo mientras la app estaba de fondo
            if (this.usuarioActual) this._cargarConductores(true);
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
        if (!document.getElementById('horaInicio')) return;
        const inicio = localStorage.getItem('lastHoraInicio');
        const fin    = localStorage.getItem('lastHoraFin');
        if (inicio) document.getElementById('horaInicio').value = inicio;
        if (fin)    document.getElementById('horaFin').value    = fin;
        if (inicio && fin) this.calcularHorasPorTiempo();
    },

    setupUI() {
        this.establecerFechaHoy();
        this.actualizarFecha();
        if (this.precioNocheDefault > 0) {
            { const e = document.getElementById('precioNocheGlobal'); if (e) e.value = this.precioNocheDefault; }
        }
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

    async _getDriveFileId() {
        if (this.driveFileId) return this.driveFileId;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?q=name%3D'${DRIVE_FILE_NAME}'%20and%20trashed%3Dfalse&fields=files(id)`
        );
        const data = await resp.json();
        if (data.files && data.files.length > 0) {
            this.driveFileId = data.files[0].id;
            localStorage.setItem('driveFileId', this.driveFileId);
            window.AndroidBridge?.saveToPrefs('driveFileId', this.driveFileId);
        }
        return this.driveFileId;
    },

    async _readDriveFile() {
        const fileId = await this._getDriveFileId();
        if (!fileId) return null;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        if (!resp.ok) return null;
        return resp.json();
    },

    async _writeDriveFile(data) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        const payload = { ...data, preferencias: this._getPreferencias() };
        // En la de desarrollador la copia lleva también lo del puesto de
        // Control de acceso: los registros de entrada y salida y el directorio
        // de visitantes, que son de gente real y no pueden depender de un solo
        // sitio. Si no se pueden leer, se queda lo de la copia anterior.
        if (ES_APP_DEV) {
            try {
                const [r1, r2] = await Promise.all([
                    fetch(this.API_BASE + 'accesos', { cache: 'no-store' }),
                    fetch(this.API_BASE + 'accesos?que=visitantes', { cache: 'no-store' }),
                ]);
                if (r1.ok && r2.ok) {
                    const registros = await r1.json(), visitantes = await r2.json();
                    if (Array.isArray(registros) && Array.isArray(visitantes)) {
                        payload.controlAcceso = { fecha: new Date().toISOString(), registros, visitantes };
                    }
                }
            } catch (_) { /* se queda la de la copia anterior */ }
        }
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
            // es "no hay copia": es que no se ha llegado a ella, y pintar el
            // historial vacío haría creer que se ha perdido todo.
            if (!data && localStorage.getItem('lastBackupTime')) {
                throw new Error('no aparece tu copia en Drive');
            }
            if (data?.preferencias) this._aplicarPreferenciasDesde(data.preferencias);
            this.actualizarUI(data || { horasTrabajadas: 0, historial: {} });
            this._renderGpsSettings();
            this._startScheduleTimer();
            this.verificarUbicacion();
            this._updateGpsState();
            this._cargarConductores();
            this._cargarLugares();
            this._pedirPermisosIniciales();
            if (this._pendingNotifAction === 'registro-rapido') {
                this._pendingNotifAction = null;
                this._registrarDesdeNotificacion();
            }
        } catch(e) {
            console.error('Error cargando datos:', e);
            // Sin lectura no se pinta un historial vacío: parecería que se ha
            // perdido todo. Solo se pinta si de verdad no hay nada cargado.
            if (!this._historialFull || !Object.keys(this._historialFull).length) {
                this.actualizarUI({ horasTrabajadas: 0, historial: {} });
            }
            this._mostrarToast('⚠️ No se ha podido leer tu copia: ' + e.message, 6000);
        }
    },

    async registrarHoras() {
        if (!this.usuarioActual) { alert('❌ No hay sesión activa'); return; }
        const horasRaw = document.getElementById('horasInput').value;
        const horas = parseFloat(horasRaw) || 0;
        const fecha = document.getElementById('fechaInput').value;
        const esFestivo      = this.festivoActivo;
        const esVacaciones   = this.vacacionesActivo;
        // A holiday or a vacation day may be registered with no hours worked;
        // anything else needs hours.
        if (!fecha || (!esFestivo && !esVacaciones && (isNaN(parseFloat(horasRaw)) || horas <= 0))) {
            alert('❌ Introduce fecha y horas válidas'); return;
        }
        if (horas < 0) { alert('❌ Las horas no pueden ser negativas'); return; }
        const horaInicio     = document.getElementById('horaInicio').value;
        const horaFin        = document.getElementById('horaFin').value;
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

            if (this.editingId && datos.historial[this.editingId]) {
                delete datos.historial[this.editingId];
            }
            const fechaFormato = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const fechaKey     = fecha.replace(/-/g, '');
            const registroId   = this.editingId || this._nuevoRegistroId(datos.historial, fechaKey);
            datos.historial[registroId] = {
                fecha: fechaFormato, horas,
                timestamp: new Date(fecha + 'T12:00:00').getTime(),
                ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
                ...(horasNocturnas > 0 ? { horasNocturnas, precioNoche, extraNoche } : {}),
                ...(esPR ? { pr: true } : {}),
                ...(esFestivo ? { festivo: true } : {}),
                ...(esExtra ? { extraManual: true, extraDestino } : {}),
                ...(esVacaciones ? { vacaciones: true } : {}),
                ...(esSinAsistencia ? { sinAsistencia: true } : {})
            };
            if (esPR && this._prUsados(datos.historial) > this.PR_ANUALES) {
                delete datos.historial[registroId];
                alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`);
                return;
            }
            const tot = this._calcTotales(datos.historial);
            if (tot.anualReal > this.horasAnualesCustom + tot.topeExtras) {
                delete datos.historial[registroId];
                alert(`❌ Superarías el tope anual + 30% de extras (${(this.horasAnualesCustom + tot.topeExtras).toFixed(1)}h)`);
                return;
            }
            datos.horasTrabajadas = tot.anualReal;

            if (horaInicio && horaFin) {
                if (!datos.prefs) datos.prefs = {};
                datos.prefs.horaInicio = horaInicio;
                datos.prefs.horaFin = horaFin;
            }
            await this._writeDriveFile(datos);
            localStorage.setItem('lastRegisteredDate', fechaKey);
            window.AndroidBridge?.saveToPrefs('lastRegisteredDate', fechaKey);
            if (horaInicio) localStorage.setItem('lastHoraInicio', horaInicio);
            const horaFinVal = document.getElementById('horaFin').value;
            if (horaFinVal) localStorage.setItem('lastHoraFin', horaFinVal);
            this._detenerGeofencingNativo();
            this._cancelarNotificacionTrabajo();
            this.actualizarUI(datos);
            this.cancelarEdicion();
        } catch(e) {
            alert('❌ Error al guardar: ' + e.message);
        }
    },

    async _guardarDesdeModal() {
        if (!this.usuarioActual || !this.editingId) return;
        const fecha     = document.getElementById('editModalFecha').value;
        const horas     = parseFloat(document.getElementById('editModalHoras').value);
        const horaInicio= document.getElementById('editModalInicio').value;
        const horaFin   = document.getElementById('editModalFin').value;
        const horasN    = parseFloat(document.getElementById('editModalNocturnas').value) || 0;
        const precioN   = parseFloat(document.getElementById('editModalPrecioN').value) || 0;
        const esPR      = document.getElementById('editModalPR').checked;
        const esFestivo = document.getElementById('editModalFestivo').checked;
        const prev      = this._historialMap?.[this.editingId] || {};
        if (!fecha || (!esFestivo && (isNaN(horas) || horas <= 0))) { alert('❌ Introduce fecha y horas válidas'); return; }

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
            ...(prev.extraManual ? { extraManual: true, extraDestino: prev.extraDestino } : {})
        };
        datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;

        await this._writeDriveFile(datos);
        this.editingId = null;
        document.getElementById('editModal').classList.remove('show');
        this.actualizarUI(datos);
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
            if (this.editingId === id) this.editingId = null;
            if (document.getElementById('historialModal').classList.contains('show')) this._renderHistorialModal();
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
            try { await navigator.share({ title: 'Copia Gestión EMT - Movilidad', files: [file] }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.share) {
            try { await navigator.share({ title: 'Copia Gestión EMT - Movilidad', text: json }); this._mostrarToast('✅ Copia exportada', 3000); return; }
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
        // En el navegador, a la bienvenida de la página; en la app, a entrar
        if (!_enLaApp()) { window.location.replace('/'); return; }
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
        if (!document.getElementById('fechaInput')) return;
        const hoy = new Date();
        const y = hoy.getFullYear();
        const m = String(hoy.getMonth() + 1).padStart(2, '0');
        const d = String(hoy.getDate()).padStart(2, '0');
        document.getElementById('fechaInput').value = `${y}-${m}-${d}`;
        document.getElementById('fechaInput').max   = `${y}-${m}-${d}`;
        this.comprobarFestivo();
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
        // Que dé tiempo a ver la bienvenida con el autobús
        // (al tocarla se pasa ya a la app)
        const minimo = document.documentElement.classList.contains('p-inicio-rapido') ? 0 : 1500;
        const falta = minimo - (Date.now() - (window._splashDesde || 0));
        if (falta > 0 && !window._splashTocado) {
            window._splashPend = () => this._hideSplash();
            setTimeout(window._splashPend, falta);
            return;
        }
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
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        { const e = document.getElementById('horasAnualesDisplay'); if (e) e.textContent = this.horasAnualesCustom + 'h'; }
        this._actualizarJornadaDisplay();
        this._actualizarConductorDisplay();
        this._renderVacaciones();
        document.getElementById('perfilEmail').textContent = this.usuarioActual?.email || '';
        document.getElementById('perfilNombre').textContent = this.usuarioActual?.name || '';
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
        this._actualizarAvatarPreview();
        this._actualizarTemaUI();
        this._actualizarInfoCopia();
    },

    // ── El círculo de envío en la foto de perfil ──
    // Mientras haya algo saliendo hacia el servidor o Drive —guardar, un
    // mensaje, una respuesta—, un círculo gira alrededor de la foto. Las
    // lecturas no cuentan: solo lo que manda datos.
    _vigilarEnvios() {
        if (this._envioVigilado) return;
        this._envioVigilado = true;
        const antes = window.fetch.bind(window);
        let enCurso = 0, desde = 0;
        const pintar = () => document.getElementById('perfilEnvio')?.classList.toggle('enviando', enCurso > 0);
        window.fetch = async (recurso, opciones) => {
            const url = typeof recurso === 'string' ? recurso : recurso?.url || '';
            const metodo = String(opciones?.method || (typeof recurso !== 'string' && recurso?.method) || 'GET').toUpperCase();
            const cuenta = !['GET', 'HEAD', 'OPTIONS'].includes(metodo)
                && /emt-palma-movilidad\.vercel\.app\/api\/(?!auth\/|usuarios\?ping)|googleapis\.com\/(upload\/)?drive/.test(url);
            if (cuenta) { if (!enCurso) desde = Date.now(); enCurso++; pintar(); }
            try { return await antes(recurso, opciones); }
            finally {
                if (cuenta) {
                    // Que se llegue a ver aunque el envío sea muy rápido
                    const falta = Math.max(0, 700 - (Date.now() - desde));
                    setTimeout(() => { enCurso = Math.max(0, enCurso - 1); pintar(); }, falta);
                }
            }
        };
    },

    // Con muchas pestañas visibles (el control de acceso suma tres), las
    // etiquetas se hacen más pequeñas para que quepan todas
    _vigilarPestanas() {
        const bar = document.getElementById('tabBar');
        if (!bar || this._pestanasVigiladas) return;
        this._pestanasVigiladas = true;
        const contar = () => {
            const n = [...bar.querySelectorAll('.tab-btn')]
                .filter(b => !b.hidden && getComputedStyle(b).display !== 'none').length;
            bar.classList.toggle('muchas', n > 6);
        };
        new MutationObserver(contar).observe(bar, { subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
        contar();
    },

    // ── Tutorial ─────────────────────────────────────────────────────────────
    // Tarjetas sobre la propia app, que se pasan con «Siguiente» o deslizando.
    // Sale solo la primera vez; después, desde Ajustes › Ayuda. Detrás se va
    // abriendo la pestaña (o los Ajustes) de la que habla cada tarjeta.
    mostrarTutorial(alCerrar) {
        document.getElementById('tutVelo')?.remove();
        const pasos = this._pasosTutorial();
        if (!pasos.length) return;
        const velo = document.createElement('div');
        velo.className = 'tut-velo';
        velo.id = 'tutVelo';
        document.body.appendChild(velo);
        let i = 0;
        const ultimo = () => i === pasos.length - 1;
        const cerrar = () => {
            velo.remove();
            try { localStorage.setItem('tutorialVisto', '1'); } catch (_) {}
            this.mostrarApp();
            this.switchTab(0);
            if (typeof alCerrar === 'function') alCerrar();
        };
        const pintar = () => {
            const p = pasos[i];
            if (p.ajustes) this.mostrarOpciones();
            else { this.mostrarApp(); if (p.tab !== undefined) this.switchTab(p.tab); }
            velo.innerHTML = `<div class="tut-card" role="dialog" aria-modal="true" aria-label="Tutorial">
                <div class="tut-ill">${p.ill}</div>
                <h3>${p.h}</h3>
                <p>${p.p}</p>
                <div class="tut-dots">${pasos.map((_, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('')}</div>
                <div class="tut-btns">
                    <button type="button" class="tut-skip">${ultimo() && i > 0 ? 'Atrás' : 'Saltar'}</button>
                    <button type="button" class="tut-go">${i === 0 ? 'Empezar' : ultimo() ? '¡Listo!' : 'Siguiente'}</button>
                </div></div>`;
            velo.querySelector('.tut-skip').onclick = () => { if (ultimo() && i > 0) { i--; pintar(); } else cerrar(); };
            velo.querySelector('.tut-go').onclick = () => { if (ultimo()) cerrar(); else { i++; pintar(); } };
        };
        // Deslizar: a la izquierda la siguiente, a la derecha la anterior
        let x0 = null;
        velo.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
        velo.addEventListener('touchend', e => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            x0 = null;
            if (dx < -50 && !ultimo()) { i++; pintar(); }
            else if (dx > 50 && i > 0) { i--; pintar(); }
        });
        pintar();
    },

    // Al entrar: la primera vez, el tutorial; luego ya lo demás (el permiso
    // de batería), que si no se le echa encima
    _tutorialPrimeraVez() {
        // La de Desarrollador no lleva tutorial
        if (ES_APP_DEV) { this._pedirBateriaSiHaceFalta(); return; }
        let visto = false;
        try { visto = localStorage.getItem('tutorialVisto') === '1'; } catch (_) {}
        if (visto) { this._pedirBateriaSiHaceFalta(); return; }
        setTimeout(() => this.mostrarTutorial(() => this._pedirBateriaSiHaceFalta()), 600);
    },

    // Las tarjetas del tutorial de gestión. La de Control de acceso, solo a
    // quien lo tenga autorizado.
    _pasosTutorial() {
        const fila = (txt, sub) => `<div class="tut-opt"><span>${txt}${sub ? `<em>${sub}</em>` : ''}</span><span style="color:#9aa5b8">›</span></div>`;
        const pasos = [
            { tab: 0, h: 'Bienvenido a Gestión',
              ill: `<div class="tut-big">🛠️</div><div class="tut-row" style="justify-content:center"><span class="tut-chip on">Trabajadores</span><span class="tut-chip">Cuadrante</span><span class="tut-chip">Registro</span><span class="tut-chip">Chat</span></div>`,
              p: 'Desde aquí organizas a la plantilla: quién está en cada sitio, el cuadrante del mes, las jornadas que registran y los mensajes. Lo que cambias le llega a cada trabajador con un aviso.' },
            { tab: 0, h: '👥 Trabajadores y lugares',
              ill: `<div class="tut-row" style="justify-content:space-between;font-size:12px;font-weight:700;color:#1f2d45"><span>‹</span><span>Hoy</span><span>›</span></div><div class="tut-row"><span class="tut-chip on">✓ Todos 42</span><span class="tut-chip">Activos 31</span><span class="tut-chip">Libres 8</span><span class="tut-chip">Sin turno 3</span></div>`,
              p: 'Arriba ves quién está en cada lugar de trabajo. Debajo, la plantilla con filtros: activos, libres, sin turno, BE y vacaciones. Cambia de día con las flechas o deslizando.' },
            { tab: 0, h: '✏️ Cambiar una jornada',
              ill: `<div class="tut-t">ANA RUIZ · 1234<b style="font-size:13px">06:30–14:00 → 07:00–15:00</b>Son Castelló</div><div class="tut-notif"><span>✅</span><div><b>Cambio enviado</b>Ana lo ha confirmado</div></div>`,
              p: 'Toca a un trabajador para ver o cambiar su horario y su lugar. Le llega un aviso y ves cuándo lo ha confirmado.' },
            { tab: 1, h: '🗓️ Publicar el cuadrante',
              ill: `<div class="tut-t" style="text-align:center;padding:10px">📤 <b style="display:inline;font-size:13px">Subir foto del cuadrante</b></div><div class="tut-notif"><span>🗓️</span><div><b>Cuadrante del mes publicado</b>Aviso enviado a la plantilla</div></div>`,
              p: 'Sube la foto o el archivo del cuadrante del mes. La plantilla recibe un aviso y lo ve en su Historial.' },
            { tab: 3, h: '📋 Registro de la plantilla',
              ill: `<div class="tut-row"><span class="tut-chip on">Día</span><span class="tut-chip">Lugar</span><span class="tut-chip">Nº</span><span class="tut-chip">📊</span></div><div class="tut-opt"><span><b>1234</b> Ana Ruiz<em>Son Castelló</em></span><span>06:30–14:00 · 7,5h ✎</span></div>`,
              p: 'Aquí salen las jornadas que registra cada trabajador, agrupadas por mes. Ordénalas por día, por lugar o por número, abre y cierra cada grupo, corrige el lugar con ✎ y expórtalas a una hoja de cálculo con 📊.' },
            { tab: 2, h: '💬 Chat con la plantilla',
              ill: `<div class="tut-bub"><small>Ana Ruiz · 1234</small>¿Puedo cambiar el turno del jueves?</div><div class="tut-bub yo"><small>Gestión</small>Sí, te lo cambio ahora</div>`,
              p: 'Escribe a una persona, a varias o a toda la plantilla, o crea un grupo. Lo que escriben a gestión llega a la bandeja que compartís los gestores. Marca «visto» y el trabajador lo ve.' },
        ];
        if (ES_APP_DEV || this._caPermitido) pasos.push({ tab: 5, h: '🛡️ Control de acceso',
            ill: `<div class="tut-row"><div class="tut-t">HOY<b>37</b>entradas</div><div class="tut-t">DENTRO<b>12</b>vehículos</div><div class="tut-t">VISITAS<b>4</b></div></div>`,
            p: 'Tienes tres pestañas más: el acceso de hoy, el histórico y los visitantes con sus matrículas. Lo que apunta cada garita aparece al momento.' });
        pasos.push(
            { ajustes: true, h: '⚙️ Ajustes: lugares de trabajo',
              ill: fila('🧩 Lugares de trabajo', 'Son Castelló, Aeropuerto, Son Rullan…') + fila('➕ Añadir lugar de trabajo', ''),
              p: 'Toca tu foto para abrir Ajustes. En <b>Lugares de trabajo</b> das de alta, cambias o quitas los sitios donde se reparte a la plantilla.' },
            { ajustes: true, h: '🎨 Ajustes: apariencia y avisos',
              ill: `<div class="tut-row"><span class="tut-chip on">Medianoche</span><span class="tut-chip">Océano</span><span class="tut-chip">Grafito</span></div>` + fila('💬 Sonido de los mensajes', 'Burbuja'),
              p: 'Elige el tema y su versión clara u oscura, el tamaño del texto y los sonidos. Si un aviso no llega, el botón 🩺 te dice por qué.' },
            { ajustes: true, h: '☁️ Ajustes: copia de seguridad',
              ill: fila('🔄 Copia automática', 'Cada hora, cada día o al cerrar la app') + fila('📆 Resumen mensual', 'Cada fin de mes, en tu Drive') + fila('⬆️ Exportar datos JSON', ''),
              p: 'La app guarda sola una copia en tu Google Drive cuando elijas, y cada fin de mes un resumen. También puedes guardarla o restaurarla a mano, o exportarla e importarla como archivo. Este tutorial lo tienes siempre en <b>Ajustes › Ayuda</b>.' },
        );
        return pasos;
    },

    toggleSection(btn) { btn.closest('.ops-section').classList.toggle('open'); },

    // ── Personalizar ─────────────────────────────────────────────────────────

    // Con un tema, la versión (clara u oscura) que se eligiera para él;
    // sin tema, vale lo que se eligiera en Modo oscuro
    _aplicarModoDelTema() {
        const p = leerPersonal();
        this.darkMode = TEMAS_APP[p.tema] ? temaEnOscuro(p) : localStorage.getItem('darkMode') === 'true';
        if (this.darkMode) this.aplicarDarkMode(); else this.removerDarkMode();
    },

    cambiarPersonal(clave, valor) {
        const p = leerPersonal();
        p[clave] = valor;
        if (clave === 'tema') delete p.temaOscuro;
        try { localStorage.setItem('personal', JSON.stringify(p)); } catch (_) {}
        aplicarPersonal(p);
        if (clave === 'tema') this._aplicarModoDelTema();
        this._pintarPersonal();
        
    },

    _pintarPersonal() {
        const p = leerPersonal();
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('pTexto', p.texto); v('pCabecera', p.cabecera); v('pPestanas', p.pestanas);
        v('pInicio', p.inicio); v('pPestanaInicio', p.pestanaInicio);
        v('pEstilo', p.estilo); v('pFuente', p.fuente);
        const grid = document.getElementById('pTemas');
        if (grid) {
            const esc2 = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
            const op = (id, nombre, cols) => `<button type="button" class="tema-op${(p.tema || '') === id ? ' on' : ''}"
                onclick="app.cambiarPersonal('tema', '${id}')"><span class="tema-mini">${
                cols.map(c => `<span style="background:${esc2(c)}"></span>`).join('')}</span>${esc2(nombre)}</button>`;
            grid.innerHTML = op('', 'Clásico', ['#ffffff', '#1565C0', '#003A99'])
                + Object.entries(TEMAS_APP).map(([id, t]) => op(id, t.nombre, t.muestra)).join('');
        }
        // Con un tema, el color lo pone él, y también la forma y la letra;
        // Modo oscuro sigue: elige su versión clara u oscura
        ['filaColor', 'filaEstilo', 'filaFuente'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.hidden = !!TEMAS_APP[p.tema];
        });
        const a = document.getElementById('pAnim');
        if (a) a.checked = p.animaciones !== false;
    },


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
        if (!document.getElementById('horaInicio')) return;
        const inicio = document.getElementById('horaInicio').value;
        const fin    = document.getElementById('horaFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('horasInput').value = horas;
        // Las horas nocturnas salen solas del horario: sin botón que las active.
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
        if (!document.getElementById('prCompact')) return;
        const restantes = this._prRestantes();
        const el = document.getElementById('prRestantes');
        if (el) el.textContent = restantes;
        const btn = document.getElementById('prCompact');
        // Still tappable when exhausted (an old one may have been deleted), just dimmed
        if (btn) btn.classList.toggle('agotado', restantes === 0 && !this.prActivo);
    },

    clickPrCompact() {
        if (!this.prActivo && this._prRestantes() === 0) {
            alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`);
            return;
        }
        this.prActivo = !this.prActivo;
        document.getElementById('prCompact').classList.toggle('active', this.prActivo);
        document.getElementById('prToggle').checked = this.prActivo;
        this._actualizarPrUI();
    },

    clickFestivo() {
        this.festivoActivo = !this.festivoActivo;
        document.getElementById('festivoCompact').classList.toggle('active', this.festivoActivo);
        document.getElementById('festivoToggle').checked = this.festivoActivo;
    },

    // ── Vacaciones ───────────────────────────────────────────────────────────

    _getVacaciones() { return JSON.parse(localStorage.getItem('vacaciones') || '[]'); },

    _saveVacaciones(v) {
        localStorage.setItem('vacaciones', JSON.stringify(v));
        this._guardarPreferencias();
    },

    _hoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },

    // El mismo día de hoy, en el formato compacto de los ids del historial
    // (AAAAMMDD), en zona local: con toISOString() el día sale en UTC y
    // hasta 2h después de medianoche local seguía marcando el de ayer.
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

    añadirVacaciones() {
        const desde = document.getElementById('vacDesde')?.value;
        const hasta = document.getElementById('vacHasta')?.value;
        if (!desde || !hasta) { this._mostrarToast('❌ Indica las dos fechas', 3000); return; }
        if (hasta < desde)    { this._mostrarToast('❌ La fecha final es anterior a la inicial', 3000); return; }
        const v = this._getVacaciones();
        v.push({ desde, hasta });
        v.sort((a, b) => a.desde.localeCompare(b.desde));
        this._saveVacaciones(v);
        { const e = document.getElementById('vacDesde'); if (e) e.value = ''; }
        { const e = document.getElementById('vacHasta'); if (e) e.value = ''; }
        this._renderVacaciones();
        this._aplicarModoVacaciones();
        this._mostrarToast('🏖️ Vacaciones añadidas', 2500);
    },

    borrarVacaciones(i) {
        const v = this._getVacaciones();
        v.splice(i, 1);
        this._saveVacaciones(v);
        this._renderVacaciones();
        this._aplicarModoVacaciones();
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

    clickVacaciones() {
        this.vacacionesActivo = !this.vacacionesActivo;
        document.getElementById('vacacionesCompact').classList.toggle('active', this.vacacionesActivo);
        document.getElementById('vacacionesToggle').checked = this.vacacionesActivo;
        // A vacation day is logged with no hours
        if (this.vacacionesActivo) document.getElementById('horasInput').value = '0';
    },

    clickExtra() {
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

    async mostrarCambiarJornada() {
        const v = prompt('¿Cuántas horas tiene tu jornada?\n\nPuedes usar decimales: 3,5 o 3.5\nSe usará para contar los festivos que no trabajas.', this.jornadaHoras);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.\nEjemplo: 3,5 o 7'); return; }
        this.jornadaHoras = n;
        localStorage.setItem('jornadaHoras', String(n));
        this._actualizarJornadaDisplay();
        await this._guardarPreferencias(true);
        this.cargarDatos();
        this._mostrarToast(`✅ Jornada: ${n}h`, 2500);
    },

    _actualizarJornadaDisplay() {
        const el = document.getElementById('jornadaHorasDisplay');
        if (el) el.textContent = this.jornadaHoras + 'h';
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
        if (el) el.textContent = this.numConductor || 'Sin asignar';
    },

    _actualizarCabeceraUsuario() {
        const nom = document.getElementById('cabeceraNombre');
        const num = document.getElementById('cabeceraNum');
        const tit = document.getElementById('cabeceraTitulo');
        if (nom) nom.textContent = this.usuarioActual?.name || '';
        // En la app de desarrollador no hay número de trabajador: no lo es.
        if (num) num.textContent = ROL_APP === 'desarrollador' ? '' : (this.numConductor || '');
        if (tit) {
            // En su propia aplicación basta con el nombre: ya se sabe cuál es
            // por el icono y la bienvenida, y así cabe el nombre de la cuenta.
            tit.textContent = ROL_APP === 'desarrollador' ? '⚙️ Desarrollador'
                : this._soyElDesarrollador() ? '⚙️ Desarrollador EMT - Movilidad'
                : '🛠️ Gestión EMT - Movilidad';
        }
    },

    // A la app de gestión entra más gente que el gestor. Los usuarios de
    // prueba, el reparto de versiones y quién puede entrar son cosa suya y
    // de nadie más, así que para el resto de cuentas ni salen las secciones
    // ni existen los de prueba en ninguna lista. El servidor ya lo exigía;
    // esto es para que tampoco se vean.
    // Lo de administrar la aplicación (versiones, usuarios de prueba, quién
    // entra) es de la app de Desarrollador. En la de Gestión todos son
    // gestores, también la cuenta del desarrollador: así se pueden tener las
    // tres apps en el mismo móvil y cada una hace lo suyo.
    _soyElGestor() {
        return ES_APP_DEV;
    },

    _aplicarPermisosGestor() {
        // En la app de desarrollador esto se ve siempre: esa aplicación es
        // para administrar y no la instala nadie más, así que esconderle los
        // apartados por entrar con otra de sus cuentas solo servía para
        // dejarle la app a medias sin decir por qué. En la de gestión siguen
        // siendo cosa del gestor. Quien manda de verdad es el servidor: cada
        // escritura se comprueba allí con la sesión, no aquí.
        const soy = ES_APP_DEV || this._soyElGestor();
        ['sectionVersiones', 'sectionPrueba', 'sectionAcceso'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = soy ? '' : 'none';
        });
    },

    // La misma huella que se guarda el trabajador al dar un cambio por leído:
    // día, lugar y horas, y con el mismo orden de preferencias que usa el
    // servidor para decirle lo que le toca.
    _claveJornadaDe(u, fecha) {
        const lugar = (u?.lugares?.[fecha] || u?.puesto || '');
        const h = this._horasPlan(u, fecha);
        const horas = (h?.i && h?.f) ? `${h.i}\u2013${h.f}` : '';
        // Con el sello de cuándo se le asignó: al volver a asignarle la misma
        // jornada, el visto de la anterior deja de valer y vuelve a pedirse.
        return `${fecha}|${lugar}|${horas}|${u?.asignadoDia?.[fecha] || 0}`;
    },

    // El visto del trabajador: sale cuando ha dado por leído un cambio de ese
    // día. Lo que confirma es la jornada de un día concreto, así que la marca
    // solo vale para ese día y no se arrastra al siguiente.
    _vistoDe(u, fecha) {
        const v = u?.avisoVisto;
        // Tiene que cuadrar con lo que le toca ahora mismo, no solo con el
        // día: si se le vuelve a cambiar el lugar o la hora, lo que dio por
        // leído ya no es lo que le toca y el visto se cae solo.
        if (!v?.clave || v.clave !== this._claveJornadaDe(u, fecha)) return '';
        let hora = '';
        try {
            hora = new Date(v.en).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        } catch (_) {}
        const t = String(v.texto || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        return `<span class="cond-visto" title="${t}${hora ? ' · ' + hora : ''}">✓✓ visto${hora ? ' ' + hora : ''}</span>`;
    },

    // Los conductores que se ven: nunca los ocultos. Los de prueba los decide
    // el desarrollador: los que él deja a la vista salen también en gestión.
    _conductoresVisibles() {
        return Object.values(this._conductores || {}).filter(u => !u.oculto);
    },

    // Record ids are YYYYMMDD for the first entry of a day, then YYYYMMDD-2, -3…
    _nuevoRegistroId(historial, fechaKey) {
        if (!historial[fechaKey]) return fechaKey;
        let n = 2;
        while (historial[`${fechaKey}-${n}`]) n++;
        return `${fechaKey}-${n}`;
    },

    _fechaDeId(id) { return String(id).slice(0, 8); },

    _hayRegistroEnFecha(fechaKey) {
        return Object.keys(this._historialFull || {}).some(id => this._fechaDeId(id) === fechaKey);
    },

    // Single source of truth for all hour totals, derived from the history
    _calcTotales(historial) {
        let anual = 0, extrasManual = 0, festivo = 0, diasFestivos = 0;
        Object.values(historial || {}).forEach(r => {
            const h = parseFloat(r.horas) || 0;
            if (r.extraDestino === 'extras') { extrasManual += h; return; }
            // A holiday you did not work still counts as a full standard shift
            const efectivas = (r.festivo && h === 0) ? this.jornadaHoras : h;
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
        if (!document.getElementById('fechaInput')) return;
        const fecha = document.getElementById('fechaInput').value;
        const hint  = document.getElementById('festivoHint');
        const nombre = this._nombreFestivo(fecha);
        if (hint) {
            hint.textContent = nombre ? `· 🎉 ${nombre}` : '';
            hint.style.display = nombre ? 'inline' : 'none';
        }
        if (nombre && !this.festivoActivo) this.clickFestivo();
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
        if (idx === 0) this._cargarConductores();
        if (idx === 1) this._cargarCuadrante();
        if (idx === 2) this._cargarNotasGestor();
        if (idx === 3) this._cargarConductores();
        if (idx === 4) this._cargarPartes();
        // Control de acceso: registro, historial y visitantes
        if (idx >= 5 && idx <= 7) {
            if (idx === 6) this._caRenderHistorial();
            if (idx === 7) { this.caRenderVisitantes(); this.caCargarVisitantes(); }
            this.caCargarRegistros(false, ...(idx === 5 ? [this._caDia, this._caDia] : []));
        }
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
            // Las escondidas no cuentan: la de control de acceso solo está
            // en la app de desarrollador, y en la de gestión el dedo acababa
            // llevando a una pestaña que no se ve.
            const btns = [...document.querySelectorAll('#tabBar .tab-btn')].filter(b => !b.hidden && b.style.display !== 'none')
                .filter(b => b.style.display !== 'none');
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
                // Las que no estaban cuando se guardó el orden —las de Control
                // de acceso—, al final y no delante de todo
                [...bar.querySelectorAll('.tab-btn')].filter(b => !orden.includes(b.dataset.tab))
                    .forEach(b => bar.appendChild(b));
            }
        } catch(_) {}
        // Las de Control de acceso, como se dejaron la última vez hasta que se
        // compruebe otra vez la autorización al entrar
        ['tabBtnCaReg', 'tabBtnCaHist', 'tabBtnCaVis'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.hidden = !(ES_APP_DEV || localStorage.getItem('caPermitido') === '1');
        });
        // Siempre se abre por Trabajadores, que es lo primero que se mira al
        // entrar. Antes se quedaba donde lo dejaste la última vez, y volver a
        // la app te dejaba en la pestaña de hace dos días.
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
    // horas puestas siguen contando como jornada efectiva.
    sinAsistenciaActivo: false,

    clickSinAsistencia() {
        this.sinAsistenciaActivo = !this.sinAsistenciaActivo;
        document.getElementById('noAsistCompact')?.classList.toggle('active', this.sinAsistenciaActivo);
        const cb = document.getElementById('sinAsistenciaToggle');
        if (cb) cb.checked = this.sinAsistenciaActivo;
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
                default:              if (!sonarTramos(sound)) bell(880, t, 0.7);
            }
        } catch(_) {}
    },

    limpiarInput() {
        if (!document.getElementById('fechaInput')) return;
        // Limpiar desmarca todo menos el festivo, y recupera el horario del día
        // anterior. No debe reabrir el cajón nocturno aunque ese horario lo sea.
        const manteniaFestivo = this.festivoActivo;
        this.establecerFechaHoy();
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
        // Horas del horario recuperado, sin activar nada nocturno
        document.getElementById('horasInput').value = (lastInicio && lastFin)
            ? this._horasEntre(lastInicio, lastFin) : '';
        this.festivoActivo = false;
        document.getElementById('festivoCompact').classList.remove('active');
        document.getElementById('festivoToggle').checked = false;
        this.comprobarFestivo();                 // vuelve a marcarlo si la fecha es festiva
        if (manteniaFestivo && !this.festivoActivo) this.clickFestivo();
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
        document.getElementById('historialModal').classList.add('show');
        if (this.darkMode) document.getElementById('historialModalContent').classList.add('dark');
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
            list.innerHTML = '<li style="text-align:center;padding:24px;color:#7f8c8d;font-size:13px;">Sin registros</li>';
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
                const cab = document.createElement('li');
                cab.className = 'hm-mes';
                cab.dataset.mes = mesKey;
                const colapsado = this._mesesColapsados.has(mesKey);
                cab.innerHTML = `<span class="hm-mes-chev">${colapsado ? '▸' : '▾'}</span>`
                    + `<span class="hm-mes-n">${MESES_ES[d.getMonth()]} ${d.getFullYear()}</span>`
                    + `<span class="hm-mes-tot">${(Math.round(totMes * 10) / 10).toFixed(1)}h`
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
                ? `<span style="color:#7f8c8d;font-size:10px;font-style:italic;">${reg.horaInicio}–${reg.horaFin}</span>` : '';
            const prBadge     = reg.pr      ? `<span class="pr-badge">PR</span>` : '';
            const festivoBadge= reg.festivo ? `<span class="festivo-badge">🎉 Festivo</span>` : '';
            const vacBadge    = reg.vacaciones ? `<span class="vacaciones-badge">🏖️ Vacaciones</span>` : '';
            const extraBadge  = reg.extraManual
                ? `<span class="extra-badge">⏱️ ${reg.extraDestino === 'extras' ? 'Extra' : 'Anual'}</span>` : '';
            li.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="color:#7f8c8d;font-weight:700;font-size:12px;">${reg.fecha}</span>
                        ${horario}
                        <span style="background:linear-gradient(135deg,var(--g1),var(--g2));color:white;padding:3px 9px;border-radius:20px;font-weight:700;font-size:10px;">${reg.horas}h</span>
                        ${prBadge}${festivoBadge}${extraBadge}${vacBadge}
                    </div>
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
                document.getElementById('historialModal').classList.remove('show');
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
        document.getElementById('editModal').classList.add('show');
        if (this.darkMode) document.getElementById('editModalContent').classList.add('dark');
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
        Object.values(historial).forEach(reg => {
            if (!reg.timestamp) return;
            const d   = new Date(reg.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!meses[key]) meses[key] = { horas:0, nocturnas:0, extra:0, dias:0, label:'', año:d.getFullYear(), mes:d.getMonth()+1 };
            meses[key].horas     = Math.round((meses[key].horas     + reg.horas) * 10) / 10;
            meses[key].nocturnas = Math.round((meses[key].nocturnas + (reg.horasNocturnas||0)) * 10) / 10;
            meses[key].extra     = Math.round((meses[key].extra     + (reg.extraNoche||0)) * 100) / 100;
            meses[key].dias++;
            meses[key].label = `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
        });
        return meses;
    },

    actualizarUI(datos) {
        this._historialFull = datos.historial || {};
        this.actualizarHistorial(datos.historial || {});
        // En gestión no existen los cuadros de horas ni el formulario: sin esto
        // actualizarUI revienta al escribir en elementos que no están, y como el
        // catch de cargarDatos vuelve a llamarla, el arranque se queda colgado.
        if (!document.getElementById('horasTrabajadas')) return;
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
        // Festivos + horas extras
        const pctExt = t.topeExtras > 0 ? (t.extras / t.topeExtras) * 100 : 0;
        const elF = document.getElementById('statFestivos');
        const elFS= document.getElementById('statFestivosSub');
        const elE = document.getElementById('statExtras');
        const elES= document.getElementById('statExtrasSub');
        if (elF)  elF.textContent  = t.festivo.toFixed(1);
        if (elFS) elFS.textContent = t.diasFestivos === 1 ? '1 día festivo' : `${t.diasFestivos} días festivos`;
        if (elE)  elE.textContent  = t.extras.toFixed(1);
        if (elES) elES.textContent = `de ${t.topeExtras.toFixed(1)}h`;
        const barExt = document.getElementById('progressFillExtra');
        if (barExt) barExt.style.width = Math.min(pctExt, 100) + '%';
        this._actualizarPrUI();
        const pctExtEl = document.getElementById('porcentajeExtra');
        if (pctExtEl) pctExtEl.textContent = Math.min(Math.round(pctExt), 100);
        const ahora = new Date();
        const mesStats = this._calcMesStats(this._historialFull, ahora.getFullYear(), ahora.getMonth() + 1);
        const elMesH = document.getElementById('statMesHoras');
        const elMesN = document.getElementById('statMesNoche');
        if (elMesH) elMesH.textContent = mesStats.horas.toFixed(1);
        if (elMesN) elMesN.textContent = mesStats.nocturnas.toFixed(1);
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
        this._renderCuadranteTrab();
        try {
            const resp = await fetch(this.CUADRANTE_URL, { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
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

    _pintarCuadrante(data) {
        const img   = document.getElementById('cuadImg');
        const vacio = document.getElementById('cuadVacio');
        const fecha = document.getElementById('cuadFecha');
        const borrar= document.getElementById('cuadBorrar');
        const hay = !!(data && data.imagen);
        if (img)   { img.style.display = hay ? 'block' : 'none'; if (hay) img.src = data.imagen; }
        if (vacio) vacio.style.display = hay ? 'none' : 'flex';
        if (borrar) borrar.style.display = hay ? 'inline-block' : 'none';
        if (fecha) {
            fecha.textContent = hay && data.actualizado
                ? new Date(data.actualizado).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
                : '';
        }
    },

    // ── Notas ───────────────────────────────────────────────────────────────
    // Notas en los dos sentidos: gestión escribe a un trabajador —o a varios
    // de una vez— y el trabajador escribe a gestión, y se contesta dentro del
    // mismo hilo. Lo que firma gestión va con el nombre del gestor, que es lo
    // que ve el trabajador. Ya no se acepta ni se deniega nada: se da el visto,
    // y ese visto lo ven los dos.

    // ── Control de acceso (las tres pestañas del puesto) ─────────────────────
    //
    // Lo que era la app de Gestión de Control de acceso, dentro de gestión:
    // apuntar entradas y salidas, el historial con exportar, y el directorio
    // de visitantes. Solo para quien el desarrollador autorice en Usuarios con
    // acceso → "Control (Gestión)" (y el desarrollador). El servidor lo vuelve
    // a comprobar: con esa lista se puede corregir y borrar cualquier registro.

    _caPermitido: false,
    _caPorId: {},
    _caVisitantes: {},
    _caDia: '',
    _caAutorrellenado: {},
    _caEditando: null,
    _caSalidaDe: null,
    _caRelojSync: null,
    _caRelojHora: null,
    _caSinPermiso: '',
    _caPreparado: false,

    _caEsc(t) {
        return String(t ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    _caUrl(q) { return this.API_BASE + 'accesos' + (q ? '?' + q : ''); },

    // La firma de las llamadas solo renueva la sesión al escribir; aquí se lee
    // cada pocos segundos, así que se renueva antes si ha caducado y, si aun
    // así el servidor no la acepta, se prueba una vez más con una nueva. Solo
    // con la llave de renovar: sin ella, renovar es sacar la pantalla de
    // entrar, y un repaso de fondo no puede hacer eso.
    async _caFetch(url, op = {}) {
        if (this.refreshToken && this.accessToken && Date.now() >= this.tokenExpiry) {
            try { await this._silentReauth(); } catch (_) {}
        }
        let r = await fetch(url, op);
        if (r.status === 401 && this.refreshToken) {
            try { await this._silentReauth(); } catch (_) {}
            r = await fetch(url, op);
        }
        return r;
    },

    async _caRespuesta(r) {
        const data = await r.json().catch(() => ({}));
        if (r.status === 403) this._caPonerSinPermiso(data.error);
        if (!r.ok) throw new Error(data.error || r.status);
        return data;
    },

    _caPonerSinPermiso(error) {
        this._caSinPermiso = error || 'Esta cuenta no tiene acceso al puesto de control de acceso';
        ['caAviso', 'caHistAviso'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = '🔒 ' + this._caSinPermiso + '. Pide al desarrollador que te autorice en Control (Gestión).';
            el.hidden = false;
        });
    },

    _caQuitarSinPermiso() {
        this._caSinPermiso = '';
        ['caAviso', 'caHistAviso'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
    },

    // Al entrar en la app con la opción puesta, o al ponerla
    _caArrancar() {
        if (!this._caPermitido || !this.usuarioActual) return;
        if (!this._caPreparado) {
            this._caPreparado = true;
            this._caPreparar();
        }
        this.caCargarVisitantes();
        this.caCargarRegistros();
        this._caSincronizarSolo();
    },

    _caHoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    _caIsoHaceDias(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    _caAISO(f)   { const s = String(f || ''); return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : ''; },
    _caAClave(f) { return String(f || '').replace(/-/g, '').slice(0, 8); },
    _caClaveMatricula(m) { return String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
    _caHoraAhora() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    _caDiaLargo(fecha) {
        const f = String(fecha || '');
        if (f.length !== 8) return f;
        const d = new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12);
        return isNaN(d) ? f : d.toLocaleDateString('es-ES',
            { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    },

    _caRegistrosDe(fecha) {
        return Object.values(this._caPorId).filter(r => r.fecha === fecha)
            .sort((a, b) => (a.entrada || '').localeCompare(b.entrada || ''));
    },

    _caGuardarCacheRegistros() {
        try {
            // Solo lo reciente: es para poder seguir sin cobertura, no un archivo
            const desde = this._caAClave(this._caIsoHaceDias(40));
            const lista = Object.values(this._caPorId).filter(r => r.fecha >= desde);
            localStorage.setItem('caRegistrosCache', JSON.stringify(lista));
        } catch (_) {}
    },

    _caGuardarCacheVisitantes() {
        try { localStorage.setItem('caVisitantesCache', JSON.stringify(Object.values(this._caVisitantes))); } catch (_) {}
    },

    // Hoy, con la hora de ahora, y lo que se tuviera guardado sin red
    _caPreparar() {
        if (!this._caDia) this._caDia = this._caAClave(this._caHoyISO());
        const pd = document.getElementById('caDesde'), ph = document.getElementById('caHasta');
        if (pd && !pd.value) pd.value = this._caIsoHaceDias(30);
        if (ph && !ph.value) ph.value = this._caHoyISO();
        const f = document.getElementById('caFecha');
        if (f) f.value = this._caAISO(this._caDia);
        this._caPintarDiaLargo();
        this._caPrepararSugerencias();
        this._caLimpiarFormulario();
        try {
            const c = JSON.parse(localStorage.getItem('caRegistrosCache') || '[]');
            c.forEach(r => { if (r?.id && !this._caPorId[r.id]) this._caPorId[r.id] = r; });
            this._caPonerVisitantes(JSON.parse(localStorage.getItem('caVisitantesCache') || '[]'));
        } catch (_) {}
        this._caRenderDia();
        this._caRenderHistorial();
    },

    _caPintarDiaLargo() {
        const el = document.getElementById('caDiaLargo');
        if (!el) return;
        const hoy = this._caAClave(this._caHoyISO());
        const d = new Date(+this._caDia.slice(0, 4), +this._caDia.slice(4, 6) - 1, +this._caDia.slice(6, 8), 12);
        const largo = isNaN(d) ? '' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        el.textContent = (this._caDia === hoy ? 'Hoy · ' : '') + largo;
        const volver = document.getElementById('caHoyBtn');
        if (volver) volver.hidden = this._caDia === hoy;
    },

    caCambiarDia() {
        const v = this._caAClave(document.getElementById('caFecha')?.value);
        if (v.length !== 8) return;
        this._caDia = v;
        this._caPintarDiaLargo();
        this._caRenderDia();
        this.caCargarRegistros(true, v, v);
    },

    caIrAHoy() {
        this._caDia = this._caAClave(this._caHoyISO());
        const f = document.getElementById('caFecha');
        if (f) f.value = this._caAISO(this._caDia);
        this.caCambiarDia();
    },

    _caLimpiarFormulario() {
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('caEntrada', this._caHoraAhora());
        // La hora va sola hasta que alguien la toque: si el formulario se queda
        // abierto un rato, al registrar tiene que ser la de ese momento
        const h = document.getElementById('caEntrada');
        if (h) {
            h.dataset.tocada = '';
            if (!h._escucha) { h._escucha = true; h.addEventListener('input', () => { h.dataset.tocada = '1'; }); }
        }
        if (!this._caRelojHora) {
            this._caRelojHora = setInterval(() => {
                const e = document.getElementById('caEntrada');
                if (e && !e.dataset.tocada && document.activeElement !== e) e.value = this._caHoraAhora();
            }, 20000);
        }
        ['caMatricula', 'caNombre', 'caEmpresa', 'caVehiculo', 'caDepartamento'].forEach(id => v(id, ''));
        this._caAutorrellenado = {};
        this._caPintarPista('');
        this._caPintarPersonas('');
    },

    // ── El directorio de visitantes: lo que se sabe de cada matrícula ──

    _caPonerVisitantes(lista) {
        if (!Array.isArray(lista)) return;
        const mapa = {};
        lista.forEach(v => { const k = this._caClaveMatricula(v?.matricula); if (k) mapa[k] = v; });
        this._caVisitantes = mapa;
        if (this._activeTab === 7) this.caRenderVisitantes();
    },

    async caCargarVisitantes() {
        if (!this._caPermitido || !this.usuarioActual) return;
        try {
            const r = await this._caFetch(this._caUrl('que=visitantes'), { cache: 'no-store' });
            const lista = await this._caRespuesta(r);
            this._caPonerVisitantes(lista);
            this._caGuardarCacheVisitantes();
        } catch (_) { /* sin cobertura vale lo último que se supo */ }
    },

    // Debajo del campo, lo que ya se conoce y encaja con lo escrito. En la
    // matrícula basta con ir poniendo números: salen las que los llevan.
    _caOpcionesDe(campo, q) {
        const vs = Object.values(this._caVisitantes);
        if (campo === 'matricula') {
            const k = this._caClaveMatricula(q);
            if (!k) return [];
            return vs.filter(v => this._caClaveMatricula(v.matricula).includes(k))
                .sort((a, b) => (this._caClaveMatricula(b.matricula).startsWith(k) - this._caClaveMatricula(a.matricula).startsWith(k))
                                || (a.matricula || '').localeCompare(b.matricula || ''))
                .map(v => ({ valor: v.matricula, texto: v.matricula,
                             sub: [v.nombre, v.empresa].filter(Boolean).join(' · ')
                                  + (v.personas?.length > 1 ? ` · y ${v.personas.length - 1} más` : '') }));
        }
        const t = String(q || '').trim().toLowerCase();
        const base = campo === 'departamento' ? ['Taller', 'Obra', 'Paquetería taller'] : [];
        const valores = [...new Set([...base, ...vs.map(v => v[campo])].filter(x => x && x !== '-'))];
        return valores.filter(x => !t || x.toLowerCase().includes(t))
            .filter(x => x.toLowerCase() !== t)
            .sort((a, b) => (b.toLowerCase().startsWith(t) - a.toLowerCase().startsWith(t)) || a.localeCompare(b, 'es'))
            .map(x => ({ valor: x, texto: x }));
    },

    _caPrepararSugerencias() {
        const campos = { caMatricula: 'matricula', caEmpresa: 'empresa', caVehiculo: 'vehiculo', caDepartamento: 'departamento',
                         caeMatricula: 'matricula', caeEmpresa: 'empresa', caeVehiculo: 'vehiculo', caeDepartamento: 'departamento' };
        Object.entries(campos).forEach(([id, campo]) => {
            const input = document.getElementById(id);
            if (!input || input._sug) return;
            const wrap = document.createElement('div');
            wrap.className = 'ca-sug-wrap';
            wrap.style.marginBottom = input.style.marginBottom;
            input.style.marginBottom = '0';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            const caja = document.createElement('div');
            caja.className = 'ca-sug';
            caja.hidden = true;
            wrap.appendChild(caja);
            input._sug = caja;
            const pintar = () => {
                const ops = this._caOpcionesDe(campo, input.value).slice(0, 8);
                caja.innerHTML = ops.map((o, i) => `<div class="ca-sug-op" data-i="${i}"><b>${this._caEsc(o.texto)}</b>${
                    o.sub ? `<span>${this._caEsc(o.sub)}</span>` : ''}</div>`).join('');
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
                const op = caja._ops?.[+e.target.closest('.ca-sug-op')?.dataset.i];
                if (!op) return;
                input.value = op.valor;
                input.dispatchEvent(new Event('input'));
                caja.hidden = true;
                if (id === 'caMatricula') this.caBuscarMatricula();
            });
        });
    },

    // Al escribir la matrícula: si ya vino alguna vez, se rellena lo demás. Lo
    // escrito a mano no se pisa; lo rellenado solo sí, por si se cambia de
    // matrícula a media escritura.
    caBuscarMatricula() {
        const el = document.getElementById('caMatricula');
        if (!el) return;
        const v = this._caVisitantes[this._caClaveMatricula(el.value)];
        const campos = { caNombre: 'nombre', caEmpresa: 'empresa', caVehiculo: 'vehiculo', caDepartamento: 'departamento' };
        Object.entries(campos).forEach(([id, k]) => {
            const c = document.getElementById(id);
            if (!c) return;
            const vacio = !c.value.trim() || this._caAutorrellenado[id] === c.value;
            if (v && vacio) {
                const nuevo = v[k] && v[k] !== '-' ? v[k] : '';
                c.value = nuevo;
                this._caAutorrellenado[id] = nuevo;
            } else if (!v && this._caAutorrellenado[id] === c.value) {
                c.value = '';
                delete this._caAutorrellenado[id];
            }
        });
        if (v) el.value = formatoMatricula(v.matricula || el.value);
        const clave = this._caClaveMatricula(el.value);
        // "Nueva" solo si no hay ninguna que la contenga: a medio escribir aún
        // puede ser una conocida, y para eso están las sugerencias
        const aMedias = !v && Object.keys(this._caVisitantes).some(k => k.includes(clave));
        const ps = this._caPintarPersonas(v ? clave : '');
        this._caPintarPista(!clave || aMedias ? '' : v ? (ps.length > 1
                ? `✅ Ya ha venido · la traen ${ps.length} personas: elige quién en el desplegable`
                : `✅ Ya ha venido: ${[v.nombre, v.empresa].filter(Boolean).join(' · ')}`)
            : '🆕 Matrícula nueva: se recordará al registrarla');
    },


    // ── Varias personas con el mismo coche ──
    //
    // Hay matrículas que traen personas distintas según el día. Si la que se
    // escribe tiene más de una, sale un desplegable en el nombre con cada una
    // (la última que vino, primero) y al elegirla se rellena lo suyo. Salen
    // del directorio y, para lo de antes de que lo guardara, de los registros.
    _caPersonasDe(clave) {
        const k = n => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const v = this._caVisitantes[clave];
        const lista = [...(Array.isArray(v?.personas) ? v.personas : [])];
        Object.values(this._caPorId)
            .filter(r => r.nombre && this._caClaveMatricula(r.matricula) === clave)
            .sort((a, b) => `${b.fecha}${b.entrada}`.localeCompare(`${a.fecha}${a.entrada}`))
            .forEach(r => lista.push({ nombre: r.nombre, empresa: r.empresa, vehiculo: r.vehiculo, departamento: r.departamento }));
        if (v?.nombre) lista.push({ nombre: v.nombre, empresa: v.empresa, vehiculo: v.vehiculo, departamento: v.departamento });
        const vistos = new Set();
        return lista.filter(p => p?.nombre && !vistos.has(k(p.nombre)) && vistos.add(k(p.nombre)));
    },

    _caPintarPersonas(clave) {
        const sel = document.getElementById('caNombreSel');
        if (!sel) return [];
        const ps = clave ? this._caPersonasDe(clave) : [];
        this._caPersonas = ps;
        if (ps.length < 2) { sel.hidden = true; sel.innerHTML = ''; return ps; }
        const actual = (document.getElementById('caNombre')?.value || '').trim().toLowerCase();
        const esc2 = t => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        sel.innerHTML = ps.map((p, i) => `<option value="${i}"${p.nombre.toLowerCase() === actual ? ' selected' : ''}>👤 ${esc2(p.nombre)}${
                p.empresa ? ' · ' + esc2(p.empresa) : ''}</option>`).join('')
            + '<option value="otra">✏️ Otra persona…</option>';
        sel.hidden = false;
        return ps;
    },

    _caElegirPersona(valor) {
        const nom = document.getElementById('caNombre');
        const auto = this._caAutorrellenado;
        if (valor === 'otra') {
            if (nom) { nom.value = ''; delete auto.caNombre; nom.focus(); }
            return;
        }
        const p = (this._caPersonas || [])[+valor];
        if (!p || !nom) return;
        nom.value = p.nombre;
        auto.caNombre = p.nombre;
        // Lo de esa persona, sin pisar lo que se haya escrito a mano
        const campos = { caEmpresa: 'empresa', caVehiculo: 'vehiculo', caDepartamento: 'departamento' };
        Object.entries(campos).forEach(([id, k]) => {
            const c = document.getElementById(id);
            if (!c || !p[k]) return;
            if (!c.value.trim() || auto[id] === c.value) { c.value = p[k]; auto[id] = p[k]; }
        });
    },
    _caPintarPista(t) {
        const el = document.getElementById('caPista');
        if (el) { el.textContent = t; el.hidden = !t; }
    },

    // ── Apuntar ──

    async caRegistrarEntrada() {
        const h = document.getElementById('caEntrada');
        if (h && !h.dataset.tocada) h.value = this._caHoraAhora();
        const g = id => (document.getElementById(id)?.value || '').trim();
        const r = {
            fecha: this._caDia, entrada: g('caEntrada'), matricula: formatoMatricula(g('caMatricula')),
            nombre: g('caNombre'), empresa: g('caEmpresa'), vehiculo: g('caVehiculo'), departamento: g('caDepartamento'),
        };
        if (!/^\d{2}:\d{2}$/.test(r.entrada)) { this._mostrarToast('❌ Falta la hora de entrada', 3000); return; }
        if (!r.matricula && !r.nombre) { this._mostrarToast('❌ Pon al menos la matrícula o el nombre', 3000); return; }
        const btn = document.getElementById('caBtn');
        if (btn) btn.disabled = true;
        try {
            const data = await this._caEnviarRegistro(r);
            // Lo aprendido, ya aquí, sin esperar a la próxima carga
            if (data.matricula) {
                const k = this._caClaveMatricula(data.matricula);
                const previo = this._caVisitantes[k] || {};
                this._caVisitantes[k] = { ...previo, matricula: data.matricula,
                    nombre: data.nombre || previo.nombre || '', empresa: data.empresa || previo.empresa || '',
                    vehiculo: data.vehiculo || previo.vehiculo || '', departamento: data.departamento || previo.departamento || '' };
                this._caGuardarCacheVisitantes();
            }
            this._caLimpiarFormulario();
            this._caRenderDia();
            this._caRenderHistorial();
            this._mostrarToast(`✅ Entrada a las ${data.entrada}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) {
            this._mostrarToast('❌ ' + e.message, 5000);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _caEnviarRegistro(cuerpo) {
        const r = await this._caFetch(this._caUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...cuerpo,
                autor: { nombre: this.usuarioActual?.name || '', num: '' } }),
        });
        const data = await this._caRespuesta(r);
        this._caQuitarSinPermiso();
        this._caPorId[data.id] = data;
        this._caGuardarCacheRegistros();
        return data;
    },

    // La salida, con la hora de ahora; si no era esa, se toca en el registro
    async caMarcarSalida(id) {
        if (!this._caPorId[id]) return;
        try {
            const data = await this._caEnviarRegistro({ id, salida: this._caHoraAhora() });
            this._caRenderDia();
            this._caRenderHistorial();
            this._mostrarToast(`🚪 Salida a las ${data.salida}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    // La hora de salida escrita a mano, por si no se apuntó en el momento
    caPonerHoraSalida(id) {
        const r = this._caPorId[id];
        if (!r) return;
        this._caSalidaDe = id;
        const t = document.getElementById('caHsTitulo');
        if (t) t.textContent = [r.matricula, r.nombre].filter(Boolean).join(' · ') + ` · entró a las ${r.entrada}`;
        const h = document.getElementById('caHsHora');
        if (h) h.value = r.fecha === this._caAClave(this._caHoyISO()) ? this._caHoraAhora() : '';
        document.getElementById('caSalidaModal').classList.add('show');
        setTimeout(() => h?.focus(), 50);
    },

    caCerrarHoraSalida() { document.getElementById('caSalidaModal').classList.remove('show'); this._caSalidaDe = null; },

    async caGuardarHoraSalida() {
        const r = this._caPorId[this._caSalidaDe];
        const hora = document.getElementById('caHsHora')?.value || '';
        if (!r) return;
        if (!/^\d{2}:\d{2}$/.test(hora)) { this._mostrarToast('❌ Pon la hora de salida', 3000); return; }
        if (hora < r.entrada) { this._mostrarToast('❌ La salida no puede ser antes que la entrada', 3500); return; }
        try {
            const data = await this._caEnviarRegistro({ id: r.id, salida: hora });
            this.caCerrarHoraSalida();
            this._caRenderDia();
            this._caRenderHistorial();
            this._mostrarToast(`🚪 Salida a las ${data.salida}${data.matricula ? ' · ' + data.matricula : ''}`, 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    // ── Lo apuntado ──

    _caTarjeta(r) {
        // Sin hora de salida no se pone nada. El botón de salida ahora, solo en
        // los de hoy: en uno de otro día pondría la hora de ahora, que no es.
        const esc = t => this._caEsc(t);
        const abierto = !r.salida && r.fecha === this._caAClave(this._caHoyISO());
        const quien = [r.nombre, r.empresa].filter(Boolean).join(' · ');
        const que = [r.vehiculo, r.departamento && r.departamento !== '-' ? '→ ' + r.departamento : ''].filter(Boolean).join(' ');
        return `<div class="ca-reg${abierto ? ' dentro' : ''}" onclick="app.caAbrirRegistro('${esc(r.id)}')">
            <div class="ca-top">
                <span class="ca-horas">${esc(r.entrada)}${r.salida ? '–' + esc(r.salida) : ''}</span>
                ${r.matricula ? `<span class="ca-mat">${esc(r.matricula)}</span>` : ''}
            </div>
            ${quien ? `<div class="ca-quien">${esc(quien)}</div>` : ''}
            ${que ? `<div class="ca-que">${esc(que)}</div>` : ''}
            ${r.creadoPor ? `<div class="ca-por">✍️ Apuntado por ${esc(this._caQuien(r.creadoPor, r.creadoNombre, r.creadoNum))}${
                r.tocadoPor && r.tocadoPor !== r.creadoPor ? `<br>✏️ Corregido por ${esc(this._caQuien(r.tocadoPor, r.tocadoNombre, r.tocadoNum))}` : ''}</div>` : ''}
            ${!r.salida ? `<div class="ca-btns">${abierto
                ? `<button class="ca-btn" onclick="event.stopPropagation();app.caMarcarSalida('${esc(r.id)}')">🚪 Salida ahora</button>` : ''}
                <button class="btn-secondary" onclick="event.stopPropagation();app.caPonerHoraSalida('${esc(r.id)}')">🕒 Poner hora</button></div>` : ''}
        </div>`;
    },

    _caRenderDia() {
        const cont = document.getElementById('caLista');
        if (!cont) return;
        const lista = this._caRegistrosDe(this._caDia);
        const cab = document.getElementById('caCuantos');
        if (cab) cab.textContent = lista.length ? String(lista.length) : '';
        cont.innerHTML = lista.length
            // Los que siguen dentro, arriba: son a los que hay que apuntar la salida
            ? [...lista.filter(r => !r.salida), ...lista.filter(r => r.salida)].map(r => this._caTarjeta(r)).join('')
            : '<div class="ca-vacio">Todavía no hay nada apuntado este día.</div>';
    },

    _caEnHistorial() {
        const desde = this._caAClave(document.getElementById('caDesde')?.value) || this._caAClave(this._caIsoHaceDias(30));
        const hasta = this._caAClave(document.getElementById('caHasta')?.value) || this._caAClave(this._caHoyISO());
        const texto = String(document.getElementById('caBuscar')?.value || '').trim().toLowerCase();
        const busca = this._caClaveMatricula(texto);
        return Object.values(this._caPorId)
            .filter(r => r.fecha >= desde && r.fecha <= hasta)
            .filter(r => !texto || (busca && this._caClaveMatricula(r.matricula).includes(busca))
                || [r.nombre, r.empresa, r.vehiculo, r.departamento].some(x => String(x || '').toLowerCase().includes(texto)))
            .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.entrada || '').localeCompare(a.entrada || ''));
    },

    _caRenderHistorial() {
        const cont = document.getElementById('caHistLista');
        if (!cont) return;
        const lista = this._caEnHistorial();
        if (!lista.length) {
            cont.innerHTML = '<div class="ca-vacio">No hay registros en esas fechas.</div>';
            return;
        }
        let dia = '';
        cont.innerHTML = lista.map(r => {
            const cab = r.fecha !== dia ? `<div class="ca-dia">${this._caEsc(this._caDiaLargo(r.fecha))}</div>` : '';
            dia = r.fecha;
            return cab + this._caTarjeta(r);
        }).join('');
    },

    // A mano, con el botón: lo que haya apuntado otra garita, ya
    async caRecargar() {
        const b = document.getElementById('caRecargar');
        if (b) { b.disabled = true; b.textContent = '⏳'; }
        this._caQuitarSinPermiso();
        const [a, d] = await Promise.all([this.caCargarRegistros(true), this.caCargarRegistros(true, this._caDia, this._caDia),
                                          this.caCargarVisitantes()]);
        if (b) { b.disabled = false; b.textContent = '🔄 Recargar'; }
        if (a && d) this._mostrarToast('✅ Actualizado', 1500);
    },

    // Y solo, como en la app del puesto: mientras se está en una de las dos
    // pestañas, cada pocos segundos se trae lo nuevo, para que lo que apunta
    // una garita salga en la otra al momento. Al volver a la app, también.
    _caSincronizarSolo() {
        if (this._caRelojSync) return;
        const traer = () => {
            if (!this._caPermitido || !this.usuarioActual) return;
            if (document.visibilityState !== 'visible') return;
            if (this._activeTab < 5 || this._activeTab > 7) return;
            // Con un cuadro abierto no se repinta nada debajo
            if (document.querySelector('.modal.show')) return;
            const hoy = this._caAClave(this._caHoyISO());
            // El día que se está viendo y hasta hoy: lo que puede haber cambiado
            const desde = this._caDia && this._caDia < hoy ? this._caDia : hoy;
            this.caCargarRegistros(false, desde, this._caDia > hoy ? this._caDia : hoy);
        };
        this._caTraer = traer;
        // Con los avisos al instante basta un repaso por minuto, de respaldo
        let vuelta = 0;
        this._caRelojSync = setInterval(() => { if (this._conPush && (++vuelta % 4)) return; traer(); }, 15000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !this._caPermitido || !this.usuarioActual) return;
            traer();
            this.caCargarVisitantes();
        });
    },

    async caCargarRegistros(forzar, desde, hasta) {
        if (!this._caPermitido || !this.usuarioActual) return false;
        if (!desde) {
            desde = this._caAClave(document.getElementById('caDesde')?.value) || this._caAClave(this._caIsoHaceDias(30));
            hasta = this._caAClave(document.getElementById('caHasta')?.value) || this._caAClave(this._caHoyISO());
        }
        try {
            const r = await this._caFetch(this._caUrl(new URLSearchParams({ desde, hasta })), { cache: 'no-store' });
            const lista = await this._caRespuesta(r);
            // Si antes no tenía acceso y ahora sí —le acaban de dar de alta—,
            // fuera el aviso y a por lo que ya se sabe de cada matrícula
            if (this._caSinPermiso) { this._caQuitarSinPermiso(); this.caCargarVisitantes(); }
            // Lo de esas fechas manda: lo que ya no está es que se ha borrado
            Object.values(this._caPorId).forEach(x => { if (x.fecha >= desde && x.fecha <= hasta) delete this._caPorId[x.id]; });
            (Array.isArray(lista) ? lista : []).forEach(x => { this._caPorId[x.id] = x; });
            this._caGuardarCacheRegistros();
            this._caRenderDia();
            this._caRenderHistorial();
            return true;
        } catch (e) {
            if (forzar && !this._caSinPermiso) this._mostrarToast('📴 Sin conexión: se ve lo último que se cargó', 3000);
        }
        this._caRenderDia();
        this._caRenderHistorial();
        return false;
    },

    caLimpiarFiltros() {
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        v('caDesde', this._caIsoHaceDias(30));
        v('caHasta', this._caHoyISO());
        const b = document.getElementById('caBuscar');
        if (b) b.value = '';
        this.caCargarRegistros(true);
    },

    // ── Corregir un registro ──

    caAbrirRegistro(id) {
        const r = this._caPorId[id];
        if (!r) return;
        this._caEditando = id;
        const v = (k, val) => { const el = document.getElementById(k); if (el) el.value = val || ''; };
        v('caeFecha', this._caAISO(r.fecha)); v('caeEntrada', r.entrada); v('caeSalida', r.salida);
        v('caeMatricula', r.matricula); v('caeNombre', r.nombre); v('caeEmpresa', r.empresa);
        v('caeVehiculo', r.vehiculo); v('caeDepartamento', r.departamento);
        // Borrar es de quien lleva el puesto, que es quien está aquí
        const b = document.getElementById('caeBorrar');
        if (b) b.hidden = false;
        const firma = document.getElementById('caeFirma');
        if (firma) firma.textContent = r.creadoPor
            ? `Apuntado por ${this._caQuien(r.creadoPor, r.creadoNombre, r.creadoNum)}`
              + (r.tocadoPor && r.tocadoPor !== r.creadoPor
                  ? ` · corregido por ${this._caQuien(r.tocadoPor, r.tocadoNombre, r.tocadoNum)}` : '')
            : '';
        document.getElementById('caRegModal').classList.add('show');
    },

    caCerrarRegistro() { document.getElementById('caRegModal').classList.remove('show'); this._caEditando = null; },

    caSalidaAhoraEnCuadro() {
        const el = document.getElementById('caeSalida');
        if (el) el.value = this._caHoraAhora();
    },

    async caGuardarRegistro() {
        const id = this._caEditando;
        if (!id) return;
        const g = k => (document.getElementById(k)?.value || '').trim();
        const cuerpo = {
            id, fecha: this._caAClave(g('caeFecha')), entrada: g('caeEntrada'), salida: g('caeSalida'),
            matricula: formatoMatricula(g('caeMatricula')), nombre: g('caeNombre'), empresa: g('caeEmpresa'),
            vehiculo: g('caeVehiculo'), departamento: g('caeDepartamento'),
        };
        if (cuerpo.fecha.length !== 8 || !/^\d{2}:\d{2}$/.test(cuerpo.entrada)) {
            this._mostrarToast('❌ Falta el día o la hora de entrada', 3000); return;
        }
        if (cuerpo.salida && cuerpo.salida < cuerpo.entrada) {
            this._mostrarToast('❌ La salida no puede ser antes que la entrada', 3500); return;
        }
        try {
            await this._caEnviarRegistro(cuerpo);
            this.caCerrarRegistro();
            this._caRenderDia();
            this._caRenderHistorial();
            this._mostrarToast('✅ Registro guardado', 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
    },

    caBorrarRegistro() {
        const id = this._caEditando;
        const r = this._caPorId[id];
        if (!r) return;
        this.caCerrarRegistro();
        this.mostrarModal('Borrar el registro',
            `¿Borrar la entrada de las ${r.entrada}${r.matricula ? ' de ' + r.matricula : ''}${r.nombre ? ' (' + r.nombre + ')' : ''}?`,
            async () => {
                try {
                    const resp = await this._caFetch(this._caUrl('id=' + encodeURIComponent(id)), { method: 'DELETE' });
                    await this._caRespuesta(resp);
                    delete this._caPorId[id];
                    this._caGuardarCacheRegistros();
                    this._caRenderDia();
                    this._caRenderHistorial();
                    this._mostrarToast('🗑️ Registro borrado', 2500);
                } catch (e) { this._mostrarToast('❌ ' + e.message, 5000); }
            });
    },

    // ── Quién puede verlo ──
    // El desarrollador siempre; en gestión, quien esté en la lista de
    // "Control (Gestión)" de Usuarios con acceso.
    async _caComprobarAcceso() {
        const yo = (this.usuarioActual?.email || '').toLowerCase();
        let ok = ES_APP_DEV || yo === SUPER_USER_EMAIL.toLowerCase();
        if (!ok && yo) {
            try {
                const r = await fetch(`${this.API_BASE}allowlist?app=gestion-control`, { cache: 'no-store' });
                if (r.ok) {
                    const l = await r.json();
                    ok = Array.isArray(l) && l.map(e => String(e).toLowerCase()).includes(yo);
                    try { localStorage.setItem('caPermitido', ok ? '1' : '0'); } catch (_) {}
                } else ok = localStorage.getItem('caPermitido') === '1';
            } catch (_) { ok = localStorage.getItem('caPermitido') === '1'; }
        }
        this._caPermitido = ok;
        this._registrarPush();
        ['tabBtnCaReg', 'tabBtnCaHist', 'tabBtnCaVis'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.hidden = !ok;
        });
        if (ok) this._caArrancar();
        else if (this._activeTab >= 5 && this._activeTab <= 7) this.switchTab(0);
    },

    // Nombre - número de quien apuntó; en los de antes, lo de la plantilla
    _caQuien(email, nombre, num) {
        const e = String(email || '').toLowerCase();
        const u = (this._conductores || {})[e];
        nombre = nombre || u?.nombre;
        num = num || u?.conductor;
        return [nombre || e, num].filter(Boolean).join(' - ');
    },

    _caCuando(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    // ── El directorio de visitantes ──
    // Una tarjeta por persona: si un coche lo traen dos, salen las dos, cada
    // una con la misma matrícula
    _caFichasVisitantes() {
        const out = [];
        Object.values(this._caVisitantes).forEach(v => {
            const ps = Array.isArray(v.personas) && v.personas.length ? v.personas
                : [{ nombre: v.nombre, empresa: v.empresa, vehiculo: v.vehiculo, departamento: v.departamento, visto: v.visto }];
            ps.forEach(p => out.push({ ...p, matricula: v.matricula, clave: this._caClaveMatricula(v.matricula),
                                       comparten: ps.length, editadoPor: v.editadoPor }));
        });
        return out;
    },

    caRenderVisitantes() {
        const cont = document.getElementById('caViLista');
        if (!cont) return;
        const t = String(document.getElementById('caViBuscar')?.value || '').trim().toLowerCase();
        const k = this._caClaveMatricula(t);
        const orden = document.getElementById('caViOrden')?.value || 'nombre';
        const todas = this._caFichasVisitantes();
        const lista = todas
            .filter(v => !t || (k && v.clave.includes(k))
                || [v.nombre, v.empresa, v.vehiculo, v.departamento].some(x => String(x || '').toLowerCase().includes(t)))
            .sort((a, b) => orden === 'visto'
                ? String(b.visto || '').localeCompare(String(a.visto || ''))
                : String(a[orden] || '￿').localeCompare(String(b[orden] || '￿'), 'es', { numeric: true })
                  || String(a.matricula || '').localeCompare(String(b.matricula || '')));
        this._caFichasVistas = lista;
        const n = document.getElementById('caViCuantos');
        if (n) n.textContent = String(todas.length);
        cont.innerHTML = lista.length ? lista.map((v, i) => `
            <div class="ca-reg" onclick="app.caAbrirVisitante(${i})">
                <div class="ca-top">
                    <span class="ca-horas">${this._caEsc(v.nombre || '—')}</span>
                    <span class="ca-mat">${this._caEsc(v.matricula)}</span>
                </div>
                ${v.empresa ? `<div class="ca-quien">${this._caEsc(v.empresa)}</div>` : ''}
                ${v.vehiculo || v.departamento ? `<div class="ca-que">${this._caEsc([v.vehiculo, v.departamento ? '→ ' + v.departamento : ''].filter(Boolean).join(' '))}</div>` : ''}
                ${v.comparten > 1 ? `<div class="ca-que">👥 Esta matrícula la traen ${v.comparten} personas</div>` : ''}
                ${v.visto ? `<div class="ca-que">Última vez: ${this._caEsc(this._caCuando(v.visto))}</div>` : ''}
            </div>`).join('')
            : '<div class="ca-vacio">No hay nadie en el directorio con eso.</div>';
    },

    // i: la tarjeta de la lista; sin él, una ficha nueva
    caAbrirVisitante(i) {
        const v = typeof i === 'number' ? this._caFichasVistas?.[i] : null;
        this._caVisEditando = v ? { clave: v.clave, nombre: v.nombre || '' } : null;
        const put = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        put('caVMatricula', v?.matricula); put('caVNombre', v?.nombre); put('caVEmpresa', v?.empresa);
        put('caVVehiculo', v?.vehiculo); put('caVDepartamento', v?.departamento);
        const t = document.getElementById('caVisTitulo');
        if (t) t.textContent = v ? '✏️ Visitante' : '➕ Nuevo visitante';
        const b = document.getElementById('caVBorrar');
        if (b) b.hidden = !v;
        const f = document.getElementById('caVFirma');
        if (f) f.textContent = [v?.comparten > 1 ? `Esta matrícula la traen ${v.comparten} personas.` : '',
                                v?.editadoPor ? `Modificado por ${v.editadoPor}` : ''].filter(Boolean).join(' ');
        document.getElementById('caVisModal').classList.add('show');
    },

    caCerrarVisitante() { document.getElementById('caVisModal').classList.remove('show'); },

    async caGuardarVisitante() {
        const g = id => (document.getElementById(id)?.value || '').trim();
        const ficha = { matricula: formatoMatricula(g('caVMatricula')), nombre: g('caVNombre'), empresa: g('caVEmpresa'),
                        vehiculo: g('caVVehiculo'), departamento: g('caVDepartamento') };
        if (!this._caClaveMatricula(ficha.matricula)) { this._mostrarToast('❌ Falta la matrícula', 3000); return; }
        try {
            const r = await this._caFetch(this._caUrl('que=visitantes'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ficha, antes: this._caVisEditando?.clave || '', antesNombre: this._caVisEditando?.nombre || '' }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || r.status);
            this.caCerrarVisitante();
            await this.caCargarVisitantes();
            this.caRenderVisitantes();
            this._mostrarToast('✅ Guardado', 2000);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
    },

    caBorrarVisitante() {
        const ed = this._caVisEditando;
        const v = ed && this._caVisitantes[ed.clave];
        if (!v) return;
        this.caCerrarVisitante();
        const quien = ed.nombre ? ` (${ed.nombre})` : '';
        this.mostrarModal('Quitar del directorio',
            `¿Quitar ${v.matricula}${quien} del directorio? Sus registros no se borran.`,
            async () => {
                try {
                    const q = `que=visitantes&matricula=${encodeURIComponent(v.matricula)}`
                        + (ed.nombre ? `&nombre=${encodeURIComponent(ed.nombre)}` : '');
                    const r = await this._caFetch(this._caUrl(q), { method: 'DELETE' });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(data.error || r.status);
                    await this.caCargarVisitantes();
                    this.caRenderVisitantes();
                    this._mostrarToast('🗑️ Quitado del directorio', 2500);
                } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
            });
    },

    CA_MESES: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
            'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    CA_CABECERAS: ['Fecha', 'Nombre y apellidos', 'Matrícula', 'Marca y modelo', 'Empresa',
                'H. Entrada', 'H. Salida', 'Departamento'],
    CA_ANCHOS: [13.7, 25.6, 13, 30, 22.6, 13.9, 13.9, 28.8],

    // Los registros de lo que se está viendo, por meses, del más viejo al más nuevo
    _caMesesExport() {
        const lista = this._caEnHistorial().slice().sort((a, b) =>
            (a.fecha || '').localeCompare(b.fecha || '') || (a.entrada || '').localeCompare(b.entrada || ''));
        const meses = [];
        lista.forEach(r => {
            const k = String(r.fecha).slice(0, 6);
            let m = meses[meses.length - 1];
            if (!m || m.clave !== k) meses.push(m = { clave: k, anio: k.slice(0, 4),
                                                      nombre: this.CA_MESES[+k.slice(4, 6) - 1], registros: [] });
            m.registros.push(r);
        });
        const anios = [...new Set(meses.map(m => m.anio))];
        meses.forEach(m => { m.hoja = anios.length > 1 ? `${m.nombre} ${m.anio}` : m.nombre;
                             m.titulo = `Control de acceso · ${m.nombre} ${m.anio}`; });
        const nombre = meses.length === 1 ? `Control de acceso - ${meses[0].nombre} ${meses[0].anio}`
                     : `Control de acceso - ${anios.length > 1 ? anios[0] + '-' + anios[anios.length - 1] : anios[0]}`;
        return { meses, nombre, total: lista.length };
    },

    caExportar() {
        const { meses, nombre, total } = this._caMesesExport();
        if (!total) { this._mostrarToast('No hay registros que exportar', 3000); return; }
        const res = document.getElementById('caExpResumen');
        if (res) res.textContent = `${total} registros · ${meses.length === 1 ? meses[0].nombre + ' ' + meses[0].anio
            : meses.length + ' meses, una hoja por mes'} · «${nombre}»`;
        document.getElementById('caExpModal').classList.add('show');
    },

    caCerrarExport() { document.getElementById('caExpModal').classList.remove('show'); },

    _caFechaCorta(f) { return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(2, 4)}`; },

    // Las filas de un mes: la fecha solo en la primera de cada día
    _caFilasMes(m) {
        let dia = '';
        return m.registros.map(r => {
            const f = r.fecha !== dia ? r.fecha : '';
            dia = r.fecha;
            return [f, r.nombre, r.matricula, r.vehiculo, r.empresa, r.entrada, r.salida, r.departamento];
        });
    },

    // ── CSV: una hoja no cabe en otra, así que cada mes va en su bloque ─────

    _caCsv() {
        const esc = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const { meses } = this._caMesesExport();
        const bloques = meses.map(m => [
            m.titulo, this.CA_CABECERAS.join(';'),
            ...this._caFilasMes(m).map(f => [f[0] ? this._caFechaCorta(f[0]) : '', ...f.slice(1)].map(esc).join(';')),
        ].join('\r\n'));
        return '﻿' + bloques.join('\r\n\r\n') + '\r\n';
    },

    // ── Excel (.xlsx), hecho aquí mismo: un ZIP con unos cuantos XML ────────

    _caCrc32(bytes) {
        let tabla = this._caCrcTabla;
        if (!tabla) {
            tabla = this._caCrcTabla = new Int32Array(256);
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

    _caZip(ficheros) {
        const enc = new TextEncoder();
        const partes = [], central = [];
        let offset = 0;
        const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
        const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
        ficheros.forEach(({ nombre, texto }) => {
            const datos = enc.encode(texto);
            const nom = enc.encode(nombre);
            const crc = this._caCrc32(datos);
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

    _caXlsx() {
        const { meses } = this._caMesesExport();
        const esc = v => String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        const col = n => String.fromCharCode(65 + n);
        const texto = (ref, v, st) => v === '' || v == null ? `<c r="${ref}" s="${st}"/>`
            : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${this._caEsc(v)}</t></is></c>`;
        const numero = (ref, v, st) => `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
        // Fechas y horas como las de Excel: días desde 1899-12-30 y fracción de día
        const serial = f => (Date.UTC(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8)) - Date.UTC(1899, 11, 30)) / 86400000;
        const hora = h => { const [a, b] = String(h).split(':').map(Number); return (a * 60 + b) / 1440; };
        const ultima = col(this.CA_CABECERAS.length - 1);

        const hojas = meses.map(m => {
            const filas = [
                `<row r="1" ht="24" customHeight="1">${texto('A1', m.titulo, 5)}</row>`,
                `<row r="2" ht="22.5" customHeight="1">${this.CA_CABECERAS.map((h, i) => texto(col(i) + '2', h, 1)).join('')}</row>`,
                ...this._caFilasMes(m).map((f, n) => {
                    const r = n + 3;
                    return `<row r="${r}" ht="21" customHeight="1">` + f.map((v, i) => {
                        const ref = col(i) + r;
                        if (i === 0) return v ? numero(ref, serial(v), 3) : `<c r="${ref}" s="2"/>`;
                        if ((i === 5 || i === 6) && /^\d{2}:\d{2}$/.test(v || '')) return numero(ref, hora(v), 4);
                        return texto(ref, v, 2);
                    }).join('') + '</row>';
                }),
            ].join('');
            const anchos = this.CA_ANCHOS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
            return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                + `<cols>${anchos}</cols><sheetData>${filas}</sheetData>`
                + `<mergeCells count="1"><mergeCell ref="A1:${ultima}1"/></mergeCells>`
                + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
                + '<pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>'
                // El título también en la cabecera de la página, al imprimir
                + `<headerFooter><oddHeader>&amp;C&amp;B${this._caEsc(m.titulo)}</oddHeader><oddFooter>&amp;CPágina &amp;P de &amp;N</oddFooter></headerFooter>`
                + '</worksheet>';
        });

        const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
        const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const fuente = 'Aptos Narrow';
        return this._caZip([
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
              + meses.map((m, i) => `<sheet name="${this._caEsc(m.hoja).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
              + '</sheets>'
              + `<definedNames>${meses.map((m, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${this._caEsc(m.hoja).slice(0, 31)}'!$1:$2</definedName>`).join('')}</definedNames>`
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

    _caGuardarArchivo(bytes, nombre, tipo) {
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

    caExportarXLS() {
        const { nombre, total } = this._caMesesExport();
        this.caCerrarExport();
        const ok = this._caGuardarArchivo(this._caXlsx(), nombre + '.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel; de momento usa CSV', 4500); return; }
        this._mostrarToast(`📗 ${total} registros en Excel`, 3500);
    },

    caExportarCSV() {
        const { nombre, total } = this._caMesesExport();
        this.caCerrarExport();
        const csv = this._caCsv();
        if (window.AndroidBridge?.saveFile) {
            try { window.AndroidBridge.saveFile(csv, nombre + '.csv'); return; } catch (_) {}
        }
        this._caGuardarArchivo(new TextEncoder().encode(csv), nombre + '.csv', 'text/csv;charset=utf-8');
        this._mostrarToast(`📊 ${total} registros en CSV`, 3500);
    },

    // Google Sheets: se sube el mismo Excel y Drive lo convierte, con sus
    // hojas por mes y su formato
    async caExportarSheets() {
        const { nombre, total } = this._caMesesExport();
        this.caCerrarExport();
        this._mostrarToast('☁️ Creando la hoja en tu Drive…', 3000);
        try {
            const frontera = 'emt' + Date.now();
            const meta = JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.spreadsheet' });
            const cuerpo = new Blob([
                `--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
                + `--${frontera}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
                this._caXlsx(),
                `\r\n--${frontera}--`,
            ]);
            if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
            const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}`,
                                           'Content-Type': 'multipart/related; boundary=' + frontera }, body: cuerpo,
            });
            if (!r.ok) throw new Error('Drive ' + r.status);
            const out = await r.json();
            this._mostrarToast(`✅ ${total} registros en Google Sheets`, 3500);
            if (out.webViewLink) {
                if (window.AndroidBridge?.openExternalUrl) window.AndroidBridge.openExternalUrl(out.webViewLink);
                else window.open(out.webViewLink, '_blank');
            }
        } catch (e) {
            this._mostrarToast('❌ No se ha podido crear la hoja: ' + e.message, 5000);
        }
    },

    // ── Partes del puesto de Control de acceso ───────────────────────────────
    // Quien hace ese turno va apuntando lo que pasa en la garita —quién entra,
    // quién sale, una incidencia, unas llaves— y queda un parte por día y
    // turno. Aquí se leen todos, se corrigen y se borran. De momento solo en
    // la app de desarrollador: hasta que el formulario no esté en la app de
    // los trabajadores, los partes se escriben desde aquí.

    PARTES_URL: 'https://emt-palma-movilidad.vercel.app/api/partes',
    TURNOS_CONTROL: { M: 'Mañana · 07:00–14:00', T: 'Tarde · 14:00–21:00', N: 'Noche · 21:00–07:00' },
    TIPOS_PARTE: { entrada: '🟢 Entrada', salida: '🔴 Salida', visita: '👤 Visita',
                   incidencia: '⚠️ Incidencia', llaves: '🔑 Llaves', otro: '· Otro' },
    // Por orden de reloj, que es como se leen: mañana, tarde y noche. Por la
    // letra salían M, N, T —la noche antes de la tarde—.
    ORDEN_TURNO: { M: 0, T: 1, N: 2 },
    _partes: null,
    _parteEdit: null,

    // Del más reciente al más viejo, y dentro del día del último turno al
    // primero: lo que acaba de pasar, arriba.
    _ordenPartes(a, b) {
        return (b.fecha || '').localeCompare(a.fecha || '')
            || (this.ORDEN_TURNO[b.turno] ?? 9) - (this.ORDEN_TURNO[a.turno] ?? 9);
    },

    // Los registros de entrada y salida del puesto, del mes elegido
    async _cargarPartes(forzar) {
        if (!ES_APP_DEV || !this.usuarioActual?.email) return;
        const hoy = this._aClave(this._hoyISO());
        const dia = document.getElementById('caDia'), mes = document.getElementById('caMes');
        if (dia && !dia.value) dia.value = this._hoyISO();
        if (mes && !mes.value) mes.value = this._hoyISO().slice(0, 7);
        const m = (mes?.value || this._hoyISO().slice(0, 7)).replace('-', '');
        if (this._accesos && this._accesosMes === m && !forzar) { this._renderPartes(); return; }
        const cont = document.getElementById('paLista');
        if (cont && !this._accesos) cont.innerHTML = '<div class="pa-vacio">Cargando…</div>';
        try {
            // El mes entero, y además el día elegido por si es de otro mes
            const d = this._aClave(dia?.value) || hoy;
            const pedir = async (desde, hasta) => {
                const r = await fetch(`${this.API_BASE}accesos?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
                return r.json();
            };
            const [delMes, delDia] = await Promise.all([pedir(m + '01', m + '31'),
                d.startsWith(m) ? Promise.resolve([]) : pedir(d, d)]);
            const porId = {};
            [...delMes, ...delDia].forEach(r => { porId[r.id] = r; });
            this._accesos = Object.values(porId);
            this._accesosMes = m;
        } catch (e) {
            if (!this._accesos) this._accesos = [];
            if (forzar) this._mostrarToast('❌ ' + e.message, 4000);
        }
        this._renderPartes();
    },

    _diaLargo(fecha) {
        const f = String(fecha || '');
        if (f.length !== 8) return f;
        const d = new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12);
        return isNaN(d) ? f : d.toLocaleDateString('es-ES',
            { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    },

    // Quién es cada correo, con el nombre de la plantilla si lo hay
    _guardiaEs(email) {
        const u = (this._conductores || {})[String(email || '').toLowerCase()];
        return u?.nombre ? `${u.nombre}${u.conductor ? ' · ' + u.conductor : ''}` : (email || '—');
    },

    _renderPartes() {
        const cont = document.getElementById('paLista');
        if (!cont) return;
        const esc = t => String(t ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const lista = Array.isArray(this._accesos) ? this._accesos : [];
        const dia = this._aClave(document.getElementById('caDia')?.value) || this._aClave(this._hoyISO());
        const mes = this._accesosMes || dia.slice(0, 6);
        // Por persona: cuántos apuntó y de qué hora a qué hora
        const resumen = regs => {
            const q = {};
            regs.forEach(r => {
                const k = r.creadoPor || '—';
                const x = q[k] || (q[k] = { n: 0, desde: '99:99', hasta: '00:00' });
                x.n++; if (r.entrada < x.desde) x.desde = r.entrada; if (r.entrada > x.hasta) x.hasta = r.entrada;
            });
            return Object.entries(q).sort((a, b) => b[1].n - a[1].n);
        };
        const delDia = lista.filter(r => r.fecha === dia).sort((a, b) => (a.entrada || '').localeCompare(b.entrada || ''));
        const quienDia = resumen(delDia);
        let html = `<div class="pa-card" style="cursor:default;">
            <div class="pa-card-top"><span class="pa-dia">📅 ${esc(this._diaLargo(dia))}</span>
                <span class="pa-n">${delDia.length} entrada${delDia.length === 1 ? '' : 's'}</span></div>
            ${quienDia.length ? quienDia.map(([k, x]) => `<div class="pa-quien">👤 ${esc(this._guardiaEs(k))} — ${x.n} registro${x.n === 1 ? '' : 's'} (${esc(x.desde)}–${esc(x.hasta)})</div>`).join('')
                : '<div class="pa-resumen">Nadie ha registrado entradas este día.</div>'}
            ${delDia.map(r => `<div class="pa-resumen">${esc(r.entrada)}${r.salida ? '–' + esc(r.salida) : ''} · <b>${esc(r.matricula || '')}</b> ${esc([r.nombre, r.empresa].filter(Boolean).join(' · '))}</div>`).join('')}
        </div>`;
        // El mes, día a día
        const delMes = lista.filter(r => String(r.fecha).startsWith(mes));
        const dias = [...new Set(delMes.map(r => r.fecha))].sort().reverse();
        const nombreMes = new Date(+mes.slice(0, 4), +mes.slice(4, 6) - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const quienMes = resumen(delMes);
        html += `<div class="pa-card" style="cursor:default;">
            <div class="pa-card-top"><span class="pa-dia">🗓️ ${esc(nombreMes)}</span>
                <span class="pa-n">${delMes.length} entradas · ${dias.length} días</span></div>
            ${quienMes.map(([k, x]) => `<div class="pa-quien">👤 ${esc(this._guardiaEs(k))} — ${x.n} en el mes</div>`).join('')
                || '<div class="pa-resumen">Sin registros este mes.</div>'}
        </div>`;
        html += dias.map(f => {
            const regs = delMes.filter(r => r.fecha === f);
            const q = resumen(regs).map(([k, x]) => `${esc(this._guardiaEs(k))} (${x.n})`).join(' · ');
            return `<div class="pa-card" onclick="document.getElementById('caDia').value='${this._aISO(f)}';app._renderPartes();document.getElementById('paLista').scrollTop=0;">
                <div class="pa-card-top"><span class="pa-dia">${esc(this._diaLargo(f))}</span>
                    <span class="pa-n">${regs.length} entrada${regs.length === 1 ? '' : 's'}</span></div>
                <div class="pa-resumen">${q}</div></div>`;
        }).join('');
        cont.innerHTML = html;
    },

    // El día va en AAAAMMDD por dentro y con guiones en el campo de fecha
    _aISO(f)  { const s = String(f || ''); return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : ''; },
    _aClave(f) { return String(f || '').replace(/-/g, '').slice(0, 8); },

    _nuevoParte() {
        this._parteEdit = { id: '', fecha: this._aClave(this._hoyISO()), turno: 'M',
                            nombre: '', notas: '', anotaciones: [] };
        this._pintarParte(true);
    },

    _abrirParte(id) {
        const p = (this._partes || []).find(x => x.id === id);
        if (!p) return;
        // Una copia: si al final cancela, la lista se queda como estaba
        this._parteEdit = JSON.parse(JSON.stringify(p));
        this._pintarParte(false);
    },

    _pintarParte(esNuevo) {
        const p = this._parteEdit;
        if (!p) return;
        document.getElementById('parteTitulo').textContent = esNuevo ? '🛡️ Parte nuevo' : '🛡️ Parte';
        document.getElementById('parteFecha').value = this._aISO(p.fecha) || this._hoyISO();
        document.getElementById('parteTurno').value = p.turno || 'M';
        document.getElementById('parteNombre').value = p.nombre || '';
        document.getElementById('parteNotas').value = p.notas || '';
        const borrar = document.getElementById('parteBorrar');
        if (borrar) borrar.style.display = esNuevo ? 'none' : '';
        const firma = document.getElementById('parteFirma');
        if (firma) firma.textContent = p.actualizado
            ? `Última corrección: ${this._fechaNota(p.actualizado)}${p.tocadoPor ? ' · ' + p.tocadoPor : ''}`
            : '';
        this._pintarAnotaciones();
        const modal = document.getElementById('parteModal');
        modal.classList.add('show');
        if (this.darkMode) document.getElementById('parteModalContent').classList.add('dark');
    },

    _pintarAnotaciones() {
        const cont = document.getElementById('parteAnotaciones');
        if (!cont || !this._parteEdit) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const filas = this._parteEdit.anotaciones || [];
        if (!filas.length) {
            cont.innerHTML = '<div class="ops-field-sub">Todavía no hay nada apuntado en este turno.</div>';
            return;
        }
        cont.innerHTML = filas.map((a, i) => `<div class="pa-fila">
            <input class="pa-hora" type="time" value="${esc(a.hora)}" onchange="app._tocarAnotacion(${i},'hora',this.value)">
            <div class="pa-fila-txt">
                <select class="pa-tipo" style="width:100%" onchange="app._tocarAnotacion(${i},'tipo',this.value)">
                    ${Object.entries(this.TIPOS_PARTE).map(([k, v]) =>
                        `<option value="${k}"${a.tipo === k ? ' selected' : ''}>${v}</option>`).join('')}
                </select>
                <input type="text" value="${esc(a.que)}" maxlength="200" placeholder="Qué (bus 214, furgoneta, paquete…)"
                       onchange="app._tocarAnotacion(${i},'que',this.value)">
                <input type="text" value="${esc(a.quien)}" maxlength="200" placeholder="Quién (nombre o empresa)"
                       onchange="app._tocarAnotacion(${i},'quien',this.value)">
                <input type="text" value="${esc(a.obs)}" maxlength="400" placeholder="Observaciones"
                       onchange="app._tocarAnotacion(${i},'obs',this.value)">
            </div>
            <button class="pa-quitar" onclick="app._quitarAnotacion(${i})" title="Quitar">✕</button>
        </div>`).join('');
    },

    _tocarAnotacion(i, campo, valor) {
        const a = this._parteEdit?.anotaciones?.[i];
        if (a) a[campo] = valor;
    },

    _anadirAnotacion() {
        if (!this._parteEdit) return;
        const d = new Date();
        this._parteEdit.anotaciones = this._parteEdit.anotaciones || [];
        this._parteEdit.anotaciones.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            tipo: 'entrada', que: '', quien: '', obs: '',
        });
        this._pintarAnotaciones();
    },

    _quitarAnotacion(i) {
        if (!this._parteEdit?.anotaciones) return;
        this._parteEdit.anotaciones.splice(i, 1);
        this._pintarAnotaciones();
    },

    async _guardarParte() {
        const p = this._parteEdit;
        if (!p) return;
        const fecha = this._aClave(document.getElementById('parteFecha').value);
        if (fecha.length !== 8) { this._mostrarToast('❌ Falta el día', 3000); return; }
        const cuerpo = {
            fecha,
            turno: document.getElementById('parteTurno').value,
            nombre: document.getElementById('parteNombre').value,
            notas: document.getElementById('parteNotas').value,
            // Sin nada escrito no se guarda: el servidor las descarta igual,
            // pero así no se manda de más.
            anotaciones: (p.anotaciones || []).filter(a => a.que || a.quien || a.obs),
        };
        try {
            const r = await fetch(this.PARTES_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || r.status);
            document.getElementById('parteModal').classList.remove('show');
            // El que vuelve manda: puede haber cambiado de clave si se le ha
            // tocado el día o el turno.
            this._partes = [data, ...(this._partes || []).filter(x => x.id !== data.id && x.id !== p.id)]
                .sort((a, b) => this._ordenPartes(a, b));
            localStorage.setItem('partesCache', JSON.stringify(this._partes));
            this._renderPartes();
            this._mostrarToast('✅ Parte guardado', 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
    },

    _borrarParte() {
        const p = this._parteEdit;
        if (!p?.id) return;
        this.mostrarModal('Borrar el parte', `¿Seguro que quieres borrar el parte de `
            + `${this._diaLargo(p.fecha)} (turno ${p.turno})? No se puede deshacer.`, async () => {
            try {
                const r = await fetch(`${this.PARTES_URL}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error || r.status);
                document.getElementById('parteModal').classList.remove('show');
                this._partes = (this._partes || []).filter(x => x.id !== p.id);
                localStorage.setItem('partesCache', JSON.stringify(this._partes));
                this._renderPartes();
                this._mostrarToast('🗑️ Parte borrado', 2500);
            } catch (e) { this._mostrarToast('❌ ' + e.message, 4500); }
        });
    },

    CABECERAS_PARTES: ['Día', 'Turno', 'Quién', 'Hora', 'Tipo', 'Qué', 'Quién/empresa', 'Observaciones'],

    exportarPartes() {
        const lista = Array.isArray(this._partes) ? this._partes : [];
        if (!lista.length) { this._mostrarToast('No hay partes que exportar', 3000); return; }
        const filas = [];
        lista.slice().sort((a, b) => this._ordenPartes(b, a)).forEach(p => {
            const dia = this._aISO(p.fecha).split('-').reverse().join('/');
            const quien = p.nombre || p.email || '';
            if (!(p.anotaciones || []).length) {
                filas.push([dia, p.turno, quien, '', '', '', '', p.notas || '']);
                return;
            }
            p.anotaciones.forEach((a, i) => filas.push([
                dia, p.turno, quien, a.hora, a.tipo, a.que, a.quien,
                // Las observaciones del turno van una sola vez, en la primera
                i === 0 && p.notas ? `${a.obs}${a.obs ? ' | ' : ''}${p.notas}` : a.obs,
            ]));
        });
        const ok = this._descargarBinario(this._xlsxDe('Control de acceso', this.CABECERAS_PARTES, filas),
            this._nombreExport('xlsx').replace('registro-emt', 'control-acceso'),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel', 4500); return; }
        this._mostrarToast('📗 Partes exportados', 3500);
    },

    NOTAS_URL: 'https://emt-palma-movilidad.vercel.app/api/notas',
    _notas: [],

    // La bandeja de gestión es de gestión. En la app de desarrollador no
    // pinta nada: ahí solo están sus conversaciones —lo que él le escribe a
    // gestión y lo que gestión le contesta—, que es lo que devuelve la API
    // cuando se le pide con el correo. Si abre la app de gestión en modo
    // desarrollador sigue viendo la bandeja entera, que para eso la prueba:
    // lo que manda es de qué aplicación se trata, no quién la abre.
    _urlNotas(extra) {
        const base = this.NOTAS_URL + (extra ? '?' + extra : '');
        if (!ES_APP_DEV) return base;
        return base + (extra ? '&' : '?')
            + 'email=' + encodeURIComponent(this.usuarioActual?.email || '');
    },

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
            // Lo que vio gestión es de gestión, y lo que vio la persona, suyo
            if (!!v.gestion !== !ES_APP_DEV) return;
            const cuando = v.en || '';
            if (cuando && cuando > (leidas[n.id] || '')) { leidas[n.id] = cuando; cambia = true; }
        });
        if (cambia) {
            try { localStorage.setItem('convLeidas', JSON.stringify(leidas)); } catch (_) {}
        }
    },

    async _cargarNotasGestor() {
        // Sin correo, pedirlas en la app de desarrollador devolvería la
        // bandeja de gestión entera. Mejor no pedir nada.
        if (ES_APP_DEV && !this.usuarioActual?.email) return;
        try {
            const r = await fetch(this._urlNotas(), { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            // Lo que se escriben entre compañeros no pasa por aquí, ni siquiera
            // lo que le escriban al desarrollador: eso es suyo y lo lee en la
            // app de trabajadores. Aquí solo está lo que va con gestión.
            // El desarrollador ve aquí todo lo suyo, también lo que le escriben
            // los trabajadores de tú a tú: antes se descartaba y no le llegaba.
            this._notas = (await r.json()).filter(n => ES_APP_DEV || n.tipo !== 'companero');
            localStorage.setItem('notasCache', JSON.stringify(this._notas));
        } catch (_) {
            try { this._notas = JSON.parse(localStorage.getItem('notasCache') || '[]'); } catch (__) {}
        }
        this._fundirVistosDelServidor();
        this._renderNotasGestor();
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

    filtrarNotas(modo) {
        localStorage.setItem('filtroNotas', modo);
        this._renderNotasGestor();
    },

    _fechaNota(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    _renderNotasGestor() {
        const cont = document.getElementById('ntLista');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        // Vista o sin ver, y aparte las que ha abierto gestión. Un mismo hilo
        // puede ser "mía" y estar vista, así que el filtro se pregunta por lo
        // que toca en cada caso en vez de encasillar la conversación en uno.
        const estado = n => this._estaVista(n) ? 'visto'
            : n.de === 'gestor' ? 'mias' : 'pendiente';
        const pasa = (n, id) => id === 'archivadas' ? !!n.archivada
            : n.archivada ? false
            : id === 'todas' ? true
            : id === 'visto' ? this._estaVista(n)
            : id === 'mias'  ? n.de === 'gestor' && !this._estaVista(n)
            : !this._estaVista(n) && n.de !== 'gestor';
        // Enviadas y Vistas ya no están: quien las tuviera elegidas pasa a Todas
        const guardado = localStorage.getItem('filtroNotas');
        const sel = ['todas', 'pendiente', 'archivadas'].includes(guardado) ? guardado : 'todas';
        const todas = this._notas || [];
        const fil = document.getElementById('ntFiltros');
        if (fil) {
            fil.innerHTML = [['todas', 'Todas'], ['pendiente', 'Sin ver'], ['archivadas', 'Archivadas']]
                .map(([id, txt]) => {
                    const n = todas.filter(x => pasa(x, id)).length;
                    return `<button class="${sel === id ? 'activo' : ''}"
                        onclick="app.filtrarNotas('${id}')">${sel === id ? '✓ ' : ''}${txt} ${n}</button>`;
                }).join('');
        }
        const pend = todas.filter(n => !n.archivada && !this._estaVista(n)).length;
        const cnt = document.getElementById('ntCnt');
        if (cnt) cnt.textContent = pend ? `${pend} sin ver` : 'al día';
        const lista = todas.filter(n => pasa(n, sel));
        if (!lista.length) {
            cont.innerHTML = `<div class="nt-vacio">${todas.length
                ? 'Ninguna conversación en este grupo.' : 'Todavía no hay conversaciones.'}</div>`;
            return;
        }
        const etiqueta = { visto: 'Vista', pendiente: 'Sin ver', mias: 'Enviada' };
        cont.innerHTML = lista.map(n => {
            const ultimo = this._ultimoMensaje(n);
            const e = estado(n);
            const q = esc(n.id).replace(/'/g, "\\'");
            const nueva = this._sinLeer(n);
            return `<div class="cv-card ${e === 'mias' ? 'gestor' : e === 'pendiente' ? '' : e}${
                    n.archivada ? ' archivada' : ''}${nueva ? ' nueva' : ''}" onclick="app.abrirHilo('${q}')">
                <span class="cv-cara">${this._caraHilo(n)}</span>
                <div class="cv-top">
                    ${nueva ? '<span class="cv-punto"></span>' : ''}
                    <span class="cv-quien">${esc(this._tituloHilo(n))}</span>
                    <span class="cv-fecha">${esc(this._horaCorta(ultimo?.en || n.creado))}</span>
                </div>
                <div class="cv-ultimo">${ultimo ? esc(
                    (this._esMiMensaje(ultimo, n) ? 'Tú: ' : (n.tipo === 'grupo' ? this._autorMensaje(ultimo, n) + ': ' : ''))
                    + (ultimo.borrado ? '🚫 Mensaje eliminado' : (ultimo.texto || '📎 Adjunto'))) : ''}</div>
                <div class="cv-pie">
                    <span class="cv-cnt">${this._mensajesDe(n).length} mensaje${
                        this._mensajesDe(n).length === 1 ? '' : 's'}</span>
                    <span class="cv-cnt">${etiqueta[e]}</span>
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

    // ── Escribir a uno, a varios o a toda la plantilla ───────────────────────
    // La misma nota puede ir a mucha gente a la vez, pero cada uno recibe la
    // suya: si contesta, contesta en su conversación y no la ven los demás.

    _elegidos: [],

    nuevaNotaGestor() {
        document.getElementById('destBuscar').value = '';
        this._elegidos = [];
        this._renderDestinatarios();
        document.getElementById('destModal').classList.add('show');
        if (this.darkMode) document.getElementById('destModalContent').classList.add('dark');
    },

    // Los que se ven ahora mismo con lo que haya escrito en el buscador
    DEV_EMAIL: 'g.rioscorrea@gmail.com',
    DEV_NOMBRE: 'Desarrollador',

    // Quien lleva la aplicación, con nombre propio y aparte de la plantilla:
    // fuera de la lista de trabajadores no le afecta "Todos", que si no una
    // nota a toda la plantilla se le colaría a él también.
    // Sale en gestión siempre, entre también quien entre (aunque sea con la
    // misma cuenta del desarrollador); solo no sale en su propia app.
    _filaDesarrollador() {
        if (ES_APP_DEV) return '';
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        if (q && !this.DEV_NOMBRE.toLowerCase().includes(q)) return '';
        const on = this._elegidos.includes(this.DEV_EMAIL);
        return `<div class="dest-fila${on ? ' on' : ''}"
            onclick="app._alternarDest('${this.DEV_EMAIL}')">
            <span class="dest-marca">${on ? '✓' : ''}</span>
            <span class="nt-num">💻</span>
            <span class="nt-nom">${this.DEV_NOMBRE}</span>
        </div>`;
    },

    _destinatariosVisibles() {
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        // Los de prueba no existen de verdad: no se les puede escribir
        return this._conductoresVisibles()
            .filter(u => !u.ficticio && !String(u.email || '').endsWith('@prueba.local'))
            .filter(u => !q || `${u.conductor || ''} ${u.nombre || ''} ${u.email}`.toLowerCase().includes(q))
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    },

    _renderDestinatarios() {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const lista = this._destinatariosVisibles();
        const cont = document.getElementById('destLista');
        const dev = this._filaDesarrollador() + this._filaAGestion();
        cont.innerHTML = dev + (lista.length ? lista.map(u => {
            const on = this._elegidos.includes(u.email);
            return `<div class="dest-fila${on ? ' on' : ''}"
                onclick="app._alternarDest('${esc(u.email).replace(/'/g, "\\'")}')">
                <span class="dest-marca">${on ? '✓' : ''}</span>
                <span class="nt-num">${esc(u.conductor) || '—'}</span>
                <span class="nt-nom">${esc(u.nombre) || esc(u.email)}</span>
            </div>`;
        }).join('')
            : (dev ? '' : '<div class="baja-vacio">Ningún trabajador con ese nombre o número</div>'));
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

    // "Todos" son todos los que se están viendo: con el buscador en blanco es
    // la plantilla entera, y con algo escrito solo los que encajan.
    _marcarTodosDest(si) {
        const visibles = this._destinatariosVisibles().map(u => u.email);
        this._elegidos = si
            ? [...new Set([...this._elegidos, ...visibles])]
            : this._elegidos.filter(e => !visibles.includes(e));
        this._renderDestinatarios();
    },

    _escribirALosElegidos() {
        if (!this._elegidos.length) return;
        this._escribirA(this._elegidos.slice());
    },

    // Quién es el destinatario: un trabajador de la plantilla, o el
    // desarrollador, que no está en ella y va con nombre propio.
    _fichaDe(email) {
        if ((email || '').toLowerCase() === this.DEV_EMAIL) {
            return { email: this.DEV_EMAIL, nombre: this.DEV_NOMBRE, conductor: '💻' };
        }
        if (email === this.A_GESTION) return { email: this.A_GESTION, nombre: 'Gestión', conductor: '🛠️' };
        return (this._conductores || {})[email] || null;
    },

    // Escribirle a gestión desde aquí solo tiene sentido para el
    // desarrollador, que no es gestor de la empresa: es su manera de contarles
    // algo. Un gestor escribiéndose a la bandeja en la que ya está no.
    A_GESTION: '__gestion__',

    _filaAGestion() {
        if (!this._soyElDesarrollador()) return '';
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        if (q && !'gestión gestion'.includes(q)) return '';
        const on = this._elegidos.includes(this.A_GESTION);
        return `<div class="dest-fila${on ? ' on' : ''}"
            onclick="app._alternarDest('${this.A_GESTION}')">
            <span class="dest-marca">${on ? '✓' : ''}</span>
            <span class="nt-num">🛠️</span>
            <span class="nt-nom">Gestión</span>
        </div>`;
    },

    _soyElDesarrollador() {
        return ES_APP_DEV && (this.usuarioActual?.email || '').toLowerCase() === this.DEV_EMAIL;
    },

    _escribirA(quienes) {
        const lista = (Array.isArray(quienes) ? quienes : [quienes])
            .filter(e => this._fichaDe(e) && !String(e).endsWith('@prueba.local'));
        if (!lista.length) return;
        document.getElementById('destModal').classList.remove('show');
        // Se reutiliza el cuadro de responder: es el mismo diálogo
        this._notaRespondiendo = null;
        this._notaPara = lista;
        const u = this._fichaDe(lista[0]);
        document.getElementById('respTitulo').textContent = '✉️ Escribir a';
        document.getElementById('respQuien').textContent = lista.length === 1
            ? this._quienEs(u, lista[0])
            : `👥 Grupo con ${lista.length}: todos leerán lo que se escriba`;
        document.getElementById('respOriginal').textContent = '';
        document.getElementById('respTexto').value = '';
        document.getElementById('respFirma').textContent = this._soyElDesarrollador()
            ? 'Firmarás como Desarrollador. Es una conversación tuya: no sale en '
              + 'la bandeja de gestión y la sigues desde la app de trabajadores.'
            : `Firmarás como ${this._nombreGestor()}.`;
        document.getElementById('respModal').classList.add('show');
        if (this.darkMode) document.getElementById('respModalContent').classList.add('dark');
    },

    async _enviarNotaAGestor() {
        const texto = (document.getElementById('respTexto').value || '').trim();
        if (!texto) { this._mostrarToast('Escribe algo', 3000); return; }
        const todos = Array.isArray(this._notaPara) ? this._notaPara : [this._notaPara];
        // Un grupo lleva nombre y emoji: se piden antes de crearlo
        let datosGrupo = null;
        if (todos.length > 1) {
            datosGrupo = await this._pedirDatosGrupo();
            if (!datosGrupo) return;
        }
        document.getElementById('respModal').classList.remove('show');
        // Al desarrollador no le corresponde firmar como gestión: lo que
        // escribe es suyo, va a su nombre y la conversación es entre los dos.
        // Ni sale en esta bandeja ni la contestación se va al gestor.
        const comoPersona = this._soyElDesarrollador();
        const paraGestion = todos.includes(this.A_GESTION);
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
            // Más de uno a la vez es un grupo: una sola conversación con todos.
            // Gestión entra como gestión; el desarrollador, como persona.
            if (todos.length > 1) {
                nuevas.push(...await enviar({ grupo: true, ...datosGrupo,
                    participantes: para.map(e => ({ email: e, nombre: this._fichaDe(e)?.nombre || '',
                                                    num: this._fichaDe(e)?.conductor || '' })),
                    ...(comoPersona
                        ? { conGestion: paraGestion, deNombre: this.DEV_NOMBRE, deConductor: '💻' }
                        : { comoGestion: true, conGestion: true, gestor: this._nombreGestor() }) }));
            } else if (para.length) {
                // Los nombres van en paralelo a los correos para que cada hilo
                // se titule con el suyo y no con el correo.
                nuevas.push(...await enviar({ para,
                    nombres:     para.map(e => this._fichaDe(e)?.nombre || ''),
                    conductores: para.map(e => this._fichaDe(e)?.conductor || ''),
                    ...(comoPersona
                        ? { tipo: 'companero', deNombre: this.DEV_NOMBRE, deConductor: '💻' }
                        : { gestor: this._nombreGestor() }) }));
            }
            else if (paraGestion) {
                nuevas.push(...await enviar({ nombre: this.DEV_NOMBRE, conductor: '💻' }));
            }
            if (!nuevas.length) return;
            // En la de desarrollador están también sus conversaciones de tú a
            // tú; en la de gestión, lo que va con gestión
            this._notas = [...nuevas.filter(x => ES_APP_DEV || x.tipo !== 'companero'), ...this._notas];
            this._renderNotasGestor();
            this._mostrarToast(nuevas[0]?.tipo === 'grupo' ? '📨 Grupo creado y mensaje enviado'
                : '📨 Mensaje enviado', 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
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
        // Al abrir o volver a la app, un rato en que lo que se cargue no suena
        this._chatCalladoHasta = Date.now() + 10000;
        if (!this._escuchaVuelta) {
            this._escuchaVuelta = true;
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this._chatCalladoHasta = Date.now() + 10000;
            });
        }
        this._registrarPush();
        window.AndroidBridge?.saveToPrefs?.('notifSoundChat', this.notifSoundChat || 'default');
        if (!this.usuarioActual?.email) return;
        let vuelta = 0;
        // Con los avisos al instante, esto es solo el respaldo: cada 3 min
        this._timerChat = setInterval(() => { if (this._conPush && (++vuelta % 3)) return; this._sondearChat(); }, this.SONDEO_CHAT);
        // Y el aviso nativo, que es el que sigue mirando con la app de fondo:
        // el sondeo de aquí arriba solo vive mientras la pantalla esté viva.
        // Lo mismo para el aviso con la app cerrada: de gestor solo tiene la
        // bandeja quien está en la app de gestión. Al desarrollador se le
        // avisa de lo suyo, y de las conversaciones entre dos no —esas las
        // lee y las tiene avisadas en la app de trabajadores—.
        window.AndroidBridge?.activarAvisoChat?.(
            this.usuarioActual.email, !ES_APP_DEV, this.NOTAS_URL);
        // Al desarrollador también le avisan de lo que le escriben de tú a tú
        window.AndroidBridge?.saveToPrefs?.('chatSinCompaneros', '');
        // Con qué nombre firma el visto que se dé desde el propio aviso
        window.AndroidBridge?.saveToPrefs?.('chatNombre', this.usuarioActual?.name || '');
    },

    // ── Avisos al instante ───────────────────────────────────────────────────
    // El móvil apunta en el servidor su token de Firebase, y así en cuanto
    // alguien escribe le llega el aviso aunque la app esté cerrada, en vez de
    // esperar a que le toque mirar. Se vuelve a apuntar cada semana, por si
    // el servidor lo borró o el token cambió.
    _registrarPush(intento = 0) {
        if (!this._escuchaPush) {
            this._escuchaPush = true;
            // Con la app delante el aviso llega aquí, con lo que ha cambiado
            window.addEventListener('avisoPush', e => this._alAvisoPush(e.detail || 'chat'));
        }
        const email = this.usuarioActual?.email;
        const token = window.AndroidBridge?.pushToken?.();
        if (!email || token === undefined || token === null) return;   // web o app sin avisos
        if (!token) {
            if (intento < 6) setTimeout(() => this._registrarPush(intento + 1), 5000);
            return;
        }
        const control = ES_APP_DEV || !!this._caPermitido;
        const clave = `${email}|${this._appPush()}|${control ? 'c' : ''}|${token}`;
        let hecho = null;
        try { hecho = JSON.parse(localStorage.getItem('pushApuntado') || 'null'); } catch (_) {}
        if (hecho?.clave === clave && Date.now() - (hecho.en || 0) < 7 * 24 * 3600 * 1000) { this._conPush = true; return; }
        fetch(this.NOTAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ pushToken: token, app: this._appPush(), control }) })
            .then(r => {
                if (!r.ok) return;
                localStorage.setItem('pushApuntado', JSON.stringify({ clave, en: Date.now() }));
                this._conPush = true;
            })
            .catch(() => {});
    },

    // Viene del enlace del correo de «ya estás autorizado»: se le vuelve a
    // preguntar si sigue en el navegador o se baja la aplicación, y se limpia
    // la dirección, que Firebase le añade sus códigos.
    _alVolverAutorizado() {
        if (!new URLSearchParams(window.location.search).has('autorizado')) return;
        try {
            localStorage.removeItem('modoUso');
            sessionStorage.setItem('recienAutorizado', '1');
        } catch (_) {}
        history.replaceState(null, '', window.location.pathname);
    },

    _avisarRecienAutorizado() {
        try {
            if (!sessionStorage.getItem('recienAutorizado')) return;
            sessionStorage.removeItem('recienAutorizado');
        } catch (_) { return; }
        setTimeout(() => this._mostrarToast('✅ Tu cuenta ya está autorizada. ¡Bienvenido!', 5000), 600);
    },

    // Quien entra sin estar autorizado pide el alta solo: al desarrollador le
    // llega el aviso y lo apunta como gestión o trabajador con un toque.
    async _pedirAccesoAlDepartamento(app) {
        const token = this.accessToken;
        if (!token) return false;
        try {
            const envio = this._fetchOriginal || window.fetch.bind(window);
            const r = await envio(`${this.API_BASE}allowlist?solicitud=1`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ nombre: this.usuarioActual?.name || '', app }) });
            return r.ok;
        } catch (_) { return false; }
    },

    // ── Cuentas nuevas por aprobar (solo Desarrollador) ──────────────────────
    // Quien crea una cuenta con un correo que no es de Google espera aquí: se
    // elige si es de gestión o trabajador, se le apunta en esa lista y el
    // servidor le manda el correo para confirmar la cuenta.
    async _cargarSolicitudes() {
        if (!ES_APP_DEV || !this.usuarioActual) return;
        try {
            const r = await fetch(this.API_BASE + 'allowlist?solicitudes=1', { cache: 'no-store' });
            if (!r.ok) return;
            this._solicitudes = await r.json();
            this._pintarSolicitudes();
        } catch (_) {}
    },

    _pintarSolicitudes() {
        document.getElementById('solicitudesCaja')?.remove();
        const lista = Array.isArray(this._solicitudes) ? this._solicitudes : [];
        if (!lista.length) return;
        const esc = t => String(t || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
        const caja = document.createElement('div');
        caja.id = 'solicitudesCaja';
        caja.className = 'sol-caja';
        caja.innerHTML = `<div class="sol-tit">🆕 ${lista.length === 1 ? 'Una cuenta nueva' : lista.length + ' cuentas nuevas'} por aprobar</div>`
            + lista.map(s => `<div class="sol-fila">
                <div class="sol-quien"><b>${esc(s.nombre) || esc(s.email)}</b><span>${esc(s.email)} · ${s.google ? 'Google' : 'correo'}${
                    s.desde ? ' · desde ' + (s.desde === 'gestion' ? 'Gestión' : 'Trabajadores') : ''}</span></div>
                <div class="sol-btns">
                    <button type="button" onclick="app.resolverSolicitud('${esc(s.email)}','trabajador')">Trabajador</button>
                    <button type="button" onclick="app.resolverSolicitud('${esc(s.email)}','gestion')">Gestión</button>
                    <button type="button" class="no" onclick="app.resolverSolicitud('${esc(s.email)}','')" title="Rechazar">✕</button>
                </div></div>`).join('');
        document.body.appendChild(caja);
    },

    async resolverSolicitud(email, como) {
        if (!como && !confirm(`¿Rechazar la cuenta de ${email}? No le llegará ningún correo.`)) return;
        try {
            const r = await fetch(this.API_BASE + 'allowlist?' + (como ? 'aprobar=1' : 'rechazar=1'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, como }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { this._mostrarToast('❌ ' + (d.error || r.status), 5000); return; }
            this._solicitudes = (this._solicitudes || []).filter(s => s.email !== email);
            this._pintarSolicitudes();
            const quien = como === 'gestion' ? 'gestión' : 'trabajador';
            this._mostrarToast(!como ? '🗑️ Solicitud rechazada'
                : d.correo === false ? `⚠️ Apuntado como ${quien}, pero no se pudo mandar el correo${d.aviso ? ' (' + d.aviso + ')' : ''}. Avísale tú.`
                : `✅ Apuntado como ${quien}: le hemos mandado el correo de que ya está autorizado`, d.correo === false ? 8000 : 4000);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
    },

    // Lo que ha cambiado, según el aviso: se trae solo eso
    _alAvisoPush(tipo) {
        if (!this.usuarioActual) return;
        if (tipo === 'chat') { this._huellaChat = null; this._sondearChat(); }
        else if (tipo === 'acceso') { this._caTraer?.(); this.caCargarVisitantes?.(); }
        else if (tipo === 'plantilla' && !document.querySelector('.modal.show')) this._cargarConductores(true);
        else if (tipo === 'solicitud') this._cargarSolicitudes();
        else if (tipo === 'registro') this._mostrarToast('✅ Se ha registrado una cuenta que ya estaba autorizada: le ha llegado el correo de confirmación', 5000);
    },

    _appPush() { return (ES_APP_DEV ? 'desarrollador' : 'gestion'); },

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
            const r = await fetch(this._urlNotas('resumen=1'), { cache: 'no-store' });
            if (!r.ok) return;
            const huella = JSON.stringify(await r.json());
            if (huella === this._huellaChat) return;    // nada nuevo, ni se baja
            this._huellaChat = huella;
            await this._cargarNotasGestor();
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
        this._cargarNotasGestor().then(() => this.abrirHilo(conv));
    },

    async _responderDesdeAviso(conv, texto) {
        if (!this.usuarioActual) { this._pendienteChat = { conv, texto }; return; }
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual.email || '' },
                body: JSON.stringify({ id: conv, texto,
                    ...(true ? { gestor: this._nombreGestor() }
                                   : { nombre: this.usuarioActual.name || '' }) }),
            });
            if (!r.ok) return;
            const data = await r.json();
            this._notas = (this._notas || []).map(x => x.id === data.id ? data : x);
            this._marcarLeida(conv);
            this._retirarAviso(conv);
            this._renderNotasGestor();
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
        // Leído es leído: además de apuntarlo aquí, se le dice al otro. Lo
        // que no se da por visto es lo que he escrito yo: esto se llama
        // también al recargar con la conversación abierta, y lo marcaba
        // "visto por" quien acababa de escribir.
        if (!this._esMiMensaje(ultimo, n) && !this._yaLoVi(n, ultimo)) {
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

    // Los mensajes llegan al momento por Firebase aunque el móvil ahorre
    // batería. Pero hay marcas que además cierran del todo las apps que no
    // están en su lista de inicio automático, y a esas no les llega nada
    // hasta que se abren. Se pide una sola vez cada cosa: lo de Android,
    // y lo de la marca si es una de esas.
    _marcaBateria() {
        let m = '';
        try { m = window.AndroidBridge?.marcaMovil?.() || ''; } catch (_) {}
        return MARCAS_BATERIA.find(x => x.re.test(m)) || null;
    },

    _pedirBateriaSiHaceFalta() {
        if (!window.AndroidBridge?.pedirBateriaSinRestriccion) return;
        let libre = true;
        try { libre = window.AndroidBridge.bateriaSinRestriccion?.() !== false; } catch (_) { return; }
        const marca = this._marcaBateria();
        const pideAndroid = !libre && !localStorage.getItem('bateriaPedida');
        const pideMarca = !!marca && !!window.AndroidBridge.abrirAjusteMarca && !localStorage.getItem('marcaAvisada');
        if (!pideAndroid && !pideMarca) return;
        // Con un respiro: recién abierta la app hay bastante en pantalla ya
        setTimeout(() => {
            if (pideAndroid && !localStorage.getItem('bateriaPedida')) {
                localStorage.setItem('bateriaPedida', '1');
                if (confirm('Para que los avisos te lleguen siempre con la aplicación cerrada '
                    + '—los mensajes, los cambios de jornada y el cuadrante— conviene que el '
                    + 'móvil no la frene para ahorrar batería.\n\n¿Lo permites ahora? Es un toque, '
                    + 'y no gasta: la aplicación no trabaja de fondo, solo se despierta cuando '
                    + 'hay algo que avisar.')) {
                    try { window.AndroidBridge.pedirBateriaSinRestriccion(); } catch (_) {}
                    return;       // lo de la marca, la próxima vez que se abra
                }
            }
            if (pideMarca && !localStorage.getItem('marcaAvisada')) {
                localStorage.setItem('marcaAvisada', '1');
                if (confirm(`Tu móvil es ${marca.nombre}. Estos móviles cierran las aplicaciones `
                    + 'que no tienen permiso de inicio automático, y entonces los avisos no llegan '
                    + `hasta que la abres.\n\n${marca.pasos}\n\n¿Abro ese ajuste ahora?`)) {
                    try { window.AndroidBridge.abrirAjusteMarca(); } catch (_) {}
                }
            }
        }, 3000);
    },

    _pintarCampana() {
        const el = document.getElementById('campanaN');
        if (!el) return;
        const n = this._totalSinLeer();
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hay', n > 0);
    },

    irANotas() {
        this.switchTab(2);
    },

    guardarSonidoChat(sonido) {
        this.notifSoundChat = sonido;
        localStorage.setItem('notifSoundChat', sonido);
        // Y al móvil, para que el aviso de la barra suene con este
        window.AndroidBridge?.saveToPrefs?.('notifSoundChat', sonido);
        this._guardarPreferencias();
        if (sonido !== 'ninguno') this._previewNotifSound(sonido);
    },

    // Suena una vez cuando aparece algo nuevo, no en cada repintado
    _avisarSiHayNuevos() {
        // Solo suena lo que llega con la app abierta y delante. Lo que ya
        // estaba al abrir lo avisó la barra, y volver a sonar al entrar era
        // sonar dos veces por lo mismo: se mira la hora del último mensaje
        // de los otros, no cuántos hay sin leer.
        let ultimo = '';
        (this._notas || []).forEach(n => {
            if (n.archivada || !this._sinLeer(n)) return;
            const m = this._ultimoMensaje(n);
            if (m && !this._esMiMensaje(m, n) && (m.en || '') > ultimo) ultimo = m.en || '';
        });
        // Lo que llega con la app de fondo, o lo que se carga al volver a
        // ella, ya sonó en la barra: se da por avisado sin sonar otra vez.
        const callado = document.hidden || Date.now() < (this._chatCalladoHasta || 0);
        if (!this._chatSonadoHasta) this._chatSonadoHasta = new Date().toISOString();
        if (ultimo > this._chatSonadoHasta) {
            this._chatSonadoHasta = ultimo;
            if (this.notifSoundChat !== 'ninguno' && !callado) {
                try { this._previewNotifSound(this.notifSoundChat); } catch (_) {}
            }
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



    // ── Quién está en cada conversación ─────────────────────────────────────
    // El servidor manda la lista de participantes de cada conversación
    // (personas y, si está, gestión). Con ella se dice siempre quién escribe
    // y con quién se habla, sea una conversación de dos o un grupo.
    _participantesDe(n) {
        if (Array.isArray(n?.participantes) && n.participantes.length) return n.participantes;
        if (n?.tipo === 'companero') {
            return [{ email: (n.deEmail || '').toLowerCase(), nombre: n.deNombre, num: n.deConductor },
                    { email: (n.email || '').toLowerCase(), nombre: n.nombre, num: n.conductor }];
        }
        return [{ email: (n?.email || '').toLowerCase(), nombre: n?.nombre, num: n?.conductor },
                { gestion: true, nombre: 'Gestión' }];
    },

    // Quién soy yo en esa conversación: una persona, o gestión
    _yoEnHilo(n) {
        const me = (this.usuarioActual?.email || '').toLowerCase();
        // En la app de gestión se es gestión en toda conversación en la que
        // está gestión, aunque se entre con la misma cuenta que la otra parte
        if (!ES_APP_DEV && this._participantesDe(n).some(p => p.gestion)) return { gestion: true };
        return this._participantesDe(n).find(p => !p.gestion && (p.email || '').toLowerCase() === me)
            || ((!ES_APP_DEV && !this._soyElDesarrollador()) ? { gestion: true } : null);
    },

    // "Nombre - número", como en el resto de la app
    _etiquetaParticipante(p) {
        if (!p) return '';
        if (p.gestion) return '🛠️ Gestión';
        if (p.num === '💻') return '💻 ' + (p.nombre || 'Desarrollador');
        return [p.nombre || p.email, p.num].filter(Boolean).join(' - ');
    },

    _otrosEnHilo(n) {
        const yo = this._yoEnHilo(n);
        return this._participantesDe(n).filter(p => !yo ? true
            : yo.gestion ? !p.gestion : (p.gestion || (p.email || '').toLowerCase() !== (yo.email || '').toLowerCase()));
    },

    // ── Grupos: nombre y emoji ──────────────────────────────────────────────
    // El selector de emojis, por categorías como en WhatsApp, con los que se
    // han usado hace poco delante. Los emojis se sacan de tramos de Unicode y
    // se quedan solo los que el móvil pinta como emoji.
    _emojisPorCategoria() {
        if (this._emojisCache) return this._emojisCache;
        const tramos = {
            '😀': [[0x1F600, 0x1F64F], [0x1F910, 0x1F92F], [0x1F970, 0x1F97A], [0x1F9D0, 0x1F9DF], [0x1FAE0, 0x1FAF8],
                   [0x1F440, 0x1F450], [0x1F466, 0x1F487], [0x1F4AA, 0x1F4AA], [0x1F90C, 0x1F90F], [0x1F9B0, 0x1F9B9]],
            '🐶': [[0x1F400, 0x1F43F], [0x1F980, 0x1F9AE], [0x1F330, 0x1F343], [0x1F490, 0x1F490], [0x1FAB0, 0x1FABF], [0x1F300, 0x1F32C]],
            '🍔': [[0x1F344, 0x1F37F], [0x1F950, 0x1F96F], [0x1F9C0, 0x1F9CB], [0x1FAD0, 0x1FADB], [0x2615, 0x2615]],
            '⚽': [[0x1F380, 0x1F393], [0x1F3A0, 0x1F3D3], [0x26BD, 0x26BE], [0x1F93A, 0x1F94F], [0x1FA80, 0x1FA8F], [0x26F3, 0x26F3]],
            '🚌': [[0x1F680, 0x1F6FF], [0x1F3D4, 0x1F3F0], [0x26F0, 0x26FD], [0x2708, 0x2708], [0x1F5FA, 0x1F5FF]],
            '💡': [[0x1F4A1, 0x1F4A1], [0x1F4B0, 0x1F4FF], [0x1F500, 0x1F533], [0x1F550, 0x1F567], [0x1F9E7, 0x1F9FF],
                   [0x1FA70, 0x1FA7F], [0x1FA90, 0x1FAAF], [0x231A, 0x231B], [0x23F0, 0x23F3]],
            '❤️': [[0x2764, 0x2764], [0x1F493, 0x1F49F], [0x1F4A2, 0x1F4A9], [0x1F4AF, 0x1F4AF], [0x2705, 0x2705], [0x274C, 0x274E],
                   [0x2753, 0x2757], [0x2795, 0x2797], [0x1F534, 0x1F53D], [0x1F7E0, 0x1F7EB], [0x2B50, 0x2B55],
                   [0x26A1, 0x26AB], [0x2648, 0x2653], [0x1F6AB, 0x1F6AB]],
        };
        const esEmoji = /^\p{Emoji_Presentation}$/u;
        const vistos = new Set();
        const out = {};
        for (const [cat, rs] of Object.entries(tramos)) {
            out[cat] = [];
            for (const [a, b] of rs) for (let c = a; c <= b; c++) {
                const e = String.fromCodePoint(c);
                if (esEmoji.test(e) && !vistos.has(e)) { vistos.add(e); out[cat].push(e); }
            }
        }
        // Banderas: las de aquí y las de fuera que más salen
        const bandera = cc => String.fromCodePoint(...[...cc].map(l => 0x1F1E6 + l.charCodeAt(0) - 65));
        out['🚩'] = ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', ...['ES', 'PT', 'FR', 'IT', 'DE', 'GB', 'IE', 'NL', 'BE', 'CH', 'AT', 'PL',
            'RO', 'BG', 'GR', 'SE', 'NO', 'DK', 'FI', 'UA', 'RU', 'MA', 'DZ', 'SN', 'NG', 'US', 'MX', 'CU', 'DO', 'CO', 'VE', 'EC',
            'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'CN', 'JP', 'KR', 'IN', 'PK', 'PH', 'EU', 'UN'].map(bandera)];
        return (this._emojisCache = out);
    },

    _emojisRecientes() {
        try { return JSON.parse(localStorage.getItem('emojisRecientes') || '[]').slice(0, 24); } catch (_) { return []; }
    },

    // Un botón 😊 en cada cuadro de escribir mensajes: abre el mismo selector
    // que los grupos y mete el emoji donde esté el cursor.
    _ponerBotonesEmoji() {
        ['hiloTexto', 'respTexto'].forEach(id => {
            const t = document.getElementById(id);
            if (!t || t.parentElement?.classList.contains('emo-campo')) return;
            const caja = document.createElement('div');
            caja.className = 'emo-campo';
            t.parentNode.insertBefore(caja, t);
            caja.appendChild(t);
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emo-meter';
            b.title = 'Poner un emoji';
            b.textContent = '😊';
            b.addEventListener('mousedown', e => e.preventDefault());
            b.addEventListener('click', async () => {
                const ini = t.selectionStart ?? t.value.length, fin = t.selectionEnd ?? t.value.length;
                const e = await this._elegirEmoji();
                if (!e) return;
                const nuevo = t.value.slice(0, ini) + e + t.value.slice(fin);
                if (t.maxLength > 0 && nuevo.length > t.maxLength) return;
                t.value = nuevo;
                t.focus();
                t.setSelectionRange(ini + e.length, ini + e.length);
                t.dispatchEvent(new Event('input', { bubbles: true }));
            });
            caja.appendChild(b);
        });
    },

    // Abre el selector y devuelve el emoji elegido (o null)
    _elegirEmoji() {
        return new Promise(resolver => {
            const cats = this._emojisPorCategoria();
            const recientes = this._emojisRecientes();
            const pestanas = [...(recientes.length ? ['🕘'] : []), ...Object.keys(cats)];
            let actual = pestanas[0];
            const v = document.createElement('div');
            v.className = 'emo-velo';
            const pintar = () => {
                const lista = actual === '🕘' ? recientes : cats[actual];
                v.innerHTML = `<div class="emo-caja" role="dialog" aria-label="Elegir emoji">
                    <div class="emo-tabs">${pestanas.map(p => `<button type="button" data-p="${p}" class="${p === actual ? 'on' : ''}">${p}</button>`).join('')}</div>
                    <div class="emo-grid">${lista.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
                    <button type="button" class="emo-cerrar">Cancelar</button></div>`;
            };
            const fin = e => {
                v.remove();
                if (e) {
                    const r = [e, ...this._emojisRecientes().filter(x => x !== e)].slice(0, 24);
                    try { localStorage.setItem('emojisRecientes', JSON.stringify(r)); } catch (_) {}
                }
                resolver(e || null);
            };
            v.addEventListener('click', ev => {
                const b = ev.target.closest('button');
                if (ev.target === v) return fin(null);
                if (!b) return;
                if (b.dataset.p) { actual = b.dataset.p; pintar(); v.querySelector('.emo-grid').scrollTop = 0; }
                else if (b.dataset.e) fin(b.dataset.e);
                else if (b.classList.contains('emo-cerrar')) fin(null);
            });
            pintar();
            document.body.appendChild(v);
        });
    },

    // El nombre y el emoji del grupo: al crearlo y al cambiarlo
    _pedirDatosGrupo(previo = {}) {
        return new Promise(resolver => {
            let emoji = previo.emoji || '👥';
            const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
            const v = document.createElement('div');
            v.className = 'emo-velo';
            v.innerHTML = `<div class="emo-caja grupo-caja" role="dialog" aria-label="Datos del grupo">
                <h3>${previo.titulo !== undefined ? '✏️ Cambiar el grupo' : '👥 Nuevo grupo'}</h3>
                <div class="grupo-fila"><button type="button" class="grupo-emo" id="grEmo" title="Elegir emoji">${emoji}</button>
                    <input type="text" id="grNombre" maxlength="60" placeholder="Nombre del grupo" value="${esc(previo.titulo || '')}"></div>
                <p class="grupo-sub">Toca el emoji para cambiarlo. El nombre lo ven todos los del grupo.</p>
                <div class="grupo-btns"><button type="button" class="emo-cerrar" id="grNo">Cancelar</button>
                    <button type="button" class="grupo-ok" id="grSi">${previo.titulo !== undefined ? 'Guardar' : 'Crear grupo'}</button></div></div>`;
            document.body.appendChild(v);
            const fin = r => { v.remove(); resolver(r); };
            v.querySelector('#grEmo').onclick = async () => {
                const e = await this._elegirEmoji();
                if (e) { emoji = e; v.querySelector('#grEmo').textContent = e; }
            };
            v.querySelector('#grNo').onclick = () => fin(null);
            v.querySelector('#grSi').onclick = () => fin({ emoji, titulo: v.querySelector('#grNombre').value.trim().slice(0, 60) });
            setTimeout(() => v.querySelector('#grNombre')?.focus(), 50);
        });
    },

    async _editarGrupo() {
        const n = (this._notas || []).find(x => x.id === this._hiloAbierto);
        if (!n || n.tipo !== 'grupo') return;
        const d = await this._pedirDatosGrupo({ titulo: n.titulo || '', emoji: n.emoji || '👥' });
        if (!d) return;
        await this._tocarConversacion(n.id, { titulo: d.titulo, emoji: d.emoji }, '✅ Grupo cambiado');
        const nuevo = (this._notas || []).find(x => x.id === n.id);
        if (nuevo) this._pintarTituloHilo(nuevo);
    },

    // La cara de alguien en el chat y en las listas: su foto; si no tiene, el
    // emoji que eligió con su color; y si tampoco, la inicial de su nombre.
    _caraDe(email, nombre, clase = 'cara') {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        const e = String(email || '').toLowerCase();
        if (e === this.DEV_EMAIL) return `<span class="${clase} cara-ico">💻</span>`;
        if (e === this.A_GESTION) return `<span class="${clase} cara-ico">🛠️</span>`;
        const u = (this._conductores || {})[e] || {};
        const foto = u.avatar || (this._avatares || {})[e];
        if (foto) return `<img class="${clase}" src="${esc(foto)}" alt="">`;
        if (u.avatarEmoji) return `<span class="${clase}" style="background:${esc(u.avatarBg || '#667eea')}">${esc(u.avatarEmoji)}</span>`;
        const ini = (String(nombre || u.nombre || e || '?').trim()[0] || '?').toUpperCase();
        return `<span class="${clase}">${esc(ini)}</span>`;
    },

    // La cara de una conversación: la del otro, o el emoji del grupo
    _caraHilo(n, clase = 'cara') {
        if (n?.tipo === 'grupo') return `<span class="${clase} cara-ico">${String(n.emoji || '👥').replace(/[<>&"]/g, '')}</span>`;
        const otro = (this._otrosEnHilo(n) || [])[0];
        if (!otro) return '';
        if (otro.gestion) return this._caraDe(this.A_GESTION, '', clase);
        return this._caraDe(otro.email, otro.nombre, clase);
    },

    // El título del hilo, con el lápiz para cambiar nombre y emoji si es un grupo
    _pintarTituloHilo(n) {
        const el = document.getElementById('hiloQuien');
        if (!el) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        el.innerHTML = this._caraHilo(n, 'cara-chica') + esc(this._tituloHilo(n))
            + (n?.tipo === 'grupo' ? ' <button type="button" class="hilo-ed" title="Cambiar nombre y emoji" onclick="app._editarGrupo()">✏️</button>' : '');
    },

    // ── Vistos en los grupos ─────────────────────────────────────────────────
    // Cada uno apunta hasta dónde ha leído; debajo de lo mío sale quién lo ha
    // visto, como en WhatsApp.
    _claveYo(n) {
        const yo = this._yoEnHilo(n);
        return !yo ? '' : yo.gestion ? 'gestion' : (yo.email || '').toLowerCase();
    },

    _yaLoVi(n, ultimo) {
        if (n?.tipo !== 'grupo') return this._estaVista(n);
        const mio = n.leidos?.[this._claveYo(n)]?.en || '';
        return !!mio && mio >= (ultimo?.en || '');
    },

    _vistoEnGrupo(n, m) {
        const yo = this._claveYo(n);
        const otros = this._participantesDe(n).filter(p => (p.gestion ? 'gestion' : (p.email || '').toLowerCase()) !== yo);
        const han = otros.filter(p => (n.leidos?.[p.gestion ? 'gestion' : (p.email || '').toLowerCase()]?.en || '') >= (m.en || ''));
        if (!han.length) return '';
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
        return `<div class="bub-visto">✓✓ ${han.length === otros.length ? 'Visto por todos'
            : 'Visto por ' + esc(han.map(p => p.gestion ? 'Gestión' : (p.nombre || p.email)).join(', '))}</div>`;
    },

    _tituloHilo(n) {
        const otros = this._otrosEnHilo(n).map(p => this._etiquetaParticipante(p));
        if (n?.tipo === 'grupo') return (n.emoji || '👥') + ' ' + (n.titulo || otros.join(', '));
        return otros[0] || '—';
    },

    // Alinear a la derecha lo que he escrito yo
    _esMiMensaje(m, n) {
        const yo = this._yoEnHilo(n);
        if (!yo) return false;
        if (yo.gestion) return m.de === 'gestor';
        const me = (yo.email || '').toLowerCase();
        return (m.de || '').toLowerCase() === me
            || (m.de === 'trabajador' && n.tipo !== 'companero' && n.tipo !== 'grupo'
                && (n.email || '').toLowerCase() === me);
    },

    // Quién escribió un mensaje, con su nombre y su número
    _autorMensaje(m, n) {
        if (m.de === 'gestor') return '🛠️ Gestión' + (m.autor && m.autor !== 'Gestión' ? ' · ' + m.autor : '');
        const ps = this._participantesDe(n);
        const email = m.de === 'trabajador' ? (n.email || '').toLowerCase() : (m.de || '').toLowerCase();
        const p = ps.find(x => !x.gestion && (x.email || '').toLowerCase() === email);
        return p ? this._etiquetaParticipante(p) : (m.autor || m.de || '');
    },

    // Borrar un mensaje propio: se queda "Mensaje eliminado", como en WhatsApp
    async _borrarMensaje(i) {
        const n = (this._notas || []).find(x => x.id === this._hiloAbierto);
        const m = this._mensajesDe(n)[i];
        if (!n || !m) return;
        if (!confirm('¿Borrar este mensaje? En la conversación quedará «Mensaje eliminado».')) return;
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id: n.id, borrarMensaje: i, enMensaje: m.en, bandeja: !ES_APP_DEV, nombre: (this._soyElDesarrollador() ? this.DEV_NOMBRE : this._nombreGestor()), gestor: (this._soyElDesarrollador() ? this.DEV_NOMBRE : this._nombreGestor()) }),
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            this._notas = this._notas.map(x => x.id === data.id ? data : x);
            this._renderHilo();
            this._renderNotasGestor();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    abrirHilo(id) {
        const n = (this._notas || []).find(x => x.id === id);
        if (!n) return;
        this._hiloAbierto = id;
        this._marcarLeida(id);
        document.getElementById('hiloTexto').value = '';
        this._pintarTituloHilo(n);
        this._renderHilo();
        this._renderNotasGestor();
        document.getElementById('hiloModal').classList.add('show');
        if (this.darkMode) document.getElementById('hiloModalContent').classList.add('dark');
        // Igual que en WhatsApp: al abrir la conversación, si lo último no es
        // mío y aún no está visto, se marca solo, sin tocar nada.
        const ultimo = this._ultimoMensaje(n);
        if (ultimo && !this._esMiMensaje(ultimo, n) && !this._yaLoVi(n, ultimo)) {
            this._marcarVisto(id, true, true);
        }
    },

    _renderHilo() {
        const n = (this._notas || []).find(x => x.id === this._hiloAbierto);
        if (!n) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const cont = document.getElementById('hiloMensajes');
        cont.innerHTML = this._mensajesDe(n).map((m, i) => {
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
            const autor = mio ? '' : `<div class="bub-autor">${esc(this._autorMensaje(m, n))}</div>`;
            // Borrado: el globo se queda, sin el texto, con quién lo borró
            if (m.borrado) {
                return `<div class="bub ${mio ? 'mio' : 'suyo'} borrado">${autor}<span class="bub-txt">🚫 ${
                    mio ? 'Has eliminado este mensaje' : 'Mensaje eliminado' + (m.borrado.nombre ? ' por ' + esc(m.borrado.nombre) : '')}</span>`
                    + `<div class="bub-hora">${esc(this._horaCorta(m.borrado.en || m.en))}</div></div>`;
            }
            return `<div class="bub ${mio ? 'mio' : 'suyo'}">` + autor
                + (mio ? `<button class="bub-x" title="Borrar el mensaje" onclick="app._borrarMensaje(${i})">🗑</button>` : '')
                + `<span class="bub-txt">${esc(m.texto)}</span>${adj}`
                + `<div class="bub-hora">${esc(this._horaCorta(m.en))}</div>`
                + (mio && n.tipo === 'grupo' ? this._vistoEnGrupo(n, m) : '') + '</div>';
        }).join('') || '<div class="nt-vacio">Sin mensajes</div>';
        // Quién le dio el visto y cuándo, para los dos lados por igual
        const v = n.tipo === 'grupo' ? null : n.vistoPor;
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
        return this._tocarConversacion(id, { visto, nombre: this._nombreGestor() },
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
                // El servidor decide si firma como gestión o como persona; se
                // mandan los dos nombres
                body: JSON.stringify({ id: this._hiloAbierto, texto, gestor: this._nombreGestor(), bandeja: !ES_APP_DEV,
                    nombre: this._soyElDesarrollador() ? this.DEV_NOMBRE : this._nombreGestor() })
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
            this._renderNotasGestor();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    async _tocarConversacion(id, cuerpo, mensaje, borrar) {
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: borrar ? 'DELETE' : 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id, ...cuerpo, bandeja: !ES_APP_DEV })
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
            this._renderNotasGestor();
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

    _nombreGestor() {
        return this.usuarioActual?.name || this.usuarioActual?.email || 'Gestión';
    },

    // Este cuadro ya solo abre conversaciones nuevas; contestar se hace
    // dentro del hilo, como en cualquier chat.
    _guardarRespuesta() { return this._enviarNotaAGestor(); },

    // ── Ponerle la jornada a un trabajador ───────────────────────────────────
    // Se abre tocando el horario en el cuadro de lugares. Se elige a qué hora
    // entra y sale, en qué lugar y para cuántos días: ese día, esa semana o el
    // mes entero. Queda guardado aparte de las jornadas que registra él, así
    // que su próxima publicación no se lo lleva por delante.

    ponerJornada(email, fecha, lugar) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._jorEditando = email;
        this._jorFecha = /^\d{8}$/.test(String(fecha || '')) ? fecha : this._fechaOffset(0);
        const h = this._horasPlan(u, this._jorFecha);
        this._jorLugar = String(lugar || '').trim() || this._lugarDe(u, this._jorFecha,
            this._jornadaDe(u, this._jorFecha)).trim();
        // Los grupos de pega del cuadro no son lugares de verdad
        if (['Sin asignar', 'Sin servicio'].includes(this._jorLugar)) this._jorLugar = '';
        this._jorAlcance = 'dia';
        // Un día puede ir repartido entre varios lugares. Mientras solo haya
        // uno, el cuadro se ve como siempre; el segundo aparece al pedirlo.
        const yaRepartido = this._tramosPlan(u, this._jorFecha);
        this._jorExtras = yaRepartido ? yaRepartido.slice(1).map(t => ({ ...t })) : [];
        if (yaRepartido) {
            this._jorLugar = yaRepartido[0].p || '';
            document.getElementById('jorEntrada').value = yaRepartido[0].i || '';
            document.getElementById('jorSalida').value  = yaRepartido[0].o || '';
        } else {
            document.getElementById('jorEntrada').value = h?.i || '';
            document.getElementById('jorSalida').value  = h?.f || '';
        }
        document.getElementById('jorQuien').textContent = this._quienEs(u, email)
            + ` · ${this._jorFecha.slice(6,8)}/${this._jorFecha.slice(4,6)}/${this._jorFecha.slice(0,4)}`;
        this._renderJornadaModal();
        document.getElementById('jornadaModal').classList.add('show');
        if (this.darkMode) document.getElementById('jornadaModalContent').classList.add('dark');
    },

    // Todos los lugares conocidos, los definidos y los que ya se usan
    _lugaresTodos() {
        const usados = [...new Set(Object.values(this._conductores || {})
            .flatMap(x => [x.puesto || '', ...Object.values(x.lugares || {})])
            .map(v => v.trim()).filter(Boolean))];
        const todos = [...PUESTOS_DEFINIDOS];
        usados.forEach(p => {
            if (!todos.some(d => this._clavePuesto(d) === this._clavePuesto(p))) todos.push(p);
        });
        return todos;
    },

    // Los tramos del lugar elegido, para no tener que escribir las horas
    _renderJornadaModal() {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const q = t => String(t || '').replace(/'/g, "\\'");

        const franjas = TURNOS_POR_PUESTO[this._clavePuesto(this._jorLugar)] || [];
        const NOMBRE = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
        const turnos = document.getElementById('jorTurnos');
        turnos.innerHTML = (this._jorExtras || []).length ? '' : franjas.length
            ? franjas.map(f => {
                const on = document.getElementById('jorEntrada').value === f.desde
                        && document.getElementById('jorSalida').value === f.hasta;
                return `<button class="jor-turno ${f.id}${on ? ' on' : ''}"
                    onclick="app._turnoAlHorario('${f.id}','${f.desde}','${f.hasta}')">
                    ${on ? '✓ ' : ''}<b>${f.id}</b> ${esc(NOMBRE[f.id] || f.id)}<br>
                    <span>${esc(f.desde)}–${esc(f.hasta)}</span></button>`;
              }).join('')
            : `<div class="jor-sinturnos">${this._jorLugar
                ? 'Este lugar no tiene turnos definidos. Pon las horas a mano.'
                : 'Elige un lugar y te salen sus turnos.'}</div>`;

        document.getElementById('jorLugares').innerHTML = this._lugaresTodos().map(p => {
            const sel = this._clavePuesto(p) === this._clavePuesto(this._jorLugar);
            return `<button class="jor-lugar${sel ? ' on' : ''}"
                onclick="app._lugarDeLaJornada('${q(esc(p))}')">${sel ? '✓ ' : ''}${esc(p)}</button>`;
        }).join('')
        + `<button class="jor-lugar${this._jorLugar ? '' : ' on'}"
                onclick="app._lugarDeLaJornada('')">${this._jorLugar ? '' : '✓ '}Sin lugar</button>`;

        // Los demás lugares del día, si los hay
        const extras = document.getElementById('jorExtras');
        if (extras) {
            extras.innerHTML = (this._jorExtras || []).map((t, k) => `<div class="jor-extra">
                <div class="edit-field"><label>Desde</label>
                    <input type="time" value="${esc(t.i || '')}"
                           onchange="app._setJorExtra(${k},'i',this.value)"></div>
                <div class="edit-field"><label>Hasta</label>
                    <input type="time" value="${esc(t.o || '')}"
                           onchange="app._setJorExtra(${k},'o',this.value)"></div>
                <div class="edit-field"><label>Lugar</label>
                    <select onchange="app._setJorExtra(${k},'p',this.value)">
                        <option value="">Sin lugar</option>
                        ${this._lugaresTodos().map(p =>
                            `<option${this._clavePuesto(p) === this._clavePuesto(t.p) ? ' selected' : ''}>${esc(p)}</option>`).join('')}
                    </select></div>
                <button class="jor-quitar" onclick="app._quitarJorExtra(${k})" title="Quitar">✕</button>
            </div>`).join('')
            + `<button class="jor-mas" onclick="app._nuevoJorExtra()">➕ Añadir otro lugar del día</button>`;
        }

        document.getElementById('jorTramos').innerHTML = this._tramosJornada().map(t => {
            const on = this._jorAlcance === t.id;
            return `<button class="jor-tramo${on ? ' on' : ''}"
                onclick="app._alcanceDeLaJornada('${t.id}')">${on ? '✓ ' : ''}${esc(t.titulo)}<br>
                <span>${esc(t.detalle)}</span></button>`;
        }).join('');

        this._resumenJornada();
    },

    // Los mismos tramos que para el lugar, pero sin "siempre": un horario para
    // toda la vida es el del mes, y eso ya se pone desde el cuadrante.
    _tramosJornada() {
        const guardar = this._fechaEditando;
        this._fechaEditando = this._jorFecha;
        const tramos = this._tramos().filter(t => t.desde);
        this._fechaEditando = guardar;
        return tramos;
    },

    _nuevoJorExtra() {
        this._jorExtras = this._jorExtras || [];
        // Empieza donde acaba lo anterior: es lo que pasa casi siempre
        const ultimo = this._jorExtras.length
            ? this._jorExtras[this._jorExtras.length - 1].o
            : document.getElementById('jorSalida').value;
        this._jorExtras.push({ p: '', i: ultimo || '', o: '' });
        this._renderJornadaModal();
    },

    _setJorExtra(k, campo, valor) {
        if (!this._jorExtras?.[k]) return;
        this._jorExtras[k][campo] = valor;
        this._renderJornadaModal();
    },

    _quitarJorExtra(k) {
        this._jorExtras.splice(k, 1);
        this._renderJornadaModal();
    },

    // Todos los lugares del día, el primero y los que se hayan añadido
    _jorTodosLosTramos() {
        const i = document.getElementById('jorEntrada').value;
        const f = document.getElementById('jorSalida').value;
        return [{ p: this._jorLugar || '', i, o: f },
                ...(this._jorExtras || [])].filter(t => t.i && t.o);
    },

    _turnoAlHorario(id, desde, hasta) {
        document.getElementById('jorEntrada').value = desde;
        document.getElementById('jorSalida').value  = hasta;
        this._renderJornadaModal();
    },

    _lugarDeLaJornada(lugar) {
        this._jorLugar = lugar;
        this._renderJornadaModal();
    },

    _alcanceDeLaJornada(id) {
        this._jorAlcance = id;
        this._renderJornadaModal();
    },

    _resumenJornada() {
        const tramo = this._tramosJornada().find(t => t.id === this._jorAlcance);
        const el = document.getElementById('jorResumen');
        if (!el || !tramo) return;
        const sitios = this._jorTodosLosTramos();
        if (!sitios.length) {
            el.textContent = 'Pon la hora de entrada y la de salida.';
            return;
        }
        const dias = this._diasDelTramo(tramo);
        const cola = ` · ${dias} día${dias === 1 ? '' : 's'}, ${tramo.detalle}.`;
        if (sitios.length === 1) {
            const t = sitios[0];
            el.textContent = `${t.i}–${t.o} (${this._enHoras(this._duracion(t.i, t.o))})`
                + `${t.p ? ' en ' + t.p : ''}` + cola;
            return;
        }
        const total = sitios.reduce((n, t) => n + this._duracion(t.i, t.o), 0);
        el.textContent = sitios.map(t => `${t.i}–${t.o}${t.p ? ' ' + t.p : ''}`).join('  ·  ')
            + ` (${this._enHoras(total)})` + cola;
    },

    _diasDelTramo(tramo) {
        const aFecha = x => new Date(+x.slice(0,4), +x.slice(4,6) - 1, +x.slice(6,8), 12);
        return Math.round((aFecha(tramo.hasta) - aFecha(tramo.desde)) / 86400000) + 1;
    },

    async _guardarJornada() {
        const sitios = this._jorTodosLosTramos();
        const tramo = this._tramosJornada().find(t => t.id === this._jorAlcance);
        if (!tramo) return;
        // Se puede dejar el horario para luego y poner solo el lugar: a este
        // cuadro se entra desde la lista de trabajadores para asignar sitio, y
        // exigir las horas dejaba sin poder hacerlo. Sin lugar y sin horas, lo
        // que se hace es quitar el que hubiera.
        if (!sitios.length) {
            document.getElementById('jornadaModal').classList.remove('show');
            const d = this._diasDelTramo(tramo);
            await this._guardarCampoTrab(this._jorEditando,
                { puesto: this._jorLugar || '', desde: tramo.desde, hasta: tramo.hasta },
                (this._jorLugar ? `✅ ${this._jorLugar}` : 'Lugar quitado')
                    + ` · ${d} día${d === 1 ? '' : 's'}`);
            this._renderPuestos();
            return;
        }
        document.getElementById('jornadaModal').classList.remove('show');
        const dias = this._diasDelTramo(tramo);
        // Arriba va lo que abarca el día entero —de la primera entrada a la
        // última salida— y el reparto por lugares viaja aparte.
        const primero = sitios[0], ultimo = sitios[sitios.length - 1];
        const cuantos = sitios.length > 1
            ? `${sitios.length} lugares` : (primero.p ? `en ${primero.p}` : '');
        await this._guardarCampoTrab(this._jorEditando,
            { horario: { i: primero.i, f: ultimo.o }, tramos: sitios,
              desde: tramo.desde, hasta: tramo.hasta, puesto: primero.p },
            `✅ ${primero.i}–${ultimo.o} ${cuantos} · ${dias} día${dias === 1 ? '' : 's'}`);
        this._renderPuestos();
    },

    // Quitar lo asignado en ese tramo y dejarlo como estaba
    // Quitar la jornada es dejarlo sin asignar: ni horas ni lugar. Antes solo
    // le quitaba las horas y se quedaba con el sitio puesto, que en el cuadro
    // se lee como que sigue teniendo servicio allí.
    async _quitarJornada() {
        const tramo = this._tramosJornada().find(t => t.id === this._jorAlcance);
        if (!tramo) return;
        document.getElementById('jornadaModal').classList.remove('show');
        await this._guardarCampoTrab(this._jorEditando,
            { horario: '', puesto: '', tramos: [], desde: tramo.desde, hasta: tramo.hasta },
            'Sin asignar esos días');
        this._renderPuestos();
    },

    // ── Trabajadores del cuadrante ───────────────────────────────────────────
    // La misma gente que la pestaña de trabajadores, pero en una fila por
    // persona con lo que hace falta para montar el cuadrante: lugar, horario,
    // días de la semana, BE, VC y —los de jornada completa— grupo de descanso.

    GRUPOS_DESCANSO: 10,
    DIAS_LETRA: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
    DIAS_ORDEN: [1, 2, 3, 4, 5, 6, 0],

    _esCompleta(u) { return (Number(u?.horasAnuales) || 777) >= this.ANUALES_COMPLETA; },

    // Horario puesto desde el cuadrante: entrada y salida, mes a mes. Lo que
    // guardaron versiones anteriores (un horario suelto, o solo la letra del
    // turno) se sigue entendiendo y vale para cualquier mes.
    _mesDe(fecha) { return String(fecha || '').slice(0, 6); },

    _horasAsignadas(u, mes) {
        const delMes = u?.horarios?.[mes || ''];
        if (delMes && delMes.i && delMes.f) return delMes;
        const suelto = u?.horario;
        return (suelto && typeof suelto === 'object' && suelto.i && suelto.f) ? suelto : null;
    },

    // Los lugares en que le toca repartir el día, si se le han puesto varios
    _tramosPlan(u, fecha) {
        const t = u?.tramosDia?.[fecha];
        return Array.isArray(t) && t.length > 1 ? t : null;
    },

    // El horario que le toca ese día. Manda lo que se le haya puesto para esa
    // fecha —un día suelto, una semana— y por debajo queda el del mes.
    _horasPlan(u, fecha) {
        const delDia = u?.horariosDia?.[fecha];
        if (delDia && delDia.i && delDia.f) return { ...delDia, delDia: true };
        return this._horasAsignadas(u, this._mesDe(fecha));
    },

    // El horario que cuenta es el que registra el trabajador: el asignado solo
    // vale mientras no haya fichado ese día. Salvo que al revisar el día el
    // gestor haya dicho que el bueno era el suyo, y entonces manda ese.
    _horasDelDia(u, fecha, j) {
        // Lo primero, si al revisar el día se dijo cuál de los dos era el
        // bueno: eso manda sobre todo lo demás.
        if (u?.revisiones?.[fecha] === 'plan') {
            const h = this._horasPlan(u, fecha);
            if (h) return { ...h, real: false, elegido: true };
        }
        if (u?.revisiones?.[fecha] === 'real' && j?.i)
            return { i: j.i, f: j.o || '', real: true, elegido: true };
        // Un horario puesto para ese día concreto es una excepción que ha
        // puesto gestión a mano, así que manda sobre lo que fichara. Antes no:
        // cambiarle el horario a un día que ya tenía jornada registrada no se
        // notaba en ninguna parte, seguía saliendo el de siempre. El del mes
        // no cuenta para esto, que ese es el de fondo y ahí sí manda lo que
        // fichó de verdad.
        const delDia = u?.horariosDia?.[fecha];
        if (delDia?.i && delDia?.f) return { ...delDia, delDia: true, real: false };
        if (j?.i) return { i: j.i, f: j.o || '', real: true };
        const h = this._horasPlan(u, fecha);
        return h ? { ...h, real: false } : null;
    },

    // El turno (M/T/N) sale de la hora de entrada que mande ese día
    _horarioDe(u, fecha, j) {
        const lugar = this._lugarDe(u, fecha, j);
        const h = this._horasDelDia(u, fecha, j);
        if (h) return this._turnoDe(lugar, h.i) || '';
        if (typeof u?.horario === 'string' && u.horario) return u.horario;
        return '';
    },

    // Días del mes en que el trabajador fichó a una hora que no era la
    // asignada. Se deja un margen porque nadie entra al minuto exacto.
    MARGEN_HORARIO: 15,

    _minDif(a, b) {
        const min = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + m; };
        let d = Math.abs(min(a) - min(b));
        if (d > 720) d = 1440 - d;                   // 23:50 y 00:10 están a 20 min
        return d;
    },

    // Días en que lo asignado y lo que fichó no cuadran. Los ya decididos
    // —da igual a favor de quién— desaparecen; los marcados con el ojo siguen,
    // que es lo que significan. 'ok' es como se guardaba antes de poder elegir
    // horario, y vale como decidido.
    DECIDIDO: ['ok', 'plan', 'real'],

    _desajustes(u, mes) {
        const revis = u?.revisiones || {};
        return (u?.jornadas || []).filter(j => {
            if (!j?.i) return false;
            if (mes && this._mesDe(j.f) !== mes) return false;
            if (this.DECIDIDO.includes(revis[j.f])) return false;
            const h = this._horasPlan(u, j.f);
            if (!h) return false;
            return this._minDif(j.i, h.i) > this.MARGEN_HORARIO
                || (j.o && h.f && this._minDif(j.o, h.f) > this.MARGEN_HORARIO);
        }).map(j => ({
            f: j.f,
            plan: this._horasPlan(u, j.f),
            real: { i: j.i, o: j.o || '' },
            estado: revis[j.f] === 'ojo' ? 'ojo' : 'pendiente',
        })).sort((a, b) => b.f.localeCompare(a.f));
    },

    // Días distintos, que es lo que dice la etiqueta: dos jornadas del mismo
    // día que no cuadran son un día, no dos.
    _desviaciones(u, mes) {
        return new Set(this._desajustes(u, mes).map(d => d.f)).size;
    },

    // ── Revisar los horarios que no cuadran ──
    // De cada día se ven los dos horarios, el que puso gestión y el que fichó
    // el trabajador, y se elige cuál es el bueno tocándolo. Lo elegido es lo
    // que manda a partir de ahí en el cuadrante. Nada se guarda hasta
    // confirmar, así que se puede repasar el mes entero y decidir al final.

    revisarHorarios(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._revEditando = email;
        this._revTmp = { ...(u.revisiones || {}) };
        // La lista se congela al abrir: si se recalculara, el día elegido
        // desaparecería en el acto y ya no se vería lo que se acaba de elegir.
        this._revLista = this._desajustes(u);
        document.getElementById('revQuien').textContent = this._quienEs(u, email);
        this._renderRevisiones();
        document.getElementById('revModal').classList.add('show');
        if (this.darkMode) document.getElementById('revModalContent').classList.add('dark');
    },

    _renderRevisiones() {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const lista = this._revLista || [];
        const cont = document.getElementById('revLista');
        cont.innerHTML = lista.length ? lista.map(d => {
            const dia = `${d.f.slice(6,8)}/${d.f.slice(4,6)}`;
            const elegido = this._revTmp[d.f];
            const ojo = elegido === 'ojo';
            const marca = cual => elegido === cual ? ' elegida' : '';
            return `<div class="rev-fila${elegido && !ojo ? ' hecha' : ''}">
                <div class="rev-dia">${esc(dia)}</div>
                <div class="rev-cols">
                    <div class="rev-col plan${marca('plan')}" onclick="app._marcarRevision('${d.f}','plan')">
                        <span class="rev-lbl">${elegido === 'plan' ? '✓ ' : ''}Gestión</span>
                        <span class="rev-h plan">${esc(d.plan.i)}–${esc(d.plan.f)}</span></div>
                    <div class="rev-col real${marca('real')}" onclick="app._marcarRevision('${d.f}','real')">
                        <span class="rev-lbl">${elegido === 'real' ? '✓ ' : ''}Trabajador</span>
                        <span class="rev-h real">${esc(d.real.i)}${d.real.o ? '–' + esc(d.real.o) : ''}</span></div>
                </div>
                <div class="rev-btns">
                    <button class="rev-btn ojo${ojo ? ' on' : ''}" onclick="app._marcarRevision('${d.f}','ojo')"
                        title="Dejarlo marcado para mirarlo luego">👁</button>
                </div>
            </div>`;
        }).join('') : '<div class="baja-vacio">Todo cuadra: no queda ningún día por revisar.</div>';
        const elegidos = lista.filter(d => ['plan', 'real'].includes(this._revTmp[d.f])).length;
        const quedan = lista.length - elegidos;
        document.getElementById('revResumen').textContent = !lista.length
            ? 'Al confirmar desaparecerá la exclamación.'
            : elegidos
            ? `${elegidos} de ${lista.length} elegido${elegidos === 1 ? '' : 's'}.`
              + (quedan ? ` Queda${quedan === 1 ? '' : 'n'} ${quedan}.` : ' Dale a Confirmar.')
            : `${lista.length} jornada${lista.length === 1 ? '' : 's'} sin cuadrar.`
              + ' Toca el horario que sea el bueno; 👁 lo deja para luego.';
        const btn = document.getElementById('revConfirmar');
        if (btn) btn.textContent = elegidos ? `Confirmar ${elegidos}` : 'Confirmar';
    },

    _marcarRevision(fecha, cual) {
        // Volver a tocar lo mismo lo deshace: el día vuelve a estar sin decidir
        if (this._revTmp[fecha] === cual) delete this._revTmp[fecha];
        else this._revTmp[fecha] = cual;
        this._renderRevisiones();
    },

    async _guardarRevisiones() {
        document.getElementById('revModal').classList.remove('show');
        const dice = v => Object.values(this._revTmp).filter(x => x === v).length;
        const conGestion = dice('plan'), conTrabajador = dice('real');
        const partes = [];
        if (conGestion)    partes.push(`${conGestion} con el horario de gestión`);
        if (conTrabajador) partes.push(`${conTrabajador} con el del trabajador`);
        await this._guardarCampoTrab(this._revEditando, { revisiones: this._revTmp },
            partes.length ? '✔ ' + partes.join(' y ') : 'Revisión guardada');
    },

    _duracion(i, f) {
        const min = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + m; };
        let mins = min(f) - min(i);
        if (mins <= 0) mins += 1440;            // turno que cruza la medianoche
        return mins;
    },

    _enHoras(mins) {
        const h = Math.floor(mins / 60), m = mins % 60;
        return m ? `${h}h ${m}min` : `${h}h`;
    },

    _etiquetaDias(u) {
        const d = Array.isArray(u?.dias) && u.dias.length ? u.dias : null;
        if (!d) return '';
        return this.DIAS_ORDEN.filter(x => d.includes(x)).map(x => this.DIAS_LETRA[x]).join(' ');
    },

    ORDENES_CUAD: [['nombre', 'Trabajador'], ['numero', 'Nº'],
                   ['grupo', 'Grupo'], ['horario', 'Horario']],

    ordenarCuadrante(modo) {
        localStorage.setItem('ordenCuadrante', modo);
        this._renderCuadranteTrab();
    },

    _mesesAlReves() { return localStorage.getItem('mesesCuadDesc') === '1'; },

    _voltearMeses() {
        localStorage.setItem('mesesCuadDesc', this._mesesAlReves() ? '0' : '1');
        this._renderCuadranteTrab();
    },

    // El horario manda dentro de cada mes, así que se ordena mes a mes
    _ordenarCuad(lista, mes) {
        const orden = localStorage.getItem('ordenCuadrante') || 'nombre';
        const porNombre = (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es');
        if (orden === 'numero') {
            return lista.slice().sort((a, b) =>
                (a.conductor || '￿').localeCompare(b.conductor || '￿', 'es', { numeric: true }));
        }
        if (orden === 'grupo') {
            // Los que no son de jornada completa no tienen grupo: van al final
            return lista.slice().sort((a, b) =>
                ((a.grupo || 99) - (b.grupo || 99)) || porNombre(a, b));
        }
        if (orden === 'horario') {
            const hora = u => this._horasAsignadas(u, mes)?.i || '￿';
            return lista.slice().sort((a, b) => hora(a).localeCompare(hora(b)) || porNombre(a, b));
        }
        return lista.slice().sort(porNombre);
    },

    _renderOrdenCuad() {
        const cont = document.getElementById('ctOrden');
        if (cont) {
            const sel = localStorage.getItem('ordenCuadrante') || 'nombre';
            cont.innerHTML = this.ORDENES_CUAD.map(([id, txt]) =>
                `<button class="${sel === id ? 'activo' : ''}" onclick="app.ordenarCuadrante('${id}')">${
                    sel === id ? '✓ ' : ''}${txt}</button>`).join('');
        }
        const btn = document.getElementById('ctMesOrden');
        if (btn) btn.textContent = this._mesesAlReves() ? 'Mes ↑' : 'Mes ↓';
    },

    // El cuadrante se hace mes a mes, así que la lista va agrupada por meses.
    // Solo se pinta lo que hay abierto: doce meses por cada trabajador serían
    // demasiadas filas para dejarlas todas montadas.
    _mesesDelAnio() {
        const anio = new Date().getFullYear();
        const meses = Array.from({ length: 12 }, (_, m) =>
            `${anio}${String(m + 1).padStart(2, '0')}`);
        return this._mesesAlReves() ? meses.reverse() : meses;
    },

    // Día de referencia del mes: hoy si es el mes en curso, si no el día 1.
    // De él salen el lugar, la baja y las vacaciones que se ven en la fila.
    _diaDelMes(mes) {
        const hoy = this._fechaOffset(0);
        return this._mesDe(hoy) === mes ? hoy : mes + '01';
    },

    _plegarMesCuad(mes) {
        const clave = 'cm:' + mes;
        const p = JSON.parse(localStorage.getItem('regPlegado') || '{}');
        const porDefecto = this._mesDe(this._fechaOffset(0)) !== mes;
        p[clave] = !(clave in p ? p[clave] : porDefecto);
        localStorage.setItem('regPlegado', JSON.stringify(p));
        this._renderCuadranteTrab();
    },

    _renderCuadranteTrab() {
        const cont = document.getElementById('ctList');
        if (!cont) return;
        const lista = this._conductoresVisibles();
        this._renderOrdenCuad();
        const cnt = document.getElementById('ctCnt');
        if (cnt) cnt.textContent = lista.length ? `${lista.length}` : '';
        if (!lista.length) {
            cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-ico">👥</span>'
                + '<span class="tab-empty-t">Sin trabajadores</span>'
                + '<span class="tab-empty-s">Aparecerán en cuanto abran su app.</span></div>';
            return;
        }
        const mesActual = this._mesDe(this._fechaOffset(0));
        cont.innerHTML = this._mesesDelAnio().map(mes => {
            const cerrado = this._estaPlegado('cm:' + mes, mes !== mesActual);
            const conHorario = lista.filter(u => this._horasAsignadas(u, mes)).length;
            const fuera = lista.reduce((n, u) => n + (this._desviaciones(u, mes) ? 1 : 0), 0);
            return `<div class="ct-mes${cerrado ? ' cerrado' : ''}">
                <div class="ct-mes-head" onclick="app._plegarMesCuad('${mes}')">
                    <span class="ct-mes-chev">▾</span>
                    <span class="ct-mes-n">${MESES_ES[+mes.slice(4) - 1]} ${mes.slice(0, 4)}</span>
                    ${fuera ? `<span class="ct-mes-c aviso">${fuera} fuera de horario</span>` : ''}
                    <span class="ct-mes-c">${conHorario}/${lista.length}</span>
                </div>
                <div class="ct-mes-body">${cerrado ? '' : this._filasCuadrante(lista, mes)}</div>
            </div>`;
        }).join('');
    },

    _filasCuadrante(todos, mes) {
        const lista = this._ordenarCuad(todos, mes);
        const fecha = this._diaDelMes(mes);
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const q = e => esc(e).replace(/'/g, "\\'");
        return lista.map(u => {
            const { j, deAyer } = this._jornadaVisible(u, fecha);
            // Ese día puede haber trabajado en varios sitios, y eran varias
            // jornadas: enseñarlas todas, que antes salía solo la última.
            const delDia = deAyer ? [] : this._jornadasDe(u, fecha).filter(x => x.i);
            const sitios = [...new Set(delDia.map(x => String(x.pu || '').trim()).filter(Boolean))];
            const lugar   = sitios.length > 1 ? sitios.join(' · ') : this._lugarDe(u, fecha, j);
            const horas   = this._horasAsignadas(u, mes);
            // La pastilla enseña lo asignado; su turno sale de esa hora, no de
            // la que fichara ese día, que va aparte.
            const horario = sitios.length > 1 ? ''
                : (horas ? (this._turnoDe(lugar, horas.i) || '')
                         : (typeof u.horario === 'string' ? u.horario : ''));
            // Lo que fichó el día de referencia, si no es lo asignado: manda
            // sobre el cuadrante. Con varias jornadas salen todas, aunque una
            // coincida con lo asignado: si no, el día se vería a medias.
            const suyos = delDia.length > 1
                ? delDia.map(x => ({ i: x.i, f: x.o || '', pu: String(x.pu || '').trim() }))
                : (() => {
                    const real = this._horasDelDia(u, fecha, j);
                    return (real?.real && (!horas || real.i !== horas.i || real.f !== horas.f))
                        ? [{ i: real.i, f: real.f, pu: '' }] : [];
                  })();
            const fuera   = this._desviaciones(u, mes);
            const dias    = this._etiquetaDias(u);
            const completa = this._esCompleta(u);
            const enBaja = this._enBaja(u, fecha) || (!this._bajasDe(u).length && !!u.baja);
            const enVac  = this._enVacaciones(u, fecha);
            const grupo = completa
                ? `<button class="ct-chip ${u.grupo ? 'grupo' : 'aviso'}"
                        onclick="app._editarGrupo('${q(u.email)}')">🔄 ${u.grupo ? 'Grupo ' + u.grupo : 'sin grupo'}</button>`
                : '';
            const estado = this._estadoTrabajador(u, fecha);
            const color = estado === 'be' ? 'baja' : estado === 'vacaciones' ? 'vacaciones'
                : estado === 'libre' ? 'libre' : lugar.trim() ? 'asignado' : 'sinlugar';
            return `<div class="ct-row ${color}">
                <div class="ct-top">
                    <span class="ct-num">${esc(u.conductor) || '—'}</span>
                    <span class="ct-nom">${esc(u.nombre) || esc(u.email)}</span>
                    <span class="ct-jor ${completa ? 'completa' : 'media'}">${completa ? 'COMPLETA' : 'MEDIA'} ${
                        String(Number(u.jornadaHoras) || 7).replace('.', ',')}h</span>
                    <button class="be-btn vc-btn${enVac ? ' on' : ''}" title="Vacaciones"
                            onclick="app.editarVacaciones('${q(u.email)}')">VC</button>
                    <button class="be-btn${enBaja ? ' on' : ''}" title="Fechas de baja"
                            onclick="app.editarBajas('${q(u.email)}')">BE</button>
                </div>
                <div class="ct-chips">
                    <button class="ct-chip${lugar ? '' : ' vacio'}"
                            onclick="app._editarPuesto('${q(u.email)}','${fecha}')">📍 ${esc(lugar) || 'sin lugar'}</button>
                    <button class="ct-chip${horas || horario ? '' : ' vacio'}"
                            onclick="app._editarHorario('${q(u.email)}','${mes}')">🕐 ${
                                horario ? `<span class="ct-t ${horario}">${horario}</span>` : ''}${
                                horas ? ` ${horas.i}–${horas.f}` : horario ? '' : 'sin horario'}</button>
                    ${suyos.map(x => `<span class="ct-chip real" title="Lo que fichó ese día; manda sobre el asignado">▶ ${
                            esc(x.i)}${x.f ? '–' + esc(x.f) : ''}${
                            suyos.length > 1 && x.pu ? ` ${esc(x.pu)}` : ''}</span>`).join('')}
                    ${fuera ? `<button class="ct-chip aviso" onclick="app._editarHorario('${q(u.email)}','${mes}')"
                            title="Días en que fichó a otra hora">⚠ ${fuera} día${fuera === 1 ? '' : 's'} distinto${fuera === 1 ? '' : 's'}</button>` : ''}
                    <button class="ct-chip${dias ? '' : ' vacio'}"
                            onclick="app._editarDiasTrab('${q(u.email)}')">📅 ${dias || 'todos los días'}</button>
                    ${grupo}
                </div>
            </div>`;
        }).join('');
    },

    _quienEs(u, email) {
        return `${u.conductor ? u.conductor + ' · ' : ''}${u.nombre || email}`;
    },

    // Todos los campos del cuadrante se guardan igual: un PATCH y a repintar.
    async _guardarCampoTrab(email, cuerpo, mensaje) {
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, ...cuerpo })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(mensaje, 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // ── Días de la semana ──
    _editarDiasTrab(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._diasTrabEditando = email;
        this._diasTrabTmp = Array.isArray(u.dias) ? u.dias.slice() : [];
        document.getElementById('diasQuien').textContent = this._quienEs(u, email);
        this._renderDiasTrab();
        document.getElementById('diasModal').classList.add('show');
        if (this.darkMode) document.getElementById('diasModalContent').classList.add('dark');
    },

    _renderDiasTrab() {
        document.getElementById('diasSem').innerHTML = this.DIAS_ORDEN
            .map(d => `<button class="${this._diasTrabTmp.includes(d) ? 'on' : ''}"
                onclick="app._toggleDiaTrab(${d})">${this.DIAS_LETRA[d]}</button>`).join('');
        const n = this._diasTrabTmp.length;
        document.getElementById('diasResumen').textContent = (!n || n === 7)
            ? 'Sin marcar días se entiende que puede trabajar cualquiera.'
            : `${n} día${n === 1 ? '' : 's'} a la semana; los demás cuentan como libres.`;
    },

    _toggleDiaTrab(d) {
        const i = this._diasTrabTmp.indexOf(d);
        if (i === -1) this._diasTrabTmp.push(d); else this._diasTrabTmp.splice(i, 1);
        this._renderDiasTrab();
    },

    async _guardarDiasTrab() {
        const dias = this._diasTrabTmp.slice().sort();
        document.getElementById('diasModal').classList.remove('show');
        await this._guardarCampoTrab(this._diasTrabEditando, { dias },
            dias.length && dias.length < 7
                ? `📅 ${dias.map(d => this.DIAS_LETRA[d]).join(' ')}`
                : 'Sin días fijos');
    },

    // ── Horario ──
    _editarHorario(email, mes) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._horarioEditando = email;
        this._mesHorario = /^\d{6}$/.test(String(mes || '')) ? mes : this._mesDe(this._fechaOffset(0));
        const h = this._horasAsignadas(u, this._mesHorario);
        document.getElementById('hrEntrada').value = h?.i || '';
        document.getElementById('hrSalida').value  = h?.f || '';
        document.getElementById('horarioQuien').textContent = this._quienEs(u, email)
            + ` · ${MESES_ES[+this._mesHorario.slice(4) - 1].toLowerCase()} ${this._mesHorario.slice(0, 4)}`;
        this._renderHorarioModal();
        this._resumenHorario();
        document.getElementById('horarioModal').classList.add('show');
        if (this.darkMode) document.getElementById('horarioModalContent').classList.add('dark');
    },

    // Los turnos de su lugar, para no tener que teclear las horas de siempre
    _renderHorarioModal() {
        const u = (this._conductores || {})[this._horarioEditando] || {};
        const fecha = this._diaDelMes(this._mesHorario);
        const lugar = this._lugarDe(u, fecha, this._jornadaDe(u, fecha));
        const franjas = TURNOS_POR_PUESTO[this._clavePuesto(lugar)] || [];
        const nombres = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const fuera = this._desviaciones(u, this._mesHorario);
        const atajos = franjas.filter(f => f.desde && f.hasta).map(f =>
            `<div class="pm-op" onclick="app._ponerTurnoHorario('${f.desde}','${f.hasta}')">
                <div style="flex:1;min-width:0;">${nombres[f.id] || f.id}<br>
                    <span class="pm-turnos">${esc(f.desde)}–${esc(f.hasta)} · ${
                        esc(this._enHoras(this._duracion(f.desde, f.hasta)))}</span></div>
            </div>`).join('');
        document.getElementById('horarioLista').innerHTML =
            (atajos
                ? `<div class="pm-paso">Turnos de ${esc(lugar)}</div>` + atajos
                : `<div class="pm-paso">${lugar
                    ? `${esc(lugar)} no tiene turnos definidos. Pon las horas a mano.`
                    : 'Sin lugar asignado. Pon las horas a mano.'}</div>`)
            + (u.horarios?.[this._mesHorario]
                ? `<div class="pm-op pm-quitar" onclick="app._quitarHorario()">✕ Quitar el horario de este mes</div>` : '')
            + `<div class="pm-paso pm-nota">Es el horario asignado para el mes. El día que el trabajador fiche a otra hora manda la suya.${
                fuera ? ` Este mes se ha salido ${fuera} día${fuera === 1 ? '' : 's'}.` : ''}</div>`;
    },

    _ponerTurnoHorario(i, f) {
        document.getElementById('hrEntrada').value = i;
        document.getElementById('hrSalida').value  = f;
        this._resumenHorario();
    },

    _resumenHorario() {
        const i = document.getElementById('hrEntrada').value;
        const f = document.getElementById('hrSalida').value;
        const el = document.getElementById('hrResumen');
        if (!i || !f) { el.textContent = 'Pon la hora de entrada y la de salida.'; return; }
        const u = (this._conductores || {})[this._horarioEditando] || {};
        const fecha = this._diaDelMes(this._mesHorario);
        const lugar = this._lugarDe(u, fecha, this._jornadaDe(u, fecha));
        const turno = this._turnoDe(lugar, i);
        const nombres = { M: 'mañana', T: 'tarde', N: 'noche' };
        el.textContent = `${this._enHoras(this._duracion(i, f))}`
            + (turno ? ` · turno de ${nombres[turno]}` : '');
    },

    async _guardarHorario() {
        const i = document.getElementById('hrEntrada').value;
        const f = document.getElementById('hrSalida').value;
        if (!i || !f) { this._mostrarToast('Pon la entrada y la salida', 3000); return; }
        if (i === f) { this._mostrarToast('La salida no puede ser igual que la entrada', 3000); return; }
        document.getElementById('horarioModal').classList.remove('show');
        await this._guardarCampoTrab(this._horarioEditando,
            { horario: { i, f }, mes: this._mesHorario },
            `🕐 ${i}–${f} · ${MESES_ES[+this._mesHorario.slice(4) - 1].toLowerCase()}`);
    },

    async _quitarHorario() {
        document.getElementById('horarioModal').classList.remove('show');
        await this._guardarCampoTrab(this._horarioEditando,
            { horario: '', mes: this._mesHorario }, 'Horario quitado');
    },

    // ── Grupo de descanso ──
    _editarGrupo(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._grupoEditando = email;
        document.getElementById('grupoQuien').textContent = this._quienEs(u, email);
        this._renderGrupoModal();
        document.getElementById('grupoModal').classList.add('show');
        if (this.darkMode) document.getElementById('grupoModalContent').classList.add('dark');
    },

    _renderGrupoModal() {
        const u = (this._conductores || {})[this._grupoEditando] || {};
        const actual = Number(u.grupo) || 0;
        // Cuántos hay ya en cada grupo, para repartirlos sin tener que contar
        const cuantos = {};
        Object.values(this._conductores || {}).forEach(x => {
            if (x.grupo) cuantos[x.grupo] = (cuantos[x.grupo] || 0) + 1;
        });
        document.getElementById('grupoLista').innerHTML =
            Array.from({ length: this.GRUPOS_DESCANSO }, (_, i) => i + 1).map(n => {
                const sel = n === actual;
                const gente = cuantos[n] || 0;
                return `<div class="pm-op${sel ? ' sel' : ''}" onclick="app._elegirGrupo(${n})">
                    <div style="flex:1;min-width:0;">Grupo ${n}<br><span class="pm-turnos">${
                        gente ? `${gente} trabajador${gente === 1 ? '' : 'es'}` : 'sin nadie todavía'}</span></div>
                    ${sel ? '<span class="pm-check">✓</span>' : ''}
                </div>`;
            }).join('')
            + (actual ? `<div class="pm-op pm-quitar" onclick="app._elegirGrupo(0)">✕ Quitar el grupo</div>` : '')
            + `<div class="pm-paso pm-nota">Cada grupo libra unos días seguidos al mes. De momento solo se elige el grupo; los días llegarán al subir el cuadro de descansos.</div>`;
    },

    async _elegirGrupo(n) {
        document.getElementById('grupoModal').classList.remove('show');
        await this._guardarCampoTrab(this._grupoEditando, { grupo: n || null },
            n ? `🔄 Grupo ${n}` : 'Sin grupo');
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

    // Downscale before upload: a phone photo is several MB and the store caps
    // the payload, so send something the drivers can still read but that fits.
    subirCuadrante() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
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
                    if (dataUrl.length > 430 * 1024) {
                        this._mostrarToast('❌ La imagen sigue siendo muy grande', 4000);
                        return;
                    }
                    this._mostrarToast('📤 Subiendo cuadrante...', 2500);
                    try {
                        const resp = await fetch(this.CUADRANTE_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json',
                                       'X-Admin-Email': this.usuarioActual?.email || '' },
                            body: JSON.stringify({ imagen: dataUrl, nombre: file.name })
                        });
                        const data = await resp.json();
                        if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
                        this._pintarCuadrante(data);
                        localStorage.setItem('cuadranteCache', JSON.stringify(data));
                        this._mostrarToast('✅ Cuadrante publicado', 3000);
                    } catch (err) {
                        this._mostrarToast('❌ Error al subir: ' + err.message, 4000);
                    }
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    async borrarCuadrante() {
        if (!confirm('¿Quitar el cuadrante publicado?\nDejará de verse en la app de trabajadores.')) return;
        try {
            const resp = await fetch(this.CUADRANTE_URL, {
                method: 'DELETE',
                headers: { 'X-Admin-Email': this.usuarioActual?.email || '' }
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._pintarCuadrante(data);
            localStorage.removeItem('cuadranteCache');
            this._mostrarToast('Cuadrante retirado', 2500);
        } catch (err) { this._mostrarToast('❌ Error: ' + err.message, 4000); }
    },


    // ── Versión publicada a los trabajadores ──────────────────────────────────

    // ── Las cuatro aplicaciones, desde un sitio ──────────────────────────────
    // Trabajador, gestión y las dos del puesto de control. Cada una lleva su
    // propia lista de cuentas —dar acceso a una no da acceso a otra— y su
    // propio número de versión publicada: publicar una no toca el reparto de
    // las demás. Antes era un apartado suelto por cada cosa y había que bajar
    // media pantalla; ahora son dos, y dentro se elige de cuál.
    APPS_TODAS: [
        { id: 'worker',   rotulo: '💪 Trabajador', acceso: 'movilidad',
          prefijo: 'build-',          clave: 'worker',
          quien: 'los trabajadores',
          deAcceso: 'Quién puede entrar en la app de los trabajadores.' },
        { id: 'gestion',  rotulo: '✏️ Gestión',    acceso: 'gestion',
          prefijo: 'gestion-build-',  clave: 'gestion',
          quien: 'los demás de gestión',
          deAcceso: 'Quién puede entrar en la app de gestión.' },
        // La app de la garita está desactivada: no tiene versiones que
        // repartir. Su lista de cuentas sigue, porque es la que deja usar la
        // pestaña de Control de acceso de la app de Trabajador.
        { id: 'control',  rotulo: '🛡️ Control (Trabajador)', acceso: 'control',
          prefijo: 'control-build-',  clave: 'control', sinVersiones: true,
          quien: 'los de control de acceso',
          deAcceso: 'Quién puede usar la pestaña de Control de acceso en la app de Trabajador (registrar entradas y salidas del puesto).' },
        // La app de Gestión de control de acceso también está desactivada: su
        // lista es la que deja ver las tres pestañas de Control de acceso en
        // la app de Gestión.
        { id: 'gcontrol', rotulo: '🗝️ Control (Gestión)', acceso: 'gestion-control',
          prefijo: 'gcontrol-build-', clave: 'gestionControl', sinVersiones: true,
          quien: 'los de gestión de control de acceso',
          deAcceso: 'Quién ve las tres pestañas de Control de acceso en la app de Gestión: registro, historial y visitantes.' },
    ],
    _appVer: 'worker',
    _appAcc: 'worker',
    _listasAcceso: {},

    _appPorId(id) { return this.APPS_TODAS.find(a => a.id === id) || this.APPS_TODAS[0]; },

    _pintarBotonesApp(contenedor, activo, fn, soloConVersiones = false) {
        const cont = document.getElementById(contenedor);
        if (!cont) return;
        cont.innerHTML = this.APPS_TODAS.filter(a => !soloConVersiones || !a.sinVersiones).map(a =>
            `<button class="grp-app${a.id === activo ? ' activo' : ''}"
                     onclick="app.${fn}('${a.id}')">${a.rotulo}</button>`).join('');
    },

    // ── Qué versión recibe cada una ─────────────────────────────────────────
    _verVersionesDe(id) {
        if (id) this._appVer = id;
        if (this._appPorId(this._appVer).sinVersiones) this._appVer = 'worker';
        this._pintarBotonesApp('grpVerApps', this._appVer, '_verVersionesDe', true);
        const cfg = this._appPorId(this._appVer);
        const sub = document.getElementById('grpVerSub');
        if (sub) sub.textContent = `Qué versión reciben ${cfg.quien}. Tú siempre ves la más `
            + 'reciente, así que si una sale mal la pruebas tú y a ellos no les llega.';
        this._cargarVersionesDe(this._appVer);
    },

    async _cargarVersionesDe(id) {
        const cfg  = this._appPorId(id);
        const cont = document.getElementById('grpVerLista');
        const act  = document.getElementById('grpVerActual');
        if (!cont) return;
        cont.innerHTML = '<div class="ops-field-sub" style="padding:8px 14px;">Cargando…</div>';
        try {
            const [res, rVer] = await Promise.all([
                this._releases(true),
                fetch(VERSION_URL, { cache: 'no-store' }),
            ]);
            // Mientras se cargaba puede haber cambiado de aplicación
            if (this._appVer !== id) return;
            if (!res.ok) {
                cont.innerHTML = `<div class="ops-field-sub" style="padding:10px 14px;color:#c0392b;">${
                    res.limite
                        ? 'GitHub ha limitado las consultas por hora. Prueba dentro de unos minutos.'
                        : 'No se pudieron cargar las versiones (error ' + res.status + ').'}</div>`;
                if (act) act.textContent = '';
                return;
            }
            const publicada = rVer.ok ? ((await rVer.json())?.[cfg.clave] ?? null) : null;
            const re = new RegExp('^' + cfg.prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            const builds = (Array.isArray(res.lista) ? res.lista : [])
                .map(r => ({ r, m: re.exec(r.tag_name || '') }))
                .filter(x => x.m)
                .map(x => ({ n: parseInt(x.m[1], 10), fecha: x.r.published_at }))
                .sort((a, b) => b.n - a.n);
            // La publicada puede ser anterior a las que quedan listadas: sin
            // esto no saldría marcada y no habría forma de ver cuál está.
            if (publicada !== null && !builds.some(b => b.n === publicada)) {
                builds.push({ n: publicada, fecha: null });
                builds.sort((a, b) => b.n - a.n);
            }
            if (act) {
                act.textContent = publicada === null
                    ? 'Ahora mismo reciben la más reciente'
                    : `Publicada: ${this._buildNumToVersion(publicada)}`;
            }
            if (!builds.length) {
                cont.innerHTML = '<div class="ops-field-sub" style="padding:8px 14px;">'
                    + 'Todavía no hay ninguna versión de esta aplicación.</div>';
                return;
            }
            cont.innerHTML = builds.map(b => {
                const activa = b.n === publicada;
                const f = b.fecha
                    ? new Date(b.fecha).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
                    : 'versión publicada';
                return `<div class="ver-item${activa ? ' activa' : ''}">
                    <span class="ver-n">${this._buildNumToVersion(b.n)}<br><span class="ver-fecha">${f}</span></span>
                    ${activa ? '<span class="ver-badge">Publicada</span>'
                             : `<button class="ver-btn" onclick="app._publicarVersionDe('${cfg.id}',${b.n})">Publicar</button>`}
                </div>`;
            }).join('');
        } catch (e) {
            cont.innerHTML = '<div style="color:#e74c3c;font-size:12px;padding:8px 14px;">Error al cargar versiones</div>';
        }
    },

    async _publicarVersionDe(id, build) {
        const cfg = this._appPorId(id);
        if (!confirm(`¿Publicar la ${this._buildNumToVersion(build)} para ${cfg.quien}?\n\n`
            + 'Solo recibirán esa versión hasta que publiques otra.')) return;
        try {
            const resp = await fetch(VERSION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ app: cfg.clave, build }),
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._mostrarToast('🚀 Publicada ' + this._buildNumToVersion(build), 3000);
            this._cargarVersionesDe(id);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
    },

    // ── Quién puede entrar en cada una ──────────────────────────────────────
    _verAccesoDe(id) {
        if (id) this._appAcc = id;
        this._pintarBotonesApp('grpAccApps', this._appAcc, '_verAccesoDe');
        const cfg = this._appPorId(this._appAcc);
        const sub = document.getElementById('grpAccSub');
        if (sub) sub.textContent = cfg.deAcceso
            + ' Si la lista está vacía, cualquier cuenta puede entrar.';
        this._cargarAcceso(this._appAcc);
    },

    async _cargarAcceso(id) {
        const cfg = this._appPorId(id);
        const el = document.getElementById('grpAccLista');
        if (!el) return;
        el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">Cargando…</div>';
        try {
            const resp = await fetch(`${this.API_BASE}allowlist?app=${cfg.acceso}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error(resp.status);
            this._listasAcceso[id] = await resp.json();
            if (this._appAcc !== id) return;   // ha cambiado de aplicación mientras cargaba
            this._renderAcceso(id);
        } catch (e) {
            if (this._appAcc === id) el.innerHTML = '<div style="color:#e74c3c;font-size:12px;">Error al cargar la lista</div>';
        }
    },

    _renderAcceso(id) {
        const el = document.getElementById('grpAccLista');
        if (!el) return;
        const correos = this._listasAcceso[id] || [];
        if (!correos.length) {
            el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">'
                + 'Lista vacía — cualquier cuenta puede entrar</div>';
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        // A los trabajadores se les enseña con qué versión andan, que es la
        // única lista de la que sabemos eso.
        const porEmail = this._conductores || {};
        el.innerHTML = correos.map(correo => {
            const u = id === 'worker' ? porEmail[String(correo).toLowerCase()] : null;
            const ver = u?.version
                ? this._buildNumToVersion(parseInt(String(u.version).replace('build-', ''), 10) || 0)
                : '';
            return `<div class="access-user-item">
                <span class="access-user-email">${esc(correo)}${ver ? `<br><span class="access-user-ver">${ver}</span>` : ''}</span>
                <button class="access-user-remove" title="Quitar"
                        onclick="app._quitarAcceso('${esc(correo).replace(/'/g, "\\'")}')">✕</button>
            </div>`;
        }).join('');
    },

    async _addAcceso() {
        const cfg = this._appPorId(this._appAcc);
        const input = document.getElementById('grpAccEmail');
        const correo = (input?.value || '').trim().toLowerCase();
        if (!correo || !correo.includes('@')) { this._mostrarToast('❌ Escribe un correo válido', 3000); return; }
        try {
            const resp = await fetch(`${this.API_BASE}allowlist?app=${cfg.acceso}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email: correo, app: cfg.acceso }),
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._listasAcceso[cfg.id] = data.emails;
            this._renderAcceso(cfg.id);
            if (input) input.value = '';
            this._mostrarToast('✅ Añadido a ' + cfg.rotulo, 2500);
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
    },

    async _quitarAcceso(correo) {
        const cfg = this._appPorId(this._appAcc);
        try {
            const resp = await fetch(`${this.API_BASE}allowlist?app=${cfg.acceso}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email: correo, app: cfg.acceso }),
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._listasAcceso[cfg.id] = data.emails;
            this._renderAcceso(cfg.id);
            // Sin acceso a la de conductores o a la de control, puede que haya
            // salido también de la plantilla: se dice, y se repinta la lista
            const pl = data.plantilla;
            if (pl?.quitado) {
                this._mostrarToast('🗑️ Quitado, y fuera de la plantilla de trabajadores. Su ficha queda guardada.', 4500);
                try { this._cargarConductores?.(); } catch (_) {}
            } else if (pl?.error) {
                this._mostrarToast('🗑️ Quitado el acceso, pero no se ha podido sacar de la plantilla: ' + pl.error, 5000);
            } else {
                this._mostrarToast('🗑️ Quitado', 2500);
            }
        } catch (e) { this._mostrarToast('❌ ' + e.message, 4000); }
    },


    // Lo mismo que la de trabajadores, pero para esta app. Se mantiene
    // aparte a propósito: publicar una no puede tocar el reparto de la otra.




    // ── Trabajadores (gestión) ────────────────────────────────────────────────

    USUARIOS_URL: 'https://emt-palma-movilidad.vercel.app/api/usuarios',

    // La lista la puede cambiar otra cuenta de gestión mientras esta la tiene
    // abierta, y antes solo se volvía a pedir al abrir la app o al cambiar de
    // pestaña: lo que tocara el otro no aparecía hasta entonces. Al refrescar
    // por su cuenta no se pone el "Cargando…", que sería un parpadeo cada
    // minuto sin venir a cuento.
    _iniciarSondeoTrabajadores() {
        if (this._sondeoTrab) return;
        let vuelta = 0;
        this._sondeoTrab = setInterval(() => {
            if (!this.usuarioActual || document.hidden) return;
            // Con los avisos al instante, cada 5 min de respaldo
            if (this._conPush && (++vuelta % 5)) return;
            // Con un cuadro abierto se está editando algo: no se repinta debajo
            if (document.querySelector('.modal.show')) return;
            this._cargarConductores(true);
        }, 60000);
    },

    async _cargarConductores(callado = false) {
        const cont = document.getElementById('condList');
        if (!cont) return;
        if (!callado) cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-s">Cargando…</span></div>';
        try {
            const resp = await fetch(this.USUARIOS_URL, { cache: 'no-store' });
            if (!resp.ok) throw new Error(resp.status);
            const data = await resp.json();
            this._conductores = data || {};
            // En la de Desarrollador, cuándo se conectó cada uno por última vez
            if (ES_APP_DEV) {
                try {
                    const rc = await fetch(this.USUARIOS_URL + '?conexiones=1', { cache: 'no-store' });
                    if (rc.ok) this._conexiones = await rc.json();
                } catch (_) {}
            }
            this._renderConductores();
            // Las fotos van detrás y sin bloquear: la lista ya se ve, y cuando
            // llegan se repinta. Si no llegan, queda la inicial de siempre.
            this._cargarAvatares();
        } catch (e) {
            // Refrescando por detrás no se borra lo que ya se ve por un fallo
            // de red: se queda lo último bueno y se prueba dentro de un minuto.
            if (callado) return;
            cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-ico">⚠️</span>'
                + '<span class="tab-empty-t">No se pudo cargar</span>'
                + '<span class="tab-empty-s">Revisa la conexión e inténtalo otra vez.</span></div>';
        }
    },


    // ── Puestos de trabajo: ¿queda cubierta la jornada? ──────────────────────

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

    // ── Registro diario de todos los trabajadores ────────────────────────────

    // ── Exportación del registro ─────────────────────────────────────────────

    _filasExport() {
        const filas = [];
        this._conductoresVisibles().forEach(u => {
            (u.jornadas || []).forEach(j => {
                const lugar = this._lugarDe(u, j.f, j);
                const t = this._turnoDe(lugar, j.i) || '';
                filas.push({
                    fecha: `${j.f.slice(6,8)}/${j.f.slice(4,6)}/${j.f.slice(0,4)}`,
                    orden: j.f,
                    email: u.email, clugar: this._clavePuesto(lugar),
                    num: u.conductor || '', nombre: u.nombre || u.email,
                    puesto: lugar, turno: { M:'Mañana', T:'Tarde', N:'Noche' }[t] || '',
                    ini: j.i || '', fin: j.o || '',
                    horas: j.h || 0, noct: j.n || 0,
                    // Horas, no un "Sí"/"": si no, la columna no se puede sumar en la
                    // hoja. Un día marcado a mano como extra cuenta sus horas enteras;
                    // el resto no se sabe aquí si pasó del tope anual —eso solo lo
                    // sabe la app del trabajador, con todo su historial a mano.
                    extra: j.x === 1 ? (j.h || 0) : 0, festivo: j.fe ? 'Sí' : '',
                    vac: j.v ? 'Sí' : '', pr: j.p ? 'Sí' : '',
                    be: u.baja ? 'Sí' : '',
                    prueba: u.ficticio ? 'Sí' : '',
                });
            });
        });
        // Por fecha y, dentro del mismo día, por hora de entrada. Las jornadas
        // sin horario (vacaciones, festivos no trabajados) van al final del día.
        const entrada = r => r.ini || '99:99';
        filas.sort((a, b) => a.orden.localeCompare(b.orden)
            || entrada(a).localeCompare(entrada(b))
            || a.num.localeCompare(b.num, 'es', { numeric: true }));
        const f = this._filtrosExport();
        return filas.filter(r =>
               (!f.desde || r.orden >= f.desde)
            && (!f.hasta || r.orden <= f.hasta)
            && (!f.trabajadores || f.trabajadores.includes(r.email))
            && (!f.lugares || f.lugares.includes(r.clugar)));
    },

    // Todas las jornadas, sin filtrar: es contra lo que se ofrecen las opciones
    _filasTodas() {
        const guardado = this._filtros;
        this._filtros = { desde:'', hasta:'', trabajadores:null, lugares:null };
        try { return this._filasExport(); } finally { this._filtros = guardado; }
    },

    // Lista vacía = sin jornadas; null = sin filtro (todas)
    _filtrosExport() {
        if (this._filtros) return this._filtros;
        let g = null;
        try { g = JSON.parse(localStorage.getItem('filtrosExport') || 'null'); } catch (_) {}
        this._filtros = {
            desde: typeof g?.desde === 'string' ? g.desde : '',
            hasta: typeof g?.hasta === 'string' ? g.hasta : '',
            trabajadores: Array.isArray(g?.trabajadores) ? g.trabajadores : null,
            lugares:      Array.isArray(g?.lugares)      ? g.lugares      : null,
        };
        return this._filtros;
    },

    _guardarFiltros(cambios) {
        this._filtros = { ...this._filtrosExport(), ...cambios };
        localStorage.setItem('filtrosExport', JSON.stringify(this._filtros));
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
        { id:'horas',      etiqueta:'Horas',                 cabeceras:['Horas'],                  valores:f => [f.horas], sumable:true },
        { id:'nocturnas',  etiqueta:'Horas nocturnas',       cabeceras:['Nocturnas'],              valores:f => [f.noct],  sumable:true },
        { id:'extras',     etiqueta:'Horas extras',          cabeceras:['Extra'],                  valores:f => [f.extra], sumable:true },
        { id:'festivos',   etiqueta:'Festivos',              cabeceras:['Festivo'],                valores:f => [f.festivo] },
        { id:'vacaciones', etiqueta:'Vacaciones',            cabeceras:['Vacaciones'],             valores:f => [f.vac] },
        { id:'pr',         etiqueta:'PR',                    cabeceras:['PR'],                     valores:f => [f.pr] },
        { id:'be',         etiqueta:'BE',                    cabeceras:['BE'],                     valores:f => [f.be] },
        { id:'prueba',     etiqueta:'De prueba',             cabeceras:['De prueba'],              valores:f => [f.prueba] },
    ],

    _colsElegidas() {
        let guardadas = null;
        try { guardadas = JSON.parse(localStorage.getItem('colsExport') || 'null'); } catch (_) {}
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
    // están elegidas.
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
        const trabajadores = [...new Map(todas.map(r =>
            [r.email, { email: r.email, etiqueta: `${r.num ? r.num + ' · ' : ''}${r.nombre}` }])).values()]
            .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
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
        <div class="exp-sec${this._secExp === 'trab' ? ' abierta' : ''}">
            <div class="exp-sec-h" onclick="app._abrirSecExport('trab')">
                <span class="exp-sec-t">👥 Trabajadores</span>
                <span class="exp-sec-r">${resumen(f.trabajadores, trabajadores.length)}</span><span class="exp-sec-c">▾</span>
            </div>
            <div class="exp-sec-b">${casillas('trabajadores', trabajadores.map(t => [t.email, t.etiqueta]))}</div>
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
        localStorage.setItem('colsExport', JSON.stringify(ids));
        this._renderColsExport();
    },

    _marcarTodoExport(marcar) {
        localStorage.setItem('colsExport', JSON.stringify(
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

    _nombreExport(ext) { return `registro-emt-${new Date().toISOString().slice(0,10)}.${ext}`; },

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
            + `<sheets><sheet name="${esc(hoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
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
    _csvRegistro() {
        const esc = v => {
            const t = String(v ?? '');
            return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const lineas = [this.CABECERAS_EXPORT.join(';')];
        const filasDatos = this._filasExport();
        const filaCsv = vals => vals.map(v => esc(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';');
        filasDatos.forEach(f => lineas.push(filaCsv(this._valoresFila(f))));
        if (this._hayColSumable() && filasDatos.length) lineas.push(filaCsv(this._filaTotales()));
        return '﻿' + lineas.join('\r\n') + '\r\n';
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
                name: `Registro EMT ${new Date().toISOString().slice(0,10)}`,
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
            'text/csv;charset=utf-8;', 'Registro');
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
    // pide la API de Gmail.
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

    ordenarRegistro(modo) {
        localStorage.setItem('ordenRegistro', modo);
        document.querySelectorAll('.reg-barra .orden-btn').forEach(b =>
            b.classList.toggle('activo', b.dataset.ord === modo));
        this._renderRegistro();
        this._renderPrueba();
    },

    // Hay que invertir el estado EFECTIVO, no el guardado: si la clave aún no
    // existe, !undefined siempre da true y la primera pulsación no hacía nada.
    _plegar(clave, porDefecto) {
        const p = JSON.parse(localStorage.getItem('regPlegado') || '{}');
        const actual = clave in p ? p[clave] : porDefecto;
        p[clave] = !actual;
        localStorage.setItem('regPlegado', JSON.stringify(p));
        this._renderRegistro();
    },

    _estaPlegado(clave, porDefecto) {
        const p = JSON.parse(localStorage.getItem('regPlegado') || '{}');
        return clave in p ? p[clave] : porDefecto;
    },

    _renderRegistro() {
        const cont = document.getElementById('regList');
        if (!cont) return;
        const modo = localStorage.getItem('ordenRegistro') || 'dia';
        document.querySelectorAll('.reg-barra .orden-btn').forEach(b =>
            b.classList.toggle('activo', b.dataset.ord === modo));

        // Aplanar: una entrada por trabajador y día
        const filas = [];
        this._conductoresVisibles().forEach(u => {
            (u.jornadas || []).forEach(j => filas.push({
                f: j.f, horas: j.h || 0, ini: j.i || '', fin: j.o || '',
                extra: j.x === 1, festivo: !!j.fe, vac: !!j.v, pr: !!j.p, be: !!j.b,
                nombre: u.nombre || u.email, num: u.conductor || '',
                email: u.email,
                puesto: this._lugarDe(u, j.f, j) || 'Sin lugar',
            }));
        });
        if (!filas.length) {
            cont.innerHTML = '<div class="rg-vacio">Sin jornadas todavía.<br>'
                + 'Aparecerán cuando los trabajadores actualicen su app y registren.</div>';
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const mesDe = f => `${f.slice(0,4)}-${f.slice(4,6)}`;
        const nomMes = f => `${MESES_ES[parseInt(f.slice(4,6),10)-1]} ${f.slice(0,4)}`;
        const diaDe = f => `${f.slice(6,8)}/${f.slice(4,6)}`;

        // Agrupar siempre por mes; dentro, según el orden elegido
        const meses = {};
        filas.forEach(r => { (meses[mesDe(r.f)] = meses[mesDe(r.f)] || []).push(r); });

        // El puesto va en segunda línea: en una sola no cabe con el horario
        const lapiz = r => `<button class="rg-ed" title="Cambiar el lugar de trabajo"
            onclick="event.stopPropagation();app._editarPuesto('${esc(r.email)}','${esc(r.f)}')">✎</button>`;
        const pintaFila = r => `<div class="rg-fila">
            <span class="rg-quien"><b>${esc(r.num) || '—'}</b> ${esc(r.nombre)}
                ${r.puesto ? `<br><span class="rg-pt">${esc(r.puesto)}</span>` : ''}</span>
            ${r.extra ? '<span class="rg-x">extra</span>' : ''}
            ${r.festivo ? '<span class="festivo-badge">🎉</span>' : ''}
            ${r.vac ? '<span class="vacaciones-badge">🏖️</span>' : ''}${r.be ? '<span class="be-badge2">🩺 BE</span>' : ''}
            <span class="rg-hor">${esc(r.ini && r.fin ? r.ini + '–' + r.fin : '—')}</span>
            <span class="rg-h2">${r.horas}h</span>
            ${lapiz(r)}
        </div>`;

        cont.innerHTML = Object.keys(meses).sort().reverse().map(mes => {
            const delMes = meses[mes];
            const totMes = Math.round(delMes.reduce((s, r) => s + r.horas, 0) * 10) / 10;
            const cerradoMes = this._estaPlegado('m:' + mes, false);

            // Subgrupos según el criterio elegido
            const subs = {};
            delMes.forEach(r => {
                const k = modo === 'puesto' ? r.puesto
                        : modo === 'numero' ? `${r.num || 'zzz'}|${r.nombre}`
                        : r.f;
                (subs[k] = subs[k] || []).push(r);
            });
            const clavesSub = Object.keys(subs).sort();
            if (modo === 'dia') clavesSub.reverse();          // días, del más reciente

            const cuerpo = clavesSub.map(k => {
                const grupo = subs[k];
                const tot = Math.round(grupo.reduce((s, r) => s + r.horas, 0) * 10) / 10;
                const titulo = modo === 'puesto' ? k
                             : modo === 'numero' ? `${grupo[0].num || '—'} ${grupo[0].nombre}`
                             : diaDe(k);
                const cs = this._estaPlegado(`s:${mes}:${k}`, true);
                const orden = modo === 'dia'
                    ? grupo.sort((a, b) => (a.ini || '').localeCompare(b.ini || ''))
                    : grupo.sort((a, b) => b.f.localeCompare(a.f));
                const filasHtml = orden.map(r => modo === 'dia' ? pintaFila(r)
                    : `<div class="rg-fila">
                        <span class="rg-quien">${diaDe(r.f)}${
                        modo === 'puesto' ? ` · <b>${esc(r.num)}</b> ${esc(r.nombre)}`
                      : modo === 'numero' ? ` · <span class="rg-pt">${esc(r.puesto)}</span>` : ''}</span>
                        ${r.extra ? '<span class="rg-x">extra</span>' : ''}
                        ${r.festivo ? '<span class="festivo-badge">🎉</span>' : ''}
                        ${r.vac ? '<span class="vacaciones-badge">🏖️</span>' : ''}${r.be ? '<span class="be-badge2">🩺 BE</span>' : ''}
                        <span class="rg-hor">${esc(r.ini && r.fin ? r.ini + '–' + r.fin : '—')}</span>
                        <span class="rg-h2">${r.horas}h</span>
                        ${lapiz(r)}
                    </div>`).join('');
                return `<div class="rg rg-sub2${cs ? ' cerrado' : ''}">
                    <div class="rg-h" onclick="app._plegar('s:${esc(mes)}:${esc(k).replace(/'/g, "\\'")}', true)">
                        <span class="rg-chev">▾</span>
                        <span class="rg-t">${esc(titulo)}</span>
                        <span class="rg-sub">${tot}h</span>
                        <span class="rg-n">${grupo.length}</span>
                    </div>
                    <div class="rg-body">${filasHtml}</div>
                </div>`;
            }).join('');

            return `<div class="rg${cerradoMes ? ' cerrado' : ''}">
                <div class="rg-h" onclick="app._plegar('m:${esc(mes)}', false)">
                    <span class="rg-chev">▾</span>
                    <span class="rg-t">${nomMes(delMes[0].f)}</span>
                    <span class="rg-sub">${totMes}h</span>
                    <span class="rg-n">${delMes.length}</span>
                </div>
                <div class="rg-body">${cuerpo}</div>
            </div>`;
        }).join('');
    },

    // ── Usuarios de prueba ───────────────────────────────────────────────────

    _renderPrueba() {
        const cont = document.getElementById('pruebaList');
        if (!cont) return;
        const orden = localStorage.getItem('ordenPrueba') || 'nombre';
        const fict = Object.values(this._conductores || {}).filter(u => u.ficticio)
            .sort((a, b) => orden === 'numero'
                ? (a.conductor || '\uffff').localeCompare(b.conductor || '\uffff', 'es', { numeric: true })
                : (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        document.getElementById('ordenPruebaNombre')?.classList.toggle('activo', orden === 'nombre');
        document.getElementById('ordenPruebaNumero')?.classList.toggle('activo', orden === 'numero');
        if (!fict.length) {
            cont.innerHTML = '<div class="ops-field-sub" style="padding:8px 14px;">Ninguno todavía</div>';
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        cont.innerHTML = fict.map(u => `<div class="pr-item${u.oculto ? ' pr-oculto' : ''}">
            <span class="pr-item-t"><b>${esc(u.conductor) || '—'}</b> ${esc(u.nombre)}
                ${u.puesto ? `<span class="cond-puesto">· ${esc(u.puesto)}</span>` : ''}
                ${u.oculto ? '<span class="cond-puesto">· oculto</span>' : ''}
                <br><span class="ops-field-sub">${(u.jornadas || []).length} jornadas · ${u.horasTotales || 0}h</span></span>
            <button class="pr-ed" title="${u.oculto ? 'Mostrar' : 'Ocultar'}"
                onclick="app._toggleOcultoFicticio('${esc(u.email)}')">${u.oculto ? '🙈' : '👁️'}</button>
            <button class="pr-ed"  onclick="app._nuevoFicticio('${esc(u.email)}')">✏️</button>
            <button class="pr-del" onclick="app._borrarFicticio('${esc(u.email)}')">×</button>
        </div>`).join('');
    },

    async _toggleOcultoFicticio(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        const { ocultoPor, ...resto } = u;
        const ficticio = { ...resto, oculto: !u.oculto, ...(!u.oculto ? { ocultoPor: 'desarrollador' } : {}) };
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, ficticio })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores(); this._renderPrueba();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // ── Permiso retribuido (PR) ──
    // Dos por año natural. Cuentan los que marca gestión aquí y los que el
    // trabajador registra como PR en su app; el mismo día no cuenta dos veces.
    PR_ANUALES: 2,

    _prsDe(u, año) {
        const dias = new Set((u?.prs || []).filter(f => String(f).startsWith(año)));
        (u?.jornadas || []).forEach(j => { if (j?.p && String(j.f || '').startsWith(año)) dias.add(String(j.f).slice(0, 8)); });
        return dias;
    },

    async marcarPR(email, fecha, boton) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        const año = fecha.slice(0, 4);
        const ya = this._prsDe(u, año);
        const quitar = ya.has(fecha);
        // El que registró él mismo como PR se quita desde su app, no desde aquí
        if (quitar && !(u.prs || []).includes(fecha)) {
            this._globo(boton, 'Este PR lo registró el trabajador en su app');
            return;
        }
        if (!quitar && ya.size >= this.PR_ANUALES) {
            this._globo(boton, `Ya ha usado los ${this.PR_ANUALES} PR de ${año}`);
            return;
        }
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, pr: !quitar, fecha })
            });
            const data = await resp.json();
            if (!resp.ok) { this._globo(boton, data.error || 'No se ha podido guardar'); return; }
            this._conductores = data;
            const n = this._prsDe(data[email], año).size;
            const dia = `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}`;
            this._renderConductores();
            // El botón se ha vuelto a pintar: el globo va sobre el nuevo
            const nuevo = [...document.querySelectorAll('.pr-btn')]
                .find(b => (b.getAttribute('onclick') || '').includes(`'${email}'`)) || boton;
            this._globo(nuevo, quitar ? `PR del ${dia} quitado · lleva ${n} de ${this.PR_ANUALES}`
                                      : `PR ${n} de ${this.PR_ANUALES} · ${dia}`);
        } catch (e) { this._globo(boton, 'Error: ' + e.message); }
    },

    // Un globo pequeño encima del botón, que se va solo
    _globo(el, texto) {
        document.querySelectorAll('.globo-pr').forEach(g => g.remove());
        const g = document.createElement('div');
        g.className = 'globo-pr';
        g.textContent = texto;
        document.body.appendChild(g);
        const r = el?.getBoundingClientRect?.();
        if (r) {
            const x = Math.min(window.innerWidth - g.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - g.offsetWidth / 2));
            g.style.left = x + 'px';
            g.style.top = Math.max(8, r.top - g.offsetHeight - 8) + 'px';
        }
        setTimeout(() => g.classList.add('fuera'), 2200);
        setTimeout(() => g.remove(), 2600);
    },

    // En la de Desarrollador: en línea (señal hace menos de 7 min) o cuándo fue
    _chipConexion(email) {
        const iso = (this._conexiones || {})[String(email || '').toLowerCase()];
        const t = Date.parse(iso || '');
        // Corto, para que quepa junto al nombre sin hacer la tarjeta más alta
        if (!t) return '<span class="cond-con" title="Nunca se ha conectado">○</span>';
        const min = Math.round((Date.now() - t) / 60000);
        const d = new Date(t);
        const completa = d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        if (min < 7) return '<span class="cond-con on" title="En línea ahora">● en línea</span>';
        const txt = min < 60 ? `${min} min`
            : d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            : `${Math.max(1, Math.round(min / 1440))} d`;
        return `<span class="cond-con" title="Última conexión: ${completa}">● ${txt}</span>`;
    },

    // Ocultar un trabajador real de la pestaña Trabajadores (sus datos se
    // quedan, solo deja de salir en el día a día); para verlo otra vez está
    // el filtro "Ocultos".
    async _toggleOcultoTrabajador(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        const oculto = !u.oculto;
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, oculto, desde: ES_APP_DEV ? 'desarrollador' : 'gestion' })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(oculto ? '🙈 Ocultado de Trabajadores' : '👁️ Vuelve a salir en Trabajadores', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // Los lugares definidos más los que ya estén en uso
    _lugaresPosibles() {
        const usados = [...new Set(Object.values(this._conductores || {})
            .flatMap(x => [(x.puesto || '').trim(), ...(x.jornadas || []).map(j => (j.pu || '').trim())])
            .filter(Boolean))];
        const todos = [...PUESTOS_DEFINIDOS];
        usados.forEach(p => { if (!todos.some(d => this._clavePuesto(d) === this._clavePuesto(p))) todos.push(p); });
        return todos;
    },

    _opcionesPuesto(actual) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        return '<option value="">Sin lugar</option>' + this._lugaresPosibles().map(p =>
            `<option${this._clavePuesto(p) === this._clavePuesto(actual) ? ' selected' : ''}>${esc(p)}</option>`).join('');
    },

    _nuevoFicticio(email) {
        const u = email ? (this._conductores || {})[email] : null;
        this._fictEditando = email || `prueba-${Date.now()}@prueba.local`;
        document.getElementById('fNum').value    = u?.conductor || '';
        document.getElementById('fNombre').value = u?.nombre || '';
        document.getElementById('fPuesto').innerHTML = this._opcionesPuesto(u?.puesto);
        this._fictJornadas = (u?.jornadas || []).map(j => ({ ...j }));
        this._fictTipo  = (u?.jornadaHoras || 7) >= 7 ? 'completa' : 'media';
        this._fictRitmo = u?.ritmo === 'lv' || u?.ritmo === '6y2' ? u.ritmo : '6y2';
        this._fictDias = Array.isArray(u?.dias) && u.dias.length
            ? u.dias.filter(d => this.DIAS_MEDIA.includes(d)) : [1, 2, 3, 4, 5];
        const hm = (u?.jornadaHoras && u.jornadaHoras < 7) ? u.jornadaHoras : 3.5;
        document.getElementById('fHoras').value = String(hm).replace('.', ',');
        this._renderTipoFict();
        const hoy = new Date();
        const mes1 = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        document.getElementById('fDesde').value = mes1.toISOString().slice(0, 10);
        document.getElementById('fHasta').value = hoy.toISOString().slice(0, 10);
        if (!this._fictJornadas.length) this._addJornadaFict(true);
        this._renderJornadasFict();
        this._aplicarPlegadoFict();
        document.getElementById('fictModal').classList.add('show');
        if (this.darkMode) document.getElementById('fictModalContent').classList.add('dark');
    },

    _renderTipoFict() {
        document.getElementById('fTipo').innerHTML = [['media','3,5 h media'],['completa','7 h completa']]
            .map(([id, txt]) => `<button class="${this._fictTipo === id ? 'on' : ''}"
                onclick="app._ponerTipoFict('${id}')">${txt}</button>`).join('');
        const ritmo = document.getElementById('fRitmo');
        const sub = document.getElementById('fRitmoSub');
        const fila = document.getElementById('fHorasFila');
        ritmo.style.display = 'flex';
        // Las horas al día solo las elige la media jornada; la completa son 7
        fila.hidden = this._fictTipo !== 'media';
        if (this._fictTipo === 'completa') {
            ritmo.innerHTML = [['6y2','6 días y 2 libres'],['lv','Lunes a viernes']]
                .map(([id, txt]) => `<button class="${this._fictRitmo === id ? 'on' : ''}"
                    onclick="app._ponerRitmoFict('${id}')">${txt}</button>`).join('');
            sub.textContent = this._fictRitmo === '6y2'
                ? 'Seis días seguidos y dos de descanso, rodando por la semana.'
                : 'De lunes a viernes, con el fin de semana libre.';
        } else {
            // La media jornada reparte sus días entre lunes y sábado
            const nombres = ['D','L','M','X','J','V','S'];
            ritmo.innerHTML = this.DIAS_MEDIA
                .map(d => `<button class="${this._fictDias.includes(d) ? 'on' : ''}"
                    onclick="app._toggleDiaFict(${d})">${nombres[d]}</button>`).join('');
            const n = this._fictDias.length;
            const h = this._horasFict();
            sub.textContent = n
                ? `${n} día${n === 1 ? '' : 's'} a la semana · ${(n * h).toFixed(1).replace('.', ',')}h semanales`
                : 'Marca al menos un día';
        }
    },

    // La media jornada se reparte de lunes a domingo
    DIAS_MEDIA: [1, 2, 3, 4, 5, 6, 0],

    _toggleDiaFict(d) {
        const i = this._fictDias.indexOf(d);
        if (i === -1) this._fictDias.push(d); else this._fictDias.splice(i, 1);
        this._fictDias.sort();
        this._renderTipoFict();
    },

    _horasFict() {
        const h = this._leerDecimal(document.getElementById('fHoras')?.value);
        return (h !== null && h > 0) ? h : 3.5;
    },

    _ponerTipoFict(t)  { this._fictTipo = t;  this._renderTipoFict(); },
    _ponerRitmoFict(r) { this._fictRitmo = r; this._renderTipoFict(); },

    // Rellena las jornadas del tramo siguiendo el patrón elegido. Lo que ya
    // hubiera fuera del tramo se respeta: solo se reescribe lo de dentro.
    _generarJornadasFict() {
        const d1 = document.getElementById('fDesde').value;
        const d2 = document.getElementById('fHasta').value;
        if (!d1 || !d2 || d2 < d1) { this._mostrarToast('Revisa las fechas', 3000); return; }
        const media = this._fictTipo === 'media';
        // Si se escriben las horas del patrón mandan ellas; si no, las de siempre
        const iniPuesto = document.getElementById('fPatIni')?.value || '';
        const finPuesto = document.getElementById('fPatFin')?.value || '';
        const ini = iniPuesto || (media ? '09:00' : '06:00');
        const horas = finPuesto
            ? this._horasEntre(ini, finPuesto)
            : (media ? this._horasFict() : 7);
        // La salida sigue a las horas elegidas, no a un horario fijo
        const fin = finPuesto || (media ? this._sumarHoras(ini, horas) : '13:00');
        const clave = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        const desde = new Date(d1 + 'T12:00:00'), hasta = new Date(d2 + 'T12:00:00');
        const puesto = document.getElementById('fPuesto').value;

        const dentro = new Set();
        const nuevas = [];
        let ciclo = 0;
        for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
            const k = clave(d);
            dentro.add(k);
            const finde = d.getDay() === 0 || d.getDay() === 6;
            let trabaja;
            if (media) trabaja = this._fictDias.includes(d.getDay());
            else if (this._fictRitmo === 'lv') trabaja = !finde;
            else { trabaja = (ciclo % 8) < 6; ciclo++; }   // seis y dos, rodando
            if (trabaja) nuevas.push({ f: k, i: ini, o: fin, h: horas, n: 0, pu: puesto });
        }
        const fuera = (this._fictJornadas || []).filter(j => j.f && !dentro.has(j.f));
        this._fictJornadas = [...fuera, ...nuevas].sort((a, b) => a.f.localeCompare(b.f));
        this._renderJornadasFict();
        this._mostrarToast(`🎲 ${nuevas.length} jornadas generadas`, 3000);
    },

    _sumarHoras(hhmm, horas) {
        const t = this._minutos(hhmm) + Math.round(horas * 60);
        const m = ((t % 1440) + 1440) % 1440;
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    },

    _addJornadaFict(silencioso) {
        const hoy = new Date();
        const f = `${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}`;
        // Nace con el lugar elegido arriba: casi siempre es el que toca
        const pu = document.getElementById('fPuesto')?.value || '';
        (this._fictJornadas = this._fictJornadas || []).push({ f, i: '06:00', o: '14:00', h: 8, n: 0, pu });
        if (!silencioso) this._renderJornadasFict();
    },

    _plegarJornadasFict() {
        const cab = document.querySelector('#fictModal .f-sep-pleg');
        const cont = document.getElementById('fPlegable');
        if (!cab || !cont) return;
        const cerrado = cab.classList.toggle('cerrado');
        cont.hidden = cerrado;
        localStorage.setItem('fictPlegado', cerrado ? '1' : '0');
    },

    _aplicarPlegadoFict() {
        const cerrado = localStorage.getItem('fictPlegado') === '1';
        document.querySelector('#fictModal .f-sep-pleg')?.classList.toggle('cerrado', cerrado);
        const cont = document.getElementById('fPlegable');
        if (cont) cont.hidden = cerrado;
    },

    _renderJornadasFict() {
        const cuenta = document.getElementById('fCuenta');
        if (cuenta) cuenta.textContent = (this._fictJornadas || []).length;
        const cont = document.getElementById('fJornadas');
        cont.innerHTML = (this._fictJornadas || []).map((j, k) => {
            const iso = `${j.f.slice(0,4)}-${j.f.slice(4,6)}-${j.f.slice(6,8)}`;
            return `<div class="fj">
                <div class="fj-row">
                    <div style="flex:1;"><label>Fecha</label><input type="date" value="${iso}" onchange="app._setJ(${k},'f',this.value)"></div>
                    <button class="fj-del" onclick="app._delJ(${k})">×</button>
                </div>
                <div class="fj-row" style="margin-top:5px;">
                    <div style="flex:1;"><label>Inicio</label><input type="time" value="${j.i || ''}" onchange="app._setJ(${k},'i',this.value)"></div>
                    <div style="flex:1;"><label>Fin</label><input type="time" value="${j.o || ''}" onchange="app._setJ(${k},'o',this.value)"></div>
                    <div style="flex:.6;"><label>Horas</label><input type="text" inputmode="decimal" value="${j.h ?? ''}" onchange="app._setJ(${k},'h',this.value)"></div>
                </div>
                <div class="fj-row" style="margin-top:5px;">
                    <div style="flex:1;"><label>Lugar de trabajo</label>
                        <select class="f-sel" onchange="app._setJ(${k},'pu',this.value)">${
                            this._opcionesPuesto(j.pu)}</select></div>
                </div>
                <div class="fj-flags">
                    <label><input type="checkbox" ${j.x === 1 ? 'checked' : ''} onchange="app._setJ(${k},'x',this.checked)"> Extra</label>
                    <label><input type="checkbox" ${j.fe ? 'checked' : ''} onchange="app._setJ(${k},'fe',this.checked)"> Festivo</label>
                    <label><input type="checkbox" ${j.v ? 'checked' : ''} onchange="app._setJ(${k},'v',this.checked)"> Vacaciones</label>
                    <label><input type="checkbox" ${j.p ? 'checked' : ''} onchange="app._setJ(${k},'p',this.checked)"> PR</label>
                    <label>Noct. <input type="text" inputmode="decimal" style="width:44px;" value="${j.n || 0}" onchange="app._setJ(${k},'n',this.value)"></label>
                </div>
            </div>`;
        }).join('');
    },

    _setJ(k, campo, valor) {
        const j = this._fictJornadas[k];
        if (!j) return;
        if (campo === 'f') j.f = String(valor).replace(/-/g, '');
        else if (campo === 'h' || campo === 'n') j[campo] = this._leerDecimal(valor) || 0;
        else if (campo === 'x') { if (valor) j.x = 1; else delete j.x; }
        else if (['fe','v','p'].includes(campo)) { if (valor) j[campo] = 1; else delete j[campo]; }
        else j[campo] = valor;
        // Horas automáticas al cambiar el horario, como en la app real
        if ((campo === 'i' || campo === 'o') && j.i && j.o) j.h = this._horasEntre(j.i, j.o);
        if (campo === 'i' || campo === 'o') this._renderJornadasFict();
    },

    _delJ(k) { this._fictJornadas.splice(k, 1); this._renderJornadasFict(); },

    async _guardarFicticio() {
        const num    = document.getElementById('fNum').value.replace(/\D/g, '');
        const nombre = document.getElementById('fNombre').value.trim();
        const puesto = document.getElementById('fPuesto').value;
        if (!nombre) { this._mostrarToast('❌ Pon un nombre', 3000); return; }
        // El número va con 4 o 5 cifras (987-9 o 1418-3): la última es la de control
        if (num && (num.length < 4 || num.length > 5)) { this._mostrarToast('❌ El nº son 4 o 5 dígitos', 3000); return; }
        const jornadas = (this._fictJornadas || []).filter(j => j.f);
        const ahora = new Date();
        const delMes = jornadas.filter(j =>
            j.f.slice(0, 6) === `${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}`);
        const suma = a => Math.round(a.reduce((s, j) => s + (parseFloat(j.h) || 0), 0) * 10) / 10;
        const ultima = jornadas.slice().sort((a, b) => b.f.localeCompare(a.f))[0];
        const hoyId = `${ahora.getFullYear()}${String(ahora.getMonth()+1).padStart(2,'0')}${String(ahora.getDate()).padStart(2,'0')}`;
        const ficticio = {
            nombre, conductor: num ? num.slice(0, -1) + '-' + num.slice(-1) : '', puesto,
            avatar: null, version: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '',
            horasMes: suma(delMes), horasTotales: suma(jornadas), diasMes: delMes.length,
            horaInicio: ultima?.i || '', horaFin: ultima?.o || '',
            horarioDe: ultima?.f === hoyId ? 'hoy' : 'anterior',
            turno: this._turnoDe(puesto, ultima?.i) || '',
            jornadaHoras: this._fictTipo === 'media' ? this._horasFict() : 7,
            horasAnuales: this._fictTipo === 'media' ? 777 : 1700,
            ritmo: this._fictTipo === 'media' ? 'lv' : this._fictRitmo,
            // El ritmo de seis y dos rueda por la semana, así que no tiene días fijos
            dias: this._fictTipo === 'media' ? this._fictDias.slice().sort()
                : this._fictRitmo === 'lv' ? [1,2,3,4,5] : null,
            jornadas,
        };
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email: this._fictEditando, ficticio })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            document.getElementById('fictModal').classList.remove('show');
            this._renderConductores(); this._renderPrueba();
            this._mostrarToast('✅ Usuario de prueba guardado', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    async _borrarFicticio(email) {
        if (!confirm('¿Borrar este usuario de prueba?')) return;
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores(); this._renderPrueba();
            this._mostrarToast('Usuario de prueba borrado', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // Día que muestran los puestos: 0 = hoy, -1 = ayer, +1 = mañana.
    _puestosOffset: 0,

    _fechaOffset(off) {
        const d = new Date();
        d.setHours(12, 0, 0, 0);          // mediodía: los cambios de hora no restan un día
        d.setDate(d.getDate() + off);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    },

    _etiquetaDia(off) {
        if (off === 0)  return 'Hoy';
        if (off === -1) return 'Ayer';
        if (off === 1)  return 'Mañana';
        const d = new Date();
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() + off);
        return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
    },

    cambiarDiaPuestos(paso) {
        this._puestosOffset += paso;
        this._renderConductores();      // el día manda sobre las dos secciones
    },

    // Swipe horizontal en toda la pestaña: cambia de día, no de pestaña. El
    // touchstart corta la propagación para que el swipe de pestañas no salte;
    // para cambiar de pestaña está la barra de abajo.
    _initSwipePuestos() {
        const cont = document.getElementById('tabPanel0');
        if (!cont || cont._swipeDia) return;
        cont._swipeDia = true;
        let x0 = 0, y0 = 0, activo = false;
        cont.addEventListener('touchstart', e => {
            e.stopPropagation();
            if (e.touches.length !== 1 || this._sobreCarrusel(e.target, cont)) { activo = false; return; }
            x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; activo = true;
        }, { passive: true });
        cont.addEventListener('touchend', e => {
            e.stopPropagation();
            if (!activo) return;
            activo = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - x0, dy = t.clientY - y0;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
            this.cambiarDiaPuestos(dx < 0 ? 1 : -1);   // arrastrar a la izquierda avanza
        }, { passive: true });
    },

    // Estando en otro día vuelve a hoy; estando ya en hoy abre el calendario,
    // que es la única forma de saltar lejos sin pulsar la flecha veinte veces.
    pulsarHoy() {
        if (this._puestosOffset !== 0) return this.irAHoy();
        this.abrirCalendario();
    },

    irAHoy() {
        if (this._puestosOffset === 0) return;
        this._puestosOffset = 0;
        this._renderConductores();
    },

    abrirCalendario() {
        const inp = document.getElementById('pstFecha');
        if (!inp) return;
        const f = this._fechaOffset(this._puestosOffset);
        inp.value = `${f.slice(0,4)}-${f.slice(4,6)}-${f.slice(6,8)}`;
        inp.style.pointerEvents = 'auto';
        try { inp.showPicker(); } catch (_) { inp.focus(); inp.click(); }
        setTimeout(() => { inp.style.pointerEvents = 'none'; }, 500);
    },

    irAFecha(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return;
        const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
        const d = new Date(+iso.slice(0,4), +iso.slice(5,7) - 1, +iso.slice(8,10), 12);
        this._puestosOffset = Math.round((d - hoy) / 86400000);
        this._renderConductores();
    },

    // El lugar de un día puede no ser el habitual: manda la excepción que haya
    // puesto el gestor, luego lo que publicó la app y por último el habitual.
    _lugarDe(u, fecha, j) {
        return (u.lugares && u.lugares[fecha]) || j?.pu || u.puesto || '';
    },

    // Totales tal y como estaban al acabar ese día. Se replican las reglas de
    // la app del trabajador: las jornadas marcadas como extra no suman al
    // cómputo anual, y un festivo sin horas cuenta como una jornada entera.
    _totalesDe(u, hasta) {
        const jor  = u.jornadaHoras || 7;
        // Los días de baja no los pudo trabajar, así que se le quitan del
        // objetivo en vez de dejárselos como horas pendientes.
        const objetivoAnual = u.horasAnuales || 777;
        // La baja descuenta media jornada por día no trabajado a quien va por
        // las 777h, aunque esos días haga 7h seguidas. La jornada completa
        // descuenta lo suyo.
        const horasDeBaja = objetivoAnual >= this.ANUALES_COMPLETA ? jor : this.HORAS_BAJA;
        const diasBaja = this._diasBaja(u, hasta);
        const horasBaja = Math.round(diasBaja * horasDeBaja * 10) / 10;
        const tope = Math.max(0, objetivoAnual - horasBaja);
        const mes  = hasta.slice(0, 6);
        let anual = 0, extras = 0, delMes = 0, festTrabajados = 0;
        // Días distintos, no jornadas: quien parte el día entre dos sitios
        // registra dos y seguía siendo un día trabajado.
        const diasDelMes = new Set();
        (u.jornadas || []).forEach(j => {
            if (!j || j.f > hasta) return;
            const h = j.h || 0;
            if (j.f.slice(0, 6) === mes) { delMes += h; diasDelMes.add(j.f); }
            if (j.x === 1) { extras += h; return; }
            if (j.fe && h > 0) festTrabajados++;
            anual += this._horasEfectivas(j, jor, u);
        });
        const exceso = Math.max(0, anual - tope);
        const r1 = n => Math.round(n * 10) / 10;
        return { mes: r1(delMes), dias: diasDelMes.size, extras: r1(extras + exceso), festTrabajados,
                 diasBaja, horasBaja, objetivo: r1(tope),
                 realizadas: r1(anual), restantes: r1(Math.max(0, tope - anual)) };
    },

    // Misma regla que en la app del trabajador: un festivo sin trabajar cuenta
    // como jornada entera, y uno trabajado cuenta sus horas.
    _horasEfectivas(j, jornada, u) {
        const h = j.h || 0;
        // Un día de baja apuntado por el trabajador cuenta como jornada hecha:
        // media jornada 3,5h y jornada completa las suyas.
        if (j.b && h === 0) {
            return (Number(u?.horasAnuales) || 777) >= this.ANUALES_COMPLETA
                ? (Number(u?.jornadaHoras) || 7) : this.HORAS_BAJA;
        }
        return (j.fe && h === 0) ? jornada : h;
    },

    // Nota junto al nombre en el cuadro de lugares: para los de calle, en qué
    // andan ese día. Va por fecha, como el lugar, porque cambia a diario.
    _notaDe(u, fecha) { return (u?.notas && u.notas[fecha]) || ''; },

    _ultimaNota(u) {
        const f = Object.keys(u?.notas || {}).sort();
        return f.length ? u.notas[f[f.length - 1]] : '';
    },

    async editarNota(email, fecha) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        const actual = this._notaDe(u, fecha) || this._ultimaNota(u);
        const v = prompt(`Descripción para ${u.nombre || email}\n${fecha.slice(6,8)}/${fecha.slice(4,6)}`, actual);
        if (v === null) return;
        const nota = v.trim().slice(0, 40);
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, nota, fecha })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(nota ? `✅ ${nota}` : 'Descripción quitada', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // Jornada de un trabajador en una fecha concreta (la última si hay varias)
    // Todas las jornadas de ese día: quien parte el día en dos sitios registra
    // dos, y quedarse con una sola hacía desaparecer media jornada.
    _jornadasDe(u, fecha) {
        return (u?.jornadas || []).filter(j => j && j.f === fecha);
    },

    _jornadaDe(u, fecha) {
        const dia = this._jornadasDe(u, fecha);
        return dia.length ? dia[dia.length - 1] : null;
    },

    _diaAntes(fecha) {
        const d = new Date(+fecha.slice(0,4), +fecha.slice(4,6) - 1, +fecha.slice(6,8), 12);
        d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    },

    // Un turno de noche que entra a las 20:00 y sale a las 3:00 sigue en marcha
    // después de medianoche, pero su jornada está guardada en el día anterior.
    // Sin esto, a las 00:30 el trabajador desaparecía del cuadro de ese día.
    _jornadaDeAyer(u, fecha) {
        const j = this._jornadaDe(u, this._diaAntes(fecha));
        if (!j) return null;
        const ini = this._minutos(j.i), fin = this._minutos(j.o);
        if (ini === null || fin === null || fin > ini) return null;   // no cruza medianoche
        return j;
    },

    // Lo que hay que pintar ese día: su jornada, o la de la víspera si todavía
    // no ha salido. `deAyer` marca el segundo caso para poder señalarlo.
    _jornadaVisible(u, fecha) {
        const j = this._jornadaDe(u, fecha);
        if (j) return { j, deAyer: false };
        const ayer = this._jornadaDeAyer(u, fecha);
        return ayer ? { j: ayer, deAyer: true } : { j: null, deAyer: false };
    },

    _estadoJornada(u, j, esHoy, esFuturo, deAyer, enBaja, enVac) {
        if (enBaja) return { clase: 'baja', texto: 'de baja (BE)' };
        // Las vacaciones son un tramo de fechas, no una jornada: sin esto solo
        // salían el día suelto que el trabajador hubiera registrado.
        if (enVac)  return { clase: 'vac',  texto: 'de vacaciones' };
        if (!j)      return { clase: 'gris', texto: esFuturo ? 'sin previsión' : 'sin registro' };
        if (j.v)     return { clase: 'vac',  texto: 'vacaciones' };
        if (j.p)     return { clase: 'gris', texto: 'permiso retribuido' };
        if (esFuturo) return { clase: 'gris', texto: 'previsto' };
        const ini = this._minutos(j.i), fin = this._minutos(j.o);
        if (ini === null || fin === null) {
            return esHoy ? { clase: 'gris', texto: 'sin horario' }
                         : { clase: 'rojo', texto: 'jornada cerrada' };
        }
        const ahora = new Date().getHours() * 60 + new Date().getMinutes();
        // Si viene de la víspera, ese día solo se ve el tramo de 00:00 a la salida
        if (deAyer) {
            if (!esHoy)        return { clase: 'rojo',  texto: 'jornada cerrada' };
            if (ahora < fin)   return { clase: 'verde', texto: `trabajando desde ayer, sale a las ${j.o}` };
            return { clase: 'rojo', texto: 'ha terminado' };
        }
        if (!esHoy) return { clase: 'rojo', texto: 'jornada cerrada' };
        let finReal = fin; if (finReal <= ini) finReal += 1440;   // turno que cruza medianoche
        let cur = ahora; if (cur < ini && finReal > 1440) cur += 1440;
        if (cur < ini)     return { clase: 'gris',  texto: 'aún no ha entrado' };
        if (cur > finReal) return { clase: 'rojo',  texto: 'ha terminado' };
        return { clase: 'verde', texto: 'trabajando' };
    },

    _renderPuestos() {
        const cont = document.getElementById('puestosList');
        if (!cont) return;
        this._initSwipePuestos();

        const off     = this._puestosOffset;
        const fecha   = this._fechaOffset(off);
        const esHoy   = off === 0;
        const esFuturo = off > 0;
        const txt = document.getElementById('pstDiaTxt');
        if (txt) txt.textContent = this._etiquetaDia(off);
        const btnHoy = document.getElementById('pstHoy');
        if (btnHoy) {
            btnHoy.textContent = off === 0 ? '📅' : 'Hoy';
            btnHoy.title = off === 0 ? 'Elegir día' : 'Volver a hoy';
        }

        const lista    = this._conductoresVisibles();
        // Los que no tienen lugar asignado también salen, en su propio grupo:
        // si no, un trabajador nuevo se quedaba invisible hasta asignárselo.
        const SIN = 'Sin asignar';
        const conPuesto = lista.flatMap(u => {
            const v = this._jornadaVisible(u, fecha);
            // Un día puede llevar más de una jornada, cada una en su sitio: se
            // saca una fila por cada una. La que viene de la víspera va sola,
            // que esa no es de hoy.
            const todas = v.deAyer ? [] : this._jornadasDe(u, fecha);
            const base = { u, deAyer: v.deAyer,
                     enBaja: this._enBaja(u, fecha) || (!this._bajasDe(u).length && !!u.baja),
                     // Unas vacaciones valen igual apuntadas como tramo por el
                     // gestor que como jornada suelta por el trabajador.
                     enVac:  this._enVacaciones(u, fecha) || !!v.j?.v,
                     // Sin jornada y sin ese día en su semana, ese día no es
                     // suyo: ni cubre el lugar ni tiene sentido listarlo.
                     fueraDeSemana: !v.j && !this._trabajaEseDia(u, fecha),
                     // Lo que tiene asignado ese día, para cuando aún no ha
                     // fichado: de hoy en adelante eso ya cubre el turno, así
                     // que el lugar no sale como vacío teniendo gente puesta.
                     plan: (esHoy || esFuturo) && !v.j ? this._horasPlan(u, fecha) : null,
                     planTramos: (esHoy || esFuturo) && !v.j ? this._tramosPlan(u, fecha) : null };
            if (todas.length < 2) {
                return [{ ...base, j: v.j, lugar: this._lugarDe(u, fecha, v.j).trim() || SIN }];
            }
            // Con varias, manda el lugar que traiga cada una: el que puso el
            // gestor para ese día vale para el conjunto, no para cada tramo.
            return todas.map(j => ({ ...base, j,
                lugar: String(j.pu || '').trim() || this._lugarDe(u, fecha, j).trim() || SIN }));
        // Quien está de vacaciones o de baja no ocupa lugar ese día, así que no
        // sale en el cuadro. Sigue en la lista de trabajadores, con su botón.
        }).filter(x => !x.enVac && !x.enBaja && !x.fueraDeSemana);

        // Quien ha pasado por varios lugares sale en cada uno con sus horas, y
        // las horas del día que no haya repartido caen en "Sin servicio".
        const SIN_SERVICIO = 'Sin servicio';
        const porLugares = conPuesto.flatMap(x => {
            // Sin fichar todavía, vale lo que le haya repartido el gestor: sale
            // en cada lugar con sus horas, como si ya lo hubiera registrado.
            if (!x.j && x.planTramos) {
                return x.planTramos.map(t => ({ ...x, tramo: true,
                    plan: { i: t.i, f: t.o },
                    lugar: String(t.p).trim() || SIN }));
            }
            // Con las horas basta: un tramo sin lugar son horas trabajadas que
            // hay que ver, y van al grupo de "Sin servicio" como las demás.
            const tr = (Array.isArray(x.j?.tr) ? x.j.tr : [])
                .filter(t => t && t.i && t.o);
            if (!tr.length) return [x];
            const filas = tr.map(t => ({ ...x, tramo: true,
                j: { ...x.j, i: t.i, o: t.o, h: this._horasEntre(t.i, t.o) },
                lugar: String(t.p || '').trim() || SIN_SERVICIO }));
            const puestas = tr.reduce((n, t) => n + this._horasEntre(t.i, t.o), 0);
            const falta = Math.round(((x.j.h || 0) - puestas) * 10) / 10;
            if (falta > 0.1) filas.push({ ...x, tramo: true, sinServicio: falta,
                j: { ...x.j, i: '', o: '', h: falta }, lugar: SIN_SERVICIO });
            return filas;
        });
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

        // Contadores de la cabecera: quién ha trabajado ese día y quién está
        // dentro ahora mismo (esto último solo tiene sentido en el día de hoy).
        const _ahora = new Date();
        const ahoraMin = _ahora.getHours() * 60 + _ahora.getMinutes();
        // Por persona, no por fila: quien parte el día en dos sitios sale dos
        // veces en el cuadro pero es un solo trabajador.
        const quienesTrabajaron = new Set(), quienesDentro = new Set();
        conPuesto.forEach(({ u, j, deAyer, enBaja, enVac }) => {
            if (enBaja || enVac || !j || j.v || j.p) return;
            if (!deAyer) quienesTrabajaron.add(u.email);
            if (esHoy && this._estadoJornada(u, j, true, false, deAyer, false, false).clase === 'verde') {
                quienesDentro.add(u.email);
            }
        });
        const trabajaron = quienesTrabajaron.size, ahoraMismo = quienesDentro.size;
        const cnt = document.getElementById('puestosCnt');
        if (cnt) {
            cnt.textContent = esFuturo
                ? `${trabajaron} previsto${trabajaron === 1 ? '' : 's'}`
                : esHoy ? `${trabajaron} hoy · ${ahoraMismo} ahora`
                        : `${trabajaron} ese día`;
        }

        if (!conPuesto.length) {
            cont.innerHTML = '<div class="tab-empty" style="padding:22px 16px;">'
                + '<span class="tab-empty-s">Aquí verás a cada trabajador en su lugar<br>'
                + 'en cuanto abran su app.</span></div>';
            this._renderFiltroLugares(localStorage.getItem('filtroLugares') || 'todos', esHoy);
            return;
        }
        const porPuesto = {};
        porLugares.forEach(x => { (porPuesto[x.lugar] = porPuesto[x.lugar] || []).push(x); });
        // Un lugar sin nadie no salía: como el cuadro se monta repartiendo
        // gente, el que no cubría nadie era justo el que no se veía. Los del
        // catálogo salen siempre, aunque estén vacíos.
        Object.entries(LUGARES_CATALOGO || {}).forEach(([k, l]) => {
            const nombre = (l?.nombre || k).trim();
            if (!nombre) return;
            if (!Object.keys(porPuesto).some(p => this._clavePuesto(p) === k)) porPuesto[nombre] = [];
        });

        // 'sinservicio' vivía aquí y se ha ido a la lista de trabajadores, que
        // es su sitio: quien lo tuviera puesto se encuentra el cuadro entero.
        let filtro = localStorage.getItem('filtroLugares') || 'todos';
        if (!['todos', 'trabajando', 'sincubrir'].includes(filtro)) filtro = 'todos';
        const tarjetas = [];
        // Lo que cuenta cada filtro, para poder enseñarlo en su botón igual que
        // en la lista de trabajadores: así se ve de un vistazo que los dos
        // "sin servicio asignado" dicen lo mismo.
        const cuenta = { todos: 0, trabajando: 0, sincubrir: 0 };
        const personas = filas => new Set(filas.map(x => x.u.email)).size;
        const diaSemana = new Date(+fecha.slice(0,4), +fecha.slice(4,6) - 1, +fecha.slice(6,8), 12).getDay();
        const alFinal = p => (p === SIN_SERVICIO ? 2 : p === SIN ? 1 : 0);
        const dePegaPuesto = p => p === SIN || p === SIN_SERVICIO;
        Object.keys(porPuesto).sort((a, b) =>
            (alFinal(a) - alFinal(b)) || a.localeCompare(b, 'es')).forEach(puesto => {
            // Los días que ese lugar no abre no hay turnos que cubrir, salvo
            // que alguien haya registrado jornada: un dato real no desaparece.
            // Antes el lugar se escondía del todo y no había forma de saber si
            // estaba cubierto o es que ese día no abría, así que en "Todos"
            // sale igual, apagado y diciéndolo.
            const dias = DIAS_POR_LUGAR[this._clavePuesto(puesto)];
            const cerradoHoy = !!dias && !dias.includes(diaSemana)
                && !porPuesto[puesto].some(x => x.j && !x.j.v && !x.j.p);
            if (cerradoHoy) {
                if (filtro !== 'todos') return;
                const DIA_PLURAL = ['los domingos', 'los lunes', 'los martes', 'los miércoles',
                                    'los jueves', 'los viernes', 'los sábados'];
                tarjetas.push(`<div class="pst-card cerrado">
                    <div class="pst-head">
                        <span class="pst-nombre">${esc(puesto)}</span>
                        <span class="pst-cob">no abre ${DIA_PLURAL[diaSemana]}</span>
                    </div></div>`);
                return;
            }
            // Ordenar por hora de entrada: así se ve de un vistazo si el relevo encaja
            const gente = porPuesto[puesto].slice().sort((a, b) => {
                // El que viene de la víspera va primero: lleva dentro desde ayer
                if (a.deAyer !== b.deAyer) return a.deAyer ? -1 : 1;
                const ma = this._minutos(a.j?.i), mb = this._minutos(b.j?.i);
                if (ma === null) return 1;
                if (mb === null) return -1;
                return ma - mb;
            });
            // En jornada: el que está dentro de su turno ahora mismo. Cuenta lo
            // que haya fichado y, si no ha fichado, lo que tenga asignado —que
            // aquí es lo normal: el gestor pone el turno y el trabajador ficha
            // al llegar—. Mirando solo lo fichado, el filtro salía a cero con
            // media plantilla en la calle.
            // En jornada: todo el que trabaja ese día, haya fichado o lo tenga
            // asignado. Aquí lo normal es que el gestor ponga el turno y el
            // trabajador fiche al llegar, si ficha, así que mirando solo lo
            // fichado el filtro salía a cero con gente en la calle.
            const trabajando = x => {
                if (x.enBaja || x.enVac) return false;
                if (x.j && !x.j.v && !x.j.p) return true;
                return !!x.plan;
            };
            // Y aparte, quién está dentro en este momento: eso solo tiene
            // sentido en el día de hoy y es lo que dice la etiqueta verde.
            const dentroAhora = x => {
                if (!esHoy || x.enBaja || x.enVac) return false;
                if (x.j && !x.j.v && !x.j.p) {
                    return this._estadoJornada(x.u, x.j, true, false, x.deAyer, false, false).clase === 'verde';
                }
                return !!x.plan
                    && this._dentroDeFranja(ahoraMin, { desde: x.plan.i, hasta: x.plan.f }, 0);
            };
            const conTurno = gente.filter(trabajando).length;
            const dentro   = gente.filter(dentroAhora).length;

            // Turnos del lugar que ese día no cubre nadie. El que viene de la
            // víspera cubre el turno de su hora de entrada, no el de ahora.
            const franjas = TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || [];
            // Un turno está cubierto si entre todos los que trabajan ese día en
            // el lugar se cubren al menos 5 h de su franja, aunque sea entre
            // dos: el de 05:00 a 12:00 cubre 5 h del turno de 07:00 a 14:00.
            // Si la franja dura menos de 5 h, basta con cubrirla entera; si
            // tiene varias plazas, 5 h por plaza. Cuenta lo fichado y, si no
            // ha fichado, lo que tiene asignado. El que viene de la víspera va
            // con su hora de ayer, así que se corre un día hacia atrás.
            const UMBRAL_TURNO = 5 * 60;
            const intervalo = x => {
                const fich = x.j && !x.j.v && !x.j.p;
                const i = this._minutos(fich ? x.j.i : x.plan?.i);
                if (i === null) return null;
                let f = this._minutos(fich ? (x.j.o || x.plan?.f) : x.plan?.f);
                if (f === null) f = i + 7 * 60;
                if (f <= i) f += 1440;
                return x.deAyer ? [i - 1440, f - 1440] : [i, f];
            };
            const cubierto = f => {
                const d = this._minutos(f.desde);
                let h = f.hasta === '24:00' ? 1440 : this._minutos(f.hasta);
                if (d === null || h === null) return 0;
                if (h <= d) h += 1440;
                return gente.filter(trabajando).reduce((s, x) => {
                    const iv = intervalo(x);
                    return s + (iv ? Math.max(0, Math.min(iv[1], h) - Math.max(iv[0], d)) : 0);
                }, 0);
            };
            const largo = f => {
                const d = this._minutos(f.desde);
                let h = f.hasta === '24:00' ? 1440 : this._minutos(f.hasta);
                if (d === null || h === null) return UMBRAL_TURNO;
                if (h <= d) h += 1440;
                return h - d;
            };
            const huecos = franjas
                .map(f => {
                    const umbral = Math.min(UMBRAL_TURNO, largo(f));
                    const plazas = Math.floor(cubierto(f) / umbral);
                    return { ...f, faltan: Math.max(0, (Number(f.n) || 1) - plazas) };
                })
                .filter(f => f.faltan > 0);
            // Las cuentas van aquí, antes de descartar nada por el filtro, para
            // que cada botón diga lo suyo y no solo el que esté puesto.
            cuenta.todos      += personas(gente);
            cuenta.trabajando += personas(gente.filter(trabajando));
            if (!dePegaPuesto(puesto)
                && (franjas.length ? huecos.length > 0 : conTurno === 0)) cuenta.sincubrir++;

            // El filtro escoge qué trabajadores se ven, salvo "sin cubrir", que
            // es una propiedad del lugar: el que tiene algún turno sin nadie.
            // Los dos grupos de pega no son lugares: no tienen turnos que cubrir
            if (filtro === 'sincubrir'
                && (dePegaPuesto(puesto)
                    || (franjas.length ? !huecos.length : conTurno > 0))) return;
            // En "Horarios sin cubrir" lo que se busca es el hueco, no la
            // gente: quien ya tiene turno no pinta nada ahí. Se enseña el
            // lugar con los turnos que nadie cubre y punto.
            const soloHuecos = filtro === 'sincubrir';
            const visibles = soloHuecos ? []
                           : filtro === 'trabajando' ? gente.filter(trabajando)
                           : gente;
            // Un lugar de verdad se enseña aunque no haya nadie: que esté
            // vacío es lo que hay que ver. Los dos grupos de pega, no.
            if (!soloHuecos && !visibles.length
                && (filtro !== 'todos' || dePegaPuesto(puesto))) return;

            const filas = soloHuecos ? '' : visibles.map(({ u, j, deAyer, enBaja, enVac, sinServicio, plan }) => {
                const e = this._estadoJornada(u, j, esHoy, esFuturo, deAyer, enBaja, enVac);
                const previsto = !j && !enBaja && !enVac && plan;
                const horario = sinServicio
                    ? `${String(sinServicio).replace('.', ',')}h sin lugar`
                    : (j?.i && j?.o && !enVac)
                    ? (deAyer ? `→${esc(j.o)}` : `${esc(j.i)}–${esc(j.o)}`)
                    : enBaja ? 'BE' : enVac ? '🏖️ VC'
                    : previsto ? `${esc(plan.i)}–${esc(plan.f)}` : '—';
                const t = this._turnoDe(puesto, j?.i || (previsto ? plan.i : '')) || '';
                // El horario se toca para ponerle la jornada: a qué hora, qué
                // días y en qué lugar. Sin jornada registrada sale un guión, y
                // ese guión es justo por donde se empieza.
                return `<div class="pst-fila${enBaja ? ' baja' : ''}${enVac ? ' vac' : ''}">
                    <span class="pst-dot ${e.clase}" title="${esc(e.texto)}"></span>
                    <span class="pst-quien" onclick="app.editarNota('${esc(u.email)}','${esc(fecha)}')"><b>${esc(u.conductor) || '—'}</b> ${esc(u.nombre)}${
                        this._notaDe(u, fecha) ? `<span class="pst-nota">${esc(this._notaDe(u, fecha))}</span>` : ''}</span>
                    ${t ? `<span class="cond-turno ${t}">${t}</span>` : ''}
                    <span class="pst-horario${previsto ? ' previsto' : ''}${j ? '' : ' ponible'}"
                          onclick="event.stopPropagation();app.ponerJornada('${esc(u.email)}','${esc(fecha)}','${esc(puesto)}')"
                          title="Ponerle jornada">${horario}</span>
                </div>`;
            }).join('');
            // Hoy interesa quién está dentro; en otro día, cuántos lo cubrieron.
            // Los dos grupos de pega no son lugares: no tiene sentido decir
            // que están sin cubrir.
            const dePega = dePegaPuesto(puesto);
            // En la vista de huecos el número que importa es cuántos faltan,
            // no cuánta gente hay: verde con "1 previsto" al lado de un turno
            // descubierto se lee como que está resuelto.
            const faltanTotal = huecos.reduce((n, f) => n + f.faltan, 0);
            const cob = soloHuecos
                ? (huecos.length
                    ? `faltan ${faltanTotal}` : 'sin turnos definidos')
                : dePega
                ? `${visibles.length} ${visibles.length === 1 ? 'persona' : 'personas'}`
                : esHoy
                // Hoy, quien tiene turno puesto pero no está dentro puede ser
                // que aún no haya entrado o que ya haya salido: "con turno"
                // vale para los dos, "previsto" solo para el primero.
                ? (dentro > 0 ? `${dentro} en turno`
                   : conTurno > 0 ? `${conTurno} con turno` : 'sin cubrir')
                : (conTurno > 0
                   ? `${conTurno} ${esFuturo
                        ? `previsto${conTurno === 1 ? '' : 's'}` : 'ese día'}`
                   : 'sin cubrir');
            const vacio = soloHuecos || (!dePega && conTurno === 0);
            const NOMBRE_TURNO = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
            tarjetas.push(`<div class="pst-card">
                <div class="pst-head">
                    <span class="pst-nombre">${esc(puesto)}</span>
                    <span class="pst-cob${vacio ? ' vacio' : ''}">${cob}</span>
                </div>
                ${huecos.length ? `<div class="pst-huecos">Sin cubrir: ${huecos.map(f =>
                    `<span class="pst-hueco"><b>${f.id}</b> ${esc(NOMBRE_TURNO[f.id] || f.id)} ${
                        esc(f.desde)}–${esc(f.hasta)}${
                        (Number(f.n) || 1) > 1 ? ` · faltan ${f.faltan} de ${f.n}` : ''}</span>`).join('')}</div>` : ''}
                ${soloHuecos && !huecos.length
                    ? '<div class="pst-huecos">Sin turnos definidos y sin nadie ese día.</div>' : ''}
                ${filas}
            </div>`);
        });
        // Vacío aquí casi siempre es buena noticia, así que se dice lo que
        // significa en vez de "no hay nada".
        const VACIO = {
            sincubrir:  'Ningún horario se queda sin cubrir.',
            trabajando: esHoy ? 'Ahora mismo no hay nadie dentro.' : 'Nadie en jornada ese día.',
        };
        cont.innerHTML = tarjetas.join('') || '<div class="tab-empty" style="padding:22px 16px;">'
            + `<span class="tab-empty-s">${VACIO[filtro] || 'Ningún lugar en este grupo.'}</span></div>`;
        this._renderFiltroLugares(filtro, esHoy, cuenta);
    },

    _renderFiltroLugares(sel, esHoy, cuenta) {
        const cont = document.getElementById('lugFiltros');
        if (!cont) return;
        const n = id => (cuenta && cuenta[id] !== undefined) ? ` ${cuenta[id]}` : '';
        cont.innerHTML = [
            ['todos', 'Todos'],
            ['trabajando',  'En jornada'],
            ['sincubrir',   'Horarios sin cubrir'],
        ].map(([id, txt]) => `<button class="${sel === id ? 'activo' : ''}"
                onclick="event.stopPropagation();app.filtrarLugares('${id}')">${
                    sel === id ? '✓ ' : ''}${txt}${n(id)}</button>`).join('');
    },

    filtrarLugares(modo) {
        localStorage.setItem('filtroLugares', modo);
        this._renderPuestos();
    },

    // Estado de un trabajador ese día, para el filtro de la lista
    _estadoTrabajador(u, fecha) {
        if (this._enBaja(u, fecha) || (!this._bajasDe(u).length && u.baja)) return 'be';
        const { j } = this._jornadaVisible(u, fecha);
        if (j?.v || this._enVacaciones(u, fecha)) return 'vacaciones';
        // Libre: ese día de la semana no es suyo y no ha registrado nada
        if (!j && !this._trabajaEseDia(u, fecha)) return 'libre';
        return 'activo';
    },

    // Sin turno asignado: le toca trabajar y le falta el horario o el lugar.
    // Con lugar pero sin hora tampoco tiene turno: es el que sale con un guión
    // en el cuadro de lugares.
    _sinServicio(u, fecha) {
        if (this._estadoTrabajador(u, fecha) !== 'activo') return false;
        const { j } = this._jornadaVisible(u, fecha);
        if (!this._lugarDe(u, fecha, j).trim()) return true;
        // Lo que ya ha fichado cuenta como servicio hecho
        if (j?.i) return false;
        return !this._horasPlan(u, fecha);
    },

    // Qué le falta, para poder decirlo en la ficha en vez de dejarlo a adivinar
    _queLeFalta(u, fecha) {
        const { j } = this._jornadaVisible(u, fecha);
        const sinLugar = !this._lugarDe(u, fecha, j).trim();
        const sinHora  = !j?.i && !this._horasPlan(u, fecha);
        return sinLugar && sinHora ? 'sin lugar ni horario'
             : sinLugar ? 'sin lugar' : sinHora ? 'sin horario' : '';
    },

    FILTROS_COND: [['todos', 'Todos'], ['activo', 'Activos'], ['libre', 'Libres'],
                   ['sinservicio', 'Sin turno asignado'], ['be', 'BE'], ['vacaciones', 'Vacaciones'],
                   ['ocultos', 'Ocultos']],

    // Los ocultos no salen en ningún filtro salvo el suyo: para verlos y
    // poder mostrarlos otra vez hay que elegir justo ese.
    _pasaFiltroCond(u, fecha, filtro) {
        if (filtro === 'ocultos') return !!u.oculto;
        if (u.oculto) return false;
        if (filtro === 'todos') return true;
        if (filtro === 'sinservicio') return this._sinServicio(u, fecha);
        return this._estadoTrabajador(u, fecha) === filtro;
    },

    _renderFiltrosCond(lista, fecha) {
        const cont = document.getElementById('condFiltros');
        if (!cont) return;
        const sel = localStorage.getItem('filtroTrabajadores') || 'todos';
        cont.innerHTML = this.FILTROS_COND.map(([id, txt]) => {
            const n = lista.filter(u => this._pasaFiltroCond(u, fecha, id)).length;
            return `<button class="${sel === id ? 'activo' : ''}"
                onclick="app.filtrarTrabajadores('${id}')">${sel === id ? '✓ ' : ''}${txt} ${n}</button>`;
        }).join('');
    },

    filtrarTrabajadores(modo) {
        localStorage.setItem('filtroTrabajadores', modo);
        this._renderConductores();
    },

    // Las fotos van en su propia consulta y se guardan en el móvil: no tiene
    // sentido bajarlas enteras cada vez que se abre la app.
    _avatares: (() => { try { return JSON.parse(localStorage.getItem('avatares') || '{}'); } catch (_) { return {}; } })(),

    async _cargarAvatares() {
        try {
            const r = await fetch(`${this.USUARIOS_URL}?avatares=1`, { cache: 'no-store' });
            if (!r.ok) return;
            this._avatares = await r.json();
            localStorage.setItem('avatares', JSON.stringify(this._avatares));
            this._renderConductores();
        } catch (_) { /* con lo cacheado vale; si no hay, sale la inicial */ }
    },

    // Las fichas dicen por qué apps ha entrado cada uno. Las de antes de eso
    // no lo dicen, y esas solo podían venir de la app de conductores.
    _sinAppTrabajador(u) {
        return !u?.ficticio && Array.isArray(u?.apps) && u.apps.length > 0 && !u.apps.includes('trabajador');
    },

    // Gestión: cada nombre entero y en una sola línea. Si no cabe con la
    // letra normal, se le va bajando la letra hasta que quepa.
    _ajustarNombres() {
        if (ES_APP_DEV) return;
        if (!this._nombresAlGirar) {
            this._nombresAlGirar = true;
            let t = null;
            window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this._ajustarNombres(), 150); });
        }
        requestAnimationFrame(() => {
            document.querySelectorAll('#condList .cond-nombre.una-linea .cond-nom-txt').forEach(el => {
                el.style.fontSize = '';
                let tam = parseFloat(getComputedStyle(el).fontSize) || 13.5;
                while (el.scrollWidth > el.clientWidth + 0.5 && tam > 9) {
                    tam -= 0.5;
                    el.style.fontSize = tam + 'px';
                }
            });
        });
    },

    _renderConductores() {
        const cont = document.getElementById('condList');
        const fecha = this._fechaOffset(this._puestosOffset);
        const esHoy = this._puestosOffset === 0;
        const orden = localStorage.getItem('ordenTrabajadores') || 'nombre';
        // Aquí sí entran los ocultos —el filtro "Ocultos" es el único sitio
        // desde donde se pueden volver a mostrar—. Los de prueba que ha
        // ocultado el desarrollador desde su app no salen en gestión ni ahí.
        const soyGestor = this._soyElGestor();
        const todos = Object.values(this._conductores || {})
            .filter(u => soyGestor || !u.ficticio || !u.oculto || u.ocultoPor === 'gestion');
        const filtro = localStorage.getItem('filtroTrabajadores') || 'todos';
        this._renderFiltrosCond(todos, fecha);
        const lista = todos
            .filter(u => this._pasaFiltroCond(u, fecha, filtro))
            .sort((a, b) =>
            orden === 'numero'
                // Sin número al final, y comparación numérica para que 209 no
                // quede antes que 1418
                ? ((a.conductor || '\uffff').localeCompare(b.conductor || '\uffff', 'es', { numeric: true }))
                : (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        if (!lista.length) {
            cont.innerHTML = todos.length
                ? '<div class="tab-empty"><span class="tab-empty-ico">🔍</span>'
                  + '<span class="tab-empty-t">Ninguno en este grupo</span>'
                  + '<span class="tab-empty-s">Prueba con otro filtro o con otro día.</span></div>'
                : '<div class="tab-empty"><span class="tab-empty-ico">👥</span>'
                  + '<span class="tab-empty-t">Sin trabajadores</span>'
                  + '<span class="tab-empty-s">Aparecerán en cuanto abran su app.</span></div>';
            this._renderPuestos();
            this._renderRegistro();
            this._renderCuadranteTrab();
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        cont.innerHTML = lista.map(u => {
            const ini = (u.nombre || u.email || '?').trim()[0]?.toUpperCase() || '?';
            // La tarjeta muestra los datos del día elegido, no siempre los de hoy
            const { j, deAyer } = this._jornadaVisible(u, fecha);
            // Si ese día trabajó en varios sitios, se dicen todos: quedarse con
            // el último escondía media jornada.
            const delDia = deAyer ? [] : this._jornadasDe(u, fecha);
            const sitios = [...new Set(delDia.map(x => String(x.pu || '').trim()).filter(Boolean))];
            const lugarHoy  = sitios.length > 1 ? sitios.join(' · ') : this._lugarDe(u, fecha, j);
            const excepcion = sitios.length < 2 && !!(u.lugares && u.lugares[fecha])
                && this._clavePuesto(lugarHoy) !== this._clavePuesto(u.puesto);
            const turno = sitios.length > 1 ? ''
                : (this._turnoDe(lugarHoy, j?.i) || (esHoy ? u.turno : ''));
            // El horario del día, para verlo junto al lugar: con el sitio solo
            // no se sabe a qué hora entra, que es lo primero que se mira.
            const hh = this._horasDelDia(u, fecha, j);
            const horasHoy = (hh?.i && hh?.f) ? `${hh.i}–${hh.f}` : '';
            const t = this._totalesDe(u, fecha);
            const foto = u.avatar || this._avatares[u.email];
            const av = foto
                ? `<img class="cond-avatar" src="${esc(foto)}">`
                // Sin foto, el emoji que eligió en su app, con su color
                : u.avatarEmoji ? `<div class="cond-avatar emo" style="background:${esc(u.avatarBg || '#667eea')}">${esc(u.avatarEmoji)}</div>`
                : `<div class="cond-avatar">${esc(ini)}</div>`;
            const ver = u.version ? this._buildNumToVersion(parseInt(String(u.version).replace('build-',''),10) || 0) : '—';
            const cerrada = this._estaPlegado('t:' + u.email, true);
            const enBaja = this._enBaja(u, fecha) || (!this._bajasDe(u).length && !!u.baja);
            const enVac  = this._enVacaciones(u, fecha);
            // Baja gris, vacaciones naranja, día libre rojo, y entre los que
            // trabajan: verde el que no tiene lugar y amarillo el que sí.
            const estado = this._estadoTrabajador(u, fecha);
            const color = estado === 'be' ? 'baja'
                : estado === 'vacaciones' ? 'vacaciones'
                : estado === 'libre' ? 'libre'
                : lugarHoy.trim() ? 'asignado' : 'sinlugar';
            return `<div class="cond-card${cerrada ? ' plegada' : ''} ${color}">
                <div class="cond-top" onclick="app._plegarTrabajador('${esc(u.email)}')">
                    ${av}
                    <div class="cond-id">
                        <div class="cond-nombre compacta${ES_APP_DEV ? '' : ' una-linea'}"><span class="cond-nom-txt">${esc(u.nombre) || esc(u.email)}</span>
                            ${turno ? `<span class="cond-turno ${turno}">${turno}</span>` : ''}
                            ${u.ficticio ? '<span class="pr-badge2">VIRTUAL</span>' : ''}
                            ${u.oculto ? '<span class="pr-badge2">OCULTO</span>' : ''}${
                            ES_APP_DEV ? this._chipConexion(u.email) : ''}</div>
                        <div class="cond-num">${esc(u.conductor) || 'sin nº'}${
                            this._desviaciones(u) ? `<span class="cond-alerta" title="Horarios que no cuadran"
                                onclick="event.stopPropagation();app.revisarHorarios('${esc(u.email)}')">❗${
                                this._desviaciones(u)}</span>` : ''}
                            <span class="cond-puesto puesto-click" onclick="event.stopPropagation();app.ponerJornada('${esc(u.email)}','${esc(fecha)}','${esc(lugarHoy)}')">· ${esc(lugarHoy) || 'asignar lugar'}${
                                horasHoy ? ` <span class="cond-hora">${esc(horasHoy)}</span>` : ''}${excepcion ? ' ·' : ''} ✎</span>${
                            // Lo ha dado por leído él: el cambio le ha llegado
                            this._vistoDe(u, fecha)}${
                            // Con lugar pero sin hora tampoco tiene servicio, y
                            // sin decirlo no hay manera de saber por qué sale
                            // en el filtro.
                            estado === 'activo' && lugarHoy.trim() && this._sinServicio(u, fecha)
                                ? `<span class="cond-falta" title="Ponerle horario"
                                        onclick="event.stopPropagation();app.ponerJornada('${esc(u.email)}','${esc(fecha)}','${esc(lugarHoy)}')">sin horario ✎</span>`
                                : ''}</div>
                    </div>
                    <div class="cond-btns cuadro">
                    <button class="be-btn vc-btn${enVac ? ' on' : ''}" title="Vacaciones"
                            onclick="event.stopPropagation();app.editarVacaciones('${esc(u.email)}')">VC</button>
                    <button class="be-btn${enBaja ? ' on' : ''}" title="Fechas de baja"
                            onclick="event.stopPropagation();app.editarBajas('${esc(u.email)}')">BE</button>
                    <button class="be-btn pr-btn${this._prsDe(u, fecha.slice(0, 4)).has(fecha) ? ' on' : ''}" title="Permiso retribuido (2 al año)"
                            onclick="event.stopPropagation();app.marcarPR('${esc(u.email)}','${esc(fecha)}',this)">PR</button>
                    <button class="be-btn" title="${u.oculto ? 'Mostrar en Trabajadores' : 'Ocultar de Trabajadores'}"
                            onclick="event.stopPropagation();app._toggleOcultoTrabajador('${esc(u.email)}')">${u.oculto ? '🙈' : '👁️'}</button>
                    </div>
                    <span class="cond-chev">▾</span>
                </div>
                <div class="cond-cuerpo">
                    ${
                    // Quien solo entra por Control de acceso no registra sus
                    // horas en la app de conductores: sin ella esos cuatro
                    // números serían ceros que no dicen nada.
                    this._sinAppTrabajador(u) ? '' : `<div class="cond-stats">
                        <div class="cond-stat"><div class="cond-stat-v">${t.mes.toFixed(1)}</div><div class="cond-stat-l">este mes</div></div>
                        <div class="cond-stat"><div class="cond-stat-v">${t.extras.toFixed(1)}</div><div class="cond-stat-l">horas extras</div></div>
                        <div class="cond-stat"><div class="cond-stat-v">${t.realizadas.toFixed(1)}</div><div class="cond-stat-l">realizadas</div></div>
                        <div class="cond-stat"><div class="cond-stat-v">${t.restantes.toFixed(1)}</div><div class="cond-stat-l">restantes</div></div>
                    </div>`}
                    ${t.diasBaja ? `<div class="cond-baja">BE: ${t.diasBaja} día${t.diasBaja === 1 ? '' : 's'} · objetivo ${t.objetivo}h en vez de ${u.horasAnuales || 777}h</div>` : ''}
                    <div class="cond-ver">${this._sinAppTrabajador(u) ? '🛡️ Solo Control de acceso' : ver} · actualizado ${u.actualizado
                        ? new Date(u.actualizado).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                        : 'nunca'}</div>
                </div>
            </div>`;
        }).join('');
        this._ajustarNombres();
        document.getElementById('ordenNombre')?.classList.toggle('activo', orden === 'nombre');
        document.getElementById('ordenNumero')?.classList.toggle('activo', orden === 'numero');
        // La cuenta de la cabecera sale del mismo estado que los filtros de
        // abajo, para que no digan cosas distintas: antes aquí "activos" era
        // todo el que no estuviera de baja —los de vacaciones incluidos— y el
        // filtro llamaba activos solo a los que trabajan ese día.
        const porEstado = { activo: 0, libre: 0, be: 0, vacaciones: 0 };
        todos.filter(u => !u.oculto).forEach(u => { porEstado[this._estadoTrabajador(u, fecha)]++; });
        const cnt = document.getElementById('trabajCnt');
        if (cnt) {
            // Los libres no van aquí: caben en el filtro de abajo y esta línea
            // se come el título si se alarga.
            const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
            cnt.textContent = [
                plural(porEstado.activo, 'activo', 'activos'),
                porEstado.be         ? `${porEstado.be} BE` : '',
                porEstado.vacaciones ? `${porEstado.vacaciones} VC` : '',
            ].filter(Boolean).join(' · ');
        }
        this._renderPuestos();
        this._renderRegistro();
        this._renderCuadranteTrab();
    },

    toggleSeccion(id) {
        const sec = document.getElementById(id);
        if (!sec) return;
        const cerrada = sec.classList.toggle('cerrada');
        localStorage.setItem('sec_' + id, cerrada ? '1' : '0');
    },

    _restaurarSecciones() {
        ['secPuestos', 'secTrabajadores'].forEach(id => {
            if (localStorage.getItem('sec_' + id) === '1')
                document.getElementById(id)?.classList.add('cerrada');
        });
    },

    ordenarTrabajadores(modo) {
        localStorage.setItem('ordenTrabajadores', modo);
        document.getElementById('ordenNombre')?.classList.toggle('activo', modo === 'nombre');
        document.getElementById('ordenNumero')?.classList.toggle('activo', modo === 'numero');
        this._renderConductores();
    },

    _plegarTrabajador(email) {
        const clave = 't:' + email;
        const p = JSON.parse(localStorage.getItem('regPlegado') || '{}');
        // Invertir el estado efectivo, no el guardado: las tarjetas nacen plegadas
        p[clave] = !(clave in p ? p[clave] : true);
        localStorage.setItem('regPlegado', JSON.stringify(p));
        this._renderConductores();
    },

    // ── Catálogo de lugares ─────────────────────────────────────────────────
    // Los turnos y las ubicaciones se guardan en el servidor, no en el código,
    // para poder cambiarlos sin publicar una versión nueva de las apps.

    // El catálogo del servidor manda, pero lo que no traiga se completa con la
    // última copia local. Así un campo que el servidor todavía no guarde —o un
    // rato sin red— no borra lo que el gestor acaba de poner.
    _mezclarCatalogo(servidor) {
        const local = this._catalogoLocal();
        const claves = new Set([...Object.keys(local), ...Object.keys(servidor || {})]);
        const fin = {};
        claves.forEach(k => { fin[k] = { ...(local[k] || {}), ...((servidor || {})[k] || {}) }; });
        return fin;
    },

    _catalogoLocal() {
        try { return JSON.parse(localStorage.getItem('lugaresCatalogo') || '{}') || {}; }
        catch (_) { return {}; }
    },

    _guardarCatalogo(cat) {
        this._lugares = cat;
        try { localStorage.setItem('lugaresCatalogo', JSON.stringify(cat)); } catch (_) {}
        aplicarCatalogoLugares(cat);
    },

    async _cargarLugares() {
        this._guardarCatalogo(this._catalogoLocal());   // pintar ya con lo que haya
        try {
            const r = await fetch(LUGARES_URL, { cache: 'no-store' });
            if (!r.ok) return;
            const data = await r.json();
            if (data && typeof data === 'object') {
                this._guardarCatalogo(this._mezclarCatalogo(data));
                this._renderConductores();
            }
        } catch (_) { /* silencioso: se sigue con la copia local */ }
    },

    _renderLugares() {
        const cont = document.getElementById('lugaresList');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const claves = [...new Set([
            ...Object.keys(this._lugares || {}),
            ...PUESTOS_DEFINIDOS.map(p => this._clavePuesto(p)),
        ])].sort();
        cont.innerHTML = claves.map(k => {
            const l = (this._lugares || {})[k];
            const nombre = l?.nombre || PUESTOS_DEFINIDOS.find(p => this._clavePuesto(p) === k) || k;
            const franjas = (TURNOS_POR_PUESTO[k] || []).map(f =>
                `${f.id} ${f.desde}–${f.hasta}${Number(f.n) > 1 ? ` ×${f.n}` : ''}`).join(' · ')
                || 'sin turnos definidos';
            const ubi = l?.ubicacion ? `📍 ${l.ubicacion.radio}m` : '';
            const nd = ['D','L','M','X','J','V','S'];
            const dias = Array.isArray(l?.dias) && l.dias.length
                ? ' · ' + [1,2,3,4,5,6,0].filter(d => l.dias.includes(d)).map(d => nd[d]).join('') : '';
            return `<div class="ver-item" onclick="app._editarLugar('${esc(k)}')" style="cursor:pointer;">
                <div class="ver-n">${esc(nombre)}<br><span class="pm-turnos">${esc(franjas)}${esc(dias)}</span></div>
                <span class="ver-fecha">${ubi}</span><span class="ops-arrow">›</span>
            </div>`;
        }).join('');
    },

    _nuevoLugar() { this._editarLugar(null); },

    _editarLugar(k) {
        this._lugarEditando = k;
        const l = k ? ((this._lugares || {})[k] || {}) : {};
        const nombre = l.nombre || (k ? PUESTOS_DEFINIDOS.find(p => this._clavePuesto(p) === k) || k : '');
        document.getElementById('lgNombre').value = nombre;
        this._turnosTmp = (TURNOS_POR_PUESTO[k] || []).map(f => ({ ...f }));
        this._turnosApagados = {};
        this._diasTmp = (k && DIAS_POR_LUGAR[k]) ? [...DIAS_POR_LUGAR[k]] : [0,1,2,3,4,5,6];
        this._renderDiasLugar();
        this._renderTurnosLugar();
        const u = l.ubicacion || {};
        document.getElementById('lgLat').value   = u.lat ?? '';
        document.getElementById('lgLng').value   = u.lng ?? '';
        document.getElementById('lgRadio').value = u.radio ?? '';
        document.getElementById('lgPrio').value  = l.prioridad ?? '';
        document.getElementById('lgBuscar').value = '';
        document.getElementById('lugarModal').classList.add('show');
        if (this.darkMode) document.getElementById('lugarModalContent').classList.add('dark');
        this._abrirMapa();
    },

    // ── Mapa para elegir la ubicación ───────────────────────────────────────
    // OpenStreetMap con Leaflet: no hace falta clave de API. El marcador es un
    // divIcon y no una imagen, para no depender de los iconos del CDN.
    PALMA: { lat: 39.5696, lng: 2.6502 },

    _coordsCampos() {
        const lat = this._leerDecimal(document.getElementById('lgLat').value);
        const lng = this._leerDecimal(document.getElementById('lgLng').value);
        return (lat !== null && lng !== null) ? { lat, lng } : null;
    },

    _radioCampo() {
        return Math.min(2000, Math.max(30, this._leerDecimal(document.getElementById('lgRadio').value) || 150));
    },

    _ponerCoords(lat, lng) {
        document.getElementById('lgLat').value = lat.toFixed(6);
        document.getElementById('lgLng').value = lng.toFixed(6);
    },

    _abrirMapa() {
        const cont = document.getElementById('lgMapa');
        if (!cont) return;
        if (typeof L === 'undefined') {           // el CDN no ha cargado
            cont.hidden = true;
            document.getElementById('lgSinMapa').hidden = false;
            return;
        }
        cont.hidden = false;
        document.getElementById('lgSinMapa').hidden = true;
        const punto = this._coordsCampos() || this.PALMA;

        if (!this._mapa) {
            this._mapa = L.map(cont, { zoomControl: true, attributionControl: true });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19, attribution: '© OpenStreetMap',
            }).addTo(this._mapa);
            this._mapa.on('click', e => this._moverMarcador(e.latlng.lat, e.latlng.lng));
        }
        this._mapa.setView([punto.lat, punto.lng], this._coordsCampos() ? 17 : 12);
        this._moverMarcador(punto.lat, punto.lng, !this._coordsCampos());
        // El mapa nace dentro de un modal oculto y calcula mal su tamaño
        setTimeout(() => this._mapa.invalidateSize(), 120);
    },

    // `soloPintar` deja los campos en blanco: se ve el centro por defecto, pero
    // el lugar sigue sin ubicación mientras no se toque el mapa.
    _moverMarcador(lat, lng, soloPintar) {
        if (!this._mapa) return;
        if (!soloPintar) this._ponerCoords(lat, lng);
        const icono = L.divIcon({ className: '', html: '<div class="lg-pin">📍</div>',
                                  iconSize: [26, 26], iconAnchor: [13, 24] });
        if (!this._marcador) {
            this._marcador = L.marker([lat, lng], { draggable: true, icon: icono }).addTo(this._mapa);
            this._marcador.on('drag',    e => this._ponerCoords(e.latlng.lat, e.latlng.lng));
            this._marcador.on('dragend', e => this._moverMarcador(e.target.getLatLng().lat, e.target.getLatLng().lng));
        } else {
            this._marcador.setLatLng([lat, lng]);
        }
        this._pintarRadio();
    },

    _pintarRadio() {
        if (!this._mapa || !this._marcador) return;
        const c = this._marcador.getLatLng();
        if (!this._circulo) {
            this._circulo = L.circle(c, { radius: this._radioCampo(), color: '#1565C0',
                                          fillColor: '#1565C0', fillOpacity: 0.15, weight: 2 }).addTo(this._mapa);
        } else {
            this._circulo.setLatLng(c).setRadius(this._radioCampo());
        }
    },

    _centrarDesdeCampos() {
        const c = this._coordsCampos();
        if (!c || !this._mapa) return;
        this._mapa.setView([c.lat, c.lng], Math.max(this._mapa.getZoom(), 16));
        this._moverMarcador(c.lat, c.lng);
    },

    _quitarUbicacion() {
        document.getElementById('lgLat').value = '';
        document.getElementById('lgLng').value = '';
        if (this._marcador) { this._mapa.removeLayer(this._marcador); this._marcador = null; }
        if (this._circulo)  { this._mapa.removeLayer(this._circulo);  this._circulo = null; }
        this._mostrarToast('Este lugar se queda sin ubicación', 2500);
    },

    // Nominatim es el buscador de OpenStreetMap. Se acota a Mallorca para que
    // "Son Rossinyol" no devuelva un sitio del otro lado del mundo.
    async _buscarEnMapa() {
        const q = document.getElementById('lgBuscar').value.trim();
        if (!q) return;
        try {
            const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es'
                + '&viewbox=2.25,40.10,3.50,39.20&bounded=0&q=' + encodeURIComponent(q + ', Mallorca');
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!r.ok) throw new Error(r.status);
            const res = await r.json();
            if (!res.length) { this._mostrarToast('No se ha encontrado esa dirección', 3000); return; }
            const lat = parseFloat(res[0].lat), lng = parseFloat(res[0].lon);
            this._mapa?.setView([lat, lng], 17);
            this._moverMarcador(lat, lng);
        } catch (e) {
            this._mostrarToast('No se ha podido buscar: ' + e.message, 3500);
        }
    },

    _renderDiasLugar() {
        const nombres = ['D','L','M','X','J','V','S'];   // 0 es domingo
        document.getElementById('lgDias').innerHTML = [1,2,3,4,5,6,0]
            .map(d => `<button class="${this._diasTmp.includes(d) ? 'on' : ''}"
                onclick="app._toggleDiaLugar(${d})">${nombres[d]}</button>`).join('');
    },

    _toggleDiaLugar(d) {
        const i = this._diasTmp.indexOf(d);
        if (i === -1) this._diasTmp.push(d); else this._diasTmp.splice(i, 1);
        this._renderDiasLugar();
    },

    // Un lugar no tiene por qué tener los tres turnos: el taller solo abre de
    // noche. Se marcan los que tiene y los que no se quedan apagados, con sus
    // horas a la vista por si se vuelven a encender.
    TURNOS_POR_DEFECTO: { M: ['06:00', '14:00'], T: ['14:00', '21:00'], N: ['21:00', '06:00'] },

    _renderTurnosLugar() {
        const nombres = { M: 'Mañana', T: 'Tarde', N: 'Noche' };
        document.getElementById('lgTurnos').innerHTML = ['M', 'T', 'N'].map(id => {
            const f = this._turnosTmp.find(x => x.id === id);
            const off = !f;
            const horas = f || (this._turnosApagados || {})[id] || {};
            const n = Math.max(1, Number(horas.n) || 1);
            return `<div class="lg-turno${off ? ' off' : ''}">
                <button class="lg-turno-sw" onclick="app._alternarTurnoLugar('${id}')">
                    <span class="lg-turno-marca">${off ? '' : '✓'}</span>${nombres[id]}</button>
                <div class="edit-field"><label>Desde</label>
                    <input type="time" value="${horas.desde || ''}" ${off ? 'disabled' : ''}
                           onchange="app._editarTurno('${id}','desde',this.value)"></div>
                <div class="edit-field"><label>Hasta</label>
                    <input type="time" value="${horas.hasta || ''}" ${off ? 'disabled' : ''}
                           onchange="app._editarTurno('${id}','hasta',this.value)"></div>
            </div>`
            // Cuánta gente hace falta para darlo por cubierto: en Control son
            // dos por la mañana y dos por la tarde.
            + (off ? '' : `<div class="lg-cuantos">
                <button onclick="app._cuantosTurno('${id}',-1)">−</button>
                <span><b>${n}</b> ${n === 1 ? 'persona' : 'personas'} para cubrirlo</span>
                <button onclick="app._cuantosTurno('${id}',1)">+</button>
            </div>`);
        }).join('');
    },

    _cuantosTurno(id, paso) {
        const f = this._turnosTmp.find(x => x.id === id);
        if (!f) return;
        f.n = Math.min(20, Math.max(1, (Number(f.n) || 1) + paso));
        this._renderTurnosLugar();
    },

    _alternarTurnoLugar(id) {
        this._turnosApagados = this._turnosApagados || {};
        const i = this._turnosTmp.findIndex(x => x.id === id);
        if (i !== -1) {
            // Al apagarlo se guardan sus horas: si vuelve, vuelve como estaba
            this._turnosApagados[id] = { ...this._turnosTmp[i] };
            this._turnosTmp.splice(i, 1);
        } else {
            const previo = this._turnosApagados[id];
            const [desde, hasta] = this.TURNOS_POR_DEFECTO[id];
            this._turnosTmp.push(previo && previo.desde && previo.hasta
                ? { id, desde: previo.desde, hasta: previo.hasta, n: previo.n || 1 }
                : { id, desde, hasta, n: 1 });
            // Que queden en el orden de siempre: mañana, tarde y noche
            this._turnosTmp.sort((a, b) => 'MTN'.indexOf(a.id) - 'MTN'.indexOf(b.id));
        }
        this._renderTurnosLugar();
    },

    _editarTurno(id, campo, valor) {
        const f = this._turnosTmp.find(x => x.id === id);
        if (!f) return;               // apagado: no hay nada que escribir
        f[campo] = valor;
    },

    _ubicacionActualLugar() {
        const Geo = window.Capacitor?.Plugins?.Geolocation || navigator.geolocation;
        if (!Geo) { this._mostrarToast('Sin acceso a la ubicación', 3000); return; }
        const poner = c => {
            const lat = c.coords?.latitude ?? c.latitude;
            const lng = c.coords?.longitude ?? c.longitude;
            if (!document.getElementById('lgRadio').value) document.getElementById('lgRadio').value = 150;
            this._ponerCoords(lat, lng);
            this._mapa?.setView([lat, lng], 17);
            this._moverMarcador(lat, lng);
            this._mostrarToast('📍 Ubicación tomada', 2500);
        };
        if (Geo.getCurrentPosition.length === 0) Geo.getCurrentPosition().then(poner).catch(() => this._mostrarToast('No se pudo obtener la ubicación', 3000));
        else Geo.getCurrentPosition(poner, () => this._mostrarToast('No se pudo obtener la ubicación', 3000), { enableHighAccuracy: true });
    },

    async _enviarLugar(cuerpo, metodo) {
        try {
            const resp = await fetch(LUGARES_URL, {
                method: metodo,
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify(cuerpo)
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return false; }
            if (metodo === 'PUT' && cuerpo.nombre) {
                const k = this._clavePuesto(cuerpo.nombre);
                const local = this._catalogoLocal();
                local[k] = { ...(local[k] || {}), ...cuerpo };
                try { localStorage.setItem('lugaresCatalogo', JSON.stringify(local)); } catch (_) {}
            } else if (metodo === 'DELETE' && cuerpo.nombre) {
                const local = this._catalogoLocal();
                delete local[this._clavePuesto(cuerpo.nombre)];
                try { localStorage.setItem('lugaresCatalogo', JSON.stringify(local)); } catch (_) {}
            }
            this._guardarCatalogo(this._mezclarCatalogo(data));
            document.getElementById('lugarModal').classList.remove('show');
            this._renderLugares();
            this._renderConductores();
            return true;
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); return false; }
    },

    async _guardarLugar() {
        const nombre = document.getElementById('lgNombre').value.trim();
        if (!nombre) { this._mostrarToast('Ponle un nombre al lugar', 3000); return; }
        const lat = this._leerDecimal(document.getElementById('lgLat').value);
        const lng = this._leerDecimal(document.getElementById('lgLng').value);
        const cuerpo = {
            nombre,
            turnos: this._turnosTmp
                .filter(f => f.desde && f.hasta && f.desde !== f.hasta)
                .map(f => ({ ...f, n: Math.min(20, Math.max(1, Number(f.n) || 1)) })),
            dias: this._diasTmp.slice().sort(),
            ubicacion: (lat !== null && lng !== null)
                ? { lat, lng, radio: this._leerDecimal(document.getElementById('lgRadio').value) || 150 }
                : null,
            prioridad: this._leerDecimal(document.getElementById('lgPrio').value) || 0,
        };
        if (await this._enviarLugar(cuerpo, 'PUT')) this._mostrarToast(`✅ ${nombre} guardado`, 2500);
    },

    async _borrarLugar() {
        const k = this._lugarEditando;
        if (!k) { document.getElementById('lugarModal').classList.remove('show'); return; }
        if (!confirm('¿Borrar este lugar del catálogo?')) return;
        if (await this._enviarLugar({ nombre: k }, 'DELETE')) this._mostrarToast('Lugar borrado', 2500);
    },

    ordenarPrueba(modo) {
        localStorage.setItem('ordenPrueba', modo);
        this._renderPrueba();
    },

    // ── Bajas (BE) ──────────────────────────────────────────────────────────
    // Una baja es un tramo con fecha, no un interruptor: hace falta saber qué
    // días estuvo fuera para descontarle las horas que no pudo hacer.

    ANUALES_COMPLETA: 1700,
    HORAS_BAJA: 3.5,

    _bajasDe(u) { return Array.isArray(u?.bajas) ? u.bajas : []; },

    _enBaja(u, fecha) {
        return this._bajasDe(u).some(b => b.d <= fecha && (!b.h || b.h >= fecha));
    },

    // Días de baja de lunes a viernes dentro del año, que son los que habría
    // trabajado. Se corta en hoy: los días futuros aún no ha dejado de hacerlos.
    _diasBaja(u, hasta) {
        const anio = hasta.slice(0, 4);
        const conDias = Array.isArray(u?.dias) && u.dias.length > 0;
        const dias = new Set();
        this._bajasDe(u).forEach(b => {
            const fin = (!b.h || b.h > hasta) ? hasta : b.h;
            const d = new Date(+b.d.slice(0,4), +b.d.slice(4,6) - 1, +b.d.slice(6,8), 12);
            const f = new Date(+fin.slice(0,4), +fin.slice(4,6) - 1, +fin.slice(6,8), 12);
            for (let i = 0; d <= f && i < 400; d.setDate(d.getDate() + 1), i++) {
                const k = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
                // Solo cuentan los días que le tocaban: si libra ese día, no
                // ha dejado de hacer ninguna hora por estar de baja. De quien
                // no ha declarado sus días no se sabe el patrón, así que se
                // sigue contando de lunes a viernes como hasta ahora.
                if (conDias) { if (!this._trabajaEseDia(u, k)) continue; }
                else if (d.getDay() === 0 || d.getDay() === 6) continue;
                if (k.slice(0, 4) === anio) dias.add(k);
            }
        });
        return dias.size;
    },

    // ── Vacaciones (VC) ─────────────────────────────────────────────────────
    // Las pone el trabajador desde su app o el gestor desde aquí; el endpoint
    // se queda con el cambio más reciente.

    _vacacionesDe(u) { return Array.isArray(u?.vacaciones) ? u.vacaciones : []; },

    // El día llega como YYYYMMDD y los rangos van en ISO
    // Días de la semana que le tocan. Sin lista, se entiende que cualquiera.
    _trabajaEseDia(u, fecha) {
        const dias = Array.isArray(u?.dias) && u.dias.length ? u.dias : null;
        if (!dias) return true;
        const d = new Date(+fecha.slice(0,4), +fecha.slice(4,6) - 1, +fecha.slice(6,8), 12).getDay();
        return dias.includes(d);
    },

    _enVacaciones(u, fecha) {
        const iso = `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)}`;
        return this._vacacionesDe(u).some(v => v.desde <= iso && v.hasta >= iso);
    },

    _diasVacaciones(u, anio) {
        let n = 0;
        this._vacacionesDe(u).forEach(v => {
            const d = new Date(v.desde + 'T12:00:00'), f = new Date(v.hasta + 'T12:00:00');
            for (let i = 0; d <= f && i < 400; d.setDate(d.getDate() + 1), i++) {
                if (String(d.getFullYear()) === anio) n++;
            }
        });
        return n;
    },

    editarVacaciones(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._vacEditando = email;
        this._vacTmp = this._vacacionesDe(u).map(v => ({ ...v }));
        document.getElementById('vacQuien').textContent =
            `${u.conductor ? u.conductor + ' · ' : ''}${u.nombre || email}`;
        this._renderVacacionesGestor();
        document.getElementById('vacModal').classList.add('show');
        if (this.darkMode) document.getElementById('vacModalContent').classList.add('dark');
    },

    _renderVacacionesGestor() {
        const cont = document.getElementById('vacLista');
        cont.innerHTML = this._vacTmp.map((v, i) => `<div class="baja-fila">
                <label>Desde<input type="date" value="${v.desde || ''}"
                    onchange="app._editarVac(${i},'desde',this.value)"></label>
                <label>Hasta<input type="date" value="${v.hasta || ''}"
                    onchange="app._editarVac(${i},'hasta',this.value)"></label>
                <button class="baja-x" onclick="app._quitarVac(${i})">×</button>
            </div>`).join('')
            || '<div class="baja-vacio">Sin vacaciones registradas</div>';
        const dias = this._diasVacaciones({ vacaciones: this._vacTmp }, String(new Date().getFullYear()));
        document.getElementById('vacResumen').textContent = dias
            ? `${dias} día${dias === 1 ? '' : 's'} este año`
            : 'Los tramos que añadas le llegan a su app';
    },

    _editarVac(i, campo, valor) {
        if (!this._vacTmp[i]) return;
        this._vacTmp[i][campo] = valor;
        this._renderVacacionesGestor();
    },

    _quitarVac(i) { this._vacTmp.splice(i, 1); this._renderVacacionesGestor(); },

    _nuevaVac() {
        const hoy = new Date().toISOString().slice(0, 10);
        this._vacTmp.push({ desde: hoy, hasta: hoy });
        this._renderVacacionesGestor();
    },

    async _guardarVacaciones() {
        const email = this._vacEditando;
        const vacaciones = this._vacTmp
            .filter(v => v.desde && v.hasta && v.hasta >= v.desde)
            .sort((a, b) => a.desde.localeCompare(b.desde));
        document.getElementById('vacModal').classList.remove('show');
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, vacaciones })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(vacaciones.length
                ? `🏖️ ${vacaciones.length} tramo${vacaciones.length === 1 ? '' : 's'} de vacaciones`
                : 'Sin vacaciones', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    editarBajas(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._bajaEditando = email;
        this._bajasTmp = this._bajasDe(u).map(b => ({ ...b }));
        document.getElementById('bajaQuien').textContent =
            `${u.conductor ? u.conductor + ' · ' : ''}${u.nombre || email}`;
        this._renderBajas();
        document.getElementById('bajaModal').classList.add('show');
        if (this.darkMode) document.getElementById('bajaModalContent').classList.add('dark');
    },

    _renderBajas() {
        const cont = document.getElementById('bajaLista');
        const iso = v => v ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : '';
        cont.innerHTML = this._bajasTmp.map((b, i) => `<div class="baja-fila">
                <label>Desde<input type="date" value="${iso(b.d)}"
                    onchange="app._editarBaja(${i},'d',this.value)"></label>
                <label>Hasta<input type="date" value="${iso(b.h)}"
                    onchange="app._editarBaja(${i},'h',this.value)"></label>
                <button class="baja-x" onclick="app._quitarBaja(${i})">×</button>
            </div>`).join('')
            || '<div class="baja-vacio">Sin bajas registradas</div>';
        const u = (this._conductores || {})[this._bajaEditando] || {};
        const anual = u.horasAnuales || 777;
        const h = anual >= this.ANUALES_COMPLETA ? (u.jornadaHoras || 7) : this.HORAS_BAJA;
        const dias = this._diasBajaTmp();
        document.getElementById('bajaResumen').textContent = dias
            ? `${dias} día${dias === 1 ? '' : 's'} suyos · −${(dias * h).toFixed(1).replace('.', ',')}h de su objetivo`
            : 'Deja "Hasta" en blanco si sigue de baja';
    },

    _diasBajaTmp() {
        const u = (this._conductores || {})[this._bajaEditando] || {};
        return this._diasBaja({ ...u, bajas: this._bajasTmp }, this._fechaOffset(0));
    },

    _editarBaja(i, campo, valor) {
        if (!this._bajasTmp[i]) return;
        this._bajasTmp[i][campo] = String(valor || '').replace(/-/g, '');
        this._renderBajas();
    },

    _quitarBaja(i) { this._bajasTmp.splice(i, 1); this._renderBajas(); },

    _nuevaBaja() {
        this._bajasTmp.push({ d: this._fechaOffset(0), h: '' });
        this._renderBajas();
    },

    async _guardarBajas() {
        const email = this._bajaEditando;
        const bajas = this._bajasTmp.filter(b => /^\d{8}$/.test(b.d) && (!b.h || b.h >= b.d));
        document.getElementById('bajaModal').classList.remove('show');
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, bajas })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(bajas.length ? `✅ ${bajas.length} tramo${bajas.length === 1 ? '' : 's'} de baja` : 'Sin bajas', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    _editarPuesto(email, fecha) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        this._puestoEditando = email;
        this._fechaEditando  = /^\d{8}$/.test(String(fecha || '')) ? fecha : this._fechaOffset(0);
        this._lugarElegido   = null;
        const hoy = this._fechaEditando === this._fechaOffset(0);
        document.getElementById('puestoModalQuien').textContent =
            `${u.conductor ? u.conductor + ' · ' : ''}${u.nombre || email}`
            + (hoy ? '' : ` · ${this._fechaEditando.slice(6,8)}/${this._fechaEditando.slice(4,6)}/${this._fechaEditando.slice(0,4)}`);
        this._renderPuestoModal();
        document.getElementById('puestoModal').classList.add('show');
        if (this.darkMode) document.getElementById('puestoModalContent').classList.add('dark');
    },

    _renderPuestoModal() {
        const u = (this._conductores || {})[this._puestoEditando] || {};
        const fecha = this._fechaEditando;
        const actual = this._clavePuesto(this._lugarDe(u, fecha, this._jornadaDe(u, fecha)));
        // Los definidos más los que ya se usen y no estén en la tabla
        const usados = [...new Set(Object.values(this._conductores || {})
            .flatMap(x => [x.puesto || '', ...Object.values(x.lugares || {})])
            .map(v => v.trim()).filter(Boolean))];
        const todos = [...PUESTOS_DEFINIDOS];
        usados.forEach(p => {
            if (!todos.some(d => this._clavePuesto(d) === this._clavePuesto(p))) todos.push(p);
        });
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const cont = document.getElementById('puestoModalLista');
        cont.innerHTML = todos.map(p => {
            const fr = TURNOS_POR_PUESTO[this._clavePuesto(p)];
            const detalle = fr
                ? fr.map(f => `${f.id} ${f.desde}–${f.hasta}`).join(' · ')
                : 'sin turnos definidos';
            const sel = this._clavePuesto(p) === actual;
            return `<div class="pm-op${sel ? ' sel' : ''}" onclick="app._elegirAlcance('${esc(p).replace(/'/g, "\\'")}')">
                <div style="flex:1;min-width:0;">${esc(p)}<br><span class="pm-turnos">${esc(detalle)}</span></div>
                ${sel ? '<span class="pm-check">✓</span>' : ''}
            </div>`;
        }).join('')
        + `<div class="pm-op pm-nuevo" onclick="app._nuevoPuesto()">➕ Crear lugar nuevo…</div>`
        + (actual ? `<div class="pm-op pm-quitar" onclick="app._elegirAlcance('')">✕ Quitar el lugar</div>` : '');
    },

    // Tramos posibles a partir del día de referencia. La semana empieza en lunes.
    _tramos() {
        const f = this._fechaEditando;
        const d = new Date(+f.slice(0,4), +f.slice(4,6) - 1, +f.slice(6,8), 12);
        const clave = x => `${x.getFullYear()}${String(x.getMonth()+1).padStart(2,'0')}${String(x.getDate()).padStart(2,'0')}`;
        const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
        const primero = new Date(d.getFullYear(), d.getMonth(), 1, 12);
        const ultimo  = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
        const hoy = f === this._fechaOffset(0);
        return [
            { id:'dia',    titulo: hoy ? 'Solo hoy' : 'Solo ese día',
              detalle: `${f.slice(6,8)}/${f.slice(4,6)}`, desde: f, hasta: f },
            { id:'semana', titulo: hoy ? 'Esta semana' : 'Esa semana',
              detalle: `${clave(lunes).slice(6,8)}/${clave(lunes).slice(4,6)} – ${clave(domingo).slice(6,8)}/${clave(domingo).slice(4,6)}`,
              desde: clave(lunes), hasta: clave(domingo) },
            { id:'mes',    titulo: hoy ? 'Este mes' : 'Ese mes',
              detalle: `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`,
              desde: clave(primero), hasta: clave(ultimo) },
            { id:'siempre', titulo: 'Siempre',
              detalle: 'Pasa a ser su lugar habitual y borra las excepciones' },
        ];
    },

    _elegirAlcance(lugar) {
        this._lugarElegido = lugar;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        document.getElementById('puestoModalLista').innerHTML =
            `<div class="pm-paso">${lugar ? `Poner <b>${esc(lugar)}</b>` : 'Quitar el lugar'} · ¿para cuándo?</div>`
            + this._tramos().map(t => `<div class="pm-op" onclick="app._aplicarLugar('${t.id}')">
                    <div style="flex:1;min-width:0;">${esc(t.titulo)}<br><span class="pm-turnos">${esc(t.detalle)}</span></div>
                </div>`).join('')
            + `<div class="pm-op pm-volver" onclick="app._renderPuestoModal()">‹ Elegir otro lugar</div>`;
    },

    _nuevoPuesto() {
        const v = prompt('Nombre del lugar de trabajo nuevo:\n\nSin turnos definidos se usará el criterio general (mañana antes de las 13h).');
        if (v === null) return;
        const nombre = v.trim();
        if (!nombre) return;
        this._elegirAlcance(nombre);
    },

    async _aplicarLugar(alcance) {
        const email = this._puestoEditando;
        const lugar = this._lugarElegido ?? '';
        if (!email) return;
        const tramo = this._tramos().find(t => t.id === alcance);
        if (!tramo) return;
        document.getElementById('puestoModal').classList.remove('show');
        const cuerpo = { email, puesto: lugar };
        if (tramo.desde) { cuerpo.desde = tramo.desde; cuerpo.hasta = tramo.hasta; }
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify(cuerpo)
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast(lugar
                ? `✅ ${lugar} · ${tramo.titulo.toLowerCase()}`
                : `Lugar quitado · ${tramo.titulo.toLowerCase()}`, 3000);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
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
        if (keys.length === 0) { container.innerHTML = '<div style="text-align:center;color:#7f8c8d;font-size:12px;padding:8px;">Sin datos</div>'; return; }
        container.innerHTML = keys.map(k => {
            const m = meses[k];
            const barPct = Math.min((m.horas / (this.horasAnualesCustom / 12)) * 100, 100);
            return `<div class="mes-row">
                <div class="mes-label">${m.label}</div>
                <div class="mes-bar-wrap"><div class="mes-bar" style="width:${barPct}%"></div></div>
                <div class="mes-vals">
                    <span>${m.horas}h</span>
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
        const p = leerPersonal();
        if (TEMAS_APP[p.tema]) {
            // Con un tema, es su versión clara u oscura
            p.temaOscuro = this.darkMode;
            try { localStorage.setItem('personal', JSON.stringify(p)); } catch (_) {}
            aplicarPersonal(p);
        } else localStorage.setItem('darkMode', this.darkMode);
        this.darkMode ? this.aplicarDarkMode() : this.removerDarkMode();
        this._guardarPreferencias();
    },

    aplicarDarkMode() {
        document.body.classList.add('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#historialModalContent','#avatarModalContent',
         '#caRegModalContent','#caSalidaModalContent','#caVisModalContent','#caExpModalContent']
            .forEach(s => { const e = document.querySelector(s); if(e) e.classList.add('dark'); });
        document.querySelector('.container')?.classList.add('dark');
    },

    removerDarkMode() {
        document.body.classList.remove('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#historialModalContent','#avatarModalContent',
         '#caRegModalContent','#caSalidaModalContent','#caVisModalContent','#caExpModalContent']
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
        this._pintarPersonal();
        ['azul','verde','fuego','acero','rojo'].forEach(t => {
            const dot = document.getElementById('dot-' + t);
            if (dot) dot.classList.toggle('active', t === this.tema);
        });
    },

    guardarPrecioNoche() {
        const precio = parseFloat(document.getElementById('precioNocheGlobal')?.value) || 0;
        this.precioNocheDefault = precio;
        localStorage.setItem('precioNoche', precio);
        this._guardarPreferencias();
    },

    async mostrarCambiarHoras() {
        const v = prompt('¿Cuántas horas quieres trabajar al año?', this.horasAnualesCustom);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        this.horasAnualesCustom = n;
        localStorage.setItem('horasAnuales', String(n));
        { const e = document.getElementById('horasAnualesDisplay'); if (e) e.textContent = n + 'h'; }
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
            container.innerHTML = '<div style="font-size:12px;color:#7f8c8d;padding:4px 0;">Sin ubicaciones guardadas</div>';
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
        if (!document.getElementById('workBanner')) return;
        const locs = this._getWorkLocations();
        if (locs.length === 0 || !navigator.geolocation) return;
        if (this.gpsMode === 'off') return;
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) return;
        const todayId = this._hoyId();
        if (localStorage.getItem('lastRegisteredDate') === todayId) return;
        if (this._historialFull[todayId]) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            const cercano = locs.some(loc =>
                this.calcularDistancia(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lng) < 300);
            if (cercano) {
                document.getElementById('workBanner').classList.add('show');
                this._enviarNotificacionTrabajo();
            }
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
                    title: '📍 Gestión EMT - Movilidad',
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
            reg.showNotification('📍 Gestión EMT - Movilidad', {
                body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'trabajo-cercano', requireInteraction: true,
                actions: [{ action: 'abrir', title: 'Abrir app' }]
            });
        } catch(_) {
            new Notification('📍 Gestión EMT - Movilidad', { body: 'Parece que estás en el trabajo.', icon: '/icons/icon-192.png' });
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
                backgroundTitle: 'Gestión EMT - Movilidad',
                requestPermissions: true,
                stale: false,
                distanceFilter: 200
            }, (location, error) => {
                if (error || !location) return;
                const ahora = Date.now();
                if (ahora - this._lastGeoCheck < this.gpsInterval * 60 * 1000) return;
                this._lastGeoCheck = ahora;
                const todayId = this._hoyId();
                if (localStorage.getItem('lastRegisteredDate') === todayId) return;
                if (this._historialFull[todayId]) return;
                const locs = this._getWorkLocations();
                if (locs.length === 0) return;
                const cercano = locs.some(loc =>
                    this.calcularDistancia(location.latitude, location.longitude, loc.lat, loc.lng) < 300
                );
                if (cercano) {
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
                title: '📍 Gestión EMT - Movilidad',
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

        if (nativo) {
            const marca = this._marcaBateria();
            if (marca) L.push(`📱 Móvil ${marca.nombre}: si con la app cerrada no llegan, ${marca.pasos}`);
            let tokenPush = '';
            try { tokenPush = window.AndroidBridge?.pushToken?.() || ''; } catch (_) {}
            L.push(tokenPush ? '✅ Avisos al instante activados en este móvil'
                             : '⚠️ Avisos al instante aún sin activar\n   → Actualiza la app y vuelve a abrirla');
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
                    title: '🔔 Gestión EMT - Movilidad — prueba',
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
            await reg.showNotification('🔔 Gestión EMT - Movilidad — prueba', {
                body: 'Las notificaciones funcionan correctamente.',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'test-notif'
            });
        } catch(_) {
            new Notification('🔔 Gestión EMT - Movilidad — prueba', { body: 'Las notificaciones funcionan correctamente.', icon: '/icons/icon-192.png' });
        }
    },

    _getPreferencias() {
        return {
            darkMode: localStorage.getItem('darkMode') === 'true',
            tema: this.tema,
            avatarEmoji: localStorage.getItem('avatarEmoji') || null,
            avatarBg: localStorage.getItem('avatarBg') || null,
            avatarPhoto: localStorage.getItem('avatarPhoto') || null,
            gpsMode: this.gpsMode,
            gpsInterval: this.gpsInterval,
            gpsScheduleFrom: this.gpsScheduleFrom,
            gpsScheduleTo: this.gpsScheduleTo,
            precioNocheDefault: this.precioNocheDefault,
            horasAnualesCustom: this.horasAnualesCustom,
            jornadaHoras: this.jornadaHoras,
            numConductor: this.numConductor,
            backupFreq: this.backupFreq,
            vacaciones: this._getVacaciones(),
            workLocations: this._getWorkLocations(),
            notifSound: this.notifSound
        };
    },

    _aplicarPreferenciasDesde(prefs) {
        if (prefs.darkMode !== undefined && prefs.darkMode !== this.darkMode && !TEMAS_APP[leerPersonal().tema]) {
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
        window.AndroidBridge?.saveToPrefs('gpsScheduleFrom', from);
        window.AndroidBridge?.saveToPrefs('gpsScheduleTo', to);
        this._renderGpsSettings();
        this._updateGpsState();
        this._guardarPreferencias();
    },

    _renderGpsSettings() {
        if (!document.getElementById('gpsIntervalSelect')) return;
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
            ...SONIDOS.slice(7).map(s => ({ id: s.id, name: s.nombre, sound: s.id })),
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

    // A management app must not fall open: if the list cannot be read, only the
    // gestor gets in. That check runs first and needs no network, so an outage
    // can never lock the gestor out.
    async _checkUserAuthorized(email) {
        if (email.toLowerCase() === SUPER_USER_EMAIL.toLowerCase()) return true;
        // En la app de desarrollador no entra nadie más. Comparte código con
        // la de gestión, así que hasta ahora dejaba pasar a cualquiera de la
        // lista de gestión: se entraba con otra cuenta sin darse cuenta y la
        // app salía a medias, que es lo que pasó.
        if (ES_APP_DEV) return false;
        try {
            const resp = await fetch('https://emt-palma-movilidad.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) return false;
            const allowed = await resp.json();
            if (!Array.isArray(allowed)) return false;
            return allowed.map(e => e.toLowerCase()).includes(email.toLowerCase());
        } catch(e) { return false; }
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
                if (ES_APP_DEV) return { ok: true, build: null };
                const build = (await r.json())?.gestion ?? null;
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
            const soyGestor = this._recibeTodasLasVersiones();
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
        // La de desarrollador va siempre por APK: no se sirve en la web.
        if (ES_APP_DEV) return false;
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
        // El cartel de abajo se queda en los dos casos: si se ha descargado
        // el APK y algo ha fallado, sigue teniendo el botón a mano.
        try { window._ofrecerInstalarSiToca?.(); } catch (_) {}
        if (modo === 'instalada') this._abrirAppInstalada();
        else if (modo === 'apk') this.instalarApp();
    },

    // El desarrollador recibe la última versión nada más salir en cualquiera
    // de las apps, no solo en la suya. Si aún no ha terminado de entrar, vale
    // la cuenta guardada de la última vez.
    _recibeTodasLasVersiones() {
        if (ES_APP_DEV) return true;
        const yo = String(this.usuarioActual?.email || localStorage.getItem('gUserEmail') || '').toLowerCase();
        return yo === SUPER_USER_EMAIL.toLowerCase();
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
            // El gestor siempre ve la última, para poder probarla antes de
            // soltársela a los demás; el resto reciben la que él haya
            // publicado en "Versión para gestión". Esto ya existía y hubo que
            // quitarlo porque no había forma de publicar ninguna: los demás se
            // quedaban clavados para siempre en una versión que nunca llegaba
            // a apuntarse. Ahora se publica desde ahí, y mientras no se
            // publique ninguna todos reciben la más reciente, que es lo que
            // hacía falta para no volver a dejar a nadie tirado.
            const soyGestor = this._recibeTodasLasVersiones();
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
    // Cerrada con la ×: se aparta un tiempo
    try {
        if (Date.now() < parseInt(localStorage.getItem('bannerCerradoHasta') || '0', 10)) return false;
    } catch (_) {}
    if (_isStandalone) return false;
    for (const id of ['rolScreen', 'gestionScreen', 'modoScreen']) {
        const p = document.getElementById(id);
        if (p && getComputedStyle(p).display !== 'none') return false;
    }
    return !!(typeof app !== 'undefined' && app?.usuarioActual?.email);
}

// En el navegador, Ajustes → Aplicación deja descargar la última versión
// siempre; dentro de la aplicación instalada no sale (allí está "Comprobar
// actualizaciones")
if (!_enLaApp()) { const sec = document.getElementById('installSection'); if (sec) sec.style.display = ''; }

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
    // Quien ya la ha descargado no necesita que se le siga ofreciendo
    try { localStorage.setItem('bannerCerradoHasta', String(Date.now() + 30 * 24 * 3600 * 1000)); } catch (_) {}
    document.getElementById('installBanner')?.classList.remove('show');
    window.location.href = apk.url;
};
// Cerrarlo con la × lo aparta una semana; decir que ya se tiene, para siempre
app.ocultarInstallBanner = function() {
    const b = document.getElementById('installBanner'); if (b) b.classList.remove('show');
    try { localStorage.setItem('bannerCerradoHasta', String(Date.now() + 7 * 24 * 3600 * 1000)); } catch (_) {}
};
app.yaLaTengo = function() {
    try { localStorage.setItem('modoUso', 'instalada'); } catch (_) {}
    const b = document.getElementById('installBanner'); if (b) b.classList.remove('show');
    app._mostrarToast?.('👍 No se te volverá a ofrecer. Ábrela desde su icono.', 3500);
};
