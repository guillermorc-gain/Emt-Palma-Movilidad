import crypto from 'crypto';
import { exigirAdmin, GESTOR_PRINCIPAL, tokenDe, revisarFirebase, revisarToken } from './_auth.js';
import { cuentaDeServicio, avisarDesarrollador, probarAvisoDesarrollador } from './_push.js';
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
// Cuándo se avisó al desarrollador de cada correo. Las versiones viejas de la
// app vuelven a pedir el alta solas cada minuto mientras esperan: sin esto,
// cada vez que se rechazaba o se quitaba a alguien volvía a saltar el aviso.
const AVISADOS = 'solicitudes-avisadas.json';
const UN_DIA = 24 * 3600 * 1000;
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
async function mutarSolicitudes(mutar, mensaje, ruta = SOLICITUDES) {
  for (let i = 0; i < 3; i++) {
    const { data, sha } = await leerJson(ruta);
    const nuevo = mutar({ ...data });
    if (!nuevo) return data;
    const body = { message: mensaje, branch: BRANCH,
      content: Buffer.from(JSON.stringify(nuevo, null, 2) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${ruta}`, {
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
async function permisoAdmin() {
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
  return { sa, access_token };
}

// Aprobada por el desarrollador, la cuenta queda confirmada sin más: él ya
// sabe de quién es. Así puede entrar aunque el correo no le llegue (Outlook
// se tragaba el de confirmación sin dejarlo ni en «Correo no deseado»).
async function marcarVerificada(uid) {
  const { sa, access_token } = await permisoAdmin();
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:update`, {
    method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Firebase: ' + (d?.error?.message || r.status));
}

// Quitar a alguien o rechazar su solicitud borra también su cuenta de correo
// (la de contraseña), si ya no tiene acceso a ninguna app. Si no, al volver a
// registrarse con el mismo correo le decía que ya existía y le pedía la
// contraseña de antes. Las cuentas de Google no se tocan.
async function borrarCuentaCorreo(email) {
  if (await yaAutorizado(email)) return false;
  const { sa, access_token } = await permisoAdmin();
  const cab = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts`;
  const r = await fetch(`${base}:lookup`, { method: 'POST', headers: cab, body: JSON.stringify({ email: [email] }) });
  const d = await r.json().catch(() => ({}));
  const u = (d.users || [])[0];
  if (!u?.localId) return false;
  const proveedores = (u.providerUserInfo || []).map(p => p.providerId);
  if (proveedores.some(p => p !== 'password')) return false;
  const b = await fetch(`${base}:delete`, { method: 'POST', headers: cab, body: JSON.stringify({ localId: u.localId }) });
  if (!b.ok) throw new Error('Firebase ' + b.status);
  console.log(`Cuenta de correo de ${email} borrada`);
  return true;
}

// El enlace para entrar sin contraseña (de un solo uso), para que al abrir el
// correo en un navegador donde no había entrado quede ya dentro. Se saca el
// código del enlace de Firebase y va en el nuestro, con el correo.
async function enlaceEntrar(email, como) {
  const { sa, access_token } = await permisoAdmin();
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:sendOobCode`, {
    method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, returnOobLink: true,
                           continueUrl: seguirEn(como), canHandleCodeInApp: true }) });
  const d = await r.json().catch(() => ({}));
  const codigo = d.oobLink ? new URL(d.oobLink).searchParams.get('oobCode') : '';
  if (!r.ok || !codigo) throw new Error('Firebase: ' + (d?.error?.message || r.status));
  return `${seguirEn(como)}&email=${encodeURIComponent(email)}&c=${encodeURIComponent(codigo)}`;
}

// Una sesión de Firebase vale una hora aunque la cuenta se haya borrado
// mientras tanto: sin mirarlo, una app abierta podía pedir el alta de una
// cuenta que ya no existe y se aprobaba sin que nadie pudiera entrar con ella.
async function cuentaExiste(uid) {
  try {
    const { sa, access_token } = await permisoAdmin();
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`, {
      method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }) });
    if (!r.ok) return true;              // sin poder mirarlo, no se le deja fuera
    const d = await r.json().catch(() => ({}));
    return Array.isArray(d.users) && d.users.length > 0;
  } catch (_) { return true; }
}

async function enlaceVerificacion(email, como) {
  const { sa, access_token } = await permisoAdmin();
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
  let verificada = false;
  if (!google && uid) {
    try { await marcarVerificada(uid); verificada = true; }
    catch (e) { console.error(`No se pudo dar por confirmada la cuenta de ${email}: ${e.message}`); }
  }
  if (hayCorreoPropio()) {
    try {
      const confirmar = !google && !!uid && !verificada;
      // Cuenta de correo ya confirmada: el enlace la deja dentro sin contraseña
      let enlace = seguirEn(como);
      if (confirmar) enlace = await enlaceVerificacion(email, como);
      else if (!google && uid) {
        try { enlace = await enlaceEntrar(email, como); }
        catch (e) { console.error(`Enlace para entrar de ${email}: ${e.message}`); }
      }
      await enviarCorreo({ para: email, ...correoAutorizado({ nombre, email, enlace, confirmar,
                                                              app: como === 'gestion' ? 'gestion' : 'trabajador' }) });
      console.log(`Correo de autorizado a ${email}: enviado desde Gmail`);
      return 'gmail';
    } catch (e) {
      console.error('Correo propio:', e.message);   // se intenta con el de Firebase
    }
  }
  if (!hayCorreoPropio()) console.warn('Correo de autorizado: falta GMAIL_CLAVE_APP, lo manda Firebase');
  if (google || verificada) await mandarAvisoGoogle(email, como);
  else if (uid) await mandarConfirmacion(uid, como);
  else throw new Error('No hay cómo avisarle');
  console.log(`Correo de autorizado a ${email}: enviado por Firebase`);
  return 'firebase';
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
    if (esFirebase && s.uid && !await cuentaExiste(s.uid)) {
      return res.status(410).json({ error: 'Esa cuenta ya no existe: vuelve a crearla con «Crear cuenta».' });
    }
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
    // Solo cuenta lo que pide la persona pulsando (Entrar, Crear cuenta o
    // entrar con Google). Lo automático, si ya se avisó hace menos de un
    // día, ni vuelve a crear la solicitud ni vuelve a avisar.
    const manual = req.body?.manual === true;
    if (!manual) {
      const avisado = Date.parse((await leerJson(AVISADOS)).data[s.email] || '') || 0;
      if (Date.now() - avisado < UN_DIA) return res.status(200).json({ pendiente: true });
    }
    let yaPedida = false;
    await mutarSolicitudes(d => {
      yaPedida = !!d[s.email];
      return { ...d, [s.email]: { email: s.email, uid: s.uid || '', nombre: nombre || d[s.email]?.nombre || '',
                                   google: !esFirebase, desde, en: d[s.email]?.en || new Date().toISOString() } };
    }, `Solicitud de cuenta de ${s.email}`);
    // Un solo aviso por persona, aunque vuelva a intentarlo. Si lo vuelve a
    // pedir él pulsando y hace más de 10 minutos del último, se avisa otra vez.
    const hace = yaPedida && manual
      ? Date.now() - (Date.parse((await leerJson(AVISADOS)).data[s.email] || '') || 0) : 0;
    if (!yaPedida || hace > 10 * 60 * 1000) {
      await avisarDesarrollador(GESTOR_PRINCIPAL, { tipo: 'solicitud',
        titulo: esFirebase ? '🆕 Cuenta nueva por aprobar' : '🆕 Alguien ha entrado con Google sin estar autorizado',
        texto: `${nombre || s.email} (${s.email})${desde ? ' desde la app de ' + (desde === 'gestion' ? 'gestión' : 'trabajadores') : ''}: ¿gestión o trabajador?` });
      await mutarSolicitudes(d => ({ ...d, [s.email]: new Date().toISOString() }), `Aviso de solicitud de ${s.email}`, AVISADOS)
        .catch(() => {});
    }
    return res.status(200).json({ pendiente: true });
  }
  // Lo que hace el desarrollador
  if (!await exigirAdmin(req, res, GESTOR_PRINCIPAL)) return;
  // Probar que el correo propio sale: uno de prueba al propio desarrollador
  if (q.probarCorreo !== undefined) {
    if (!hayCorreoPropio()) return res.status(200).json({ ok: false, error: 'Falta GMAIL_CLAVE_APP en Vercel (o no se ha vuelto a desplegar)' });
    try {
      const c = correoAutorizado({ nombre: 'Guillermo', email: GESTOR_PRINCIPAL, app: 'trabajador',
                                   enlace: seguirEn('trabajador'), confirmar: false });
      await enviarCorreo({ para: GESTOR_PRINCIPAL, asunto: '🧪 Prueba · ' + c.asunto, html: c.html, texto: c.texto });
      return res.status(200).json({ ok: true, para: GESTOR_PRINCIPAL });
    } catch (e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }
  // Probar el aviso: espera unos segundos para que dé tiempo a salir de la app
  // (con la app delante el aviso no va a la barra, lo recoge ella)
  if (q.probarAviso !== undefined) {
    await new Promise(r => setTimeout(r, 8000));
    try { return res.status(200).json({ ok: true, ...(await probarAvisoDesarrollador(GESTOR_PRINCIPAL) || {}) }); }
    catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }
  if (req.method === 'GET') return res.status(200).json(Object.values((await leerJson(SOLICITUDES)).data));
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  const sol = (await leerJson(SOLICITUDES)).data[email];
  if (q.rechazar !== undefined) {
    await mutarSolicitudes(d => { delete d[email]; return d; }, `Solicitud de ${email} rechazada`);
    await borrarCuentaCorreo(email).catch(e => console.error(`No se pudo borrar la cuenta de ${email}: ${e.message}`));
    return res.status(200).json({ ok: true });
  }
  const app = COMO[req.body?.como];
  if (!app) return res.status(400).json({ error: 'Di si es de gestión o trabajador' });
  if (!sol) return res.status(404).json({ error: 'Esa solicitud ya no está' });
  const { emails, sha } = await getFile(APPS[app].file);
  if (!emails.map(e => String(e).toLowerCase()).includes(email)) emails.push(email);
  if (!await setFile(APPS[app].file, emails, sha)) return res.status(500).json({ error: 'No se pudo apuntar en la lista' });
  // Ya está apuntado: el correo se intenta, y si falla se dice, pero el alta vale
  let correo = true, aviso = '', via = '';
  try {
    if (sol.google || sol.uid) {
      via = await avisarAutorizado({ email, uid: sol.uid, google: !!sol.google, como: req.body.como, nombre: sol.nombre });
    } else correo = false;
  } catch (e) { correo = false; aviso = e.message; console.error(`Correo de autorizado a ${email}: ${e.message}`); }
  await mutarSolicitudes(d => { delete d[email]; return d; }, `Solicitud de ${email} aprobada (${req.body.como})`);
  return res.status(200).json({ ok: true, correo, via, ...(aviso ? { aviso } : {}) });
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
  if (['solicitud', 'reenviar', 'solicitudes', 'aprobar', 'rechazar', 'probarCorreo', 'probarAviso'].some(k => q[k] !== undefined)) {
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
      // Sin acceso a ninguna app, su cuenta de correo tampoco se queda
      await borrarCuentaCorreo(norm).catch(e => console.error(`No se pudo borrar la cuenta de ${norm}: ${e.message}`));
      return res.status(200).json({ emails: filtered, plantilla });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(405).end();
}
