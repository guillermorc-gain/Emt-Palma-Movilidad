import crypto from 'crypto';
import { exigirAdmin, GESTOR_PRINCIPAL, tokenDe, revisarFirebase, revisarToken } from './_auth.js';
import { cuentaDeServicio, avisarDesarrollador } from './_push.js';
import { enviarCorreo, correoAutorizado, hayCorreoPropio } from './_correo.js';
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

// ── Cuentas de correo que no es de Google ───────────────────────────────────
// Quien crea una cuenta con su correo no recibe la confirmación hasta que el
// desarrollador dice si es de gestión o trabajador: entonces se le apunta en
// esa lista y se le manda el correo. Las pendientes van en solicitudes.json.
const SOLICITUDES = 'solicitudes.json';
const CLAVE_WEB = process.env.FIREBASE_WEB_KEY || 'AIzaSyCKhWVjlM0IAKAvjVWmT4WD4Y3NC0M6QFI';
const COMO = { trabajador: 'movilidad', gestion: 'gestion' };
// Adónde lleva el enlace del correo: a su app, donde lo dejó, que ya sabe que
// está autorizado y le pregunta si sigue en el navegador o baja la aplicación
const WEB = process.env.WEB_PUBLICA || 'https://emt-palma-movilidad.vercel.app';
const seguirEn = como => como === 'gestion' ? `${WEB}/gestion/?autorizado=1` : `${WEB}/?app=trabajador&autorizado=1`;

async function leerJson(ruta) {
  const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${ruta}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(), cache: 'no-store' });
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const m = await r.json();
  return { data: JSON.parse(Buffer.from(m.content, 'base64').toString('utf8') || '{}'), sha: m.sha };
}
async function mutarSolicitudes(mutar, mensaje) {
  for (let i = 0; i < 3; i++) {
    const { data, sha } = await leerJson(SOLICITUDES);
    const nuevo = mutar({ ...data });
    if (!nuevo) return data;
    const body = { message: mensaje, branch: BRANCH,
      content: Buffer.from(JSON.stringify(nuevo, null, 2) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${SOLICITUDES}`, {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return nuevo;
    if (r.status !== 409) throw new Error('No se pudo guardar la solicitud');
  }
  throw new Error('No se pudo guardar la solicitud');
}

// Si ya está en alguna lista, a qué app
async function yaAutorizado(email) {
  for (const [como, app] of Object.entries(COMO)) {
    const { emails } = await getFile(APPS[app].file);
    if (emails.map(e => String(e).toLowerCase()).includes(email)) return como;
  }
  return '';
}

// El correo de confirmación, mandado desde aquí: con la cuenta de servicio se
// entra como ese usuario (token propio firmado) y se pide el correo a Firebase.
async function mandarConfirmacion(uid, como) {
  const sa = cuentaDeServicio();
  if (!sa) throw new Error('Falta la clave de Firebase en el servidor');
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sinFirma = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, sub: sa.client_email, uid, iat: ahora, exp: ahora + 3600,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit' });
  const jwt = `${sinFirma}.${crypto.createSign('RSA-SHA256').update(sinFirma).sign(sa.private_key, 'base64url')}`;
  const post = async (accion, cuerpo) => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${accion}?key=${CLAVE_WEB}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Firebase: ' + (d?.error?.message || r.status));
    return d;
  };
  const { idToken } = await post('signInWithCustomToken', { token: jwt, returnSecureToken: true });
  await post('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken, continueUrl: seguirEn(como) });
}

// Quien entró con Google no tiene nada que confirmar, pero también tiene que
// enterarse: Firebase le manda un correo con el enlace para seguir. No hace
// falta cuenta de servicio, solo que esté activado el acceso por enlace.
async function mandarAvisoGoogle(email, como) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${CLAVE_WEB}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: seguirEn(como), canHandleCodeInApp: true }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Firebase: ' + (d?.error?.message || r.status));
}

// El enlace para confirmar el correo, pedido a Firebase como administrador
// (con la cuenta de servicio): así el correo lo mandamos nosotros, desde la
// cuenta de Gmail de Gestión, en vez de que lo mande Firebase.
async function enlaceVerificacion(email, como) {
  const sa = cuentaDeServicio();
  if (!sa) throw new Error('Falta la clave de Firebase en el servidor');
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sinFirma = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 });
  const firma = crypto.createSign('RSA-SHA256').update(sinFirma).sign(sa.private_key, 'base64url');
  const t = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${sinFirma}.${firma}` }) });
  if (!t.ok) throw new Error('Google ' + t.status + ' al pedir permiso');
  const { access_token } = await t.json();
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:sendOobCode`, {
    method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', email, returnOobLink: true, continueUrl: seguirEn(como) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.oobLink) throw new Error('Firebase: ' + (d?.error?.message || r.status));
  return d.oobLink;
}

// El aviso de «ya estás autorizado». Con la clave de Gmail puesta sale de
// Gestión (g.rioscorrea@gmail.com) con su asunto; si no, lo manda Firebase.
async function avisarAutorizado({ email, uid, google, como, nombre }) {
  if (hayCorreoPropio()) {
    try {
      const confirmar = !google && !!uid;
      const enlace = confirmar ? await enlaceVerificacion(email, como) : seguirEn(como);
      await enviarCorreo({ para: email, ...correoAutorizado({ nombre, email, enlace, confirmar,
                                                              app: como === 'gestion' ? 'gestion' : 'trabajador' }) });
      return;
    } catch (e) {
      console.error('Correo propio:', e.message);   // se intenta con el de Firebase
    }
  }
  if (google) await mandarAvisoGoogle(email, como);
  else if (uid) await mandarConfirmacion(uid, como);
  else throw new Error('No hay cómo avisarle');
}

async function cuentasDeCorreo(req, res) {
  const q = req.query || {};
  // Lo que pide el propio usuario, con su sesión aún sin confirmar
  if (q.solicitud !== undefined || q.reenviar !== undefined) {
    // Cuenta de correo (Firebase, aún sin confirmar) o cuenta de Google que
    // ha entrado sin estar autorizada: las dos piden el alta igual
    const token = tokenDe(req);
    const esFirebase = /^eyJ/.test(token);
    const s = esFirebase ? await revisarFirebase(token, true) : await revisarToken(token);
    if (!s.email) return res.status(401).json({ error: 'Sesión no válida' });
    const como = await yaAutorizado(s.email);
    if (como && !esFirebase) return res.status(200).json({ aprobado: true });
    if (como) {
      // Ya tenía acceso: la confirmación va directa
      await avisarAutorizado({ email: s.email, uid: s.uid, google: false, como,
                               nombre: String(req.body?.nombre || s.nombre || '').slice(0, 80) });
      await mutarSolicitudes(d => { if (!d[s.email]) return null; delete d[s.email]; return d; }, `Solicitud de ${s.email} resuelta`);
      // Solo para enterarse: ya estaba autorizado, no hay nada que decidir
      if (q.solicitud !== undefined) {
        const nombre = String(req.body?.nombre || s.nombre || '').slice(0, 80);
        await avisarDesarrollador(GESTOR_PRINCIPAL, { tipo: 'registro', titulo: '✅ Cuenta registrada',
          texto: `${nombre ? nombre + ' · ' : ''}${s.email} (${como === 'gestion' ? 'gestión' : 'trabajador'}) se ha registrado. Le hemos mandado el correo de confirmación.` });
      }
      return res.status(200).json({ aprobado: true });
    }
    if (q.reenviar !== undefined) return res.status(403).json({ error: 'Tu cuenta aún no está aprobada por el Departamento.' });
    const nombre = String(req.body?.nombre || s.nombre || '').slice(0, 80);
    // Desde qué app lo ha intentado, para que el desarrollador lo sepa
    const desde = ['trabajador', 'gestion'].includes(req.body?.app) ? req.body.app : '';
    let yaPedida = false;
    await mutarSolicitudes(d => {
      yaPedida = !!d[s.email];
      return { ...d, [s.email]: { email: s.email, uid: s.uid || '', nombre: nombre || d[s.email]?.nombre || '',
                                   google: !esFirebase, desde, en: d[s.email]?.en || new Date().toISOString() } };
    }, `Solicitud de cuenta de ${s.email}`);
    // Un solo aviso por persona, aunque vuelva a intentarlo
    if (!yaPedida) {
      await avisarDesarrollador(GESTOR_PRINCIPAL, { tipo: 'solicitud',
        titulo: esFirebase ? '🆕 Cuenta nueva por aprobar' : '🆕 Alguien ha entrado con Google sin estar autorizado',
        texto: `${nombre || s.email} (${s.email})${desde ? ' desde la app de ' + (desde === 'gestion' ? 'gestión' : 'trabajadores') : ''}: ¿gestión o trabajador?` });
    }
    return res.status(200).json({ pendiente: true });
  }
  // Lo que hace el desarrollador
  if (!await exigirAdmin(req, res, GESTOR_PRINCIPAL)) return;
  if (req.method === 'GET') return res.status(200).json(Object.values((await leerJson(SOLICITUDES)).data));
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  const sol = (await leerJson(SOLICITUDES)).data[email];
  if (q.rechazar !== undefined) {
    await mutarSolicitudes(d => { delete d[email]; return d; }, `Solicitud de ${email} rechazada`);
    return res.status(200).json({ ok: true });
  }
  const app = COMO[req.body?.como];
  if (!app) return res.status(400).json({ error: 'Di si es de gestión o trabajador' });
  if (!sol) return res.status(404).json({ error: 'Esa solicitud ya no está' });
  const { emails, sha } = await getFile(APPS[app].file);
  if (!emails.map(e => String(e).toLowerCase()).includes(email)) emails.push(email);
  if (!await setFile(APPS[app].file, emails, sha)) return res.status(500).json({ error: 'No se pudo apuntar en la lista' });
  // Ya está apuntado: el correo se intenta, y si falla se dice, pero el alta vale
  let correo = true, aviso = '';
  try {
    if (sol.google || sol.uid) {
      await avisarAutorizado({ email, uid: sol.uid, google: !!sol.google, como: req.body.como, nombre: sol.nombre });
    } else correo = false;
  } catch (e) { correo = false; aviso = e.message; }
  await mutarSolicitudes(d => { delete d[email]; return d; }, `Solicitud de ${email} aprobada (${req.body.como})`);
  return res.status(200).json({ ok: true, correo, ...(aviso ? { aviso } : {}) });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  if (['solicitud', 'reenviar', 'solicitudes', 'aprobar', 'rechazar'].some(k => q[k] !== undefined)) {
    try { return await cuentasDeCorreo(req, res); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

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
