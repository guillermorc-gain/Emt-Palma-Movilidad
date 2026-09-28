// Correos con remitente propio: salen de la cuenta de Gmail del Departamento
// (g.rioscorrea@gmail.com) con el nombre «Gestión», en vez del
// noreply@…firebaseapp.com de Firebase, que muchas bandejas mandan a spam.
//
// Gmail deja enviar por SMTP con una «contraseña de aplicación» (una clave de
// 16 letras que se crea en la cuenta de Google con la verificación en dos
// pasos puesta). Va en Vercel como GMAIL_CLAVE_APP. Sin ella no se envía nada
// y quien llama sigue con los correos de Firebase, como antes.
//
// Es un cliente SMTP mínimo sobre TLS, sin librerías: EHLO, AUTH, MAIL, RCPT,
// DATA y QUIT, que es todo lo que hace falta para mandar un correo.
import tls from 'tls';

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PUERTO = Number(process.env.SMTP_PORT) || 465;

export const usuarioGmail = () => (process.env.GMAIL_USUARIO || 'g.rioscorrea@gmail.com').trim();
export const hayCorreoPropio = () => !!(process.env.GMAIL_CLAVE_APP || '').replace(/\s/g, '');

const b64 = t => Buffer.from(t, 'utf8').toString('base64');
// Cabecera con tildes y emojis, como manda el estándar
const cabecera = t => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64(t)}?=`;

function conversar(socket) {
  let bufer = '';
  const esperando = [];
  socket.on('data', d => {
    bufer += d.toString('utf8');
    // Una respuesta termina en una línea "NNN texto" (sin guion tras el código)
    let m;
    while ((m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(bufer))) {
      const fin = m.index + m[0].length;
      const respuesta = bufer.slice(0, fin);
      bufer = bufer.slice(fin);
      const w = esperando.shift();
      if (w) w({ codigo: Number(m[2]), texto: respuesta.trim() });
    }
  });
  const leer = () => new Promise(ok => esperando.push(ok));
  const decir = async (linea, espera) => {
    if (linea !== null) socket.write(linea + '\r\n');
    const r = await leer();
    if (espera && !espera.includes(r.codigo)) throw new Error(`SMTP ${r.codigo}: ${r.texto.slice(0, 160)}`);
    return r;
  };
  return decir;
}

export async function enviarCorreo({ para, asunto, html, texto, nombre = 'Gestión' }) {
  const usuario = usuarioGmail();
  const clave = (process.env.GMAIL_CLAVE_APP || '').replace(/\s/g, '');
  if (!clave) throw new Error('Falta GMAIL_CLAVE_APP en el servidor');
  const socket = tls.connect({ host: HOST, port: PUERTO, servername: HOST });
  socket.setTimeout(15000, () => socket.destroy(new Error('SMTP sin respuesta')));
  const decir = conversar(socket);
  const errorSocket = new Promise((_, mal) => socket.once('error', mal));
  const sesion = (async () => {
    await decir(null, [220]);
    await decir('EHLO emt-palma-movilidad.vercel.app', [250]);
    await decir('AUTH PLAIN ' + b64(`\0${usuario}\0${clave}`), [235]);
    await decir(`MAIL FROM:<${usuario}>`, [250]);
    await decir(`RCPT TO:<${para}>`, [250, 251]);
    await decir('DATA', [354]);
    const limite = 'emt' + Date.now().toString(36);
    const cuerpo = [
      `From: ${cabecera(nombre)} <${usuario}>`,
      `To: <${para}>`,
      `Subject: ${cabecera(asunto)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@emt-palma-movilidad>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${limite}"`,
      '',
      `--${limite}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(texto || '').replace(/.{76}/g, '$&\r\n'),
      `--${limite}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(html || '').replace(/.{76}/g, '$&\r\n'),
      `--${limite}--`,
    ].join('\r\n');
    await decir(cuerpo + '\r\n.', [250]);
    await decir('QUIT', null).catch(() => {});
  })();
  try {
    await Promise.race([sesion, errorSocket]);
  } finally {
    socket.end();
  }
}

// El correo de «ya estás autorizado», con un botón que lleva a la app
export function correoAutorizado({ nombre, email, app, enlace, confirmar }) {
  const esc = t => String(t || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const cual = app === 'gestion' ? 'Gestión EMT · Movilidad' : 'EMT Palma · Movilidad';
  const asunto = `✅ Tu cuenta de ${cual} ya está autorizada`;
  const boton = confirmar ? 'Confirmar mi correo y entrar' : 'Entrar en la aplicación';
  const texto = `Hola${nombre ? ' ' + nombre : ''}:\n\n`
    + `El Departamento ha autorizado tu cuenta (${email}) para usar ${cual}.\n\n`
    + (confirmar ? 'Para terminar, confirma tu correo abriendo este enlace. Después seguirás donde lo dejaste:\n'
                 : 'Abre este enlace para seguir donde lo dejaste:\n')
    + `${enlace}\n\nUn saludo,\nGestión`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2d45;">
    <h2 style="color:#1565C0;margin:0 0 12px;">✅ Tu cuenta ya está autorizada</h2>
    <p>Hola${nombre ? ' <b>' + esc(nombre) + '</b>' : ''}:</p>
    <p>El Departamento ha autorizado tu cuenta (<b>${esc(email)}</b>) para usar <b>${esc(cual)}</b>.</p>
    <p>${confirmar ? 'Para terminar, confirma tu correo con el botón. Después seguirás donde lo dejaste.'
                   : 'Pulsa el botón para seguir donde lo dejaste.'}</p>
    <p style="text-align:center;margin:24px 0;"><a href="${esc(enlace)}"
       style="background:#1565C0;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:bold;display:inline-block;">${boton}</a></p>
    <p style="font-size:12px;color:#7f8c8d;">Si el botón no funciona, copia este enlace en el navegador:<br>${esc(enlace)}</p>
    <p>Un saludo,<br>Gestión</p></div>`;
  return { asunto, html, texto };
}
