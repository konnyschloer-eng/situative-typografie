'use strict';

// ═══════════════════════════════════════════════════════════════
//  END-TO-END-TEST – wachsende Kontaktliste
//
//  Läuft bewusst gegen die ECHTE Adresse (wss://…/ws), nicht gegen
//  localhost: so wird die vollständige Strecke geprüft, die auch das
//  Handy nimmt – Caddy, TLS-Zertifikat, WebSocket-Upgrade, Server.
//
//    node test-e2e.js
//    node test-e2e.js ws://127.0.0.1:8080/ws     (ohne Caddy)
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');

const ADRESSE = process.argv[2] || 'wss://212-227-70-31.sslip.io/ws';

// Kleinstmögliches gültiges JPEG als Data-URL – steht hier für das
// heruntergerechnete Profilbild, das die App erzeugt.
const BILD_A = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
               'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
               'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const BILD_B = BILD_A.replace('/9j/4AAQ', '/9j/4AAR');   // andere Bytes, gleiche Form

let bestanden = 0;
let gescheitert = 0;

function pruefe(bedingung, beschreibung, zusatz) {
  if (bedingung) {
    bestanden++;
    console.log('  ✓ ' + beschreibung);
  } else {
    gescheitert++;
    console.log('  ✗ ' + beschreibung + (zusatz ? '\n      → ' + zusatz : ''));
  }
}

// Ein simuliertes Handy: verbindet sich und sammelt eingehende
// Nachrichten, damit der Test gezielt auf einen Typ warten kann.
function handy(bezeichnung) {
  const ws = new WebSocket(ADRESSE);
  const eingang = [];
  const wartende = [];

  ws.on('message', (daten) => {
    const nachricht = JSON.parse(daten.toString());
    const index = wartende.findIndex((w) => w.typ === nachricht.typ);
    if (index >= 0) {
      const [w] = wartende.splice(index, 1);
      clearTimeout(w.uhr);
      w.aufloesen(nachricht);
    } else {
      eingang.push(nachricht);
    }
  });

  return {
    bezeichnung,
    ws,
    offen() {
      return new Promise((aufloesen, ablehnen) => {
        ws.on('open', aufloesen);
        ws.on('error', ablehnen);
      });
    },
    sende(objekt) { ws.send(JSON.stringify(objekt)); },
    warteAuf(typ, msFrist = 8000) {
      const index = eingang.findIndex((n) => n.typ === typ);
      if (index >= 0) return Promise.resolve(eingang.splice(index, 1)[0]);
      return new Promise((aufloesen, ablehnen) => {
        const uhr = setTimeout(() => {
          ablehnen(new Error(bezeichnung + ': Zeitüberschreitung beim Warten auf "' + typ +
            '" – stattdessen kam: ' + JSON.stringify(eingang)));
        }, msFrist);
        wartende.push({ typ, aufloesen, uhr });
      });
    },
    // Prüft, dass innerhalb der Frist NICHTS dieses Typs eintrifft.
    kommtNicht(typ, msFrist = 1200) {
      return new Promise((aufloesen) => {
        setTimeout(() => aufloesen(!eingang.some((n) => n.typ === typ)), msFrist);
      });
    },
    schliessen() {
      return new Promise((aufloesen) => { ws.on('close', aufloesen); ws.close(); });
    }
  };
}

// Ein Wort so, wie chat.html es besiegelt (wortZustaende).
function wort(werte) {
  return {
    roh: Object.assign({
      intensitaet: 500, tempo: 500, stabilitaet: 500,
      tonalitaet: 500, schlafqualitaet: 500, atemfrequenz: 500
    }, werte),
    pausenZuschlag: 0,
    leblos: false
  };
}

async function anmelden(h, name, bild) {
  const anmeldung = { typ: 'hallo' };
  if (name) anmeldung.name = name;
  if (bild) anmeldung.bild = bild;
  h.sende(anmeldung);
  return h.warteAuf('willkommen');
}

// Koppelt zwei Handys über einen Code und gibt beide Meldungen zurück.
async function koppeln(zeigt, gibtEin) {
  zeigt.sende({ typ: 'code-erzeugen' });
  const code = (await zeigt.warteAuf('code')).code;
  gibtEin.sende({ typ: 'koppeln', code });
  return {
    beiGeber:  await zeigt.warteAuf('kontakt-neu'),
    beiNehmer: await gibtEin.warteAuf('kontakt-neu'),
    code
  };
}

async function main() {
  console.log('Adresse: ' + ADRESSE + '\n');

  // ── 1. Anmelden mit Profil ───────────────────────────────────
  console.log('1. Geräte melden sich mit Name und Profilbild an');
  const a = handy('Handy A');
  const b = handy('Handy B');
  await Promise.all([a.offen(), b.offen()]);

  const wA = await anmelden(a, 'Anja', BILD_A);
  const wB = await anmelden(b, 'Bruno', BILD_B);

  pruefe(!!wA.geraetId && !!wA.geheim, 'Handy A bekommt Geräte-ID und Geheimnis');
  pruefe(wA.geraetId !== wB.geraetId, 'Beide Geräte bekommen verschiedene IDs');
  pruefe(Array.isArray(wA.kontakte) && wA.kontakte.length === 0, 'Kontaktliste startet leer');
  pruefe(Array.isArray(wA.nachrichten), 'Feld "nachrichten" ist immer vorhanden');

  // ── 2. Erster Kontakt ────────────────────────────────────────
  console.log('\n2. Erste Kopplung überträgt Name und Bild');
  const k1 = await koppeln(a, b);

  pruefe(k1.beiNehmer.kontakt.id === wA.geraetId, 'Handy B kennt jetzt Handy A');
  pruefe(k1.beiNehmer.kontakt.name === 'Anja', 'Der NAME kommt mit, nicht der Raum-Code',
    'bekam: ' + k1.beiNehmer.kontakt.name);
  pruefe(k1.beiNehmer.kontakt.bild === BILD_A, 'Das BILD kommt mit');
  pruefe(k1.beiGeber.kontakt.name === 'Bruno', 'Auch die andere Richtung überträgt den Namen');
  pruefe(k1.beiGeber.kontakt.bild === BILD_B, 'Auch die andere Richtung überträgt das Bild');

  // ── 3. Zweiter Kontakt – der eigentliche Umbau ───────────────
  console.log('\n3. Zweite Kopplung ERGÄNZT, statt die erste zu ersetzen');
  const c = handy('Handy C');
  await c.offen();
  const wC = await anmelden(c, 'Cem', null);

  const k2 = await koppeln(a, c);
  pruefe(k2.beiNehmer.kontakt.id === wA.geraetId, 'Handy C kennt jetzt Handy A');
  pruefe(k2.beiGeber.kontakt.name === 'Cem', 'Handy A erfährt den Namen von Handy C');
  pruefe(k2.beiGeber.kontakt.bild === null, 'Ohne Profilbild kommt null, kein Fehler');

  // Handy A neu anmelden und die Kontaktliste prüfen – das ist der Kern:
  // im alten 1:1-Modell hätte C den Kontakt B überschrieben.
  const a2 = handy('Handy A (neu)');
  await a2.offen();
  a2.sende({ typ: 'hallo', geraetId: wA.geraetId, geheim: wA.geheim });
  const wA2 = await a2.warteAuf('willkommen');

  pruefe(wA2.kontakte.length === 2, 'Handy A hat jetzt ZWEI Kontakte',
    'bekam: ' + wA2.kontakte.length);
  const namenA = wA2.kontakte.map((k) => k.name).sort();
  pruefe(namenA.join(',') === 'Bruno,Cem', 'Beide Kontakte sind erhalten', 'bekam: ' + namenA.join(','));
  pruefe(wA2.kontakte.some((k) => k.bild === BILD_B), 'Das Bild bleibt in der Kontaktliste gespeichert');

  // ── 4. Nachricht an einen BESTIMMTEN Kontakt ─────────────────
  console.log('\n4. Nachrichten gehen an den adressierten Kontakt');
  a2.sende({
    typ: 'nachricht', an: wB.geraetId, text: 'Hallo Bruno',
    woerter: [wort({ intensitaet: 640 }), wort({ tempo: 310 })]
  });
  const beiB = await b.warteAuf('nachricht');
  pruefe(beiB.text === 'Hallo Bruno', 'Handy B empfängt die Nachricht');
  pruefe(beiB.woerter[0].roh.intensitaet === 640, 'Rohwerte bleiben erhalten');
  pruefe(await c.kommtNicht('nachricht'), 'Handy C bekommt sie NICHT');

  // Bestätigung hier abholen, sonst bliebe sie in der Warteschlange
  // liegen und Schritt 5 würde SIE statt der dortigen greifen.
  const bestaetigung1 = await a2.warteAuf('gesendet');
  pruefe(bestaetigung1.zugestellt === true, 'Bestätigung meldet zugestellt, solange der Kontakt online ist');
  pruefe(bestaetigung1.an === wB.geraetId, 'Die Bestätigung nennt den Empfänger');

  a2.sende({ typ: 'nachricht', an: 'fremde-id', text: 'Hallo', woerter: [] });
  const fremdFehler = await a2.warteAuf('fehler');
  pruefe(/Kein Kontakt/i.test(fremdFehler.grund), 'An Nicht-Kontakte kann nicht gesendet werden',
    fremdFehler.grund);

  // ── 5. Offline-Zustellung, danach gelöscht ───────────────────
  console.log('\n5. Offline-Zustellung – ohne dauerhaften Verlauf');
  await b.schliessen();
  await new Promise((r) => setTimeout(r, 400));

  a2.sende({ typ: 'nachricht', an: wB.geraetId, text: 'Bist du da', woerter: [wort({})] });
  const bestaetigung = await a2.warteAuf('gesendet');
  pruefe(bestaetigung.zugestellt === false, 'Nachricht an ein offline-Gerät gilt als nicht zugestellt');

  const b2 = handy('Handy B (neu)');
  await b2.offen();
  b2.sende({ typ: 'hallo', geraetId: wB.geraetId, geheim: wB.geheim });
  const wB2 = await b2.warteAuf('willkommen');

  pruefe(wB2.nachrichten.length === 1, 'Die wartende Nachricht wird nachgeliefert',
    'bekam: ' + wB2.nachrichten.length);
  pruefe(wB2.nachrichten[0].text === 'Bist du da', 'Inhalt stimmt');

  // Erneut anmelden: jetzt darf NICHTS mehr kommen – der Server führt
  // keinen Verlauf, ausgelieferte Nachrichten sind gelöscht.
  const b3 = handy('Handy B (drittes Mal)');
  await b3.offen();
  b3.sende({ typ: 'hallo', geraetId: wB.geraetId, geheim: wB.geheim });
  const wB3 = await b3.warteAuf('willkommen');
  pruefe(wB3.nachrichten.length === 0, 'Beim nächsten Anmelden kommt sie NICHT nochmal',
    'bekam: ' + wB3.nachrichten.length);
  pruefe(wB3.kontakte.length === 1, 'Die Kontakte bleiben dagegen erhalten');

  // ── 6. Profiländerung erreicht alle Kontakte ─────────────────
  console.log('\n6. Profiländerung wird an alle Kontakte verteilt');
  a2.sende({ typ: 'hallo', geraetId: wA.geraetId, geheim: wA.geheim, name: 'Anja K.', bild: BILD_B });

  const beiBProfil = await b3.warteAuf('kontakt-profil');
  const beiCProfil = await c.warteAuf('kontakt-profil');
  pruefe(beiBProfil.name === 'Anja K.', 'Handy B erfährt den neuen Namen', 'bekam: ' + beiBProfil.name);
  pruefe(beiBProfil.bild === BILD_B, 'Handy B erfährt das neue Bild');
  pruefe(beiCProfil.kontaktId === wA.geraetId, 'Handy C wird ebenfalls informiert (alle Kontakte)');
  await a2.warteAuf('willkommen');   // Antwort aufs erneute hallo abräumen

  // ── 7. Prüfung der Eingaben ──────────────────────────────────
  console.log('\n7. Der Server prüft, was hereinkommt');
  const d = handy('Handy D');
  await d.offen();
  d.sende({ typ: 'hallo', bild: 'nicht-wirklich-ein-bild' });
  const bildFehler = await d.warteAuf('fehler');
  pruefe(/Profilbild/i.test(bildFehler.grund), 'Eine kaputte Bild-Angabe wird abgelehnt', bildFehler.grund);

  const e = handy('Handy E');
  await e.offen();
  e.sende({ typ: 'hallo', bild: 'data:image/jpeg;base64,' + 'A'.repeat(70000) });
  const grossFehler = await e.warteAuf('fehler');
  pruefe(/Profilbild/i.test(grossFehler.grund), 'Ein zu großes Bild wird abgelehnt (statt die Verbindung zu sprengen)',
    grossFehler.grund);

  await Promise.all([a.schliessen(), a2.schliessen(), b2.schliessen(), b3.schliessen(),
                     c.schliessen(), d.schliessen(), e.schliessen()]);

  console.log('\n' + '─'.repeat(50));
  console.log('Bestanden: ' + bestanden + '   Gescheitert: ' + gescheitert);
  process.exit(gescheitert === 0 ? 0 : 1);
}

main().catch((fehler) => {
  console.error('\nTest abgebrochen: ' + fehler.message);
  process.exit(1);
});
