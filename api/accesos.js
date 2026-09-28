// El registro de entradas y salidas del puesto de Control de acceso. Quien
// hace el turno en la garita apunta cada vehículo o persona que entra —la
// hora, la matrícula, quién es, de qué empresa, en qué viene y a qué
// departamento va— y, cuando se va, la hora de salida.
//
// Aparte va el directorio de visitantes: lo que se sabe de cada matrícula.
// Se va llenando solo con cada registro, para que la próxima vez que venga
// el mismo baste con poner la matrícula.
//
// Los dos ficheros van cifrados (ver _cifrado.js): el repositorio es público.
//
//   accesos.json    { "<id>": { id, fecha, entrada, salida, matricula, nombre,
//                               empresa, vehiculo, departamento, obs, ... } }
//   visitantes.json { "<MATRICULA>": { matricula, nombre, empresa, vehiculo,
//                                      departamento, visto, personas } }
//
// Un mismo coche a veces lo traen personas distintas: personas guarda cada
// una con lo suyo (nombre, empresa, departamento y cuándo vino), la última
// primero, para que en la garita se pueda elegir quién viene hoy.
import { emailDelToken, tokenDe, esGestorControl, esDelPuesto, GESTOR_PRINCIPAL } from './_auth.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';
import { cifrar, descifrar } from './_cifrado.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const F_ACCESOS    = 'accesos.json';
const F_VISITANTES = 'visitantes.json';

const MAX_REGISTROS  = 8000;   // unos años de garita; los más viejos se caen
const MAX_VISITANTES = 3000;
const MAX_TEXTO      = 120;
const MAX_PERSONAS   = 10;     // por matrícula

const claveNombre = n => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Las personas de una ficha; las de antes de guardarlas tienen solo una
function personasDe(f) {
  if (!f) return [];
  if (Array.isArray(f.personas) && f.personas.length) return f.personas.filter(p => p && p.nombre);
  return f.nombre ? [{ nombre: f.nombre, empresa: f.empresa || '', vehiculo: f.vehiculo || '',
                       departamento: f.departamento || '', visto: f.visto || '' }] : [];
}

// Una ficha con su lista de personas: lo de arriba es lo de la última que vino
function ficha(matricula, personas, base = {}, extra = {}) {
  const ps = [...personas].sort((a, b) => String(b.visto || '').localeCompare(String(a.visto || '')))
    .slice(0, MAX_PERSONAS);
  const top = ps[0] || base || {};
  return {
    ...base, ...extra,
    matricula,
    nombre: top.nombre || '', empresa: top.empresa || '', vehiculo: top.vehiculo || '',
    departamento: top.departamento || '',
    visto: ps.reduce((m, p) => (String(p.visto || '') > m ? String(p.visto) : m), String(base?.visto || '')),
    personas: ps,
  };
}

// Quien viene en este registro pasa delante en la lista de esa matrícula
function conPersona(personas, r, ahora) {
  const lista = Array.isArray(personas) ? personas.filter(p => p && p.nombre) : [];
  if (!r.nombre) return lista.slice(0, MAX_PERSONAS);
  const k = claveNombre(r.nombre);
  const previa = lista.find(p => claveNombre(p.nombre) === k) || {};
  const nueva = {
    nombre:       r.nombre,
    empresa:      r.empresa      || previa.empresa      || '',
    vehiculo:     r.vehiculo     || previa.vehiculo     || '',
    departamento: r.departamento || previa.departamento || '',
    visto:        ahora,
  };
  return [nueva, ...lista.filter(p => claveNombre(p.nombre) !== k)].slice(0, MAX_PERSONAS);
}

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

async function getFile(fichero) {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${fichero}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' }
  );
  if (r.status === 404) return { data: {}, sha: null };   // aún no existe
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + fichero);
  const meta = await r.json();
  const texto = await leerContenido(meta);
  if (!texto.trim()) return { data: {}, sha: meta.sha };
  // Va cifrado: son nombres y matrículas de gente real en un repositorio público
  const parsed = descifrar(JSON.parse(texto));
  return { data: parsed && typeof parsed === 'object' ? parsed : {}, sha: meta.sha };
}

async function setFile(fichero, data, sha, mensaje) {
  const content = Buffer.from(JSON.stringify(cifrar(data)) + '\n').toString('base64');
  const body = { message: mensaje, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${fichero}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.status;
}

// Dos garitas pueden escribir a la vez; con 409 se vuelve a leer y se reintenta.
async function guardarConReintento(fichero, mutar, mensaje) {
  for (let intento = 0; intento < 4; intento++) {
    const { data, sha } = await getFile(fichero);
    const nuevo = mutar(data);
    if (!nuevo) return null;
    const status = await setFile(fichero, nuevo, sha, mensaje);
    if (status >= 200 && status < 300) return nuevo;
    if (status !== 409) throw new Error('GitHub ' + status + ' al guardar ' + fichero);
  }
  throw new Error('No se pudo guardar: otra garita estaba escribiendo a la vez');
}

const texto  = (t, max = MAX_TEXTO) => String(t ?? '').trim().slice(0, max);
const esFecha = f => /^\d{8}$/.test(String(f || ''));
const esHora  = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
// La matrícula se escribe de mil maneras —con guion, sin él, en minúsculas—:
// para buscarla solo cuentan las letras y los números.
export const claveMatricula = m => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Con sus guiones aunque vengan sin ellos (lo mismo que hacen las apps, para
// lo que llegue de las que aún no se han actualizado)
export function formatoMatricula(m) {
  const t = String(m || '').trim().toUpperCase();
  const k = claveMatricula(t);
  let x = /^(\d{4})([A-Z]{3})$/.exec(k);
  if (x) return `${x[1]}-${x[2]}`;
  x = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/.exec(k);
  if (x) return `${x[1]}-${x[2]}-${x[3]}`;
  return t;
}

function limpiarRegistro(b, previo) {
  const v = (k, max) => (b[k] !== undefined ? texto(b[k], max) : (previo?.[k] || ''));
  const r = {
    id:           previo?.id || texto(b.id, 40)
                  || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    fecha:        esFecha(b.fecha) ? b.fecha : (previo?.fecha || ''),
    entrada:      esHora(b.entrada) ? b.entrada : (previo?.entrada || ''),
    salida:       b.salida === '' ? '' : (esHora(b.salida) ? b.salida : (previo?.salida || '')),
    matricula:    formatoMatricula(v('matricula', 20)),
    nombre:       v('nombre', 80),
    empresa:      v('empresa', 80),
    vehiculo:     v('vehiculo', 80),
    departamento: v('departamento', 60),
    obs:          v('obs', 300),
  };
  return r;
}

// Lo que se aprende de un registro pasa al directorio: lo nuevo manda, pero
// un campo vacío no borra lo que ya se sabía.
function aprender(visitantes, r, ahora) {
  const clave = claveMatricula(r.matricula);
  if (!clave) return visitantes;
  const previo = visitantes[clave] || {};
  const out = { ...visitantes };
  out[clave] = {
    matricula:    r.matricula || previo.matricula || '',
    nombre:       r.nombre       || previo.nombre       || '',
    empresa:      r.empresa      || previo.empresa      || '',
    vehiculo:     r.vehiculo     || previo.vehiculo     || '',
    departamento: r.departamento || previo.departamento || '',
    visto:        ahora,
    personas:     conPersona(previo.personas?.length ? previo.personas
                    : (previo.nombre ? [{ nombre: previo.nombre, empresa: previo.empresa, vehiculo: previo.vehiculo,
                                          departamento: previo.departamento, visto: previo.visto || '' }] : []),
                    r, ahora),
  };
  const claves = Object.keys(out);
  if (claves.length <= MAX_VISITANTES) return out;
  // Si se pasa, se van los que hace más que no vienen
  claves.sort((a, b) => String(out[a].visto || '').localeCompare(String(out[b].visto || '')));
  claves.slice(0, claves.length - MAX_VISITANTES).forEach(k => delete out[k]);
  return out;
}

function acotar(data) {
  const lista = Object.values(data);
  if (lista.length <= MAX_REGISTROS) return data;
  lista.sort((a, b) => `${a.fecha}${a.entrada}`.localeCompare(`${b.fecha}${b.entrada}`));
  return Object.fromEntries(lista.slice(-MAX_REGISTROS).map(r => [r.id, r]));
}

const orden = (a, b) => (b.fecha || '').localeCompare(a.fecha || '')
                      || (b.entrada || '').localeCompare(a.entrada || '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Lo que entra y sale de las instalaciones no lo lee cualquiera: solo la
    // gente del puesto y el desarrollador, que guarda la copia en su Drive.
    const quien = await emailDelToken(tokenDe(req));
    if (!quien) return res.status(401).json({ error: 'Vuelve a entrar en la app' });
    const esDesarrollador = quien === GESTOR_PRINCIPAL;
    if (!esDesarrollador && !await esDelPuesto(quien)) {
      return res.status(403).json({ error: `Esta cuenta (${quien}) no tiene acceso al puesto de control de acceso` });
    }
    const mandaEl = esDesarrollador || await esGestorControl(quien);
    const que = String(req.query?.que || '');

    // ── Directorio de visitantes ─────────────────────────────────────────
    if (que === 'visitantes') {
      if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-store');
        const { data } = await getFile(F_VISITANTES);
        return res.status(200).json(Object.values(data)
          .sort((a, b) => (a.nombre || a.matricula || '').localeCompare(b.nombre || b.matricula || '', 'es')));
      }
      if (req.method === 'POST' && req.body?.ficha) {
        // Crear o corregir una ficha a mano, desde la del puesto. Cada ficha
        // es una persona con su matrícula, y una matrícula puede tener
        // varias: antes/antesNombre dicen cuál se está corrigiendo (vacíos
        // si es nueva). Aquí sí vale dejar un campo vacío.
        if (!mandaEl) return res.status(403).json({ error: 'Solo gestión puede tocar el directorio' });
        const b = req.body.ficha || {};
        const clave = claveMatricula(b.matricula);
        if (!clave) return res.status(400).json({ error: 'Falta la matrícula' });
        const antes = claveMatricula(req.body.antes);
        const antesNombre = texto(req.body.antesNombre, 80);
        const persona = { nombre: texto(b.nombre, 80), empresa: texto(b.empresa, 80),
                          vehiculo: texto(b.vehiculo, 80), departamento: texto(b.departamento, 60) };
        const firma = { editado: new Date().toISOString(), editadoPor: quien };
        let repetida = false;
        const nuevo = await guardarConReintento(F_VISITANTES, data => {
          const out = { ...data };
          let vistoPrevio = '';
          // La persona que se corrige sale de donde estaba
          if (antes && out[antes]) {
            const ps = personasDe(out[antes]);
            const quitada = antesNombre ? ps.find(x => claveNombre(x.nombre) === claveNombre(antesNombre)) : null;
            vistoPrevio = quitada?.visto || out[antes].visto || '';
            if (quitada) {
              const quedan = ps.filter(x => x !== quitada);
              if (quedan.length) out[antes] = ficha(out[antes].matricula, quedan, out[antes]);
              else delete out[antes];
            } else if (antes !== clave) {
              // Una ficha sin personas (de las de antes) que cambia de matrícula
              if (!ps.length) delete out[antes];
            }
          }
          const destino = out[clave];
          const psDest = personasDe(destino);
          // La misma persona dos veces en la misma matrícula, no
          if (persona.nombre && psDest.some(x => claveNombre(x.nombre) === claveNombre(persona.nombre))) {
            repetida = true; return null;
          }
          if (!persona.nombre && destino && !antes) { repetida = true; return null; }
          const lista = persona.nombre ? [...psDest, { ...persona, visto: vistoPrevio }] : psDest;
          out[clave] = ficha(formatoMatricula(texto(b.matricula, 20)), lista,
                             persona.nombre ? destino : { ...destino, ...persona }, firma);
          return out;
        }, `Ficha de ${clave} en el directorio`);
        if (repetida) return res.status(409).json({ error: 'Esa persona ya está con esa matrícula en el directorio' });
        return res.status(200).json(nuevo?.[clave] || {});
      }
      if (req.method === 'POST') {
        // Añadir o corregir fichas; nunca borrar las que no vengan. Así sirve
        // para restaurar una copia sin llevarse lo nuevo por delante.
        const lista = Array.isArray(req.body?.lista) ? req.body.lista.slice(0, MAX_VISITANTES) : [];
        const ahora = new Date().toISOString();
        const nuevo = await guardarConReintento(F_VISITANTES, data => {
          let out = { ...data };
          for (const b of lista) {
            const r = limpiarRegistro(b || {}, null);
            out = aprender(out, r, texto(b?.visto, 40) || ahora);
          }
          return out;
        }, `Directorio de visitantes (${lista.length})`);
        return res.status(200).json({ ok: true, total: Object.keys(nuevo || {}).length });
      }
      if (req.method === 'DELETE') {
        if (!mandaEl) return res.status(403).json({ error: 'Solo gestión puede quitar a alguien del directorio' });
        const clave = claveMatricula(req.query?.matricula);
        if (!clave) return res.status(400).json({ error: 'Falta la matrícula' });
        // Con nombre se quita solo esa persona; la matrícula se va con la última
        const nombre = texto(req.query?.nombre, 80);
        await guardarConReintento(F_VISITANTES, data => {
          if (!data[clave]) return null;
          const out = { ...data };
          const quedan = nombre ? personasDe(out[clave]).filter(x => claveNombre(x.nombre) !== claveNombre(nombre)) : [];
          if (quedan.length) out[clave] = ficha(out[clave].matricula, quedan, out[clave]);
          else delete out[clave];
          return out;
        }, `Quitar ${nombre || clave} del directorio`);
        return res.status(200).json({ ok: true });
      }
      return res.status(405).end();
    }

    // ── Registros de entrada y salida ────────────────────────────────────
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const { data } = await getFile(F_ACCESOS);
      const desde = esFecha(req.query?.desde) ? req.query.desde : '';
      const hasta = esFecha(req.query?.hasta) ? req.query.hasta : '';
      // Todos los del puesto ven todos: lo que entra con un turno lo saca el
      // siguiente, y tiene que poder apuntarle la salida.
      const lista = Object.values(data)
        .filter(r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta))
        .sort(orden);
      return res.status(200).json(lista);
    }

    if (req.method === 'DELETE') {
      const id = texto(req.query?.id, 40);
      if (!id) return res.status(400).json({ error: 'Falta el registro' });
      let prohibido = false;
      const nuevo = await guardarConReintento(F_ACCESOS, data => {
        const r = data[id];
        if (!r) return null;
        // Borrar es de gestión; quien lo apuntó puede quitar lo suyo del día,
        // por si se equivocó, pero no lo de otros ni lo de otros días.
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).replace(/-/g, '');
        if (!mandaEl && !(r.creadoPor === quien && r.fecha === hoy)) { prohibido = true; return null; }
        const out = { ...data }; delete out[id]; return out;
      }, `Borrar el registro ${id}`);
      if (prohibido) return res.status(403).json({ error: 'Solo gestión puede borrar este registro' });
      if (!nuevo) return res.status(404).json({ error: 'Ese registro ya no está' });
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).end();

    // Uno o varios (varios es al restaurar una copia: solo entran los que no
    // estén, y los que estén no se tocan).
    const varios = Array.isArray(req.body?.registros);
    const entrada = varios ? req.body.registros.slice(0, 2000) : [req.body || {}];
    const ahora = new Date().toISOString();
    // Quién es, con su nombre y su número de trabajador, que es como se le
    // conoce en el puesto: el correo lo dice el token; esto lo manda la app.
    const autor = req.body?.autor || {};
    const autorNombre = texto(autor.nombre, 80);
    const autorNum    = texto(autor.num, 20);
    let guardados = [];
    await guardarConReintento(F_ACCESOS, data => {
      const out = { ...data };
      guardados = [];
      for (const b of entrada) {
        const previo = b?.id ? out[texto(b.id, 40)] : null;
        if (varios && previo) continue;
        const { autor: _a, ...sinAutor } = b || {};
        const r = limpiarRegistro(sinAutor, previo);
        if (!esFecha(r.fecha) || !esHora(r.entrada)) {
          if (varios) continue;
          throw Object.assign(new Error('Falta el día o la hora de entrada'), { status: 400 });
        }
        if (!r.matricula && !r.nombre) {
          if (varios) continue;
          throw Object.assign(new Error('Pon al menos la matrícula o el nombre'), { status: 400 });
        }
        const final = {
          ...r,
          creado:     previo?.creado || (varios && texto(b.creado, 40)) || ahora,
          creadoPor:  previo?.creadoPor || (varios && texto(b.creadoPor, 80)) || quien,
          creadoNombre: previo ? (previo.creadoNombre || '') : ((varios && texto(b.creadoNombre, 80)) || autorNombre),
          creadoNum:    previo ? (previo.creadoNum || '')    : ((varios && texto(b.creadoNum, 20)) || autorNum),
          actualizado: ahora,
          tocadoPor:  quien,
          tocadoNombre: autorNombre,
          tocadoNum:    autorNum,
        };
        out[final.id] = final;
        guardados.push(final);
      }
      return guardados.length ? acotar(out) : null;
    }, varios ? `Restaurar ${entrada.length} registros de acceso` : 'Registro de acceso');

    // Y lo que se ha aprendido de cada uno, al directorio. Que esto falle no
    // estropea el registro, que es lo importante.
    const conMatricula = guardados.filter(r => claveMatricula(r.matricula));
    if (conMatricula.length) {
      try {
        await guardarConReintento(F_VISITANTES, data => {
          let out = data;
          conMatricula.forEach(r => { out = aprender(out, r, ahora); });
          return out;
        }, 'Directorio de visitantes');
      } catch (_) { /* se aprenderá la próxima vez */ }
    }
    return res.status(200).json(varios ? { ok: true, guardados: guardados.length } : (guardados[0] || {}));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
