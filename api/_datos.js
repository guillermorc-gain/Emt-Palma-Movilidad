// Dónde se guardan los datos: la plantilla, las nóminas, las notas, los
// registros del puesto de control de acceso…
//
// El código de las apps y sus versiones van en el repositorio público, que es
// de donde las apps se descargan y se actualizan. Los datos son de gente real
// y no pueden ir ahí: van a un repositorio privado, que se dice en Vercel con
// DATOS_REPO (p. ej. guillermorc-gain/RegistroHorario-datos) y DATOS_BRANCH
// (main si no se dice). El token de GITHUB_TOKEN tiene que poder escribir en él.
//
// Mientras DATOS_REPO no esté puesto, todo sigue en la rama datos del público,
// como siempre. Al ponerlo, cada fichero que todavía no esté en el privado se
// lee del público la primera vez y se guarda ya en el privado: el traslado se
// hace solo, sin parar las apps.
// El repositorio se renombró (antes RegistroHorario): GitHub redirige el
// nombre viejo, pero mejor ir directo.
export const REPO_PUBLICO = process.env.CODIGO_REPO || 'guillermorc-gain/Emt-Palma-Movildad';
export const RAMA_PUBLICA = 'datos';
export const REPO_DATOS   = process.env.DATOS_REPO || REPO_PUBLICO;
export const RAMA_DATOS   = process.env.DATOS_BRANCH || (process.env.DATOS_REPO ? 'main' : RAMA_PUBLICA);

// fetch para la API de contenidos de GitHub. Si al leer del privado el fichero
// aún no está, se trae el del público sin su sha: para el privado es nuevo, y
// al guardar se crea ahí.
export async function ghFetch(url, op = {}) {
  const r = await fetch(url, op);
  const metodo = String(op.method || 'GET').toUpperCase();
  if (r.status !== 404 || metodo !== 'GET' || REPO_DATOS === REPO_PUBLICO) return r;
  const publica = String(url)
    .replace(`/repos/${REPO_DATOS}/`, `/repos/${REPO_PUBLICO}/`)
    .replace(/([?&]ref=)[^&]*/, `$1${RAMA_PUBLICA}`);
  const r2 = await fetch(publica, op);
  if (!r2.ok) return r;
  const meta = await r2.json();
  const sinSha = { ...meta, sha: undefined };
  return { ok: true, status: 200, json: async () => sinSha, text: async () => JSON.stringify(sinSha) };
}
