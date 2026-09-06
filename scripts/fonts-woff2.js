// Erzeugt die .woff2-Dateien aus den Schriftquellen in
// assets/fonts/Situra/OpenType-TT/.
//
// WARUM ES DAS GIBT
// Die .woff2 lagen bis September 2026 nur statisch im Ordner – einmal
// erzeugt, danach nie wieder. Das ist gefährlich: Die @font-face-Regeln
// nennen .woff2 ZUERST, der Browser nimmt also immer diese Datei. Wird
// nur die Quelldatei (.otf/.ttf) ausgetauscht, lädt die App weiterhin
// die alte Schrift – ohne Fehlermeldung, ohne sichtbaren Hinweis.
// Genau dieser Fall ist eingetreten und war von außen nicht erkennbar.
//
// Läuft als erster Schritt von "npm run sync-web" (siehe package.json)
// und damit auch bei "npm run cap:sync". Quelle und Ergebnis können so
// nicht mehr auseinanderlaufen.
//
// GRUNDSATZ: Bei jedem Fehler bricht das Skript mit Exit-Code 1 ab.
// Eine stehengebliebene alte .woff2 ist schlimmer als ein abgebrochener
// Sync, weil sie wie ein funktionierender Zustand aussieht.
const fs = require('fs');
const path = require('path');
const { compress } = require('wawoff2');

const SCHRIFT_ORDNER = path.join(__dirname, '..', 'assets', 'fonts', 'Situra', 'OpenType-TT');
// .otf (CFF/PostScript) und .ttf (TrueType) sind beide zulässige
// Quellen – WOFF2 ist nur ein Container, die Umrissart bleibt erhalten.
const QUELL_ENDUNGEN = ['.otf', '.ttf'];

async function main() {
  if (!fs.existsSync(SCHRIFT_ORDNER)) {
    console.error('[Schrift] Ordner nicht gefunden: ' + SCHRIFT_ORDNER);
    process.exit(1);
  }

  const quellen = fs.readdirSync(SCHRIFT_ORDNER)
    .filter(function (d) { return QUELL_ENDUNGEN.includes(path.extname(d).toLowerCase()); })
    .sort();

  if (!quellen.length) {
    console.error('[Schrift] Keine .otf/.ttf in ' + SCHRIFT_ORDNER + ' gefunden – nichts zu erzeugen.');
    console.error('[Schrift] Das ist fast sicher ein Fehler: ohne Quelldateien kann die App keine Schrift laden.');
    process.exit(1);
  }

  // Doppelte Basisnamen (z. B. Situra-Regular.otf UND .ttf) würden
  // einander überschreiben – dann wäre nicht mehr bestimmbar, welche
  // Quelle in der .woff2 steckt.
  const gesehen = new Map();
  for (const q of quellen) {
    const basis = path.basename(q, path.extname(q));
    if (gesehen.has(basis)) {
      console.error('[Schrift] "' + basis + '" liegt doppelt vor: ' + gesehen.get(basis) + ' und ' + q + '.');
      console.error('[Schrift] Beide würden dieselbe .woff2 erzeugen. Bitte eine der beiden entfernen.');
      process.exit(1);
    }
    gesehen.set(basis, q);
  }

  let erzeugt = 0;
  for (const datei of quellen) {
    const quellPfad = path.join(SCHRIFT_ORDNER, datei);
    const zielPfad  = path.join(SCHRIFT_ORDNER, path.basename(datei, path.extname(datei)) + '.woff2');

    const roh = fs.readFileSync(quellPfad);
    let aus;
    try {
      aus = Buffer.from(await compress(roh));
    } catch (fehler) {
      console.error('[Schrift] Umwandlung von ' + datei + ' fehlgeschlagen: ' + fehler.message);
      console.error('[Schrift] ABBRUCH. Eine evtl. vorhandene alte ' + path.basename(zielPfad)
        + ' bleibt liegen und würde weiterhin geladen – bitte prüfen, bevor synchronisiert wird.');
      process.exit(1);
    }

    // Gegenprobe: Der WOFF2-Kopf trägt die Größe des Originals mit.
    // Weicht sie stark von der Quelldatei ab, stimmt etwas nicht.
    const signatur = aus.toString('ascii', 0, 4);
    const originalGroesse = aus.readUInt32BE(16);
    if (signatur !== 'wOF2') {
      console.error('[Schrift] ' + datei + ': Ergebnis trägt keine wOF2-Signatur – ABBRUCH.');
      process.exit(1);
    }
    if (Math.abs(originalGroesse - roh.length) > roh.length * 0.05) {
      console.error('[Schrift] ' + datei + ': WOFF2 nennt ' + originalGroesse
        + ' Byte Originalgröße, die Quelle hat ' + roh.length + ' – ABBRUCH.');
      process.exit(1);
    }

    fs.writeFileSync(zielPfad, aus);
    erzeugt++;
    const anteil = Math.round(aus.length / roh.length * 100);
    console.log('[Schrift] ' + datei.padEnd(22) + ' → ' + path.basename(zielPfad).padEnd(24)
      + String(roh.length).padStart(7) + ' → ' + String(aus.length).padStart(7) + ' Byte (' + anteil + ' %)');
  }

  // Verwaiste .woff2 ohne Quelldatei: Reste eines umbenannten oder
  // entfernten Schnitts. Sie würden weiter mitsynchronisiert und im
  // Zweifel geladen – deshalb ausdrücklich melden.
  const basisNamen = new Set(quellen.map(function (q) { return path.basename(q, path.extname(q)); }));
  const verwaist = fs.readdirSync(SCHRIFT_ORDNER)
    .filter(function (d) { return path.extname(d).toLowerCase() === '.woff2'; })
    .filter(function (d) { return !basisNamen.has(path.basename(d, '.woff2')); });

  if (verwaist.length) {
    console.warn('[Schrift] WARNUNG: ' + verwaist.length + ' .woff2 ohne zugehörige Quelldatei: '
      + verwaist.join(', '));
    console.warn('[Schrift] Vermutlich Reste eines umbenannten Schnitts – bitte von Hand entfernen.');
  }

  console.log('[Schrift] ' + erzeugt + ' .woff2 aus ' + quellen.length + ' Quelldatei(en) neu erzeugt.');
}

main().catch(function (fehler) {
  console.error('[Schrift] Unerwarteter Fehler:', fehler);
  process.exit(1);
});
