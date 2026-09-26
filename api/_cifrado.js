// Cifrado de lo que se guarda en el repositorio y no debe leer nadie más:
// los registros del puesto de control de acceso y su directorio de
// visitantes, con nombres y matrículas de gente de otras empresas.
//
// El repositorio es público, así que el fichero va cifrado con AES-256-GCM.
// La clave sale del token de GitHub que ya tiene Vercel como secreto: no hay
// nada más que configurar, y sin ese secreto el fichero es ruido. Si algún
// día se cambia el token, lo guardado deja de poder leerse; las copias de
// Drive —la de cada trabajador y la del desarrollador— lo devuelven con
// "Restaurar".
import crypto from 'node:crypto';

const clave = () => crypto.createHash('sha256')
  .update('emt-control-acceso:' + (process.env.GITHUB_TOKEN || '')).digest();

export function cifrar(objeto) {
  if (!process.env.GITHUB_TOKEN) throw new Error('Sin clave para cifrar');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(JSON.stringify(objeto), 'utf8'), c.final()]);
  return { cifrado: 'v1', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'),
           datos: datos.toString('base64') };
}

// Lo que no venga cifrado se devuelve tal cual; si viene cifrado y no se
// puede abrir, falla: mejor parar que guardar encima un vacío.
export function descifrar(guardado) {
  if (!guardado || guardado.cifrado !== 'v1') return guardado || {};
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(guardado.iv, 'base64'));
  d.setAuthTag(Buffer.from(guardado.tag, 'base64'));
  try {
    const texto = Buffer.concat([d.update(Buffer.from(guardado.datos, 'base64')), d.final()]).toString('utf8');
    return JSON.parse(texto);
  } catch (_) {
    throw new Error('No se pueden abrir los datos guardados (¿ha cambiado la clave?). Restaura desde una copia de Drive.');
  }
}
