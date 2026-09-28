// Copia lo de control/ a www-control/, que es de donde sale el APK del puesto
// de control de acceso. Las dos aplicaciones del puesto salen de aquí: lo que
// las distingue lo cambia el montaje sobre esta copia.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'control');
const www  = path.join(root, 'www-control');

fs.mkdirSync(www, { recursive: true });

['index.html', 'app.js', 'version.js', 'service-worker.js', 'manifest.json'].forEach(f => {
    const from = path.join(src, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(www, f));
});

const iconsDir = path.join(src, 'icons');
if (fs.existsSync(iconsDir)) fs.cpSync(iconsDir, path.join(www, 'icons'), { recursive: true });

// Las tipografías de Opciones → Apariencia, para que funcionen sin conexión
const fontsDir = path.join(src, 'fonts');
if (fs.existsSync(fontsDir)) fs.cpSync(fontsDir, path.join(www, 'fonts'), { recursive: true });

console.log('✅ www-control/ built');
