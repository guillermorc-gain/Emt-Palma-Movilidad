import { emailDelToken, tokenDe, esGestor, GESTOR_PRINCIPAL } from './_auth.js';
import { hayBaseDeDatos, leerNotas, leerNota, guardarNota, borrarNota } from './_almacen.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';
import { registrarPush, avisarChat, estadoPush } from './_push.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'notas.json';
const MAX_TEXTO    = 500;
const MAX_NOTAS    = 400;   // las más viejas se van cayendo
// Una nota para toda la plantilla son tantas conversaciones como gente
const MAX_DESTINOS = 120;
// Un adjunto va como data URL dentro del JSON, así que hay que acotarlo por
// las dos puntas: lo que ocupa uno y lo que ocupan todos juntos.
//
// Guardando en el repo el techo es duro: la API de contenidos de GitHub no
// escribe ficheros de más de 1 MB, así que en cuanto el fichero lo pasaba
// dejaban de entrar mensajes —se guardaban en la app y desaparecían al
// recargar— sin que nada lo dijera. Con base de datos eso no pasa y caben
// adjuntos de verdad.
const EN_BASE = () => hayBaseDeDatos();
// Solo cuenta para las fotos que se mandaron cuando se podía: mientras no
// quepan, las conversaciones viejas las van soltando.
const TOTAL_ADJUNTOS = () => EN_BASE() ? 12 * 1024 * 1024 : 700 * 1024;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

// GitHub no manda el contenido en esta llamada cuando el fichero pasa de 1 MB:
// responde 200 con content vacío. Sin mirarlo, el fichero entero se leía como
// "no hay nada" y la siguiente escritura se llevaba por delante a todos. Así
// que por encima de ese tamaño se pide el contenido en bruto, y cualquier
// lectura que falle revienta en vez de devolver un vacío que parece legítimo.
async function leerContenido(meta) {
  if (meta.content) return Buffer.from(meta.content, 'base64').toString('utf8');
  if (!meta.size) return '';
  // Por la URL de la API, no por download_url: la de la API respeta el token
  // siempre, y la otra es una firma temporal que puede haber caducado.
  const r = await fetch(meta.url || meta.download_url, {
    headers: { ...ghHeaders(), Accept: 'application/vnd.github.raw' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('No se pudo leer el fichero completo: ' + r.status);
  return r.text();
}

async function getFile() {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' }
  );
  if (r.status === 404) return { data: {}, sha: null };   // aún no existe
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + FILE_PATH);
  const meta = await r.json();
  const texto = await leerContenido(meta);
  if (!texto.trim()) return { data: {}, sha: meta.sha };
  const parsed = JSON.parse(texto);
  return { data: parsed && typeof parsed === 'object' ? parsed : {}, sha: meta.sha };
}

async function setFile(data, sha, mensaje) {
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
  const body = { message: mensaje, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.status;
}

// Dos apps escriben aquí a la vez; con 409 se vuelve a leer y se reintenta.
async function guardarConReintento(mutar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();
    const nuevo = mutar(data);
    if (!nuevo) return null;
    const status = await setFile(nuevo, sha, mensaje);
    if (status >= 200 && status < 300) return nuevo;
    if (status !== 409) return null;
  }
  return null;
}

const texto = t => String(t ?? '').trim().slice(0, MAX_TEXTO);
// El emoji de un grupo: uno solo (con sus modificadores), o el de siempre
const limpiarEmoji = e => {
  const s = String(e ?? '').trim();
  return s && [...s].length <= 10 && /^[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f\u20e3\u{1F3FB}-\u{1F3FF}]+$/u.test(s) ? s : '👥';
};
// A los usuarios de prueba no se les escribe: no hay nadie detrás
const esDePrueba = e => String(e || '').toLowerCase().endsWith('@prueba.local');

// Ya no se aceptan adjuntos nuevos: solo texto. Lo que se mandó cuando sí se
// podía se sigue leyendo y enseñando, hasta que el recorte por tamaño se lo
// lleve; de ahí que sigan estando lo de medirlos y soltarlos.


const pesaAdjuntos = n => (n.mensajes || [])
  .flatMap(m => m.adjuntos || [])
  .reduce((s, a) => s + (a.datos?.length || 0), 0);

// Guardando en el repo hay un techo duro: la API de contenidos de GitHub no
// escribe por encima de 1 MB. Se deja margen y se mide el fichero de verdad,
// no solo la suma de los adjuntos, porque lo que revienta es el conjunto.
const LIMITE_FICHERO = 900 * 1024;

const sinAdjuntos = n => ({ ...n, adjuntosPurgados: true,
  mensajes: (n.mensajes || []).map(m => ({ ...m, adjuntos: [] })) });

// Si el fichero se va de tamaño, las notas viejas pierden los adjuntos pero
// conservan el texto: es lo que de verdad hace falta guardar.
function acotarAdjuntos(data) {
  const viejasPrimero = Object.keys(data)
    .sort((a, b) => (data[a].creado || '').localeCompare(data[b].creado || ''));
  let total = viejasPrimero.reduce((s, id) => s + pesaAdjuntos(data[id]), 0);
  const tope = TOTAL_ADJUNTOS();
  const out = { ...data };
  for (const id of viejasPrimero) {
    if (total <= tope) break;
    const peso = pesaAdjuntos(out[id]);
    if (!peso) continue;
    out[id] = sinAdjuntos(out[id]);
    total -= peso;
  }
  if (EN_BASE()) return out;
  // Y ahora por tamaño real: mientras no quepa, las más viejas con adjuntos
  // los sueltan. El texto se queda siempre.
  for (const id of viejasPrimero) {
    if (JSON.stringify(out).length <= LIMITE_FICHERO) break;
    if (!pesaAdjuntos(out[id])) continue;
    out[id] = sinAdjuntos(out[id]);
  }
  return out;
}

// Se guardan las MAX_NOTAS más nuevas. Primero se van las viejas ya vistas o
// archivadas; las que están sin ver se respetan mientras se pueda. Si aun así
// no bajan del tope —una nota a toda la plantilla son muchas de golpe— caen
// las más antiguas de todos modos: pasarse de tamaño es peor, porque entonces
// no entra ningún mensaje nuevo.
function recortar(data) {
  const ids = Object.keys(data);
  if (ids.length <= MAX_NOTAS) return data;
  const orden = ids.sort((a, b) => (data[a].creado || '').localeCompare(data[b].creado || ''));
  const sobran = orden.length - MAX_NOTAS;
  const out = { ...data };
  let quitadas = 0;
  const protegida = id => !out[id].archivada && out[id].tipo !== 'companero'
    && out[id].estado === 'pendiente';
  for (const vuelta of [true, false]) {
    for (const id of orden) {
      if (quitadas >= sobran) return out;
      if (!out[id]) continue;
      if (vuelta && protegida(id)) continue;
      delete out[id];
      quitadas++;
    }
  }
  return out;
}

// Antes una nota se aceptaba o se denegaba. Ahora solo se da por vista, y da
// igual quién de los dos la dé: el otro lo ve. Lo que se aceptó en su día se
// lee como visto; lo denegado vuelve a pendiente, que es lo único que queda.
const ESTADO = e => (e === 'visto' || e === 'ok') ? 'visto' : 'pendiente';

// Quién está en cada conversación, dicho igual para todos los tipos: cada
// uno con su correo, su nombre y su número, y gestión como un participante
// más ({ gestion: true }). Así las apps pueden decir siempre quién escribe y
// a quién, en vez de adivinarlo por el tipo de conversación.
//   · gestion:   el trabajador (email) y gestión
//   · companero: quien empezó (deEmail) y quien recibe (email)
//   · grupo:     los que se eligieron, más gestión si se la eligió
function participantesDe(n) {
  if (n.tipo === 'grupo') {
    const ps = (Array.isArray(n.participantes) ? n.participantes : []).filter(p => p && p.email);
    return n.conGestion ? [...ps, { gestion: true, nombre: 'Gestión' }] : ps;
  }
  if (n.tipo === 'companero') {
    return [{ email: (n.deEmail || '').toLowerCase(), nombre: n.deNombre || '', num: n.deConductor || '' },
            { email: (n.email || '').toLowerCase(), nombre: n.nombre || '', num: n.conductor || '' }];
  }
  return [{ email: (n.email || '').toLowerCase(), nombre: n.nombre || '', num: n.conductor || '' },
          { gestion: true, nombre: 'Gestión' }];
}
const enGrupo = (n, quien) => n.tipo === 'grupo'
  && (n.participantes || []).some(p => (p.email || '').toLowerCase() === quien);

// Qué conversaciones ve cada uno: con correo, en las que participa; sin él
// (la bandeja de gestión), las que tienen a gestión dentro.
function laVe(n, quien) {
  if (quien) {
    if (n.tipo === 'grupo') return enGrupo(n, quien);
    return (n.email || '').toLowerCase() === quien || (n.deEmail || '').toLowerCase() === quien;
  }
  if (n.tipo === 'grupo') return !!n.conGestion;
  return n.tipo !== 'companero';
}

// Las conversaciones antiguas guardaban un texto y como mucho una respuesta.
// Se leen como lo que son: los dos primeros mensajes del hilo.
function normalizar(nota) {
  if (!nota) return nota;
  if (nota.estado !== ESTADO(nota.estado)) nota = { ...nota, estado: ESTADO(nota.estado) };
  if (Array.isArray(nota.mensajes)) return { ...nota, participantes: participantesDe(nota) };
  const mensajes = [];
  if (nota.texto || nota.adjuntos?.length) {
    mensajes.push({
      de: nota.de === 'gestor' ? 'gestor' : 'trabajador',
      autor: nota.de === 'gestor' ? (nota.gestor || 'Gestión') : (nota.deNombre || nota.nombre || ''),
      texto: nota.texto || '', adjuntos: nota.adjuntos || [], en: nota.creado,
    });
  }
  if (nota.respuesta?.texto || nota.respuesta?.adjuntos?.length) {
    mensajes.push({
      de: 'gestor', autor: nota.respuesta.gestor || 'Gestión',
      texto: nota.respuesta.texto || '', adjuntos: nota.respuesta.adjuntos || [],
      en: nota.respuesta.en || nota.creado,
    });
  }
  const { texto: _t, adjuntos: _a, respuesta: _r, ...resto } = nota;
  return { ...resto, mensajes, participantes: participantesDe(nota) };
}

// Al guardar, los participantes calculados no se guardan (salen solos al
// leer), salvo en los grupos, donde son la conversación misma.
const paraGuardar = n => {
  if (n.tipo === 'grupo') {
    return { ...n, participantes: (n.participantes || []).filter(p => p && p.email) };
  }
  const { participantes: _p, ...resto } = n;
  return resto;
};

// Quién puede escribir y tocar una conversación: los dos que hablan, y
// gestión en las que van dirigidas a ella. Que quien llama sea de gestión se
// comprueba fuera, que ahí se puede esperar a la respuesta.
function puedeTocar(nota, quien, deGestion = false) {
  if (!nota) return false;
  if (nota.tipo === 'grupo') return enGrupo(nota, quien) || (deGestion && !!nota.conGestion);
  if (deGestion) return nota.tipo !== 'companero' || nota.email === quien;
  return nota.email === quien || nota.deEmail === quien;
}

// Quien escribe en nombre de gestión: un gestor en una conversación de
// gestión en la que no está como persona. El desarrollador también es gestor,
// y cuando gestión le escribe a él, lo que contesta es suyo, no de gestión.
function escribeComoGestion(nota, quien, deGestion) {
  if (!deGestion || nota.tipo === 'companero') return false;
  if (nota.tipo === 'grupo') return !!nota.conGestion && !enGrupo(nota, quien);
  return (nota.email || '').toLowerCase() !== quien;
}

// Borrar un mensaje suelto, como en WhatsApp: el globo se queda, sin el texto,
// diciendo quién lo borró y cuándo. Solo lo borra quien lo escribió.
function borrarMensaje(nota, i, en, { quien, nombre, deGestion }) {
  const n = normalizar(nota);
  const m = n.mensajes[i];
  if (!m || (en && m.en !== en) || m.borrado || m.sistema) return { error: 'Ese mensaje ya no está', status: 404 };
  const suyo = (m.de || '').toLowerCase() === quien
    || (m.de === 'gestor' && escribeComoGestion(n, quien, deGestion))
    || (m.de === 'trabajador' && n.tipo !== 'grupo' && (n.email || '').toLowerCase() === quien);
  if (!suyo) return { error: 'Solo puedes borrar tus mensajes', status: 403 };
  const mensajes = n.mensajes.slice();
  mensajes[i] = { de: m.de, autor: m.autor, en: m.en, texto: '', adjuntos: [],
                  borrado: { nombre: String(nombre || m.autor || '').slice(0, 80), en: new Date().toISOString() } };
  return { nota: { ...n, mensajes } };
}

// Avisar al instante a los que están en la conversación (ver _push.js).
// Gestión cuenta si está dentro y no es ella la que escribe.
const avisarDe = (nota, quien, comoGestion) => {
  const ps = participantesDe(nota);
  return avisarChat({ id: nota.id, quien, emails: ps.filter(p => p.email).map(p => p.email),
                      aGestion: !comoGestion && ps.some(p => p.gestion) });
};

// El visto vale para lo que hay dicho hasta ese momento: en cuanto alguien
// escribe otra vez, la conversación vuelve a estar sin ver.
function añadirMensaje(nota, { de, autor, cuerpo, adjuntos }) {
  const n = normalizar(nota);
  const { vistoPor: _v, ...resto } = n;
  const en = new Date().toISOString();
  const leidos = n.tipo === 'grupo'
    ? { ...(n.leidos || {}), [de === 'gestor' ? 'gestion' : String(de).toLowerCase()]: { nombre: String(autor || '').slice(0, 80), en } }
    : n.leidos;
  return { ...resto, ...(leidos ? { leidos } : {}), estado: 'pendiente', mensajes: [...n.mensajes, {
    de, autor: String(autor || '').slice(0, 80),
    texto: cuerpo, adjuntos, en,
  }] };
}

// Dar el visto o archivar. El visto es de los dos: lo dé quien lo dé, queda
// apuntado en la conversación con su nombre y su hora, así que el otro lo ve
// en su app sin que nadie tenga que escribir nada.
function tocarNota(nota, { visto, archivada, quien, nombre, deGestion, titulo, emoji }) {
  const n = normalizar(nota);
  // Los grupos: su nombre y su emoji los puede cambiar cualquiera de dentro
  if (n.tipo === 'grupo') {
    if (typeof titulo === 'string') n.titulo = titulo.trim().slice(0, 80);
    if (emoji !== undefined) n.emoji = limpiarEmoji(emoji);
  }
  if (visto !== undefined) {
    if (visto) {
      n.estado = 'visto';
      n.vistoPor = { email: quien, nombre: String(nombre || '').slice(0, 80),
                     en: new Date().toISOString() };
      // En un grupo cada uno apunta hasta dónde ha leído, para que debajo
      // de cada mensaje salga quién lo ha visto
      if (n.tipo === 'grupo') {
        const k = escribeComoGestion(n, quien, deGestion) ? 'gestion' : quien;
        n.leidos = { ...(n.leidos || {}), [k]: { nombre: String(nombre || '').slice(0, 80), en: n.vistoPor.en } };
      }
    } else {
      n.estado = 'pendiente';
      delete n.vistoPor;
    }
  }
  if (archivada !== undefined) n.archivada = !!archivada;
  return n;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, X-User-Email, X-Metodo, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // El aviso de la barra de Android marca la conversación como leída sin
  // abrir la app, y desde ahí no se puede mandar un PATCH: la clase que trae
  // Android para hacer peticiones no admite ese método. Así que va un POST
  // diciendo en una cabecera lo que de verdad quiere hacer. Solo se acepta
  // PATCH, que borrar por ese camino no se le pide a nadie.
  const metodo = String(req.headers['x-metodo'] || '').toUpperCase() === 'PATCH'
    ? 'PATCH' : req.method;

  try {
    // Con ?email= se devuelven solo las suyas, que es lo que pide su app.
    if (metodo === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      // ?push=estado: si los avisos al instante están bien puestos
      if (req.query?.push === 'estado') return res.status(200).json(await estadoPush());
      const quien = String(req.query?.email || '').toLowerCase().trim();
      // Con ?resumen=1 solo se devuelve una huella por conversación: es lo que
      // consultan las apps cada poco para saber si hay algo nuevo sin bajarse
      // los mensajes enteros, que con adjuntos pesan lo suyo.
      const soloResumen = req.query?.resumen !== undefined;
      // Con base de datos el filtro y el orden los hace Postgres, que para eso
      // tiene los índices; si no, se filtra aquí como siempre.
      // Quién mandó el último también va en la huella: el aviso nativo lo
      // necesita para no avisarte de lo que acabas de escribir tú.
      // Con quién es la conversación, visto desde quien pregunta: el aviso de
      // Android lo pone de título, y sin esto solo podía decir "tienes un
      // mensaje" —sin saber de quién ni de qué— y obligaba a abrir la app.
      const conQuien = n => {
        if (n.tipo === 'grupo') {
          const otros = participantesDe(n).filter(p => p.gestion ? !!quien : (p.email || '') !== quien)
            .map(p => p.gestion ? 'Gestión' : (p.nombre || p.email));
          return (n.emoji || '👥') + ' ' + (n.titulo || otros.join(', '));
        }
        if (n.tipo === 'companero') {
          return (n.deEmail || '').toLowerCase() === quien
            ? (n.nombre || n.email || '') : (n.deNombre || n.deEmail || '');
        }
        return quien ? 'Gestión'
          : `${n.conductor ? n.conductor + ' · ' : ''}${n.nombre || n.email || ''}`;
      };
      const huella = notas => notas.map(n => {
        const m = n.mensajes || [];
        const ult = m.length ? m[m.length - 1] : null;
        return { id: n.id, n: m.length, en: ult ? ult.en : n.creado,
                 de: ult ? ult.de : '', estado: n.estado, archivada: !!n.archivada,
                 // Y de qué tipo es: el gestor pide el resumen entero y con
                 // esto sabe cuáles no son suyas —lo que se escriben entre
                 // ellos— para no avisar de conversaciones ajenas.
                 tipo: n.tipo === 'companero' ? 'companero' : 'gestion',
                 quien: String(conQuien(n)).slice(0, 80),
                 // Lo justo para que el aviso se lea entero en la barra
                 texto: String(ult?.texto || '').slice(0, 140) };
      });
      // Al gestor, que pregunta sin correo, no le toca saber siquiera que
      // existen las conversaciones entre compañeros.
      if (hayBaseDeDatos()) {
        // Los grupos no van por el correo de la fila: se leen todas y se filtra
        const notas = (await leerNotas('')).filter(n => laVe(n, quien)).map(normalizar);
        return res.status(200).json(soloResumen ? huella(notas) : notas);
      }
      const { data } = await getFile();
      // Las mías son las que me llegan, las que he mandado y los grupos en los
      // que estoy; a gestión, las que la tienen dentro
      const notas = Object.values(data)
        .filter(n => laVe(n, quien))
        .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''))
        .map(normalizar);
      return res.status(200).json(soloResumen ? huella(notas) : notas);
    }

    // El trabajador escribe las suyas. El correo sale del token; la cabecera
    // solo vale mientras queden apps antiguas sin mandarlo.
    if (metodo === 'POST') {
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-user-email'] || '').toLowerCase().trim();
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      // Firmar como gestión solo lo puede hacer quien lo sea de verdad, y eso
      // sale del token: con la cabecera sola cualquiera se haría pasar.
      const deGestion = !!delToken && await esGestor(delToken);
      const b = req.body || {};
      // El móvil apunta su token para los avisos al instante. Solo con la
      // sesión: el correo sale de ella, no de lo que diga el móvil.
      if (b.pushToken !== undefined) {
        if (!delToken) return res.status(401).json({ error: 'Falta la sesión' });
        const r = await registrarPush({ email: delToken, token: b.pushToken, app: b.app,
                                        bandeja: b.app === 'gestion' && deGestion, control: !!b.control });
        return r.error ? res.status(r.status).json({ error: r.error }) : res.status(200).json(r);
      }
      const cuerpo = texto(b.texto);
      const adjuntos = [];
      if (!cuerpo) return res.status(400).json({ error: 'La nota está vacía' });

      // Con id se contesta dentro de la conversación, que es lo que hace un
      // chat: el mensaje se añade al hilo en vez de abrir uno nuevo. Pueden
      // hacerlo los dos que hablan, no solo quien empezó.
      const hilo = String(b.id || '').trim();
      if (hilo) {
        const previa = hayBaseDeDatos() ? await leerNota(hilo) : (await getFile()).data[hilo];
        if (!previa) return res.status(404).json({ error: 'Esa conversación ya no está' });
        if (!puedeTocar(previa, quien, deGestion)) {
          return res.status(403).json({ error: 'Esa conversación no es tuya' });
        }
        const soyGestor = escribeComoGestion(previa, quien, deGestion);
        const conMensaje = añadirMensaje(previa, {
          de: soyGestor ? 'gestor' : quien,
          autor: soyGestor ? (b.gestor || 'Gestión') : (b.nombre || b.deNombre || ''),
          cuerpo, adjuntos,
        });
        if (hayBaseDeDatos()) {
          await guardarNota(paraGuardar(conMensaje));
          await avisarDe(conMensaje, quien, soyGestor);
          return res.status(200).json(normalizar(conMensaje));
        }
        const guardado = await guardarConReintento(
          data => acotarAdjuntos({ ...data, [hilo]: paraGuardar(conMensaje) }), `Mensaje en ${hilo}`);
        if (guardado) await avisarDe(conMensaje, quien, soyGestor);
        return guardado ? res.status(200).json(normalizar(conMensaje))
                        : res.status(500).json({ error: 'No se pudo guardar' });
      }

      // Varios a la vez es un grupo: una sola conversación con todos, en la que
      // lo que escribe uno lo leen los demás. Gestión puede ser uno más.
      if (b.grupo) {
        const lista = Array.isArray(b.participantes) ? b.participantes : [];
        const vistos = new Set();
        const otros = lista.map(p => ({ email: String(p?.email || '').toLowerCase().trim(),
                                        nombre: String(p?.nombre || '').slice(0, 80),
                                        num: String(p?.num || '').slice(0, 12) }))
          .filter(p => p.email.includes('@') && p.email !== quien && !esDePrueba(p.email) && !vistos.has(p.email) && vistos.add(p.email))
          .slice(0, MAX_DESTINOS);
        const conGestion = !!b.conGestion;
        // Quien escribe como gestión no entra en la lista: está como "gestión"
        const comoGestion = deGestion && !!b.comoGestion;
        const cuantos = otros.length + (conGestion && !comoGestion ? 1 : 0);
        if (cuantos < 1) return res.status(400).json({ error: 'No has elegido a nadie' });
        const creado = new Date().toISOString();
        const yo = { email: quien, nombre: String(b.deNombre || '').slice(0, 80), num: String(b.deConductor || '').slice(0, 12) };
        const grupo = {
          id: `${creado.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 7)}-g`,
          tipo: 'grupo', creado, creadoPor: quien,
          email: quien,                     // para el almacén; quién está lo dice participantes
          participantes: comoGestion ? otros : [yo, ...otros],
          conGestion: conGestion || comoGestion,
          titulo: String(b.titulo || '').slice(0, 80),
          emoji: limpiarEmoji(b.emoji),
          // Quien lo crea ya ha visto su primer mensaje
          leidos: { [comoGestion ? 'gestion' : quien]: { nombre: comoGestion ? String(b.gestor || 'Gestión').slice(0, 80) : yo.nombre, en: creado } },
          mensajes: [{ de: comoGestion ? 'gestor' : quien,
                       autor: comoGestion ? String(b.gestor || 'Gestión').slice(0, 80) : yo.nombre,
                       texto: cuerpo, adjuntos, en: creado }],
          archivada: false, de: comoGestion ? 'gestor' : 'trabajador', estado: 'pendiente',
        };
        if (hayBaseDeDatos()) {
          await guardarNota(grupo);
          await avisarDe(grupo, quien, comoGestion);
          return res.status(200).json(normalizar(grupo));
        }
        const nuevo = await guardarConReintento(data => acotarAdjuntos(recortar({ ...data, [grupo.id]: grupo })),
          `Grupo de ${quien} con ${grupo.participantes.length} personas`);
        if (nuevo) await avisarDe(grupo, quien, comoGestion);
        return nuevo ? res.status(200).json(normalizar(grupo)) : res.status(500).json({ error: 'No se pudo guardar' });
      }

      // El gestor puede abrir la conversación él: la nota se guarda a nombre
      // del trabajador, que es quien la verá en su app, pero firmada por él.
      // Puede mandar la misma nota a varios —o a toda la plantilla— y entonces
      // `para` viene como lista: sale una conversación por persona, porque
      // cada uno contestará lo suyo.
      const destinos = [...new Set((Array.isArray(b.para) ? b.para : [b.para])
        .map(d => String(d || '').toLowerCase().trim())
        .filter(d => d.includes('@') && !esDePrueba(d)))].slice(0, MAX_DESTINOS);
      if ((Array.isArray(b.para) ? b.para : [b.para]).some(esDePrueba) && !destinos.length) {
        return res.status(400).json({ error: 'A los usuarios de prueba no se les puede escribir' });
      }
      if (Array.isArray(b.para) && !destinos.length) {
        return res.status(400).json({ error: 'No has elegido a nadie' });
      }
      const para = destinos[0] || '';
      // Con destinatario hay dos casos: el gestor escribiendo a un trabajador
      // y un trabajador escribiendo a un compañero. Firmar como gestión exige
      // el token; con la cabecera sola cualquiera podría hacerse pasar por él.
      const delGestor = !!para && b.tipo !== 'companero';
      if (delGestor && !deGestion) {
        return res.status(403).json({ error: 'Solo gestión escribe a un trabajador' });
      }
      const entreCompaneros = !!para && !delGestor;
      if (entreCompaneros && !para.includes('@')) {
        return res.status(400).json({ error: 'Falta el compañero' });
      }
      // La hora la pone el servidor: así no depende del reloj del móvil
      const creado = new Date().toISOString();
      // Quién recibe cada copia: los nombres vienen en paralelo a la lista de
      // correos para que el hilo se titule con el nombre y no con el correo.
      const comoSeLlama = String(b.nombre || '').slice(0, 80);
      const quienes = destinos.length ? destinos : [''];
      const nombres = Array.isArray(b.nombres) ? b.nombres : null;
      const conductores = Array.isArray(b.conductores) ? b.conductores : null;
      const nuevas = quienes.map((destino, i) => {
        const id = `${creado.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 7)}-${i}`;
        return {
          id, email: destino || quien, creado,
          nombre:    String(nombres ? (nombres[i] || '') : comoSeLlama).slice(0, 80),
          conductor: String(conductores ? (conductores[i] || '') : (b.conductor || '')).slice(0, 12),
          mensajes: [{
            de: delGestor ? 'gestor' : (entreCompaneros ? quien : 'trabajador'),
            autor: delGestor ? String(b.gestor || 'Gestión').slice(0, 80)
                 : String(b.deNombre || b.nombre || '').slice(0, 80),
            texto: cuerpo, adjuntos, en: creado,
          }],
          archivada: false,
          de: delGestor ? 'gestor' : 'trabajador',
          // Un mensaje entre compañeros no es una petición a gestión: no lleva
          // estado que atender y no sale en su lista.
          tipo: entreCompaneros ? 'companero' : 'gestion',
          ...(entreCompaneros ? { deEmail: quien,
                deNombre: String(b.deNombre || '').slice(0, 80),
                deConductor: String(b.deConductor || '').slice(0, 12) } : {}),
          ...(delGestor ? { gestor: String(b.gestor || '').slice(0, 80) } : {}),
          estado: 'pendiente',
        };
      });
      // Con un solo destinatario se devuelve la nota suelta, como siempre;
      // con varios, la lista. Las apps viejas solo mandan uno.
      const respuesta = Array.isArray(b.para) ? nuevas : nuevas[0];
      // A la plantilla entera son muchas conversaciones: un solo aviso con
      // todos, que la bandeja de gestión no tiene que sonar una vez por cada.
      const avisarNuevas = () => avisarChat({ id: nuevas[0]?.id, quien, aGestion: !delGestor && !entreCompaneros,
        emails: nuevas.flatMap(n => participantesDe(n).filter(p => p.email).map(p => p.email)) });
      if (hayBaseDeDatos()) {
        // Una fila por nota: no hay que recortar nada para que quepa
        for (const n of nuevas) await guardarNota(n);
        await avisarNuevas();
        return res.status(200).json(respuesta);
      }
      const porId = Object.fromEntries(nuevas.map(n => [n.id, n]));
      const nuevo = await guardarConReintento(data => acotarAdjuntos(recortar({ ...data, ...porId })),
        entreCompaneros ? `Mensaje de ${quien} para ${para}`
        : delGestor ? `Nota del gestor para ${nuevas.length} trabajador${nuevas.length === 1 ? '' : 'es'}`
        : `Nota de ${quien}`);
      if (nuevo) await avisarNuevas();
      return nuevo ? res.status(200).json(respuesta) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    // Dar el visto, archivar y borrar. Cada uno manda en sus conversaciones:
    // el visto lo da cualquiera de los dos y el otro lo ve.
    if (metodo === 'PATCH' || metodo === 'DELETE') {
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-admin-email'] || req.headers['x-user-email'] || '')
        .toLowerCase().trim();
      const { id, visto, archivada, gestor, nombre, borrarMensaje: iBorrar, enMensaje, titulo, emoji } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta la nota' });
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      const deGestion = !!delToken && await esGestor(delToken);
      // Solo con el token: el desarrollador puede borrar cualquier conversación
      const esDesarrollador = !!delToken && delToken === GESTOR_PRINCIPAL;
      // El visto lo da cualquiera de los dos: no hace falta comprobar nada
      // más de lo que ya comprueba puedeTocar.
      const quita = { visto, archivada, quien, nombre: gestor || nombre, deGestion, titulo, emoji };
      const borraUno = metodo === 'PATCH' && Number.isInteger(iBorrar);
      if (borraUno) {
        const quienBorra = { quien, nombre: gestor || nombre, deGestion };
        if (hayBaseDeDatos()) {
          const n = await leerNota(id);
          if (!puedeTocar(n, quien, deGestion)) return res.status(404).json({ error: 'Esa conversación no es tuya' });
          const r = borrarMensaje(n, iBorrar, enMensaje, quienBorra);
          if (r.error) return res.status(r.status).json({ error: r.error });
          await guardarNota(paraGuardar(r.nota));
          await avisarDe(r.nota, quien, false);
          return res.status(200).json(normalizar(r.nota));
        }
        let fallo = null, hecha = null;
        await guardarConReintento(data => {
          if (!data[id]) { fallo = { status: 404, error: 'Esa conversación ya no está' }; return null; }
          if (!puedeTocar(data[id], quien, deGestion)) { fallo = { status: 403, error: 'Esa conversación no es tuya' }; return null; }
          const r = borrarMensaje(data[id], iBorrar, enMensaje, quienBorra);
          if (r.error) { fallo = r; return null; }
          hecha = r.nota;
          return { ...data, [id]: paraGuardar(r.nota) };
        }, `Mensaje borrado en ${id}`);
        if (fallo) return res.status(fallo.status).json({ error: fallo.error });
        if (hecha) await avisarDe(hecha, quien, false);
        return hecha ? res.status(200).json(normalizar(hecha)) : res.status(500).json({ error: 'No se pudo guardar' });
      }

      if (hayBaseDeDatos()) {
        const n = await leerNota(id);
        // El desarrollador puede borrar cualquier conversación
        const puede = puedeTocar(n, quien, deGestion) || (metodo === 'DELETE' && !!n && esDesarrollador);
        if (!puede) return res.status(404).json({ error: 'Esa conversación no es tuya' });
        if (metodo === 'DELETE') {
          await borrarNota(id);
          return res.status(200).json({ id, borrada: true });
        }
        const tocada = tocarNota(n, quita);
        await guardarNota(paraGuardar(tocada));
        if (visto !== undefined || titulo !== undefined || emoji !== undefined) await avisarDe(tocada, quien, false);
        return res.status(200).json(tocada);
      }
      let prohibido = false;
      const nuevo = await guardarConReintento(data => {
        if (!data[id]) return null;
        const puede = puedeTocar(data[id], quien, deGestion) || (metodo === 'DELETE' && esDesarrollador);
        if (!puede) { prohibido = true; return null; }
        if (metodo === 'DELETE') { const out = { ...data }; delete out[id]; return out; }
        return acotarAdjuntos({ ...data, [id]: paraGuardar(tocarNota(data[id], quita)) });
      }, metodo === 'DELETE' ? `Quitar conversación ${id}` : `Cambio en ${id}`);
      if (nuevo && nuevo[id] && (visto !== undefined || titulo !== undefined || emoji !== undefined)) await avisarDe(nuevo[id], quien, false);
      if (!nuevo) {
        return res.status(prohibido ? 403 : 404)
          .json({ error: prohibido ? 'Esa conversación no es tuya' : 'No se pudo actualizar' });
      }
      return res.status(200).json(nuevo[id] ? normalizar(nuevo[id]) : { id, borrada: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
