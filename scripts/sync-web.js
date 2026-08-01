// Kopiert die Web-Quelldateien vom Repo-Root nach www/, damit Capacitor
// (webDir: "www") sie in die native Android-App übernehmen kann. Root
// bleibt die eigentliche Arbeitskopie – vor jedem "npx cap sync" bzw.
// "npx cap copy" hier ausführen, damit www/ den aktuellen Stand hat.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'www');

// Vendor-Skripte für ble-test.html: node_modules wird nicht komplett mit in
// die App kopiert (viel zu groß/unnötig, u.a. Typings + Source-Maps) –
// stattdessen nur die beiden konkreten UMD-Runtime-Dateien, die die
// no-Bundler-Seite per <script> lädt (erst Capacitor-Core, global
// "capacitorExports", danach das Plugin, global
// "capacitorCommunityBluetoothLe", das darauf aufbaut). Werden zuerst nach
// root/vendor/ aktualisiert (gitignored, siehe .gitignore – reine
// node_modules-Kopie), damit ble-test.html sowohl vom Repo-Root aus lokal
// testbar ist als auch – über den Schritt weiter unten – in www/ landet.
const vendorRoot = path.join(root, 'vendor');
fs.mkdirSync(vendorRoot, { recursive: true });
fs.copyFileSync(
  path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'),
  path.join(vendorRoot, 'capacitor.js')
);
fs.copyFileSync(
  path.join(root, 'node_modules', '@capacitor-community', 'bluetooth-le', 'dist', 'plugin.js'),
  path.join(vendorRoot, 'bluetooth-le.js')
);

const dateien = ['index.html', 'chat.html', 'onboarding.html', 'situra-slider.html', 'ble-test.html'];
const ordner = ['assets', 'vendor'];

fs.mkdirSync(dest, { recursive: true });

for (const datei of dateien) {
  fs.copyFileSync(path.join(root, datei), path.join(dest, datei));
}

for (const name of ordner) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}

console.log('www/ synchronisiert:', [...dateien, ...ordner].join(', '));
