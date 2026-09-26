// El parte del puesto de Control de acceso. Quien hace ese turno va apuntando
// lo que pasa en la garita —quién entra, quién sale, una incidencia, unas
// llaves— y eso queda en un parte por día y turno. La app de desarrollador
// los lee todos y puede corregirlos; cada trabajador solo los suyos.
//
// Se guarda uno por día y turno, con sus anotaciones dentro:
//   { "20260926-M": { fecha, turno, email, nombre, conductor,
//                     notas, anotaciones: [ { hora, tipo, que, quien, obs } ] } }
import { emailDelToken, tokenDe, esGestorControl, esDelPuesto } from './_auth.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'partes.json';

const MAX_PARTES      = 400;   // los más viejos se van cayendo
const MAX_ANOTACIONES = 200;   // por parte; un turno no da para más
const MAX_TEXTO       = 200;
const MAX_NOTAS       = 1000;
const TURNOS          = ['M', 'T', 'N'];
// Por orden de reloj, que es como se leen: mañana, tarde y noche. Ordenar
// por la letra los dejaba en M, N, T —la noche antes de la tarde—.
const ORDEN_TURNO     = { M: 0, T: 1, N: 2 };
const TIPOS = ['entrada', 'salida', 'visita', 'incidencia', 'llaves', 'otro'];

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

// Por encima de 1 MB la API de contenidos devuelve el fichero vacío en vez de
// fallar, y leerlo como "no hay nada" se lo llevaría por delante al guardar.
async function leerContenido(meta) {
  if (meta.content) return Buffer.from(meta.content, 'base64').toString('utf8');
  if (!meta.size) return '';
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

const texto = (t, max = MAX_TEXTO) => String(t ?? '').trim().slice(0, max);
const esFecha = f => /^\d{8}$/.test(String(f || ''));
const esHora  = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
const claveDe = (fecha, turno) => `${fecha}-${turno}`;

function limpiarAnotacion(a, previa) {
  const hora = esHora(a?.hora) ? a.hora : (previa?.hora || '');
  if (!hora) return null;
  const tipo = TIPOS.includes(a?.tipo) ? a.tipo : 'otro';
  const out = {
    id:    texto(a?.id, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    hora, tipo,
    que:   texto(a?.que),
    quien: texto(a?.quien),
    obs:   texto(a?.obs, MAX_TEXTO * 2),
    en:    previa?.en || new Date().toISOString(),
  };
  // Una anotación sin nada escrito no es una anotación
  if (!out.que && !out.quien && !out.obs) return null;
  return out;
}

// Lo que se devuelve siempre tiene la misma forma, venga de donde venga
const normalizar = p => ({
  id: p?.id || '',
  fecha: p?.fecha || '',
  turno: TURNOS.includes(p?.turno) ? p.turno : 'M',
  email: (p?.email || '').toLowerCase(),
  nombre: p?.nombre || '',
  conductor: p?.conductor || '',
  notas: p?.notas || '',
  anotaciones: Array.isArray(p?.anotaciones) ? p.anotaciones : [],
  creado: p?.creado || '',
  actualizado: p?.actualizado || '',
  tocadoPor: p?.tocadoPor || '',
});

// Los más viejos se van cayendo para que el fichero no crezca sin fin
function acotar(data) {
  const claves = Object.keys(data).sort();
  if (claves.length <= MAX_PARTES) return data;
  return Object.fromEntries(claves.slice(-MAX_PARTES).map(k => [k, data[k]]));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // El parte lleva dentro quién entra y quién sale de las instalaciones, así
    // que aquí no lee nadie sin identificarse: el correo sale del token.
    const quien = await emailDelToken(tokenDe(req));
    if (!quien) return res.status(401).json({ error: 'Vuelve a entrar en la app' });
    // Y solo la gente del puesto: el que hace el turno en la garita y el que
    // lleva el puesto. Tener cuenta de Google no da acceso a esto.
    if (!await esDelPuesto(quien)) {
      return res.status(403).json({ error: `Esta cuenta (${quien}) no tiene acceso al puesto de control de acceso` });
    }
    // Quien manda aquí es quien lleva el puesto, que no es quien gestiona a
    // los conductores: su lista es la de gestión control de acceso.
    const mandaEl = await esGestorControl(quien);

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const { data } = await getFile();
      const desde = esFecha(req.query?.desde) ? req.query.desde : '';
      const hasta = esFecha(req.query?.hasta) ? req.query.hasta : '';
      // Cada uno los suyos. El gestor los de todos, que es lo que hace falta
      // para repasarlos y corregirlos.
      const mios = req.query?.mio !== undefined || !mandaEl;
      const lista = Object.values(data).map(normalizar)
        .filter(p => !mios || p.email === quien)
        .filter(p => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta))
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')
                     || (ORDEN_TURNO[b.turno] ?? 9) - (ORDEN_TURNO[a.turno] ?? 9));
      return res.status(200).json(lista);
    }

    if (req.method === 'DELETE') {
      // Borrar un parte entero es cosa del gestor: el que lo escribió puede
      // corregirlo, pero no hacerlo desaparecer.
      if (!mandaEl) return res.status(403).json({ error: 'Solo gestión puede borrar un parte' });
      const id = texto(req.query?.id, 40);
      if (!id) return res.status(400).json({ error: 'Falta el parte' });
      const nuevo = await guardarConReintento(data => {
        if (!data[id]) return null;
        const out = { ...data };
        delete out[id];
        return out;
      }, 'Borrar el parte ' + id);
      if (!nuevo) return res.status(404).json({ error: 'Ese parte ya no está' });
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).end();

    const b = req.body || {};
    const fecha = texto(b.fecha, 8);
    const turno = TURNOS.includes(b.turno) ? b.turno : '';
    if (!esFecha(fecha) || !turno) {
      return res.status(400).json({ error: 'Falta el día o el turno' });
    }
    // Escribir el parte de otro solo lo puede hacer quien lleva el puesto; el
    // resto, el suyo.
    const pedido = mandaEl && b.email ? String(b.email).toLowerCase().trim() : '';
    const clave = claveDe(fecha, turno);
    const ahora = new Date().toISOString();

    const nuevo = await guardarConReintento(data => {
      const previo = data[clave] ? normalizar(data[clave]) : null;
      // El parte sigue siendo de quien lo abrió aunque lo corrija el jefe del
      // puesto: corregir no es quedárselo. Solo cambia de dueño si se dice a
      // quién, y eso solo lo puede hacer él.
      const dueno = pedido || previo?.email || quien;
      // Otro trabajador no puede escribir encima del turno de un compañero;
      // el que lleva el puesto sí, para corregirlo.
      if (previo && previo.email && previo.email !== quien && !mandaEl) {
        return null;
      }
      const previas = new Map((previo?.anotaciones || []).map(a => [a.id, a]));
      const anotaciones = (Array.isArray(b.anotaciones) ? b.anotaciones : (previo?.anotaciones || []))
        .map(a => limpiarAnotacion(a, previas.get(texto(a?.id, 40))))
        .filter(Boolean)
        .sort((x, y) => x.hora.localeCompare(y.hora))
        .slice(0, MAX_ANOTACIONES);
      const parte = {
        id: clave, fecha, turno,
        email: dueno,
        nombre:    b.nombre    !== undefined ? texto(b.nombre, 80)    : (previo?.nombre || ''),
        conductor: b.conductor !== undefined ? texto(b.conductor, 20) : (previo?.conductor || ''),
        notas:     b.notas     !== undefined ? texto(b.notas, MAX_NOTAS) : (previo?.notas || ''),
        anotaciones,
        creado: previo?.creado || ahora,
        actualizado: ahora,
        tocadoPor: quien,
      };
      return acotar({ ...data, [clave]: parte });
    }, `Parte de control de acceso ${fecha} ${turno}`);

    if (!nuevo) return res.status(409).json({ error: 'Ese turno es de otro, no se puede escribir encima' });
    return res.status(200).json(normalizar(nuevo[clave]));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
