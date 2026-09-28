// Copies web assets to www/ for Capacitor to bundle into the Android APK.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www  = path.join(root, 'www');

fs.mkdirSync(www, { recursive: true });

['index.html', 'app.js', 'version.js', 'service-worker.js', 'manifest.json'].forEach(f => {
    const src = path.join(root, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(www, f));
});

const iconsDir = path.join(root, 'icons');
if (fs.existsSync(iconsDir)) fs.cpSync(iconsDir, path.join(www, 'icons'), { recursive: true });

// Las tipografías de Opciones → Apariencia, para que funcionen sin conexión
const fontsDir = path.join(root, 'fonts');
if (fs.existsSync(fontsDir)) fs.cpSync(fontsDir, path.join(www, 'fonts'), { recursive: true });

console.log('✅ www/ built');
