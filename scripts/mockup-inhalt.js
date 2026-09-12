// ══════════════════════════════════════════════════════════════════
//  INHALT DES MOCKUPS
//
//  Wird von build-mockup.js in mockup-chat.html eingesetzt. Hier steht
//  NUR, welche Rohwerte gezeigt werden – wie daraus Typografie wird,
//  entscheidet ausschließlich sensorZuSchriftAchse aus chat.html.
//
//  Die Zahlen sind Rohwerte der Sensor-Skala (100–900), also genau das,
//  was in der App aus Band und Tippverhalten entsteht. Kein einziger
//  typografischer Wert ist hier von Hand gesetzt.
// ══════════════════════════════════════════════════════════════════

// Neutrale Grundlage – einzelne Wörter weichen davon ab.
function roh(ueberschreibung) {
  return Object.assign({
    intensitaet: 500, tempo: 500, stabilitaet: 900,
    tonalitaet: 500, schlafqualitaet: 900, atemfrequenz: 900
  }, ueberschreibung || {});
}

// ── Eingehende Nachricht ──────────────────────────────────────────
// "hey, alles okay bei dir?" – ruhig gesetzt. Intensität um 500 trifft
// Situra-Medium (mittlere Strichstärke), Tempo um 450 eine normale
// Laufweite. Stabilität und Schlaf auf dem oberen Anschlag: kein
// Zittern, keine Unschärfe. Die kleinen Abweichungen von Wort zu Wort
// sind Absicht – gleichmäßige Werte über alle Wörter kommen beim
// echten Tippen nicht vor.
const EINGEHEND = {
  text: 'hey, alles okay bei dir?',
  vonMir: false,
  rohwerte: [
    roh({ intensitaet: 520, tempo: 470 }),   // hey,
    roh({ intensitaet: 495, tempo: 440 }),   // alles
    roh({ intensitaet: 510, tempo: 455 }),   // okay
    roh({ intensitaet: 480, tempo: 430 }),   // bei
    roh({ intensitaet: 505, tempo: 460 })    // dir?
  ]
};

// ── Eigene Antwort ────────────────────────────────────────────────
// "ja, mir geht's gut" – der Wortlaut sagt das eine, der Zustand das
// andere. Intensität über 800 trifft Situra-Black (schwerster Schnitt),
// hohes Tempo zieht die Laufweite zusammen, niedrige Stabilität lässt
// die Buchstaben zittern, abgesenkter Schlafwert macht sie weich.
//
// ENTSCHEIDEND: "gut" ist deutlich gezögert – Tempo 150 statt 880.
// Daraus wird eine weite Laufweite, während die drei Wörter davor eng
// stehen. Genau so entsteht es beim echten Wort-für-Wort-Einfrieren:
// Wer vor einem Wort zögert, dehnt es. Dass ausgerechnet die
// Bestätigung gedehnt wird, ist der Widerspruch, um den es geht.
const ANTWORT = {
  text: "ja, mir geht's gut",
  vonMir: true,
  // Zur Unschärfe: Ein erster Versuch stand bei Schlafwerten um 340
  // (rund 0,96 px). Am Bildschirm geprüft war "geht's" damit nicht mehr
  // lesbar – die Unschärfe kommt auf die enge Laufweite von Black
  // obendrauf, und beides zusammen lässt die Buchstaben verschmelzen.
  // Werte um 580 ergeben rund 0,55 px: sichtbar weich, aber jeder
  // Buchstabe bleibt einzeln erkennbar. Das entspricht auch eher dem
  // "leicht weich" der Vorgabe.
  rohwerte: [
    roh({ intensitaet: 800, tempo: 870, stabilitaet: 260, schlafqualitaet: 620 }), // ja,
    roh({ intensitaet: 830, tempo: 890, stabilitaet: 230, schlafqualitaet: 600 }), // mir
    roh({ intensitaet: 850, tempo: 880, stabilitaet: 200, schlafqualitaet: 570 }), // geht's
    roh({ intensitaet: 820, tempo: 150, stabilitaet: 180, schlafqualitaet: 550 })  // gut  ← gezögert
  ]
};

// Baut einen Verlaufs-Eintrag im Format, das nachrichtElementErstellen
// erwartet: wortSnapshots mit fertig berechneten Achsen je Wort.
function eintragBauen(quelle) {
  return {
    text: quelle.text,
    vonMir: quelle.vonMir,
    einblendDauer: sensorZuSchriftAchse(quelle.rohwerte[0]).einblendDauer,
    wortSnapshots: quelle.rohwerte.map(function (r) {
      return { achsen: sensorZuSchriftAchse(r), leblos: false };
    })
  };
}

// ── Kopfzeile ─────────────────────────────────────────────────────
document.getElementById('chat-partner-name').textContent = 'Marie';
document.getElementById('chat-partner-avatar').textContent = 'M';

// Band verbunden zeigen – sonst sähe es aus, als käme die Darstellung
// aus Testreglern statt aus einer echten Messung.
const bandBtn = document.getElementById('band-btn');
bandBtn.textContent = 'Verbunden';
bandBtn.classList.add('verbunden');
const bpmLive = document.getElementById('band-bpm-live');
bpmLive.hidden = false;
bpmLive.textContent = '92 bpm';

// ── Sensor-Anzeige ────────────────────────────────────────────────
// Aufgeklappt, damit im Foto erkennbar ist, woher die Darstellung
// kommt. Die Werte entsprechen dem Zustand der eigenen Antwort – der
// Screen zeigt also nicht irgendwelche Zahlen, sondern die, aus denen
// die Blase darunter entstanden ist.
const drawer = document.getElementById('info-drawer');
if (drawer) drawer.classList.add('offen');
const griff = document.getElementById('info-drawer-griff');
if (griff) griff.setAttribute('aria-expanded', 'true');

// Mittelwert der Antwort-Rohwerte – das ist der Zustand, in dem sie
// geschrieben wurde.
function mittel(feld) {
  return Math.round(ANTWORT.rohwerte.reduce(function (s, r) { return s + r[feld]; }, 0)
                    / ANTWORT.rohwerte.length);
}
const ANZEIGE = {
  intensitaet: mittel('intensitaet'),
  tempo:       mittel('tempo'),
  stabilitaet: mittel('stabilitaet'),
  schlaf:      340   // Wachheit: aus der Nacht-Auswertung, nicht aus dem Tippen
};

function setzen(id, wert) { const el = document.getElementById(id); if (el) el.textContent = wert; }
function balken(id, wert) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, (wert - 100) / 8)) + '%';
}

setzen('wert-intensitaet', ANZEIGE.intensitaet);
const sliderInt = document.getElementById('slider-intensitaet');
if (sliderInt) sliderInt.value = ANZEIGE.intensitaet;
// Mit Band ist die Intensität eine Messung, kein Testwert.
const badgeInt = document.getElementById('badge-intensitaet');
if (badgeInt) badgeInt.hidden = true;
const labelInt = document.getElementById('label-intensitaet');
if (labelInt) labelInt.classList.add('dimension-label--live');

setzen('wert-tempo', ANZEIGE.tempo);              balken('balken-tempo', ANZEIGE.tempo);
setzen('wert-stabilitaet', ANZEIGE.stabilitaet);  balken('balken-stabilitaet', ANZEIGE.stabilitaet);
setzen('wert-wachheit', ANZEIGE.schlaf);          balken('balken-wachheit', ANZEIGE.schlaf);
const labelWach = document.getElementById('label-wachheit');
if (labelWach) labelWach.innerHTML = 'Wachheit';  // echte Nacht vorhanden

// Profil-Werte, falls im Markup vorhanden
setzen('profil-wert-puls', '92 bpm');
setzen('profil-wert-stabilitaet', ANZEIGE.stabilitaet);

// ── Nachrichten einsetzen ─────────────────────────────────────────
const chat = document.getElementById('chat');
chat.innerHTML = '';
[EINGEHEND, ANTWORT].forEach(function (quelle) {
  const el = nachrichtElementErstellen(eintragBauen(quelle));
  chat.appendChild(el);
  // Kontur erst NACH dem Einfügen – sie braucht echtes Layout.
  blasenKonturEinrichten(el.querySelector('.text'));
});

// Eingabefeld leer und ohne Fokus – es ist ein Standbild.
const eingabe = document.getElementById('eingabe');
if (eingabe) { eingabe.value = ''; eingabe.blur(); }

// Für eine Kontrolle von außen (Konsole), nicht fürs Foto:
window.__mockup = {
  eingehend: EINGEHEND,
  antwort: ANTWORT,
  achsenJeWort: function (quelle) {
    return quelle.rohwerte.map(function (r, i) {
      const a = sensorZuSchriftAchse(r);
      return {
        wort: quelle.text.split(/\s+/)[i],
        schnitt: a.schriftschnitt,
        laufweite: +a.spacing.toFixed(3),
        zittern: +a.wobble.toFixed(2),
        unschaerfe: +a.blur.toFixed(2)
      };
    });
  }
};
