// Kopiert die Web-Quelldateien vom Repo-Root nach www/, damit Capacitor
// (webDir: "www") sie in die native Android-App übernehmen kann. Root
// bleibt die eigentliche Arbeitskopie – vor jedem "npx cap sync" bzw.
// "npx cap copy" hier ausführen, damit www/ den aktuellen Stand hat.
// WICHTIG: auch nach jedem Hinzufügen/Entfernen einer Datei in
// assets/avatars/ erneut ausführen – sonst bleibt avatars-manifest.json
// (und damit die aus Fotos abgeleitete Kontaktliste in chat.html) veraltet.
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

// ── Kontakt-Fotos: assets/avatars/ → Kontaktliste in chat.html ─────
// Der Browser kann Verzeichnisinhalte nicht selbst auflisten (auch
// nicht in der gebauten Capacitor-App) – deshalb liest dieser
// Sync-Schritt assets/avatars/ aus und trägt die gefundenen
// Bilddateinamen direkt in chat.html ein (Platzhalter-Kommentar
// "/* @AVATARS_MANIFEST@ */ []" → echtes Array). Bewusst NICHT per
// fetch() einer separaten JSON-Datei nachgeladen: das schlägt fehl,
// wenn chat.html direkt als Datei geöffnet wird (file://) – Browser
// unterstützen fetch() für das file-Schema grundsätzlich nicht, die
// Kontaktliste wäre dann immer nur die feste Anna/Ben-Liste, obwohl
// echte Fotos vorhanden sind. Die feste Sicherheitsnetz-Liste bleibt
// unverändert, wenn assets/avatars/ leer ist – siehe chat.html,
// kontaktlisteAusManifestErsetzen.
//
// avatars-manifest.json wird zusätzlich weiterhin geschrieben (nicht
// mehr von chat.html selbst benutzt, aber nützlich zum Nachschauen/
// Debuggen, welche Dateien zuletzt gefunden wurden).
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

const dateien = ['index.html', 'chat.html', 'onboarding.html', 'situra-slider.html', 'ble-test.html'];
const ordner = ['assets', 'vendor'];

fs.mkdirSync(dest, { recursive: true });

const AVATARS_MANIFEST_PLATZHALTER = '/* @AVATARS_MANIFEST@ */ []';
const chatHtmlQuelle = fs.readFileSync(path.join(root, 'chat.html'), 'utf8');
if (!chatHtmlQuelle.includes(AVATARS_MANIFEST_PLATZHALTER)) {
  throw new Error(
    'chat.html: Platzhalter "' + AVATARS_MANIFEST_PLATZHALTER + '" nicht gefunden – ' +
    'wurde er umbenannt/entfernt? www/chat.html würde sonst ohne Kontaktfotos gebaut.'
  );
}
fs.writeFileSync(
  path.join(dest, 'chat.html'),
  chatHtmlQuelle.replace(AVATARS_MANIFEST_PLATZHALTER, '/* @AVATARS_MANIFEST@ */ ' + JSON.stringify(avatarDateien))
);
fs.copyFileSync(path.join(root, 'avatars-manifest.json'), path.join(dest, 'avatars-manifest.json'));

for (const datei of dateien) {
  if (datei === 'chat.html') continue; // oben bereits mit eingebettetem Manifest geschrieben
  fs.copyFileSync(path.join(root, datei), path.join(dest, datei));
}

for (const name of ordner) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}

console.log('www/ synchronisiert:', [...dateien, ...ordner].join(', '));
