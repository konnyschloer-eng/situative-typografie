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

// ── Kontakt-Fotos: assets/avatars/ → avatars-manifest.json ─────────
// Der Browser kann Verzeichnisinhalte nicht selbst auflisten (auch
// nicht in der gebauten Capacitor-App) – deshalb schreibt dieser
// Sync-Schritt eine einfache Liste der gefundenen Bilddateinamen
// nach avatars-manifest.json. chat.html lädt diese Datei per fetch()
// und baut daraus optional die Kontaktliste; schlägt das fehl (Datei
// fehlt/ist leer/Fetch-Fehler), bleibt dort die fest einprogrammierte
// Kontaktliste als Sicherheitsnetz aktiv – siehe chat.html,
// kontaktlisteAusManifestErsetzen.
const avatarOrdner = path.join(root, 'assets', 'avatars');
const AVATAR_BILD_ENDUNGEN = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const avatarDateien = fs.existsSync(avatarOrdner)
  ? fs.readdirSync(avatarOrdner)
      .filter(function (datei) { return AVATAR_BILD_ENDUNGEN.includes(path.extname(datei).toLowerCase()); })
      .sort(function (a, b) { return a.localeCompare(b, 'de'); })
  : [];

fs.writeFileSync(
  path.join(root, 'avatars-manifest.json'),
  JSON.stringify(avatarDateien, null, 2) + '\n'
);

console.log('avatars-manifest.json aktualisiert:', avatarDateien.length, 'Bild(er)', avatarDateien);

const dateien = ['index.html', 'chat.html', 'onboarding.html', 'situra-slider.html', 'ble-test.html', 'avatars-manifest.json'];
const ordner = ['assets', 'vendor'];

fs.mkdirSync(dest, { recursive: true });

for (const datei of dateien) {
  fs.copyFileSync(path.join(root, datei), path.join(dest, datei));
}

for (const name of ordner) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}

console.log('www/ synchronisiert:', [...dateien, ...ordner].join(', '));
