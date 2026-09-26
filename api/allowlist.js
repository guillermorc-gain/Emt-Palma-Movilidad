import { exigirAdmin, GESTOR_PRINCIPAL } from './_auth.js';
import { quitarDeApp } from './usuarios.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.

// Each app keeps its own list and its own administrator: granting access to one
// must not grant access to the other.
const APPS = {
  movilidad: { file: 'allowed-users.json',         admin: 'guillermo.rc82@gmail.com' },
  gestion:   { file: 'allowed-users-gestion.json', admin: 'g.rioscorrea@gmail.com'   },
  // El puesto de control de acceso: los que hacen el turno en la garita y
  // los que llevan ese puesto. Cada uno su lista, como las de arriba.
  control:            { file: 'allowed-users-control.json',         admin: 'g.rioscorrea@gmail.com' },
  'gestion-control':  { file: 'allowed-users-gestion-control.json', admin: 'g.rioscorrea@gmail.com' },
};
const appCfg = req => APPS[String((req.query?.app) || (req.body?.app) || '').toLowerCase()] || APPS.movilidad;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile(FILE_PATH) {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: ghHeaders() }
  );
  if (!r.ok) return { emails: [], sha: null };
  const data = await r.json();
  const emails = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { emails: Array.isArray(emails) ? emails : [], sha: data.sha };
}

async function setFile(FILE_PATH, emails, sha) {
  const content = Buffer.from(JSON.stringify(emails, null, 2) + '\n').toString('base64');
  const body = { message: `Actualizar acceso (${FILE_PATH})`, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { emails } = await getFile(appCfg(req).file);
      return res.status(200).json(emails);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const cfg = appCfg(req);
  // Cada lista tiene su dueño, y el desarrollador puede con todas: es quien
  // lleva las cuatro aplicaciones desde su app y sería absurdo que no pudiera
  // dar de alta a nadie en la que no es suya.
  if (!await exigirAdmin(req, res, cfg.admin, GESTOR_PRINCIPAL)) return;

  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  const norm = email.toLowerCase().trim();

  try {
    const { emails, sha } = await getFile(cfg.file);

    if (req.method === 'POST') {
      if (!emails.map(e => e.toLowerCase()).includes(norm)) emails.push(norm);
      const ok = await setFile(cfg.file, emails, sha);
      return res.status(ok ? 200 : 500).json(ok ? { emails } : { error: 'No se pudo guardar' });
    }

    if (req.method === 'DELETE') {
      const filtered = emails.filter(e => e.toLowerCase() !== norm);
      const ok = await setFile(cfg.file, filtered, sha);
      if (!ok) return res.status(500).json({ error: 'No se pudo guardar' });
      // Sin acceso a la app de conductores o a la de Control de acceso, deja
      // de ser de esa app; si no le queda ninguna, sale de la plantilla de
      // gestión (con su ficha guardada antes). Que esto falle no deshace el
      // quitarle el acceso, que es lo que se ha pedido.
      const deApp = { movilidad: 'trabajador', control: 'control' }[
        String(req.query?.app || req.body?.app || 'movilidad').toLowerCase()];
      let plantilla = null;
      if (deApp) {
        try { plantilla = await quitarDeApp(norm, deApp); }
        catch (e) { plantilla = { error: e.message }; }
      }
      return res.status(200).json({ emails: filtered, plantilla });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(405).end();
}
