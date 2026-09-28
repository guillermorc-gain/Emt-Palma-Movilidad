import { exigirGestor, emailDelToken, tokenDe } from './_auth.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';
import { avisarCuadrante } from './_push.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'cuadrante.json';
// El de gestión publica el de todos; cada trabajador puede además subir el
// suyo propio (uno personal, que solo ve él).
// A data URL costs ~33% more than the raw bytes, and GitHub's contents API
// starts failing around 1 MB of base64, so keep the payload well under it.
// Al escribir, el JSON se manda en base64, que abulta un tercio más. Con
// 700 KB la petición rondaba los 930 KB y se acercaba al tope de 1 MB de la
// API de contenidos: pasado ese punto la escritura falla y la foto no entra,
// que es lo que ya pasó con las notas.
const MAX_CHARS    = 450 * 1024;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile() {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(), cache: 'no-store' }
  );
  if (!r.ok) return { data: null, sha: null };
  const meta = await r.json();
  try {
    return { data: JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')), sha: meta.sha };
  } catch (_) {
    return { data: null, sha: meta.sha };
  }
}

async function save(payload, sha, mensaje) {
  const content = Buffer.from(JSON.stringify(payload) + '\n').toString('base64');
  const body = { message: mensaje, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.status;
}

const global_ = data => ({
  imagen: data?.imagen ?? null,
  nombre: data?.nombre || '',
  actualizado: data?.actualizado || null,
  publicadoPor: data?.publicadoPor || null,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const esMio = req.query?.mio !== undefined || req.body?.mio === true;

  try {
    // El personal: cada uno el suyo, y ninguno el de los demás. El correo
    // sale del token, no de lo que diga la petición.
    if (esMio) {
      const email = await emailDelToken(tokenDe(req));
      if (!email) return res.status(401).json({ error: 'Vuelve a entrar en la app' });

      if (req.method === 'GET') {
        const { data } = await getFile();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(data?.porTrabajador?.[email] || { imagen: null });
      }

      return await guardarPersonal(req, res, email);
    }

    // El de gestión, para todos: cualquiera lo puede leer sin identificarse.
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(global_(data));
    }

    const adminEmail = await exigirGestor(req, res);
    if (!adminEmail) return;
    return await guardarGlobal(req, res, adminEmail);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function guardarGlobal(req, res, adminEmail) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();

    let payload;
    if (req.method === 'DELETE') {
      payload = { ...(data || {}), imagen: null, nombre: '', actualizado: new Date().toISOString(), publicadoPor: null };
    } else {
      const { imagen, nombre } = req.body || {};
      if (typeof imagen !== 'string' || !imagen.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Imagen inválida' });
      }
      if (imagen.length > MAX_CHARS) {
        return res.status(413).json({ error: 'La imagen es demasiado grande' });
      }
      payload = {
        ...(data || {}),
        // El cuadrante nuevo de gestión es el que vale: lo que se hubiera
        // subido cada uno por su cuenta era para mientras no lo hubiera, y
        // dejarlo ahí significaba que el suyo le tapaba el bueno.
        porTrabajador: {},
        imagen,
        nombre: (nombre || '').slice(0, 120),
        actualizado: new Date().toISOString(),
        publicadoPor: adminEmail,
      };
    }
    const status = await save(payload, sha,
      req.method === 'DELETE' ? 'Quitar el cuadrante' : 'Actualizar el cuadrante');
    if (status >= 200 && status < 300) {
      // Publicado: que le llegue a toda la plantilla al momento
      if (req.method !== 'DELETE') await avisarCuadrante();
      return res.status(200).json(global_(payload));
    }
    if (status !== 409) break;
  }
  return res.status(500).json({ error: req.method === 'DELETE' ? 'No se pudo borrar' : 'No se pudo guardar' });
}

async function guardarPersonal(req, res, email) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();
    const porTrabajador = { ...(data?.porTrabajador || {}) };

    let payload;
    if (req.method === 'DELETE') {
      delete porTrabajador[email];
      payload = { imagen: null };
    } else {
      const { imagen, nombre } = req.body || {};
      if (typeof imagen !== 'string' || !imagen.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Imagen inválida' });
      }
      if (imagen.length > MAX_CHARS) {
        return res.status(413).json({ error: 'La imagen es demasiado grande' });
      }
      payload = { imagen, nombre: (nombre || '').slice(0, 120), actualizado: new Date().toISOString() };
      porTrabajador[email] = payload;
    }
    const nuevo = { ...(data || {}), porTrabajador };
    const status = await save(nuevo, sha,
      req.method === 'DELETE' ? `Quitar el cuadrante personal de ${email}` : `Cuadrante personal de ${email}`);
    if (status >= 200 && status < 300) return res.status(200).json(payload);
    if (status !== 409) break;
  }
  return res.status(500).json({ error: req.method === 'DELETE' ? 'No se pudo borrar' : 'No se pudo guardar' });
}
