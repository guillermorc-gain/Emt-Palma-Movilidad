// Copies the gestion/ web assets to www-gestion/ for the management APK.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'gestion');
const www  = path.join(root, 'www-gestion');

fs.mkdirSync(www, { recursive: true });

['index.html', 'app.js', 'version.js', 'service-worker.js', 'manifest.json'].forEach(f => {
    const from = path.join(src, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(www, f));
});

const iconsDir = path.join(src, 'icons');
if (fs.existsSync(iconsDir)) fs.cpSync(iconsDir, path.join(www, 'icons'), { recursive: true });

// Leaflet, para el mapa de los lugares de trabajo
const vendorDir = path.join(src, 'vendor');
if (fs.existsSync(vendorDir)) fs.cpSync(vendorDir, path.join(www, 'vendor'), { recursive: true });

// Las tipografías de Opciones → Apariencia, para que funcionen sin conexión
const fontsDir = path.join(src, 'fonts');
if (fs.existsSync(fontsDir)) fs.cpSync(fontsDir, path.join(www, 'fonts'), { recursive: true });

console.log('✅ www-gestion/ built');
