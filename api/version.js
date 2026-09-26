import { exigirAdmin } from './_auth.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'version-publicada.json';
// Only the gestor decides which build the drivers are offered.
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile() {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: ghHeaders() }
  );
  if (!r.ok) return { data: null, sha: null };
  const meta = await r.json();
  try {
    return { data: JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')), sha: meta.sha };
  } catch (_) {
    return { data: null, sha: meta.sha };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      // null means "nothing published yet": the app then falls back to the
      // newest release, which is how it behaved before this existed.
      return res.status(200).json(data
        || { worker: null, gestion: null, control: null, gestionControl: null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const adminEmail = await exigirAdmin(req, res, ADMIN_EMAIL);
  if (!adminEmail) return;

  // Cada app tiene su propia numeración de builds, así que publicar una no
  // puede tocar el reparto de la otra: antes compartían un solo número y
  // publicar la del trabajador dejaba a gestión con el reparto de aquélla.
  const { app: cual, build } = req.body || {};
  // Cada aplicación lleva su propio número: publicar una no puede tocar el
  // reparto de las otras.
  const CUALES = ['worker', 'gestion', 'control', 'gestionControl'];
  if (!CUALES.includes(cual)) {
    return res.status(400).json({ error: 'Falta indicar la app (' + CUALES.join(', ') + ')' });
  }
  if (build !== null && !Number.isInteger(build)) {
    return res.status(400).json({ error: 'Build inválido' });
  }

  try {
    const { data, sha } = await getFile();
    const payload = { ...(data || {}), [cual]: build,
      actualizado: new Date().toISOString(), publicadoPor: adminEmail };
    const content = Buffer.from(JSON.stringify(payload, null, 2) + '\n').toString('base64');
    const body = { message: `Publicar ${cual} ${build === null ? '(ninguna)' : build}`, content, branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await ghFetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
      { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    return r.ok ? res.status(200).json(payload) : res.status(500).json({ error: 'No se pudo guardar' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
