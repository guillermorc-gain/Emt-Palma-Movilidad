// Catálogo de lugares de trabajo: nombre, turnos y ubicación. Lo mantiene el
// gestor y lo leen las dos apps, para que los turnos y las ubicaciones dejen de
// estar escritos a mano en el código de cada una.
import { exigirGestor } from './_auth.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'lugares.json';
const MAX_LUGARES  = 60;

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
  const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.status;
}

const clave = n => String(n || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const hora = v => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : '');

// Cuánta gente hace falta para cubrir un turno. Lo normal es una, pero en
// Control hacen falta dos por la mañana y dos por la tarde.
const CUANTOS_MAX = 20;
const cuantos = v => Math.min(CUANTOS_MAX, Math.max(1, parseInt(v, 10) || 1));

// Un turno sin horas no sirve para deducir nada, así que se descarta. Uno que
// empieza y acaba a la misma hora tampoco: es lo que deja el reloj del móvil
// al vaciarle las horas para quitarlo, y luego se tragaba el día entero.
function limpiarTurnos(turnos) {
  if (!Array.isArray(turnos)) return [];
  return turnos
    .filter(t => ['M', 'T', 'N'].includes(t?.id) && hora(t.desde) && hora(t.hasta)
                 && hora(t.desde) !== hora(t.hasta))
    .slice(0, 3)
    .map(t => ({ id: t.id, desde: hora(t.desde), hasta: hora(t.hasta), n: cuantos(t.n) }));
}

// Días de la semana en que se trabaja ahí, 0 domingo a 6 sábado. Sin lista se
// entiende que todos: es lo que había antes de existir este campo.
function limpiarDias(d) {
  if (!Array.isArray(d)) return null;
  const dias = [...new Set(d.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return dias.length && dias.length < 7 ? dias : null;
}

function limpiarUbicacion(u) {
  if (!u || typeof u !== 'object') return null;
  const lat = Number(u.lat), lng = Number(u.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const radio = Math.min(2000, Math.max(30, Number(u.radio) || 150));
  return { lat, lng, radio };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    if (!await exigirGestor(req, res)) return;

    const { nombre } = req.body || {};
    const k = clave(nombre);
    if (!k) return res.status(400).json({ error: 'Falta el nombre del lugar' });

    for (let intento = 0; intento < 3; intento++) {
      const { data, sha } = await getFile();
      if (req.method === 'DELETE') {
        delete data[k];
      } else {
        if (!data[k] && Object.keys(data).length >= MAX_LUGARES) {
          return res.status(400).json({ error: 'Demasiados lugares' });
        }
        const previo = data[k] || {};
        const b = req.body || {};
        data[k] = {
          nombre:    String(nombre).trim().slice(0, 40),
          turnos:    b.turnos !== undefined ? limpiarTurnos(b.turnos) : (previo.turnos || []),
          ubicacion: b.ubicacion !== undefined ? limpiarUbicacion(b.ubicacion) : (previo.ubicacion || null),
          dias:      b.dias !== undefined ? limpiarDias(b.dias) : (previo.dias || null),
          // Con dos lugares en la misma ubicación gana el de prioridad más alta
          prioridad: b.prioridad !== undefined ? (Number(b.prioridad) || 0) : (previo.prioridad || 0),
        };
      }
      const status = await setFile(data, sha,
        req.method === 'DELETE' ? `Quitar lugar ${k}` : `Lugar ${k}`);
      if (status >= 200 && status < 300) return res.status(200).json(data);
      if (status !== 409) break;
    }
    return res.status(500).json({ error: 'No se pudo guardar' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
