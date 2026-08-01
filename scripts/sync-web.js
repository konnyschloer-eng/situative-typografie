// Kopiert die Web-Quelldateien vom Repo-Root nach www/, damit Capacitor
// (webDir: "www") sie in die native Android-App übernehmen kann. Root
// bleibt die eigentliche Arbeitskopie – vor jedem "npx cap sync" bzw.
// "npx cap copy" hier ausführen, damit www/ den aktuellen Stand hat.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'www');

const dateien = ['index.html', 'chat.html', 'onboarding.html', 'situra-slider.html'];
const ordner = ['assets'];

fs.mkdirSync(dest, { recursive: true });

for (const datei of dateien) {
  fs.copyFileSync(path.join(root, datei), path.join(dest, datei));
}

for (const name of ordner) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}

console.log('www/ synchronisiert:', [...dateien, ...ordner].join(', '));
