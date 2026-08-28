'use strict';

// ═══════════════════════════════════════════════════════════════
//  MOMENTUM – CHAT-SERVER
//
//  Verbindet Handys zu einer wachsenden Kontaktliste. Aufgabe:
//   1. Geräte dauerhaft wiedererkennen (ID + Geheimnis, kein Login)
//   2. Geräte über einen 6-stelligen Code koppeln – beliebig oft,
//      jede Kopplung fügt einen weiteren Kontakt hinzu
//   3. Profile (Name + Miniaturbild) zwischen Kontakten verteilen
//   4. Nachrichten weiterleiten und für abwesende Geräte puffern
//
//  ── WAS DER SERVER NICHT TUT ─────────────────────────────────
//  Er führt KEINEN Gesprächsverlauf. Ist der Empfänger verbunden,
//  wird die Nachricht durchgereicht und nie geschrieben; ist er es
//  nicht, liegt sie genau so lange in der Tabelle, bis er sie abholt,
//  und wird dann gelöscht. Dauerhaft gespeichert sind ausschließlich
//  Kontaktdaten – Geräte-ID, Name, Miniaturbild und wer mit wem
//  gekoppelt ist.
//
//  ── PROFILBILDER ─────────────────────────────────────────────
//  Übertragen wird eine auf ~128 px heruntergerechnete Data-URL
//  (~4–8 KB), die die App erzeugt – nicht das Originalfoto. Ein
//  heutiges Handyfoto hätte mehrere Megabyte und würde die
//  Verbindung sprengen (maxPayload 256 KB). Der Avatar wird ohnehin
//  nur 42 px groß dargestellt.
//
//  ── WICHTIG: WAS ÜBER DIE LEITUNG GEHT ────────────────────────
//  Übertragen werden pro Wort die ROHWERTE (je 100–900), NICHT die
//  daraus berechnete Typografie. Grund: sensorZuSchriftAchse() in
//  chat.html ist eine reine Funktion der Rohwerte – das Empfänger-
//  Handy rechnet also selbst. Das hält die Payload winzig (6 kleine
//  Zahlen pro Wort) und, viel wichtiger: die Mapping-Konstanten in
//  chat.html sind durchgehend mit "← nachjustieren" markiert. Würden
//  wir fertige Achsenwerte schicken, wären alte Nachrichten für immer
//  auf ein altes Mapping eingefroren. So ziehen sie bei jeder
//  Kalibrierung mit.
// ═══════════════════════════════════════════════════════════════

const http     = require('node:http');
const crypto   = require('node:crypto');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');

const PORT    = Number(process.env.PORT || 8080);
const DB_PFAD = process.env.DB_PFAD || '/var/lib/momentum/momentum.db';

// Grenzen – schützen den kleinen VPS (1 vCPU / 1,8 GB) vor Überlast
// und vor versehentlich riesigen Payloads.
const MAX_TEXT_LAENGE  = 2000;
const MAX_WOERTER      = 400;
// Miniaturbild als Data-URL. 128 px JPEG liegen bei ~4–8 KB; 64 KB
// lassen reichlich Luft und bleiben weit unter maxPayload (256 KB),
// sodass ein zu großes Bild abgelehnt wird, statt die Verbindung zu
// zerreißen.
const MAX_BILD_LAENGE  = 64 * 1024;
const CODE_GUELTIG_MS  = 10 * 60 * 1000;  // Kopplungscode: 10 Minuten
const TAKT_MS          = 30000;           // Heartbeat (tote Verbindungen erkennen)
const SENDE_FENSTER_MS = 10000;           // Ratenbegrenzung: Fenster
const SENDE_MAX        = 30;              // Ratenbegrenzung: Nachrichten pro Fenster

// Die sechs Rohwert-Felder aus chat.html (aktuelleRohwerte, chat.html:5615).
const ROHWERT_FELDER = [
  'intensitaet', 'tempo', 'stabilitaet',
  'tonalitaet', 'schlafqualitaet', 'atemfrequenz'
];

// ── Datenbank ──────────────────────────────────────────────────
const db = new Database(DB_PFAD);
db.pragma('journal_mode = WAL');   // gleichzeitiges Lesen/Schreiben ohne Sperren

db.exec([
  'CREATE TABLE IF NOT EXISTS geraete (',
  '  id              TEXT PRIMARY KEY,',
  '  geheim_hash     TEXT NOT NULL,',
  '  name            TEXT,',
  '  erstellt_am     INTEGER NOT NULL,',
  '  zuletzt_gesehen INTEGER',
  ');',
  'CREATE TABLE IF NOT EXISTS kopplungen (',
  '  code        TEXT PRIMARY KEY,',
  '  geraet_id   TEXT NOT NULL,',
  '  gueltig_bis INTEGER NOT NULL',
  ');',
  // ── Kontakte: beliebig viele pro Gerät ──────────────────────────
  // Der zusammengesetzte Primärschlüssel ist der ganze Unterschied zur
  // früheren "partner"-Tabelle: die hatte PRIMARY KEY (geraet_id) und
  // konnte damit genau EINE Beziehung halten – ein zweiter Kontakt
  // überschrieb den ersten. Jede Kopplung legt zwei Zeilen an (hin und
  // zurück), damit beide Seiten einander sehen.
  'CREATE TABLE IF NOT EXISTS kontakte (',
  '  geraet_id  TEXT NOT NULL,',
  '  kontakt_id TEXT NOT NULL,',
  '  seit       INTEGER NOT NULL,',
  '  PRIMARY KEY (geraet_id, kontakt_id)',
  ');',
  // ── Nachrichten: reine Warteschlange, KEIN Verlauf ──────────────
  // Hier liegen ausschließlich Nachrichten an gerade nicht verbundene
  // Geräte. Sobald der Empfänger sie abholt, werden sie gelöscht (siehe
  // offeneLoeschen). Ist der Empfänger online, werden sie direkt
  // weitergeleitet und gar nicht erst geschrieben. Auf dem Server
  // entsteht dadurch kein Gesprächsverlauf – bewusste Entscheidung,
  // passend dazu, dass die App selbst nur Kontaktdaten dauerhaft
  // speichert und keine Nachrichteninhalte.
  'CREATE TABLE IF NOT EXISTS nachrichten (',
  '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  von         TEXT NOT NULL,',
  '  an          TEXT NOT NULL,',
  '  text        TEXT NOT NULL,',
  '  woerter     TEXT NOT NULL,',
  '  gesendet_am INTEGER NOT NULL',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_nachrichten_an ON nachrichten (an, id);'
].join('\n'));

// ── Nachträgliche Schemaänderungen ───────────────────────────────
// Läuft bei jedem Start und ist absichtlich fehlertolerant: Auf einer
// frisch angelegten Datenbank ist nichts zu tun, auf einer bestehenden
// werden die fehlenden Teile ergänzt.

// Miniaturbild des Profils (Data-URL, ~128 px – siehe Kommentar zum
// Protokoll unten). Vor dieser Fassung gab es die Spalte nicht.
const geraeteSpalten = db.prepare('PRAGMA table_info(geraete)').all().map(function (s) { return s.name; });
if (geraeteSpalten.indexOf('bild') === -1) {
  db.exec('ALTER TABLE geraete ADD COLUMN bild TEXT');
  console.log('Schema: Spalte geraete.bild ergänzt');
}

// Bestehende 1:1-Kopplungen in die neue Kontakttabelle übernehmen,
// damit ein bereits gekoppeltes Handy-Paar nach dem Update nicht
// plötzlich ohne Kontakte dasteht.
const alteTabelle = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='partner'"
).get();
if (alteTabelle) {
  const uebernommen = db.prepare(
    'INSERT OR IGNORE INTO kontakte (geraet_id, kontakt_id, seit) ' +
    'SELECT geraet_id, partner_id, seit FROM partner'
  ).run();
  if (uebernommen.changes > 0) {
    console.log('Schema: ' + uebernommen.changes + ' alte Kopplung(en) nach kontakte übernommen');
  }
  db.exec('DROP TABLE partner');
}

const sql = {
  geraetAnlegen:    db.prepare('INSERT INTO geraete (id, geheim_hash, name, bild, erstellt_am) VALUES (?, ?, ?, ?, ?)'),
  geraetLesen:      db.prepare('SELECT * FROM geraete WHERE id = ?'),
  geraetGesehen:    db.prepare('UPDATE geraete SET zuletzt_gesehen = ? WHERE id = ?'),
  geraetNameSetzen: db.prepare('UPDATE geraete SET name = ? WHERE id = ?'),
  geraetBildSetzen: db.prepare('UPDATE geraete SET bild = ? WHERE id = ?'),

  codeAnlegen:     db.prepare('INSERT INTO kopplungen (code, geraet_id, gueltig_bis) VALUES (?, ?, ?)'),
  codeLesen:       db.prepare('SELECT * FROM kopplungen WHERE code = ?'),
  codeLoeschen:    db.prepare('DELETE FROM kopplungen WHERE code = ?'),
  codesAufraeumen: db.prepare('DELETE FROM kopplungen WHERE gueltig_bis < ?'),
  codesVonGeraet:  db.prepare('DELETE FROM kopplungen WHERE geraet_id = ?'),

  // Kopplung ist immer beidseitig – wird zweimal aufgerufen (A→B, B→A).
  // OR IGNORE: erneutes Koppeln derselben zwei Geräte ist damit
  // folgenlos statt ein Fehler.
  kontaktSetzen: db.prepare(
    'INSERT OR IGNORE INTO kontakte (geraet_id, kontakt_id, seit) VALUES (?, ?, ?)'
  ),
  // Alle Kontakte eines Geräts, samt Profil der Gegenseite.
  kontakteLesen: db.prepare(
    'SELECT g.id, g.name, g.bild, k.seit FROM kontakte k ' +
    'JOIN geraete g ON g.id = k.kontakt_id ' +
    'WHERE k.geraet_id = ? ORDER BY k.seit'
  ),
  kontaktIdsLesen: db.prepare('SELECT kontakt_id FROM kontakte WHERE geraet_id = ?'),
  kontaktPruefen:  db.prepare('SELECT 1 FROM kontakte WHERE geraet_id = ? AND kontakt_id = ?'),

  nachrichtAnlegen: db.prepare(
    'INSERT INTO nachrichten (von, an, text, woerter, gesendet_am) VALUES (?, ?, ?, ?, ?)'
  ),
  offeneLesen:   db.prepare('SELECT * FROM nachrichten WHERE an = ? ORDER BY id'),
  offeneLoeschen: db.prepare('DELETE FROM nachrichten WHERE an = ?')
};

// ── Hilfsfunktionen ────────────────────────────────────────────
function jetzt() { return Date.now(); }

function hashen(geheim) {
  return crypto.createHash('sha256').update(String(geheim)).digest('hex');
}

// Zeitkonstanter Vergleich – verhindert, dass man das Geheimnis
// zeichenweise über Antwortzeiten erraten kann.
function gleichSicher(a, b) {
  const pufferA = Buffer.from(String(a));
  const pufferB = Buffer.from(String(b));
  if (pufferA.length !== pufferB.length) return false;
  return crypto.timingSafeEqual(pufferA, pufferB);
}

// Sechsstelliger Kopplungscode. Ziffern statt Buchstaben, damit er
// auf der Tastatur des zweiten Handys schnell einzugeben ist.
function codeErzeugen() {
  for (let versuch = 0; versuch < 20; versuch++) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!sql.codeLesen.get(code)) return code;
  }
  throw new Error('Kein freier Kopplungscode gefunden');
}

// Prüft die Wortliste einer Nachricht und gibt eine BEREINIGTE Kopie
// zurück – nur bekannte Felder, nur Zahlen im gültigen Bereich. Alles
// andere fliegt raus, damit ein manipulierter Client dem Empfänger
// nichts Unerwartetes unterschieben kann.
function woerterPruefen(roh) {
  if (!Array.isArray(roh)) return null;
  if (roh.length > MAX_WOERTER) return null;

  const sauber = [];
  for (const wort of roh) {
    if (!wort || typeof wort !== 'object') return null;
    const rohwerte = wort.roh;
    if (!rohwerte || typeof rohwerte !== 'object') return null;

    const geprueft = {};
    for (const feld of ROHWERT_FELDER) {
      const wert = rohwerte[feld];
      // schlafqualitaet darf fehlen – chat.html setzt dann selbst 900
      // als Standard ein (siehe sensorZuSchriftAchse).
      if (wert == null) continue;
      if (typeof wert !== 'number' || !Number.isFinite(wert)) return null;
      geprueft[feld] = Math.min(900, Math.max(100, Math.round(wert)));
    }

    const zuschlag = Number(wort.pausenZuschlag) || 0;
    sauber.push({
      roh: geprueft,
      // Pausenzuschlag ist ein em-Wert; großzügig, aber begrenzt.
      pausenZuschlag: Math.min(5, Math.max(0, zuschlag)),
      leblos: Boolean(wort.leblos)
    });
  }
  return sauber;
}

// Eine zwischengelagerte Nachricht in dieselbe Form bringen wie eine
// live weitergeleitete. Bewusst OHNE die Datenbank-id: die ist eine
// reine Warteschlangen-Nummer, die die App nie zu sehen bekommt und
// nach dem Ausliefern ohnehin nicht mehr existiert.
function nachrichtNachAussen(zeile) {
  return {
    typ: 'nachricht',
    von: zeile.von,
    text: zeile.text,
    woerter: JSON.parse(zeile.woerter),
    gesendetAm: zeile.gesendet_am
  };
}

// ── Verbindungsverwaltung ──────────────────────────────────────
// geraetId → WebSocket. Bewusst nur EINE aktive Verbindung pro Gerät:
// meldet sich dasselbe Gerät neu an (App-Neustart, Netzwechsel), wird
// die alte Verbindung geschlossen.
const verbindungen = new Map();

function sende(ws, objekt) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(objekt));
  }
}

function sendeAnGeraet(geraetId, objekt) {
  const ws = verbindungen.get(geraetId);
  if (!ws) return false;
  sende(ws, objekt);
  return true;
}

function fehler(ws, grund) {
  sende(ws, { typ: 'fehler', grund });
}

// Alle Kontakte eines Geräts über dessen Online-Status informieren –
// die App zeigt das unter dem Namen in der Liste an. Anders als früher
// (genau ein Partner) sind das jetzt beliebig viele Empfänger.
function kontaktStatusMelden(geraetId, online) {
  for (const zeile of sql.kontaktIdsLesen.all(geraetId)) {
    sendeAnGeraet(zeile.kontakt_id, {
      typ: 'kontakt-status', kontaktId: geraetId, online
    });
  }
}

// Profiländerung (Name und/oder Bild) an alle Kontakte verteilen.
// Ohne das sähen sie den alten Stand bis zu ihrer nächsten Anmeldung.
function kontaktProfilMelden(geraetId, name, bild) {
  for (const zeile of sql.kontaktIdsLesen.all(geraetId)) {
    sendeAnGeraet(zeile.kontakt_id, {
      typ: 'kontakt-profil', kontaktId: geraetId, name, bild
    });
  }
}

// Ein Kontakt so, wie ihn die App erwartet.
function kontaktNachAussen(zeile) {
  return {
    id: zeile.id,
    name: zeile.name,
    bild: zeile.bild,
    online: verbindungen.has(zeile.id)
  };
}

// Prüft das übertragene Miniaturbild. Erwartet wird eine Data-URL, die
// die App durch Herunterrechnen auf ~128 px erzeugt (siehe
// bildVerkleinern in chat.html) – NICHT das Originalfoto, das mehrere
// Megabyte hätte und die Verbindung sprengen würde (maxPayload).
function bildPruefen(roh) {
  if (roh == null || roh === '') return null;
  if (typeof roh !== 'string') return undefined;              // undefined = ungültig
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(roh)) return undefined;
  if (roh.length > MAX_BILD_LAENGE) return undefined;
  return roh;
}

// ── HTTP-Server (nur Gesundheitsprüfung; alles andere über WS) ──
const server = http.createServer((anfrage, antwort) => {
  if (anfrage.url === '/gesundheit') {
    antwort.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    antwort.end(JSON.stringify({
      status: 'ok',
      zeit: new Date().toISOString(),
      verbundeneGeraete: verbindungen.size
    }));
    return;
  }
  antwort.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  antwort.end('Nicht gefunden');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  // Zustand dieser einen Verbindung
  ws.geraetId     = null;
  ws.amLeben      = true;
  ws.sendeZaehler = 0;
  ws.fensterAb    = jetzt();

  ws.on('pong', () => { ws.amLeben = true; });

  ws.on('message', (daten) => {
    let nachricht;
    try {
      nachricht = JSON.parse(daten.toString());
    } catch {
      return fehler(ws, 'Ungültiges JSON');
    }
    if (!nachricht || typeof nachricht.typ !== 'string') {
      return fehler(ws, 'Feld "typ" fehlt');
    }

    // ── 1. Anmelden ──────────────────────────────────────────
    // Ohne geraetId legt der Server ein neues Gerät an und schickt
    // ID + Geheimnis zurück; die App merkt sich beides in
    // localStorage und meldet sich künftig damit an.
    if (nachricht.typ === 'hallo') {
      let geraetId = nachricht.geraetId;
      let geheim   = nachricht.geheim;
      let neu      = false;

      const bild = bildPruefen(nachricht.bild);
      if (bild === undefined) return fehler(ws, 'Ungültiges oder zu großes Profilbild');

      if (!geraetId || !geheim) {
        geraetId = crypto.randomUUID();
        geheim   = crypto.randomBytes(24).toString('hex');
        neu      = true;
        sql.geraetAnlegen.run(geraetId, hashen(geheim), nachricht.name || null, bild, jetzt());
      } else {
        const geraet = sql.geraetLesen.get(String(geraetId));
        if (!geraet || !gleichSicher(hashen(geheim), geraet.geheim_hash)) {
          return fehler(ws, 'Unbekanntes Gerät oder falsches Geheimnis');
        }

        // Name und Bild nur bei tatsächlicher Änderung schreiben – und
        // die Kontakte nur dann benachrichtigen. Sonst löste jede
        // Anmeldung eine Rundmail an alle aus.
        let geaendert = false;
        let name = geraet.name;
        if (nachricht.name && nachricht.name !== geraet.name) {
          name = String(nachricht.name).slice(0, 60);
          sql.geraetNameSetzen.run(name, geraetId);
          geaendert = true;
        }
        if (bild !== null && bild !== geraet.bild) {
          sql.geraetBildSetzen.run(bild, geraetId);
          geaendert = true;
        }
        if (geaendert) {
          kontaktProfilMelden(geraetId, name, bild !== null ? bild : geraet.bild);
        }
      }

      // Ältere Verbindung desselben Geräts ablösen
      const alt = verbindungen.get(geraetId);
      if (alt && alt !== ws) {
        sende(alt, { typ: 'fehler', grund: 'An anderer Stelle angemeldet' });
        alt.close();
      }

      ws.geraetId = geraetId;
      verbindungen.set(geraetId, ws);
      sql.geraetGesehen.run(jetzt(), geraetId);

      // Kontaktliste mitschicken – die App baut daraus ihre Einträge
      // (Name + Bild kommen also vom Server, nicht aus dem Raum-Code).
      const kontakte = sql.kontakteLesen.all(geraetId).map(kontaktNachAussen);

      // Wartende Nachrichten ausliefern und DANACH löschen: der Server
      // führt bewusst keinen Verlauf, er überbrückt nur die Zeit, in der
      // ein Gerät nicht verbunden war.
      const offene = sql.offeneLesen.all(geraetId).map(nachrichtNachAussen);
      if (offene.length) sql.offeneLoeschen.run(geraetId);

      sende(ws, {
        typ: 'willkommen',
        geraetId,
        geheim: neu ? geheim : undefined,   // nur beim ersten Mal
        kontakte,
        nachrichten: offene
      });

      kontaktStatusMelden(geraetId, true);
      return;
    }

    // Ab hier ist eine Anmeldung Pflicht.
    if (!ws.geraetId) return fehler(ws, 'Nicht angemeldet');

    // ── 2. Kopplungscode erzeugen (Handy A) ──────────────────
    if (nachricht.typ === 'code-erzeugen') {
      sql.codesAufraeumen.run(jetzt());
      sql.codesVonGeraet.run(ws.geraetId);   // pro Gerät nur ein offener Code
      const code = codeErzeugen();
      const gueltigBis = jetzt() + CODE_GUELTIG_MS;
      sql.codeAnlegen.run(code, ws.geraetId, gueltigBis);
      return sende(ws, { typ: 'code', code, gueltigBis });
    }

    // ── 3. Koppeln (Handy B gibt den Code ein) ───────────────
    if (nachricht.typ === 'koppeln') {
      sql.codesAufraeumen.run(jetzt());
      const code = String(nachricht.code || '').trim();
      const eintrag = sql.codeLesen.get(code);

      if (!eintrag) return fehler(ws, 'Code unbekannt oder abgelaufen');
      if (eintrag.gueltig_bis < jetzt()) {
        sql.codeLoeschen.run(code);
        return fehler(ws, 'Code abgelaufen');
      }
      if (eintrag.geraet_id === ws.geraetId) return fehler(ws, 'Das ist dein eigener Code');

      const anderes = eintrag.geraet_id;
      const zeit = jetzt();

      // Kopplung ist beidseitig – zwei Zeilen, eine je Richtung. Ein
      // bereits bestehender Kontakt bleibt dabei unangetastet (OR
      // IGNORE), erneutes Koppeln ist also folgenlos statt ein Fehler.
      db.transaction(() => {
        sql.kontaktSetzen.run(ws.geraetId, anderes, zeit);
        sql.kontaktSetzen.run(anderes, ws.geraetId, zeit);
        sql.codeLoeschen.run(code);
      })();

      const ich   = sql.geraetLesen.get(ws.geraetId);
      const gegen = sql.geraetLesen.get(anderes);

      // Beide bekommen das VOLLE Profil der Gegenseite (Name + Bild),
      // damit die Person sofort mit echtem Namen und Foto in der Liste
      // steht statt mit dem Raum-Code.
      sende(ws, { typ: 'kontakt-neu', kontakt: {
        id: anderes, name: gegen ? gegen.name : null,
        bild: gegen ? gegen.bild : null, online: verbindungen.has(anderes)
      }});
      sendeAnGeraet(anderes, { typ: 'kontakt-neu', kontakt: {
        id: ws.geraetId, name: ich ? ich.name : null,
        bild: ich ? ich.bild : null, online: true
      }});
      return;
    }

    // ── 4. Nachricht senden ──────────────────────────────────
    if (nachricht.typ === 'nachricht') {
      // Ratenbegrenzung pro Verbindung
      if (jetzt() - ws.fensterAb > SENDE_FENSTER_MS) {
        ws.fensterAb = jetzt();
        ws.sendeZaehler = 0;
      }
      if (++ws.sendeZaehler > SENDE_MAX) return fehler(ws, 'Zu viele Nachrichten – kurz warten');

      // Empfänger steht jetzt in der Nachricht – früher ergab er sich
      // aus dem einen Partner. Gegen die Kontaktliste geprüft, damit
      // niemand an beliebige Geräte schreiben kann.
      const an = String(nachricht.an || '');
      if (!an) return fehler(ws, 'Empfänger fehlt');
      if (!sql.kontaktPruefen.get(ws.geraetId, an)) return fehler(ws, 'Kein Kontakt');

      const text = String(nachricht.text || '');
      if (!text.trim())                  return fehler(ws, 'Leere Nachricht');
      if (text.length > MAX_TEXT_LAENGE) return fehler(ws, 'Nachricht zu lang');

      const woerter = woerterPruefen(nachricht.woerter || []);
      if (woerter === null) return fehler(ws, 'Ungültige Wortdaten');

      const gesendetAm = jetzt();
      const empfaengerOnline = verbindungen.has(an);

      const hinaus = {
        typ: 'nachricht',
        von: ws.geraetId,
        text,
        woerter,
        gesendetAm
      };

      if (empfaengerOnline) {
        // Direkt weiterleiten und NICHT speichern – so entsteht auf dem
        // Server erst gar kein Verlauf.
        sendeAnGeraet(an, hinaus);
      } else {
        // Nur zwischenlagern, bis der Empfänger sich verbindet; beim
        // Ausliefern wird die Zeile gelöscht (siehe 'hallo').
        sql.nachrichtAnlegen.run(ws.geraetId, an, text, JSON.stringify(woerter), gesendetAm);
      }

      sende(ws, { typ: 'gesendet', an, gesendetAm, zugestellt: empfaengerOnline });
      return;
    }

    fehler(ws, 'Unbekannter Typ: ' + nachricht.typ);
  });

  ws.on('close', () => {
    if (ws.geraetId && verbindungen.get(ws.geraetId) === ws) {
      verbindungen.delete(ws.geraetId);
      sql.geraetGesehen.run(jetzt(), ws.geraetId);
      kontaktStatusMelden(ws.geraetId, false);
    }
  });

  ws.on('error', () => { /* close räumt auf */ });
});

// Heartbeat: Handys verlieren die Verbindung oft ohne sauberes Close
// (Funkloch, Standby). Ohne diesen Takt blieben tote Einträge in
// "verbindungen" stehen und der Partner sähe fälschlich "online".
const takt = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.amLeben === false) { ws.terminate(); continue; }
    ws.amLeben = false;
    ws.ping();
  }
}, TAKT_MS);

wss.on('close', () => clearInterval(takt));

server.listen(PORT, '127.0.0.1', () => {
  console.log('Momentum-Chat-Server lauscht auf 127.0.0.1:' + PORT);
  console.log('Datenbank: ' + DB_PFAD);
});

// Sauber herunterfahren, damit systemd-Neustarts keine WAL-Reste hinterlassen.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('Beende (' + signal + ') …');
    clearInterval(takt);
    for (const ws of wss.clients) ws.close();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
