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
// QR-Erzeugung für den Kopplungs-Bildschirm (chat.html, Abschnitt
// VERBINDUNG). qrcode-generator hat KEINE Abhängigkeiten und deklariert
// intern "var qrcode" auf oberster Ebene – in einem klassischen <script>
// ist das eine globale Variable, ganz ohne Bundler. Genau derselbe Weg
// wie bei den beiden Dateien darüber.
fs.copyFileSync(
  path.join(root, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js'),
  path.join(vendorRoot, 'qrcode.js')
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

// ── Gruppen-Fotos: assets/gruppen/ → Gruppenbilder in chat.html ────
// Exakt dasselbe Prinzip wie assets/avatars/ oben, nur für Gruppen:
// Dateiname (ohne Endung) muss dem Gruppennamen entsprechen (z. B.
// "Wochenende.jpg" für die Gruppe "Wochenende"). Anders als bei
// Kontakten wird der Name hier NICHT aus dem Dateinamen abgeleitet
// (Gruppennamen sind freier Text, oft mit Leerzeichen) – stattdessen
// gleicht chat.html (gruppenBildAusManifestAufloesen) den Dateinamen
// 1:1 gegen den bereits vorhandenen Gruppennamen ab.
const gruppenOrdner = path.join(root, 'assets', 'gruppen');

const gruppenDateien = fs.existsSync(gruppenOrdner)
  ? fs.readdirSync(gruppenOrdner)
      .filter(function (datei) { return AVATAR_BILD_ENDUNGEN.includes(path.extname(datei).toLowerCase()); })
      .sort(function (a, b) { return a.localeCompare(b, 'de'); })
  : [];

console.log('Gruppenbilder gefunden:', gruppenDateien.length, gruppenDateien);

// stresstest.html gehört bewusst dazu, umfrage.html bewusst nicht:
// Der Wahrnehmungstest läuft im Browser, der Stresstest braucht dagegen
// das Bluetooth-Band – und das Capacitor-Plugin dafür gibt es nur in der
// gebauten App. Im reinen Browser bliebe die Seite ohne Messwerte.
// webseite.html ist bewusst NICHT dabei: Das ist die Projektseite,
// nicht Teil der App. App und Webseite bleiben getrennt – sie würde
// im Android-Bundle nur Platz kosten und dort nie aufgerufen.
const dateien = ['index.html', 'chat.html', 'onboarding.html', 'ble-test.html', 'stresstest.html'];
const ordner = ['assets', 'vendor'];

fs.mkdirSync(dest, { recursive: true });

// ── Manifeste in chat.html einsetzen ──────────────────────────────
//
// WICHTIG, und genau hier lag ein Fehler: Die Manifeste wurden bisher
// NUR in www/chat.html geschrieben. Die Datei im Wurzelverzeichnis
// behielt ihren leeren Platzhalter – und genau die liefert GitHub
// Pages aus. Im Web erschienen deshalb weder Kontaktfotos noch die
// echten Namen, sondern die fest einprogrammierte Rückfallliste
// (Anna, Ben, Clara …), während dieselbe App auf dem Handy alles
// richtig zeigte.
//
// Jetzt wird BEIDES geschrieben: Wurzel und www/. Damit verhält sich
// die Web-Auslieferung identisch zur App.
//
// Die Ersetzung muss dafür WIEDERHOLBAR sein: Nach dem ersten Lauf
// steht in der Wurzeldatei kein leeres "[]" mehr, sondern die zuletzt
// eingesetzte Liste. Ein Muster, das nur auf "[]" passt, würde beim
// zweiten Lauf nichts mehr finden. Die Regex fasst deshalb den Marker
// plus ein beliebiges folgendes Array.
const AVATARS_MARKER = '/* @AVATARS_MANIFEST@ */';
const GRUPPEN_MARKER = '/* @GRUPPEN_MANIFEST@ */';

function manifestErsetzen(inhalt, marker, liste, bezeichnung) {
  // Marker maskieren (enthält * und /), danach beliebiges Array fassen.
  const maskiert = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const muster = new RegExp(maskiert + '\\s*\\[[^\\]]*\\]');
  if (!muster.test(inhalt)) {
    throw new Error(
      'chat.html: Marker "' + marker + '" mit folgendem Array nicht gefunden – ' +
      'wurde er umbenannt/entfernt? Die App würde sonst ohne ' + bezeichnung + ' gebaut.'
    );
  }
  return inhalt.replace(muster, marker + ' ' + JSON.stringify(liste));
}

const chatHtmlQuelle = fs.readFileSync(path.join(root, 'chat.html'), 'utf8');
const chatHtmlFertig = manifestErsetzen(
  manifestErsetzen(chatHtmlQuelle, AVATARS_MARKER, avatarDateien, 'Kontaktfotos'),
  GRUPPEN_MARKER, gruppenDateien, 'Gruppenbilder'
);

// In die Wurzeldatei nur schreiben, wenn sich wirklich etwas ändert –
// sonst entstünde bei jedem Lauf eine Änderung in der Versionierung,
// obwohl inhaltlich alles gleich bleibt.
if (chatHtmlFertig !== chatHtmlQuelle) {
  fs.writeFileSync(path.join(root, 'chat.html'), chatHtmlFertig);
  console.log('chat.html (Wurzel): Manifeste aktualisiert – wird so auch im Web ausgeliefert');
}
fs.writeFileSync(path.join(dest, 'chat.html'), chatHtmlFertig);
fs.copyFileSync(path.join(root, 'avatars-manifest.json'), path.join(dest, 'avatars-manifest.json'));

for (const datei of dateien) {
  if (datei === 'chat.html') continue; // oben bereits mit eingebettetem Manifest geschrieben
  fs.copyFileSync(path.join(root, datei), path.join(dest, datei));
}

for (const name of ordner) {
  fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
}

console.log('www/ synchronisiert:', [...dateien, ...ordner].join(', '));
