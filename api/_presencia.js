// Cuándo se ha conectado por última vez cada trabajador. La app de
// trabajadores da una señal al abrirse y cada pocos minutos mientras está
// delante; la de Desarrollador lo enseña en su lista ("en línea" o "hace 2 h").
//
// Va en su propio fichero y no en usuarios.json: son muchas escrituras
// pequeñas y no deben chocar con los resúmenes ni con lo que toca gestión.
// Además, si la última señal es reciente no se escribe nada.
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const FICHERO = 'presencia.json';
const CADA = 4 * 60 * 1000;          // una escritura cada 4 min como mucho por persona

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

async function leer() {
  const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${FICHERO}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + FICHERO);
  const meta = await r.json();
  const texto = meta.content ? Buffer.from(meta.content, 'base64').toString('utf8') : '';
  return { data: texto.trim() ? JSON.parse(texto) : {}, sha: meta.sha };
}

export async function leerPresencia() {
  return (await leer()).data;
}

export async function apuntarPresencia(email) {
  email = String(email || '').toLowerCase();
  if (!email.includes('@')) return;
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await leer();
    const antes = Date.parse(data[email] || '') || 0;
    if (Date.now() - antes < CADA) return;
    const nuevo = { ...data, [email]: new Date().toISOString() };
    const body = { message: `Conexión de ${email}`, branch: BRANCH,
                   content: Buffer.from(JSON.stringify(nuevo, null, 1) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${FICHERO}`, {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 409) return;
  }
}

// Con qué versión anda cada uno en cada app (trabajador, gestión,
// desarrollador), para verlo en Usuarios autorizados. '0' es el navegador.
// Va en su fichero y solo se escribe cuando cambia.
const VERSIONES = 'versiones.json';
async function leerFichero(nombre) {
  const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${nombre}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + nombre);
  const meta = await r.json();
  const texto = meta.content ? Buffer.from(meta.content, 'base64').toString('utf8') : '';
  return { data: texto.trim() ? JSON.parse(texto) : {}, sha: meta.sha };
}
export async function leerVersiones() {
  return (await leerFichero(VERSIONES)).data;
}
export async function apuntarVersion(email, app, version) {
  email = String(email || '').toLowerCase();
  app = String(app || '');
  version = String(version || '').slice(0, 24);
  if (!email.includes('@') || !['trabajador', 'gestion', 'desarrollador'].includes(app) || !version) return;
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await leerFichero(VERSIONES);
    if (data[email]?.[app] === version) return;
    const nuevo = { ...data, [email]: { ...(data[email] || {}), [app]: version } };
    const body = { message: `Versión de ${email} en ${app}: ${version}`, branch: BRANCH,
                   content: Buffer.from(JSON.stringify(nuevo, null, 1) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${VERSIONES}`, {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 409) return;
  }
}

// Marcas de «ya visto» de cada cuenta (el tutorial de gestión, por ejemplo),
// para que no se repitan al cerrar sesión o cambiar de móvil. Van en el
// mismo fichero que las versiones, en marcas.
export async function leerMarcas(email) {
  return (await leerFichero(VERSIONES)).data[String(email || '').toLowerCase()]?.marcas || {};
}
export async function apuntarMarca(email, clave) {
  email = String(email || '').toLowerCase();
  clave = String(clave || '');
  if (!email.includes('@') || !/^[a-zA-Z]{1,32}$/.test(clave)) return;
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await leerFichero(VERSIONES);
    if (data[email]?.marcas?.[clave]) return;
    const yo = data[email] || {};
    const nuevo = { ...data, [email]: { ...yo, marcas: { ...(yo.marcas || {}), [clave]: new Date().toISOString() } } };
    const body = { message: `Marca ${clave} de ${email}`, branch: BRANCH,
                   content: Buffer.from(JSON.stringify(nuevo, null, 1) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const r = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${VERSIONES}`, {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 409) return;
  }
}
