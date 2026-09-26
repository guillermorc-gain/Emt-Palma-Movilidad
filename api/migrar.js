// Copia los datos del repo a la base de datos. Se llama una sola vez, justo
// antes de encender las variables de entorno, para que nadie empiece de cero.
//
// Es repetible: vuelve a copiar encima sin duplicar nada, así que se puede
// lanzar otra vez si entre medias alguien ha publicado.
//
//   POST /api/migrar          copia trabajadores y notas
//   GET  /api/migrar          solo cuenta qué hay a cada lado, sin tocar nada

import { exigirAdmin } from './_auth.js';
import { hayBaseDeDatos, leerUsuarios, leerNotas, guardarUsuario, guardarNota } from './_almacen.js';
import { REPO_DATOS as REPO, RAMA_DATOS as BRANCH, ghFetch } from './_datos.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github.raw',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

// En bruto, que no tiene el tope de 1 MB de la API de contenidos
async function leerDelRepo(fichero) {
  const r = await ghFetch(
    `https://api.github.com/repos/${REPO}/contents/${fichero}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: ghHeaders(), cache: 'no-store' }
  );
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`GitHub ${r.status} al leer ${fichero}`);
  const texto = await r.text();
  if (!texto.trim()) return {};
  const datos = JSON.parse(texto);
  return datos && typeof datos === 'object' ? datos : {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  // La firma de la sesión obliga al navegador a preguntar antes en cada
  // petición; sin esto repetiría esa pregunta cada pocos segundos.
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;

  if (!hayBaseDeDatos()) {
    return res.status(400).json({
      error: 'Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno',
    });
  }

  try {
    const [usuariosRepo, notasRepo] = await Promise.all([
      leerDelRepo('usuarios-resumen.json'),
      leerDelRepo('notas.json'),
    ]);

    if (req.method === 'GET') {
      const [enBaseU, enBaseN] = await Promise.all([leerUsuarios(), leerNotas('')]);
      return res.status(200).json({
        repo: { usuarios: Object.keys(usuariosRepo).length, notas: Object.keys(notasRepo).length },
        base: { usuarios: Object.keys(enBaseU).length, notas: enBaseN.length },
      });
    }

    // De uno en uno: son pocos y así un fallo suelto no se lleva el resto
    let usuarios = 0, notas = 0;
    const fallos = [];
    for (const [email, datos] of Object.entries(usuariosRepo)) {
      try { await guardarUsuario(email, datos); usuarios++; }
      catch (e) { fallos.push(`usuario ${email}: ${e.message}`); }
    }
    for (const nota of Object.values(notasRepo)) {
      if (!nota?.id) continue;
      try { await guardarNota(nota); notas++; }
      catch (e) { fallos.push(`nota ${nota.id}: ${e.message}`); }
    }
    return res.status(200).json({ copiados: { usuarios, notas }, fallos });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
