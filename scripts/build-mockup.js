// Erzeugt mockup-chat.html aus chat.html.
//
// WARUM ERZEUGT UND NICHT VON HAND GESCHRIEBEN
// Das Mockup soll zeigen, was das System tatsächlich erzeugt. Ein
// nachgebauter Chat-Screen wäre nach der ersten Änderung an chat.html
// still veraltet – und eine Dokumentation, die etwas zeigt, das die
// App so nicht mehr tut, ist schlimmer als gar keine.
//
// Deshalb werden CSS und die typografische Rechenkette WÖRTLICH aus
// chat.html übernommen. Ändert sich dort etwas, genügt ein erneuter
// Lauf: npm run mockup
//
// chat.html wird dabei nur gelesen, nie verändert.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'chat.html');
const ZIEL   = path.join(ROOT, 'mockup-chat.html');

const src = fs.readFileSync(QUELLE, 'utf8');

function abbruch(text) {
  console.error('[Mockup] ' + text);
  console.error('[Mockup] ABBRUCH – mockup-chat.html wurde NICHT geschrieben.');
  process.exit(1);
}

// ── Stylesheet vollständig übernehmen ──────────────────────────────
// Der komplette <style>-Block, unverändert. Dadurch sind Kopfzeile,
// Sprechblasen, Sensor-Anzeige und Fußleiste garantiert identisch –
// bis auf das letzte Pixel, ohne dass hier irgendetwas nachgepflegt
// werden müsste.
const stilTreffer = src.match(/<style>([\s\S]*?)<\/style>/);
if (!stilTreffer) abbruch('Kein <style>-Block in chat.html gefunden.');
const STIL = stilTreffer[1];

// ── Benannte Bausteine aus dem Skript schneiden ────────────────────
// Funktionen stehen in chat.html auf zwei Leerzeichen eingerückt und
// enden auf "\n  }". Die beiden Nicht-Funktionen sind gesondert
// beschrieben.
function funktion(name) {
  const anker = '\n  function ' + name + '(';
  const a = src.indexOf(anker);
  if (a === -1) abbruch('Funktion "' + name + '" nicht in chat.html gefunden.');
  const e = src.indexOf('\n  }', a);
  if (e === -1) abbruch('Ende von "' + name + '" nicht gefunden.');
  return src.slice(a + 1, e + 4);
}

function ausdruck(beschreibung, regex) {
  const t = src.match(regex);
  if (!t) abbruch(beschreibung + ' nicht in chat.html gefunden.');
  return t[0];
}

const TEILE = [
  ausdruck('SITURA_SCHRIFTSCHNITTE', /const SITURA_SCHRIFTSCHNITTE = \[[\s\S]*?\];/),
  ausdruck('SPACING_WEIT',           /const SPACING_WEIT = [0-9.]+;/),
  ausdruck('SPACING_ENG_PRO_SCHNITT',/const SPACING_ENG_PRO_SCHNITT = \{[\s\S]*?\};/),
  ausdruck('SPACING_ENG_STANDARD',   /const SPACING_ENG_STANDARD = [-0-9.]+;/),
  funktion('umrechnen'),
  funktion('intensitaetZuSchriftschnitt'),
  funktion('sensorZuSchriftAchse'),

  // Zitter-Stylesheet: zwei Zeilen, keine Funktion.
  "  const zitterStyleEl = document.createElement('style');\n" +
  '  document.head.appendChild(zitterStyleEl);\n',

  funktion('erstelleZitterAnimation'),
  funktion('buchstabenAnimieren'),
  funktion('stilAnwenden'),
  funktion('stilNeutralAnwenden'),

  funktion('blasenPfad'),
  funktion('blasenKonturAktualisieren'),

  // ResizeObserver: ebenfalls keine Funktion, endet auf "});".
  ausdruck('blasenKonturBeobachter',
    /const blasenKonturBeobachter = new ResizeObserver\(function \(entries\) \{[\s\S]*?\n  \}\);/),

  funktion('blasenSchriftenLaden'),
  funktion('blasenKonturEinrichten'),
  funktion('nachrichtElementErstellen')
];

// ── Markup der Chat-Ansicht wörtlich übernehmen ────────────────────
// Von <div class="ansicht" id="ansicht-chat"> bis zum schließenden
// </div> vor der nächsten Ansicht. So stimmen Kopfzeile, Sensor-
// Anzeige und Fußleiste exakt.
const mAnfang = src.indexOf('<div class="ansicht ansicht--versteckt" id="ansicht-chat">');
if (mAnfang === -1) abbruch('Chat-Ansicht (id="ansicht-chat") nicht gefunden.');
const mEnde = src.indexOf('\n  </div>', src.indexOf('<footer class="eingabe-bereich">', mAnfang));
if (mEnde === -1) abbruch('Ende der Chat-Ansicht nicht gefunden.');
let MARKUP = src.slice(mAnfang, mEnde + '\n  </div>'.length);

// Für das Standbild sichtbar schalten (in der App wird die Klasse per
// JS entfernt, hier gibt es kein Umschalten).
MARKUP = MARKUP.replace('class="ansicht ansicht--versteckt"', 'class="ansicht"');

// ── Zusammensetzen ─────────────────────────────────────────────────
const MOCKUP_JS = fs.readFileSync(path.join(__dirname, 'mockup-inhalt.js'), 'utf8');

const seite = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mockup – Einzelchat</title>

<!-- ══════════════════════════════════════════════════════════════
     ERZEUGT von scripts/build-mockup.js aus chat.html.
     NICHT von Hand bearbeiten – Änderungen gehen beim nächsten Lauf
     verloren. Inhalt und Werte stehen in scripts/mockup-inhalt.js,
     Aussehen und Rechenkette kommen wörtlich aus chat.html.
     Neu erzeugen:  npm run mockup
     ══════════════════════════════════════════════════════════════ -->

<style>${STIL}</style>

<style>
  /* Nur fürs Standbild – ändert nichts an der Darstellung der
     Nachrichten selbst, macht die Seite bloß aufnahmebereit. */
  body { margin: 0; background: #202020; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; }
  .phone-frame { width: 390px; height: 844px; }  /* Gerätemaß, feste Größe fürs Foto */

  /* Bedienelemente bleiben sichtbar (sie gehören zum Screen), reagieren
     aber nicht – es ist ein Standbild, kein bedienbarer Prototyp. */
  .ansicht button, .ansicht input { pointer-events: none; }
</style>
</head>
<body>

<div class="phone-frame emotion-an" id="phone-frame">
${MARKUP}
</div>

<script>
(function () {
  'use strict';

// ══════════════════════════════════════════════════════════════════
//  WÖRTLICH AUS chat.html – von build-mockup.js eingesetzt
// ══════════════════════════════════════════════════════════════════
${TEILE.join('\n')}

// ══════════════════════════════════════════════════════════════════
//  INHALT DES MOCKUPS – aus scripts/mockup-inhalt.js
// ══════════════════════════════════════════════════════════════════
${MOCKUP_JS}
})();
</script>
</body>
</html>
`;

fs.writeFileSync(ZIEL, seite);
console.log('[Mockup] mockup-chat.html erzeugt (' + Math.round(seite.length / 1024) + ' KB).');
console.log('[Mockup] Übernommen: Stylesheet, Chat-Markup und ' + TEILE.length + ' Skript-Bausteine aus chat.html.');
