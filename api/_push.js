// Avisos al instante, como en WhatsApp. Sin esto el móvil solo se enteraba
// de un mensaje cuando le tocaba mirar —cada 15 minutos como poco, y más con
// el móvil en reposo—. Ahora, en cuanto alguien escribe, el servidor se lo
// dice a Google (Firebase Cloud Messaging), Google despierta al móvil aunque
// la app esté cerrada, y el móvil mira en ese momento lo que hay nuevo y lo
// avisa como siempre, con su sonido.
//
// Cada móvil apunta aquí su token al abrir la app. Se guarda qué correo es y
// desde qué app, porque no se avisa igual a todas: la de gestión lleva la
// bandeja de gestión; las otras, lo de cada persona.
//
// La clave de Google va en Vercel como FIREBASE_SERVICE_ACCOUNT (el JSON de
// la cuenta de servicio, entero). Sin ella no se manda nada y todo sigue como
// antes: los móviles miran por su cuenta cada poco.
import crypto from 'crypto';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const FICHERO = 'push.json';
const APPS = ['trabajador', 'gestion', 'desarrollador'];

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

async function leer() {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${FICHERO}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  if (r.status === 404) return { data: { tokens: {} }, sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + FICHERO);
  const meta = await r.json();
  const texto = meta.content ? Buffer.from(meta.content, 'base64').toString('utf8') : '';
  const data = texto.trim() ? JSON.parse(texto) : {};
  return { data: { tokens: {}, ...data }, sha: meta.sha };
}

async function guardar(mutar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await leer();
    const nuevo = mutar(data);
    if (!nuevo) return true;                     // no había nada que cambiar
    const body = { message: mensaje, branch: BRANCH,
      content: Buffer.from(JSON.stringify(nuevo, null, 2) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${FICHERO}`, {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    if (r.status >= 200 && r.status < 300) return true;
    if (r.status !== 409) return false;
  }
  return false;
}

// Un móvil, un token: si cambia de cuenta o de app, se queda con lo último.
// Solo se escribe si algo cambia, que las apps lo mandan cada vez que abren.
export async function registrarPush({ email, token, app, bandeja, control }) {
  token = String(token || '').trim();
  if (!/^[\w:.\-]{20,4096}$/.test(token)) return { error: 'Token no válido', status: 400 };
  const quien = { email: String(email || '').toLowerCase(), app: APPS.includes(app) ? app : 'trabajador',
                  bandeja: !!bandeja, control: !!control };
  const ok = await guardar(data => {
    const antes = data.tokens[token];
    if (antes && antes.email === quien.email && antes.app === quien.app && !!antes.bandeja === quien.bandeja
        && !!antes.control === quien.control) return null;
    return { ...data, tokens: { ...data.tokens, [token]: { ...quien, en: new Date().toISOString() } } };
  }, `Avisos: móvil de ${quien.email} (${quien.app})`);
  return ok ? { ok: true } : { error: 'No se pudo guardar', status: 500 };
}

// Al cerrar sesión: ese móvil deja de recibir avisos de esa cuenta
export async function quitarPush(token) {
  token = String(token || '').trim();
  if (!token) return { ok: true };
  const ok = await guardar(data => {
    if (!data.tokens[token]) return null;
    const tk = { ...data.tokens };
    delete tk[token];
    return { ...data, tokens: tk };
  }, 'Avisos: móvil que ha cerrado sesión');
  return ok ? { ok: true } : { error: 'No se pudo guardar', status: 500 };
}

// La cuenta de servicio. Si al pegarla en Vercel los saltos de línea de la
// clave quedaron de verdad (y no como \n), el JSON ya no se lee: entonces se
// sacan los tres datos que hacen falta a mano.
export function cuentaDeServicio() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw.trim()) return null;
  try {
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key && j.project_id) return j;
  } catch (_) { /* se intenta a mano */ }
  const campo = n => (raw.match(new RegExp(`"${n}"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}]`)) || [])[1];
  const sa = { client_email: campo('client_email'), project_id: campo('project_id'),
               private_key: (campo('private_key') || '').replace(/\\n/g, '\n') };
  return sa.client_email && sa.private_key && sa.project_id ? sa : null;
}

// El permiso para hablar con Firebase dura una hora; se guarda mientras la
// función siga viva para no pedirlo en cada mensaje.
let acceso = null;
async function tokenDeGoogle(sa) {
  if (acceso && acceso.hasta > Date.now() + 60_000) return acceso.t;
  const ahora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sinFirma = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 });
  const firma = crypto.createSign('RSA-SHA256').update(sinFirma).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                assertion: `${sinFirma}.${firma}` }) });
  if (!r.ok) throw new Error('Google ' + r.status + ' al pedir permiso');
  const j = await r.json();
  acceso = { t: j.access_token, hasta: Date.now() + (j.expires_in || 3600) * 1000 };
  return acceso.t;
}

// Solo un toque para que el móvil mire: el mensaje no viaja por Google, lo
// lee el móvil del servidor como siempre, y el aviso lo monta él con su
// nombre, su texto, su sonido y sus botones de responder.
async function enviar(sa, permiso, token, datos) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${permiso}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, data: datos,
      android: { priority: 'HIGH', ttl: '3600s' } } }) });
  if (r.ok) return 'ok';
  const t = await r.text().catch(() => '');
  // Queda constancia de por qué no salió, para saber si el móvil no lo recibió
  console.error(`Aviso ${datos?.tipo || ''} a …${String(token).slice(-8)}: ${r.status} ${t.slice(0, 160)}`);
  // El móvil desinstaló la app o el token caducó: se borra
  return (r.status === 404 || /UNREGISTERED/.test(t)) ? 'caducado' : 'fallo';
}

// Manda el toque a esos móviles y borra los que ya no tienen la app
async function mandarA(sa, tokens, datos) {
  if (!tokens.length) return { ok: 0, total: 0 };
  const permiso = await tokenDeGoogle(sa);
  const res = await Promise.all(tokens.map(t => enviar(sa, permiso, t, datos)
    .catch(e => { console.error(`Aviso ${datos?.tipo || ''}: ${e.message}`); return 'fallo'; })));
  console.log(`Aviso ${datos?.tipo || ''}: ${res.filter(x => x === 'ok').length}/${tokens.length} móviles`);
  const caducados = tokens.filter((_, i) => res[i] === 'caducado');
  if (caducados.length) {
    await guardar(d => {
      const tk = { ...d.tokens };
      caducados.forEach(t => delete tk[t]);
      return { ...d, tokens: tk };
    }, `Avisos: fuera ${caducados.length} móvil${caducados.length === 1 ? '' : 'es'} sin la app`);
  }
  return { ok: res.filter(x => x === 'ok').length, total: tokens.length, caducados: caducados.length };
}

// A quién: los que están en la conversación menos quien escribe, en sus
// apps; y si la conversación es con gestión y no escribe gestión, además
// los móviles con la bandeja de gestión.
// Quien escribe no se avisa a sí mismo, pero con su papel: el desarrollador
// y gestión pueden ser la misma cuenta, y lo que escribe uno le tiene que
// sonar al otro. Si escribe como gestión, sus apps de persona sí se avisan;
// si escribe como persona, la bandeja de gestión también.
async function avisar({ id, emails, aGestion, quien, comoGestion }) {
  const sa = cuentaDeServicio();
  if (!sa) return;
  const para = new Set((emails || []).map(e => String(e || '').toLowerCase())
    .filter(e => e && (comoGestion || e !== quien)));
  const { data } = await leer();
  const tokens = Object.entries(data.tokens || {}).filter(([, t]) =>
    t.bandeja ? aGestion : para.has(t.email)).map(([k]) => k);
  await mandarA(sa, tokens, { tipo: 'chat', id: String(id || '') });
}

// El cuadrante del mes, a toda la plantilla: a cada móvil con la app de
// trabajadores. El aviso lo monta el móvil, como el de siempre.
async function avisarTodos() {
  const sa = cuentaDeServicio();
  if (!sa) return;
  const { data } = await leer();
  const tokens = Object.entries(data.tokens || {}).filter(([, t]) => t.app === 'trabajador').map(([k]) => k);
  await mandarA(sa, tokens, { tipo: 'cuadrante' });
}

export async function avisarCuadrante() {
  try {
    await Promise.race([avisarTodos(), new Promise(r => setTimeout(r, 8000))]);
  } catch (_) { /* los móviles lo verán en su próximo repaso */ }
}

// Un toque a un grupo de móviles, elegidos por lo que se apuntó de cada uno.
// Sin la clave no hace nada; con ella, espera como mucho unos segundos para
// no retrasar la respuesta de quien ha guardado.
async function avisarFiltro(filtro, datos) {
  const sa = cuentaDeServicio();
  if (!sa) return;
  const { data } = await leer();
  const tokens = Object.entries(data.tokens || {}).filter(([, t]) => filtro(t)).map(([k]) => k);
  return mandarA(sa, tokens, datos);
}

// Un aviso de prueba a la app de desarrollador, esperando la respuesta: para
// saber si llega a la barra sin tener que registrar a nadie
export const probarAvisoDesarrollador = email =>
  avisarFiltro(t => t.app === 'desarrollador' && t.email === String(email).toLowerCase(),
    { tipo: 'solicitud', titulo: '🧪 Prueba de aviso', texto: 'Si ves esto en la barra, los avisos de cuentas nuevas te llegan bien.' });
const conTope = async p => {
  try { await Promise.race([p, new Promise(r => setTimeout(r, 6000))]); } catch (_) { /* ya mirará */ }
};

// A unas personas en su app de trabajador (un cambio de jornada, por ejemplo)
export const avisarPersonas = (emails, datos) => {
  const para = new Set((emails || []).map(e => String(e || '').toLowerCase()));
  return conTope(avisarFiltro(t => !t.bandeja && para.has(t.email), datos));
};
// Al desarrollador, en su app (por ejemplo, una cuenta nueva por aprobar)
export const avisarDesarrollador = (email, datos) =>
  conTope(avisarFiltro(t => t.app === 'desarrollador' && t.email === String(email).toLowerCase(), datos));
// A las apps de gestión y desarrollador, menos a quien lo ha hecho
export const avisarGestion = (datos, salvo = '') =>
  conTope(avisarFiltro(t => (t.app === 'gestion' || t.app === 'desarrollador') && t.email !== salvo, datos));
// A los móviles con el control de acceso puesto, menos a quien lo ha hecho
export const avisarControl = (datos, salvo = '') =>
  conTope(avisarFiltro(t => t.control && t.email !== salvo, datos));

// Para comprobar que está bien puesto sin enseñar nada: si la clave se lee
// y si Google la acepta, y cuántos móviles hay apuntados.
export async function estadoPush() {
  const sa = cuentaDeServicio();
  let google = false, error = '';
  if (sa) {
    try { google = !!(await tokenDeGoogle(sa)); } catch (e) { error = e.message; }
  }
  let moviles = null;
  try { moviles = Object.keys((await leer()).data.tokens || {}).length; } catch (_) {}
  return { clave: !!sa, proyecto: sa?.project_id || '', google, ...(error ? { error } : {}), moviles };
}

// Que un aviso que falla o tarda no se lleve por delante el mensaje, que ya
// está guardado: como mucho se espera unos segundos y se sigue.
export async function avisarChat(datos) {
  try {
    await Promise.race([avisar(datos), new Promise(r => setTimeout(r, 6000))]);
  } catch (_) { /* el móvil lo verá en su próximo repaso */ }
}
