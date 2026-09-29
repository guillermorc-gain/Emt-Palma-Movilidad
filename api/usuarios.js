import { emailDelToken, tokenDe, exigirGestor, GESTOR_PRINCIPAL } from './_auth.js';
import { avisarPersonas, avisarGestion } from './_push.js';
import { apuntarPresencia, leerPresencia, apuntarVersion, leerVersiones, apuntarMarca, leerMarcas } from './_presencia.js';
import { hayBaseDeDatos, leerUsuarios, leerUsuario, leerAvatares, guardarUsuario, borrarUsuario } from './_almacen.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const FILE_PATH    = 'usuarios-resumen.json';
const MAX_AVATAR   = 40 * 1024;   // el avatar va reescalado a 80px, no debe pasar de aquí
const MAX_JORNADAS = 500;         // un año da ~220; el tope evita cargas absurdas
const MAX_LUGARES  = 500;         // un lugar por día: más de un año de excepciones
const GRUPOS_DESCANSO = 10;       // grupos de descanso de la jornada completa

// 'YYYYMMDD' -> lista de días del tramo, ambos incluidos. Se acota a 400 para
// que una petición mal formada no genere un fichero enorme.
function diasEntre(desde, hasta) {
  const ok = f => /^\d{8}$/.test(String(f || ''));
  if (!ok(desde) || !ok(hasta) || hasta < desde) return [];
  const aFecha = f => new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12);
  const out = [];
  for (let d = aFecha(desde), fin = aFecha(hasta); d <= fin && out.length < 400; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// Un tramo sin inicio no se puede situar en el calendario; el fin vacío
// significa que sigue de baja.
function limpiarBajas(bajas) {
  if (!Array.isArray(bajas)) return [];
  const ok = f => /^\d{8}$/.test(String(f || ''));
  return bajas
    .filter(b => ok(b?.d) && (!b.h || ok(b.h)) && (!b.h || b.h >= b.d))
    .slice(0, 50)
    .map(b => ({ d: b.d, h: b.h || '' }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

// Rangos con fecha ISO, que es como los guarda la app del trabajador
function limpiarDiasSemana(d) {
  if (!Array.isArray(d)) return null;
  const dias = [...new Set(d.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return dias.length && dias.length < 7 ? dias : null;
}

function limpiarVacaciones(v) {
  if (!Array.isArray(v)) return [];
  const ok = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
  return v
    .filter(x => ok(x?.desde) && ok(x?.hasta) && x.hasta >= x.desde)
    .slice(0, 60)
    .map(x => ({ desde: x.desde, hasta: x.hasta }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

// Los días de la semana los tocan los dos lados (el trabajador en su app y el
// gestor desde el cuadrante), así que gana el que los haya cambiado después.
function diasMasNuevos(previo, b) {
  const suyos = Number(b.diasAt) || 0;
  const guardados = Number(previo.diasAt) || 0;
  if (b.dias === undefined || suyos <= guardados) {
    return { dias: previo.dias ?? null, diasAt: guardados };
  }
  return { dias: limpiarDiasSemana(b.dias), diasAt: suyos };
}

// Horario asignado desde el cuadrante: entrada y salida en HH:MM. Vacío = sin
// horario fijo, y entonces se deduce de la hora a la que ficha.
function limpiarHorario(h) {
  const ok = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
  if (!h || !ok(h.i) || !ok(h.f)) return '';
  return { i: h.i, f: h.f };
}

// Lo último que el trabajador ha dado por leído. La hora la pone el servidor,
// no el móvil, y solo cambia cuando cambia lo confirmado: si no, cada
// publicación del resumen movería la hora del visto y dejaría de decir cuándo
// se enteró de verdad.
function nuevoVisto(previo, dado) {
  if (!dado || typeof dado !== 'object') return previo || null;
  const clave = String(dado.clave || '').slice(0, 120);
  if (!clave) return previo || null;
  if (previo && previo.clave === clave) return previo;
  return { clave, texto: String(dado.texto || '').slice(0, 200), en: new Date().toISOString() };
}

// Los horarios se asignan mes a mes: { '202609': {i,f}, ... }. Se guardan los
// MAX_MESES_HORARIO más recientes para que el fichero no crezca sin fin.
const MAX_MESES_HORARIO = 36;
function ponerHorarioDelMes(previos, mes, horario) {
  const out = { ...(previos || {}) };
  const limpio = limpiarHorario(horario);
  if (limpio) out[mes] = limpio; else delete out[mes];
  const claves = Object.keys(out).sort();
  if (claves.length <= MAX_MESES_HORARIO) return out;
  const recorte = {};
  claves.slice(-MAX_MESES_HORARIO).forEach(k => { recorte[k] = out[k]; });
  return recorte;
}

// Días ya revisados cuando el horario asignado y el registrado no cuadran:
// 'ok' es resuelto y 'ojo' es visto pero sin resolver.
const MAX_REVISIONES = 400;
function limpiarRevisiones(r) {
  if (!r || typeof r !== 'object') return {};
  const out = {};
  Object.keys(r).sort().slice(-MAX_REVISIONES).forEach(f => {
    // 'plan' y 'real' dicen con qué horario se queda ese día: el que puso
    // gestión o el que fichó el trabajador. 'ok' es de antes de poder elegir
    // y vale como decidido; 'ojo' es dejarlo marcado sin decidir.
    if (/^\d{8}$/.test(f) && ['ok', 'ojo', 'plan', 'real'].includes(r[f])) out[f] = r[f];
  });
  return out;
}

// Grupo de descanso (1–10) de los de jornada completa. 0 / vacío = sin grupo.
function limpiarGrupo(g) {
  const n = parseInt(g, 10);
  return Number.isInteger(n) && n >= 1 && n <= GRUPOS_DESCANSO ? n : null;
}

function vacacionesMasNuevas(previo, b) {
  const suyas = Number(b.vacacionesAt) || 0;
  const guardadas = Number(previo.vacacionesAt) || 0;
  if (!Array.isArray(b.vacaciones) || suyas <= guardadas) {
    return { vacaciones: previo.vacaciones || [], vacacionesAt: guardadas };
  }
  return { vacaciones: limpiarVacaciones(b.vacaciones), vacacionesAt: suyas };
}

function enBajaHoy(bajas) {
  const hoy = new Date();
  const f = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
  return (bajas || []).some(b => b.d <= f && (!b.h || b.h >= f));
}

function recortarNotas(notas) {
  const claves = Object.keys(notas).sort();
  if (claves.length <= MAX_LUGARES) return notas;
  const recorte = {};
  claves.slice(-MAX_LUGARES).forEach(k => { recorte[k] = notas[k]; });
  return recorte;
}

// Horario puesto solo para unas fechas: { '20260915': {i,f}, ... }. Va aparte
// del horario del mes porque se asigna por tramos —un día, una semana, el mes
// entero— y aparte de las jornadas porque esas las reescribe el trabajador
// cada vez que publica y se llevarían por delante lo que ponga el gestor.
function limpiarHorariosDia(hs) {
  if (!hs || typeof hs !== 'object') return {};
  const out = {};
  Object.keys(hs).sort().slice(-MAX_LUGARES).forEach(f => {
    const h = limpiarHorario(hs[f]);
    if (/^\d{8}$/.test(f) && h) out[f] = h;
  });
  return out;
}

// Un día repartido entre varios lugares: [{p:'Calle', i:'06:00', o:'10:00'}, …].
// Es la misma forma que usan las jornadas que registra el trabajador, para que
// las dos apps lo lean igual.
const MAX_TRAMOS_DIA = 6;
function limpiarTramosDia(ts) {
  if (!Array.isArray(ts)) return [];
  return ts
    .filter(t => t && typeof t === 'object' && limpiarHorario({ i: t.i, f: t.o }))
    .slice(0, MAX_TRAMOS_DIA)
    .map(t => ({ p: String(t.p || '').slice(0, 40), i: t.i, o: t.o }));
}

function recortarLugares(lugares) {
  const claves = Object.keys(lugares).sort();
  if (claves.length <= MAX_LUGARES) return lugares;
  const recorte = {};
  claves.slice(-MAX_LUGARES).forEach(k => { recorte[k] = lugares[k]; });
  return recorte;
}

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
  // GitHub responde con ETag y puede servir una copia cacheada; el parámetro
  // suelto y el no-cache fuerzan a que la lectura sea siempre la última.
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

// Dos apps escribiendo a la vez chocan en el sha; reintentar una vez releyendo
// basta cuando cada usuario publica una vez al día.
// Todo lo que se guarda aquí toca a un solo trabajador. Con base de datos eso
// es leer y escribir su fila, sin tocar las de los demás: se acabaron las
// colisiones del relevo y el fichero que crece sin parar. Sin base de datos se
// sigue reescribiendo el fichero entero, igual que siempre.
async function mutarUsuario(clave, mutar, mensaje, devolverTodo) {
  if (!hayBaseDeDatos()) return guardarConReintento(mutar, mensaje);
  const previo = await leerUsuario(clave);
  const nuevo = mutar(previo ? { [clave]: previo } : {});
  if (!nuevo) return null;
  // Solo se borra si de verdad había algo y la mutación lo ha quitado; si no
  // existía y sigue sin existir, no hay nada que hacer.
  if (nuevo[clave] !== undefined) await guardarUsuario(clave, nuevo[clave]);
  else if (previo) await borrarUsuario(clave);
  // Gestión espera la plantilla entera de vuelta; el trabajador que publica,
  // solo lo suyo, y no tiene sentido hacerle leer las jornadas de los demás.
  return devolverTodo ? leerUsuarios() : nuevo;
}

// ── De qué aplicaciones es cada trabajador ─────────────────────────────────
//
// A la plantilla de gestión se entra por la app de conductores o por la de
// Control de acceso. Cada ficha apunta por cuál ha entrado; las de antes de
// esto solo podían venir de la de conductores.
const APPS_DE_PLANTILLA = ['trabajador', 'control'];
const appsDe = u => (Array.isArray(u?.apps) && u.apps.length ? u.apps : ['trabajador'])
  .filter(a => APPS_DE_PLANTILLA.includes(a));

// Lo que se quita de la plantilla no se pierde: antes de borrar la ficha se
// guarda entera aquí, con cuándo y por qué se quitó.
const FICHERO_QUITADOS = 'usuarios-quitados.json';
async function archivarQuitado(email, datos, app) {
  const { avatar, ...ficha } = datos || {};
  for (let intento = 0; intento < 3; intento++) {
    const r = await ghFetch(
      `https://api.github.com/repos/${REPO}/contents/${FICHERO_QUITADOS}?ref=${BRANCH}&t=${Date.now()}`,
      { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
    let archivo = {}, sha = null;
    if (r.ok) {
      const meta = await r.json();
      sha = meta.sha;
      const texto = await leerContenido(meta);
      if (texto.trim()) archivo = JSON.parse(texto);
    } else if (r.status !== 404) {
      throw new Error('GitHub ' + r.status + ' al leer ' + FICHERO_QUITADOS);
    }
    const lista = Array.isArray(archivo[email]) ? archivo[email] : [];
    archivo[email] = [...lista, { quitado: new Date().toISOString(), sinAccesoA: app, ficha }].slice(-10);
    const body = { message: `Guardar la ficha de ${email} antes de quitarlo`, branch: BRANCH,
      content: Buffer.from(JSON.stringify(archivo, null, 2) + '\n').toString('base64') };
    if (sha) body.sha = sha;
    const w = await ghFetch(`https://api.github.com/repos/${REPO}/contents/${FICHERO_QUITADOS}`,
      { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (w.ok) return;
    if (w.status !== 409) throw new Error('GitHub ' + w.status + ' al guardar ' + FICHERO_QUITADOS);
  }
  throw new Error('No se pudo guardar la copia de la ficha');
}

// Al quitarle a alguien el acceso a una de las apps por las que se entra en
// la plantilla, deja de ser de esa app. Si ya no le queda ninguna, sale de la
// plantilla de gestión; su ficha se guarda antes, y lo que tenga en sus
// copias de seguridad de Drive no se toca.
export async function quitarDeApp(email, app) {
  const clave = String(email || '').toLowerCase().trim();
  if (!clave || !APPS_DE_PLANTILLA.includes(app)) return { quitado: false };
  const u = hayBaseDeDatos() ? await leerUsuario(clave) : (await leerTodo())[clave];
  if (!u || u.ficticio) return { quitado: false };
  const quedan = appsDe(u).filter(a => a !== app);
  if (quedan.length) {
    await mutarUsuario(clave, data => {
      if (data[clave]) data[clave] = { ...data[clave], apps: quedan };
      return data;
    }, `${clave} ya no entra en ${app}`);
    return { quitado: false, quedan };
  }
  // Primero la copia: si no se puede guardar, no se borra nada
  await archivarQuitado(clave, u, app);
  await mutarUsuario(clave, data => { delete data[clave]; return data; },
    `Quitar a ${clave} de la plantilla (sin acceso a ${app})`);
  return { quitado: true };
}

async function leerTodo() {
  if (hayBaseDeDatos()) return leerUsuarios();
  const { data } = await getFile();
  return data;
}

async function guardarConReintento(mutar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();
    const nuevo = mutar(data);
    const status = await setFile(nuevo, sha, mensaje);
    if (status >= 200 && status < 300) return nuevo;
    if (status !== 409) return null;
  }
  return null;
}

// ── Quién trabaja en un lugar un día ────────────────────────────────────────
const clavePuesto = p => String(p || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function deBajaEse(u, f) {
  return (u.bajas || []).some(b => b.d <= f && (!b.h || b.h >= f));
}

function deVacacionesEse(u, f) {
  const iso = `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
  return (u.vacaciones || []).some(v => v.desde <= iso && v.hasta >= iso);
}

// Sin lista de días se entiende que le puede tocar cualquiera
// Los días puestos para ese mes en el cuadrante mandan sobre los de siempre
function leTocaEse(u, f) {
  const delMes = u.diasMes?.[f.slice(0, 6)];
  const dias = Array.isArray(delMes) ? delMes : u.dias;
  if (!Array.isArray(dias) || !dias.length) return true;
  const d = new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12).getDay();
  return dias.includes(d);
}

// El horario asignado para ese día: primero el que le hayan puesto a esa
// fecha, luego el del mes y por último el de siempre.
// Días que gestión ha dejado libres con «Quitar»: sin horario ni lugar, ni
// siquiera el del mes o el habitual, así que queda disponible ese día.
const libreEse = (u, f) => !!u?.libresDia?.[f];

function planDelDia(u, f) {
  if (libreEse(u, f)) return null;
  const delDia = u.horariosDia?.[f];
  if (delDia?.i && delDia?.f) return { ...delDia, real: false };
  const delMes = u.horarios?.[f.slice(0, 6)];
  if (delMes?.i) return { ...delMes, real: false };
  const suelto = u.horario;
  return (suelto && typeof suelto === 'object' && suelto.i) ? { ...suelto, real: false } : null;
}

// El horario que vale es el que fichó; si no ha fichado, el asignado.
function horarioDelDia(u, f) {
  const suya = (u.jornadas || []).filter(j => j && j.f === f).pop();
  if (suya?.i) return { i: suya.i, f: suya.o || '', real: true };
  return planDelDia(u, f);
}

// Lo que le toca ese día: dónde y a qué hora. Un lugar puesto para esa fecha
// manda sobre el habitual, y como va por fecha, al día siguiente vuelve solo
// al del mes sin que nadie tenga que deshacer nada.
// Cuándo se le asignó por última vez la jornada de ese día. Sin esto, quitarle
// la jornada y volver a ponerle la misma no era ningún cambio —el antes y el
// después son idénticos— y no le llegaba aviso ninguno: ni a la app abierta,
// que compara con lo que tenía, ni al aviso de fondo, que compara con lo
// último que vio. Con el sello, volver a asignar siempre es algo nuevo.
const MAX_SELLOS = 400;

function sellarAsignacion(u, fechas) {
  const sellos = { ...(u.asignadoDia || {}) };
  const ahora = Date.now();
  for (const f of fechas) sellos[f] = ahora;
  const claves = Object.keys(sellos).sort();
  u.asignadoDia = claves.length <= MAX_SELLOS ? sellos
    : Object.fromEntries(claves.slice(-MAX_SELLOS).map(k => [k, sellos[k]]));
}

function ajustesRecientes(u, hoy) {
  const desde = new Date(+hoy.slice(0, 4), +hoy.slice(4, 6) - 1, +hoy.slice(6, 8) - 40);
  const minimo = `${desde.getFullYear()}${String(desde.getMonth() + 1).padStart(2, '0')}${String(desde.getDate()).padStart(2, '0')}`;
  const out = {};
  for (const [f, rev] of Object.entries(u.asignadoDia || {})) {
    if (f < minimo || f > hoy) continue;
    if (deBajaEse(u, f) || deVacacionesEse(u, f)) continue;
    const h = planDelDia(u, f);
    if (h?.i && h?.f) out[f] = { i: h.i, f: h.f, rev };
  }
  return out;
}

// Los días que el trabajador acaba de marcar como baja, vacaciones, permiso
// retribuido o que no fue (lo que antes no estaba así)
const AUSENCIAS = { b: 'BE', v: 'Vacaciones', p: 'PR', na: 'No vino' };
function ausenciasQueAparecen(antes, ahora) {
  if (!Array.isArray(ahora)) return [];
  const ya = new Set((antes || []).flatMap(j => Object.keys(AUSENCIAS).filter(k => j?.[k]).map(k => `${j.f}|${k}`)));
  const out = [];
  for (const j of ahora) for (const k of Object.keys(AUSENCIAS)) {
    if (j?.[k] && /^\d{8}$/.test(String(j.f || '')) && !ya.has(`${j.f}|${k}`)) out.push({ f: j.f, que: AUSENCIAS[k] });
  }
  return out.sort((a, b) => a.f.localeCompare(b.f));
}

function loQueLeToca(u, f) {
  if (!u) return null;
  const delDia = (u.lugares || {})[f] || '';
  return {
    fecha: f,
    lugar: libreEse(u, f) ? '' : delDia || u.puesto || '',
    // Va con la jornada porque forma parte de su huella: dos jornadas iguales
    // asignadas en momentos distintos son dos avisos distintos.
    rev: (u.asignadoDia || {})[f] || 0,
    habitual: u.puesto || '',
    // Los días que gestión ha asignado o rectificado en las últimas semanas,
    // con su horario y cuándo: la app corrige con ellos lo que tenga
    // registrado de antes de ese momento.
    ajustes: ajustesRecientes(u, f),
    // Para que la app pueda decir que ese día va a otro sitio
    excepcion: !!delDia && clavePuesto(delDia) !== clavePuesto(u.puesto || ''),
    horario: planDelDia(u, f),
    libre: !leTocaEse(u, f),
    baja: deBajaEse(u, f),
    vacaciones: deVacacionesEse(u, f),
  };
}

function quienHayEn(data, lugar, fecha) {
  const hoy = new Date();
  const f = /^\d{8}$/.test(String(fecha || '')) ? fecha
    : `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
  const clave = clavePuesto(lugar);
  const gente = Object.values(data || {})
    .filter(u => u && !u.ficticio && !u.oculto)
    .filter(u => !libreEse(u, f) && clavePuesto((u.lugares || {})[f] || u.puesto) === clave && clave)
    .filter(u => !deBajaEse(u, f) && !deVacacionesEse(u, f) && leTocaEse(u, f))
    .map(u => ({
      email:     u.email,
      nombre:    u.nombre || '',
      conductor: u.conductor || '',
      horario:   horarioDelDia(u, f),
    }))
    .sort((a, b) => (a.horario?.i || '\uffff').localeCompare(b.horario?.i || '\uffff')
                 || (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  return { lugar: String(lugar || ''), fecha: f, gente };
}


// El número que ve gestión. Se guarda aparte el que pone él (conductorPropio),
// el último que tuvo (conductorAnterior) y el que puso gestión
// (conductorGestion): quitarlo de su app no lo borra de gestión.
function numeroDeTrabajador(previo, b) {
  const enviado = typeof b.conductor === 'string' ? b.conductor.trim().slice(0, 12) : null;
  const propio = enviado !== null ? enviado
    : (previo.conductorPropio ?? (previo.conductorGestion ? '' : previo.conductor) ?? '');
  const anterior = propio || previo.conductorAnterior || (previo.conductorGestion ? '' : previo.conductor) || '';
  return {
    conductorPropio: propio,
    conductorAnterior: anterior,
    conductor: propio || previo.conductorGestion || anterior || '',
  };
}
// Permiso retribuido: dos al año. Los días que ya lo son ese año, sumando
// los que marca gestión y los que el trabajador registra como PR.
const PR_ANUALES = 2;
function prUsados(u, año) {
  const dias = new Set((Array.isArray(u?.prs) ? u.prs : []).filter(f => String(f).startsWith(año)));
  (u?.jornadas || []).forEach(j => { if (j?.p && String(j.f || '').startsWith(año)) dias.add(String(j.f).slice(0, 8)); });
  return dias;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query?.conexiones !== undefined) {
      res.setHeader('Cache-Control', 'no-store');
      const pide = await emailDelToken(tokenDe(req)).catch(() => null);
      if (pide !== GESTOR_PRINCIPAL) return res.status(403).json({ error: 'Solo para el desarrollador' });
      return res.status(200).json(await leerPresencia());
    }

    // Las marcas de «ya visto» de quien pregunta (el tutorial, por ejemplo)
    if (req.method === 'GET' && req.query?.misMarcas !== undefined) {
      res.setHeader('Cache-Control', 'no-store');
      const pide = await emailDelToken(tokenDe(req)).catch(() => null);
      if (!pide) return res.status(401).json({ error: 'Falta la sesión' });
      return res.status(200).json(await leerMarcas(pide));
    }

    // Con qué versión anda cada uno en cada app (solo para el desarrollador)
    if (req.method === 'GET' && req.query?.versiones !== undefined) {
      res.setHeader('Cache-Control', 'no-store');
      const pide = await emailDelToken(tokenDe(req)).catch(() => null);
      if (pide !== GESTOR_PRINCIPAL) return res.status(403).json({ error: 'Solo para el desarrollador' });
      return res.status(200).json(await leerVersiones());
    }

    if (req.method === 'GET') {
      let data = await leerTodo();
      res.setHeader('Cache-Control', 'no-store');
      // Quien quitó la comunicación con el Departamento sigue saliendo en la
      // lista de gestión (con "sin conexión"), pero no para sus compañeros:
      // ni en los lugares ni para escribirle. Eso se filtra más abajo.
      const sinComunicacion = u => u?.comunicacion === false;
      // Con ?lugar= se devuelve solo quién trabaja ahí ese día. Lo usa la app
      // del trabajador para enseñarle con quién va, sin bajarse todo.
      const { lugar, fecha, directorio, avatares, mio } = req.query || {};
      const hoyClave = () => {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      };
      // Las fotos, aparte y cacheables: cambian una vez al año y pesan más que
      // todo lo demás junto.
      if (avatares !== undefined) {
        if (hayBaseDeDatos()) return res.status(200).json(await leerAvatares());
        const out = {};
        Object.values(data).forEach(u => { if (u?.avatar) out[u.email] = u.avatar; });
        return res.status(200).json(out);
      }
      if (lugar !== undefined) {
        return res.status(200).json(quienHayEn(Object.fromEntries(Object.entries(data).filter(([, u]) => !sinComunicacion(u))), lugar, fecha));
      }
      // Lo que le toca a uno ese día. Es lo que mira su app para la cabecera,
      // y así no se baja la plantilla entera para leer dos datos suyos.
      if (mio !== undefined) {
        const u = data[String(mio).toLowerCase().trim()];
        const f = /^\d{8}$/.test(String(fecha || '')) ? fecha : hoyClave();
        // Con su número: así la app de Control de acceso lo recupera en un
        // móvil nuevo sin tener que volver a escribirlo.
        return res.status(200).json({ ...(loQueLeToca(u, f) || { fecha: f, lugar: '', horario: null }),
                                      conductor: u?.conductor || '',
                                      // Ya vio la bienvenida, o es de antes (ya tenía jornadas)
                                      bienvenida: !!(u?.bienvenidaVista || (u?.jornadas || []).length),
                                      // Los permisos retribuidos que le ha marcado gestión
                                      prs: Array.isArray(u?.prs) ? u.prs : [] });
      }
      // Solo nombre y número, para que la app del trabajador pueda escribir a
      // un compañero sin bajarse las jornadas de toda la plantilla.
      if (directorio !== undefined) {
        return res.status(200).json(Object.values(data)
          .filter(u => u && u.email && !u.ficticio && !u.oculto && !sinComunicacion(u))
          .map(u => ({ email: u.email, nombre: u.nombre || '', conductor: u.conductor || '',
                       ...(u.avatarEmoji ? { avatarEmoji: u.avatarEmoji, avatarBg: u.avatarBg || null } : {}) }))
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')));
      }
      return res.status(200).json(data);
    }

    // Cada conductor publica su propio resumen
    if (req.method === 'POST') {
      // Cada trabajador escribe su propia fila. El correo sale del token, no de
      // la cabecera, para que nadie pueda escribir en la fila de otro. Las apps
      // antiguas todavía no mandan el token: mientras queden, se acepta la
      // cabecera, pero solo después de haber intentado el token.
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-user-email'] || '').toLowerCase().trim();
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      const b = req.body || {};
      // La señal de "estoy conectado": solo con la sesión, y va aparte
      if (req.query?.ping !== undefined || b.ping) {
        if (!delToken) return res.status(401).json({ error: 'Falta la sesión' });
        // Gestión y desarrollador solo dicen su versión: su uso no es el
        // "en línea" de un trabajador
        await Promise.all([
          b.soloVersion ? null : apuntarPresencia(delToken),
          b.app && b.version ? apuntarVersion(delToken, b.app, b.version).catch(() => {}) : null,
          b.marca ? apuntarMarca(delToken, b.marca).catch(() => {}) : null,
        ]);
        return res.status(200).json({ ok: true });
      }
      if (typeof b.avatar === 'string' && b.avatar.length > MAX_AVATAR) b.avatar = null;

      // Quien entra por la app de Control de acceso también es de la
      // plantilla: se le da de alta con su nombre y su número, sin tocar nada
      // de lo que ya tuviera si además usa la de conductores.
      if (b.origen === 'control') {
        const nuevo = await mutarUsuario(quien, data => {
          const previo = data[quien];
          if (previo?.ficticio) return data;
          const base = previo || {
            email: quien, horasMes: 0, horasTotales: 0, horasAnuales: 777, jornadaHoras: 7,
            diasMes: 0, jornadas: [], vacaciones: [], puesto: '',
          };
          const nombre = typeof b.nombre === 'string' ? b.nombre.trim().slice(0, 80) : '';
          const conductor = typeof b.conductor === 'string' ? b.conductor.trim().slice(0, 12) : '';
          data[quien] = {
            ...base,
            email: quien,
            nombre: base.nombre || nombre,
            conductor: conductor || base.conductor || '',
            avatar: base.avatar ?? (typeof b.avatar === 'string' && b.avatar ? b.avatar : null),
            apps: [...new Set([...(previo ? appsDe(previo) : []), 'control'])],
            actualizado: new Date().toISOString(),
          };
          return data;
        }, `Alta de ${quien} desde Control de acceso`);
        return nuevo ? res.status(200).json(nuevo[quien] || {}) : res.status(500).json({ error: 'No se pudo guardar' });
      }

      let ausenciasNuevas = [];
      const nuevo = await mutarUsuario(quien, data => {
        const previo = data[quien] || {};
        ausenciasNuevas = ausenciasQueAparecen(previo.jornadas, b.jornadas);
        data[quien] = {
          ...previo,
          email: quien,
          nombre:       typeof b.nombre === 'string' ? b.nombre.slice(0, 80) : previo.nombre || '',
          // El número: el que tenga puesto él; si lo quita, el que puso
          // gestión o, si no, el último que tuvo, para que gestión no lo pierda
          ...numeroDeTrabajador(previo, b),
          avatar:       b.avatar ?? previo.avatar ?? null,
          // El avatar de emoji y su color, para quien no ha puesto foto
          avatarEmoji:  typeof b.avatarEmoji === 'string' ? b.avatarEmoji.slice(0, 16) || null
                      : b.avatarEmoji === null ? null : previo.avatarEmoji ?? null,
          avatarBg:     /^#[0-9a-f]{3,8}$/i.test(b.avatarBg || '') ? b.avatarBg : (b.avatarEmoji === null ? null : previo.avatarBg ?? null),
          version:      typeof b.version === 'string' ? b.version.slice(0, 20) : previo.version || '',
          horasMes:     Number(b.horasMes) || 0,
          horasTotales: Number(b.horasTotales) || 0,
          horasAnuales: Number(b.horasAnuales) || previo.horasAnuales || 777,
          jornadaHoras: Number(b.jornadaHoras) || previo.jornadaHoras || 7,
          // Días de la semana que trabaja; null si no los ha fijado
          ...diasMasNuevos(previo, b),
          diasMes:      Number(b.diasMes) || 0,
          turno:        ['M','T','N'].includes(b.turno) ? b.turno : (previo.turno || ''),
          horaInicio:   typeof b.horaInicio === 'string' ? b.horaInicio.slice(0, 5) : previo.horaInicio || '',
          horaFin:      typeof b.horaFin === 'string' ? b.horaFin.slice(0, 5) : previo.horaFin || '',
          horarioDe:    b.horarioDe === 'hoy' ? 'hoy' : 'anterior',
          jornadas:     Array.isArray(b.jornadas) ? b.jornadas.slice(-MAX_JORNADAS) : (previo.jornadas || []),
          // Las vacaciones las tocan los dos, así que gana la versión más
          // reciente en vez de pisarse una a otra sin orden.
          ...vacacionesMasNuevas(previo, b),
          // el puesto lo pone el gestor: una publicación del conductor no lo pisa
          puesto:       previo.puesto || '',
          // Lo mismo con el horario asignado y el grupo de descanso, que se
          // eligen desde el cuadrante y el trabajador no envía.
          horario:      previo.horario || '',
          horarios:     previo.horarios || {},
          horariosDia:  previo.horariosDia || {},
          tramosDia:    previo.tramosDia || {},
          revisiones:   previo.revisiones || {},
          avisoVisto:   nuevoVisto(previo.avisoVisto, b.avisoVisto),
          // Entra por la de conductores, y puede que también por la de control
          apps:         [...new Set([...(previo.email ? appsDe(previo) : []), 'trabajador'])],
          grupo:        previo.grupo ?? null,
          // Si mantiene la comunicación con el Departamento (lo elige él)
          comunicacion: typeof b.comunicacion === 'boolean' ? b.comunicacion : (previo.comunicacion ?? true),
          // Ya pasó por la bienvenida de la app (solo sale la primera vez)
          bienvenidaVista: b.bienvenidaVista === true || !!previo.bienvenidaVista,
          actualizado:  new Date().toISOString(),
        };
        return data;
      }, `Resumen de ${quien}`);

      // Gestión ve el cambio en su lista al momento; y si ha marcado días de
      // baja, vacaciones, permiso o que no fue, se le avisa para confirmarlo
      if (nuevo) {
        const u = nuevo[quien] || {};
        await avisarGestion(ausenciasNuevas.length ? {
          tipo: 'ausencia', email: quien,
          titulo: `📅 ${u.nombre || quien} ha marcado días`,
          texto: ausenciasNuevas.slice(0, 6).map(a => `${a.que} el ${a.f.slice(6, 8)}/${a.f.slice(4, 6)}`).join(', ')
            + (ausenciasNuevas.length > 6 ? '…' : '') + '. Confírmalo en la app.',
        } : { tipo: 'plantilla' }, quien);
      }
      return nuevo ? res.status(200).json(nuevo[quien]) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    // Esto lo hace gestión: el gestor principal y los correos que él haya
    // autorizado, que son los que llevan a los trabajadores.
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      const quienGestiona = await exigirGestor(req, res);
      if (!quienGestiona) return;
      const { email, puesto, ficticio, baja, bajas, vacaciones, nota, fecha,
              desde, hasta, dias, grupo, horario, mes, revisiones, oculto, pr, numero } = req.body || {};
      // Los usuarios de prueba son cosa de quien lleva la aplicación, no de
      // quien gestiona la plantilla: ni los ve ni los crea.
      if (ficticio && quienGestiona !== GESTOR_PRINCIPAL) {
        return res.status(403).json({ error: 'Los usuarios de prueba los lleva el gestor de la aplicación' });
      }
      const clave = (email || '').toLowerCase().trim();
      if (!clave) return res.status(400).json({ error: 'Falta el email' });
      if (quienGestiona !== GESTOR_PRINCIPAL && req.method === 'PATCH') {
        const actual = (await leerTodo())[clave];
        if (actual?.comunicacion === false) {
          return res.status(403).json({ error: 'Este trabajador no mantiene la comunicación con el Departamento' });
        }
      }
      // Los usuarios de prueba solo pueden vivir bajo este dominio, para que no
      // se pueda sobrescribir a un trabajador real con datos inventados.
      if (ficticio && !clave.endsWith('@prueba.local')) {
        return res.status(400).json({ error: 'Los usuarios de prueba usan @prueba.local' });
      }

      let sinPR = false;
      const nuevo = await mutarUsuario(clave, data => {
        if (req.method === 'DELETE') delete data[clave];
        // Permiso retribuido (PR): dos por año natural. Cuentan los que marca
        // gestión y los que registra el trabajador en su app.
        else if (data[clave] && pr !== undefined && /^\d{8}$/.test(String(fecha || ''))) {
          const u = data[clave];
          const prs = new Set(Array.isArray(u.prs) ? u.prs : []);
          if (pr) {
            const usados = prUsados(u, String(fecha).slice(0, 4));
            if (!usados.has(fecha) && usados.size >= PR_ANUALES) { sinPR = true; return data; }
            prs.add(String(fecha));
          } else prs.delete(String(fecha));
          u.prs = [...prs].sort().slice(-20);
        }
        // El número de trabajador real, puesto por gestión cuando él no lo ha
        // puesto en su app. Si lo pone él, manda el suyo.
        else if (data[clave] && numero !== undefined && !ficticio) {
          const u = data[clave];
          const propio = u.conductorPropio ?? (u.conductorGestion ? '' : u.conductor) ?? '';
          u.conductorGestion = String(numero || '').replace(/[^\d-]/g, '').slice(0, 12);
          u.conductor = propio || u.conductorGestion || u.conductorAnterior || '';
        }
        else if (ficticio) {
          data[clave] = {
            ...ficticio,
            email: clave,
            ficticio: true,
            jornadas: Array.isArray(ficticio.jornadas) ? ficticio.jornadas.slice(-MAX_JORNADAS) : [],
            actualizado: new Date().toISOString(),
          };
        }
        // La baja (BE) y el lugar de trabajo son campos del gestor; una
        // publicación del trabajador los conserva porque no los sobrescribe.
        else if (data[clave] && nota !== undefined && /^\d{8}$/.test(String(fecha || ''))) {
          const notas = { ...(data[clave].notas || {}) };
          if (nota) notas[fecha] = String(nota).slice(0, 40);
          else delete notas[fecha];
          data[clave].notas = recortarNotas(notas);
        }
        else if (data[clave] && vacaciones !== undefined) {
          data[clave].vacaciones   = limpiarVacaciones(vacaciones);
          data[clave].vacacionesAt = Date.now();
        }
        else if (data[clave] && bajas !== undefined) {
          // Tramos de baja con fecha. `baja` se sigue guardando porque es lo
          // que mira la lista para pintar en gris, y sale de los tramos.
          data[clave].bajas = limpiarBajas(bajas);
          data[clave].baja  = enBajaHoy(data[clave].bajas);
        }
        else if (data[clave] && baja !== undefined) data[clave].baja = !!baja;
        // Ocultar un trabajador real de la pestaña Trabajadores, sin borrar sus
        // datos: para el que ya no está en plantilla pero cuya nómina o
        // jornadas siguen queriéndose consultar.
        // Quién lo oculta cuenta: si es el desarrollador desde su app, gestión
        // deja de verlo del todo (sus usuarios de prueba); si es gestión, lo
        // tiene en su filtro "Ocultos" para volver a mostrarlo.
        else if (data[clave] && oculto !== undefined) {
          data[clave].oculto = !!oculto;
          if (oculto) data[clave].ocultoPor = quienGestiona === GESTOR_PRINCIPAL
            && req.body?.desde === 'desarrollador' ? 'desarrollador' : 'gestion';
          else delete data[clave].ocultoPor;
        }
        // Días de la semana: se sella la hora para que gane el último que los
        // toque, venga del cuadrante o de la app del trabajador.
        // Con mes, solo ese mes (un mes de lunes a viernes, otro el fin de
        // semana); con «todos», los de siempre y fuera los de cada mes.
        else if (data[clave] && dias !== undefined && /^\d{6}$/.test(String(mes || ''))) {
          const dm = { ...(data[clave].diasMes || {}), [mes]: limpiarDiasSemana(dias) || [] };
          const claves = Object.keys(dm).sort().slice(-24);
          data[clave].diasMes = Object.fromEntries(claves.map(k => [k, dm[k]]));
        }
        else if (data[clave] && dias !== undefined) {
          data[clave].dias   = limpiarDiasSemana(dias);
          data[clave].diasAt = Date.now();
          if (req.body?.todos === true) delete data[clave].diasMes;
        }
        else if (data[clave] && grupo !== undefined) data[clave].grupo = limpiarGrupo(grupo);
        else if (data[clave] && revisiones !== undefined) {
          const antes = data[clave].revisiones || {};
          data[clave].revisiones = limpiarRevisiones(revisiones);
          // Los días en que gestión da por bueno su horario se sellan: la app
          // del trabajador corrige con él lo que tuviera registrado ese día
          const rectificados = Object.entries(data[clave].revisiones)
            .filter(([f, v]) => v === 'plan' && antes[f] !== 'plan').map(([f]) => f);
          if (rectificados.length) sellarAsignacion(data[clave], rectificados);
        }
        // Horario para unas fechas concretas. Tiene que ir antes que las dos
        // ramas de abajo: una mira solo `horario` y la otra solo el tramo, y
        // cualquiera de las dos se quedaría con esta petición.
        else if (data[clave] && horario !== undefined && desde && hasta) {
          const hs = { ...(data[clave].horariosDia || {}) };
          const limpio = limpiarHorario(horario);
          for (const f of diasEntre(desde, hasta)) {
            if (limpio) hs[f] = limpio; else delete hs[f];
          }
          data[clave].horariosDia = limpiarHorariosDia(hs);
          // «Quitar» deja esos días libres; poner una jornada los vuelve a ocupar
          const libres = { ...(data[clave].libresDia || {}) };
          const libre = req.body?.libre === true && !limpio;
          for (const f of diasEntre(desde, hasta)) { if (libre) libres[f] = 1; else delete libres[f]; }
          const claves = Object.keys(libres).sort().slice(-MAX_LUGARES);
          data[clave].libresDia = Object.fromEntries(claves.map(k => [k, 1]));
          sellarAsignacion(data[clave], diasEntre(desde, hasta));
          // El día puede ir repartido entre varios lugares. Se guarda aparte y
          // además se deja la hora de entrada y el primer lugar arriba, que es
          // lo que leen la cabecera del trabajador y el resto del cuadro.
          const trs = limpiarTramosDia(req.body?.tramos);
          const td = { ...(data[clave].tramosDia || {}) };
          for (const f of diasEntre(desde, hasta)) {
            if (trs.length > 1) td[f] = trs; else delete td[f];
          }
          data[clave].tramosDia = td;
          // Y el lugar del tramo, si viene en la misma petición: asignar la
          // jornada es decir a qué hora y dónde, y son un solo gesto.
          if (puesto !== undefined) {
            const lugares = { ...(data[clave].lugares || {}) };
            for (const f of diasEntre(desde, hasta)) {
              if (puesto) lugares[f] = String(puesto).slice(0, 40);
              else delete lugares[f];
            }
            data[clave].lugares = recortarLugares(lugares);
          }
        }
        else if (data[clave] && horario !== undefined) {
          // Con mes va al horario de ese mes; sin mes, al de siempre.
          if (/^\d{6}$/.test(String(mes || ''))) {
            data[clave].horarios = ponerHorarioDelMes(data[clave].horarios, mes, horario);
          } else {
            data[clave].horario = limpiarHorario(horario);
          }
        }
        // Lugar solo para unas fechas: va aparte de `puesto` porque la app del
        // trabajador reescribe sus jornadas enteras cada vez que publica y se
        // llevaría por delante el cambio.
        else if (data[clave] && desde && hasta) {
          const lugares = { ...(data[clave].lugares || {}) };
          for (const f of diasEntre(desde, hasta)) {
            if (puesto) lugares[f] = String(puesto).slice(0, 40);
            else delete lugares[f];
          }
          data[clave].lugares = recortarLugares(lugares);
          if (puesto && data[clave].libresDia) {
            const libres = { ...data[clave].libresDia };
            for (const f of diasEntre(desde, hasta)) delete libres[f];
            data[clave].libresDia = libres;
          }
          sellarAsignacion(data[clave], diasEntre(desde, hasta));
        }
        // Sin fechas es el lugar habitual: manda sobre cualquier excepción.
        // Se exige que venga `puesto`: si no, una petición con un campo que
        // esta versión todavía no conozca acabaría aquí y le borraría el lugar.
        else if (data[clave] && puesto !== undefined) {
          data[clave].puesto  = String(puesto || '').slice(0, 40);
          data[clave].lugares = {};
        }
        return data;
      }, req.method === 'DELETE' ? `Quitar ${clave}`
         : ficticio ? `Usuario de prueba ${clave}`
         : baja !== undefined ? `${baja ? 'Baja' : 'Alta'} de ${clave}`
         : oculto !== undefined ? `${oculto ? 'Ocultar' : 'Mostrar'} a ${clave}`
         : pr !== undefined ? `${pr ? 'PR' : 'Quitar PR'} de ${clave} el ${fecha}`
         : nota !== undefined ? `Descripción de ${clave}`
         : vacaciones !== undefined ? `Vacaciones de ${clave}`
         : bajas !== undefined ? `Bajas de ${clave}`
         : dias !== undefined ? `Días de ${clave}`
         : grupo !== undefined ? `Grupo de descanso de ${clave}`
         : revisiones !== undefined ? `Horarios revisados de ${clave}`
         : horario !== undefined && desde && hasta ? `Jornada de ${clave} del ${desde} al ${hasta}`
         : horario !== undefined ? `Horario de ${clave}`
         : desde && hasta ? `Lugar de ${clave} del ${desde} al ${hasta}`
         : `Lugar de ${clave}`, true);

      if (nuevo && req.method === 'PATCH') {
        // Si le cambia la jornada o el lugar de hoy (o el habitual), que le
        // llegue el aviso al momento; y los demás gestores, que lo vean.
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(/-/g, '');
        const tocaHoy = (desde && hasta) ? (desde <= hoy && hoy <= hasta)
                      : (puesto !== undefined || (horario !== undefined && !mes));
        await Promise.all([
          tocaHoy && (horario !== undefined || puesto !== undefined) ? avisarPersonas([clave], { tipo: 'jornada' }) : null,
          avisarGestion({ tipo: 'plantilla' }, quienGestiona),
        ]);
      }
      if (sinPR) return res.status(409).json({ error: `Ya ha usado los ${PR_ANUALES} PR de este año` });
      if (!nuevo) return res.status(500).json({ error: 'No se pudo guardar' });
      return res.status(200).json(nuevo);
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
