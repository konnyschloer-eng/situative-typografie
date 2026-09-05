package com.momentum.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import androidx.core.app.NotificationCompat;

/**
 * Echter nativer Android Foreground Service (Java) – kein Capacitor-Plugin-Code
 * im engeren Sinn, sondern ein "normaler" Android-Service, wie er auch in einer
 * App ohne Capacitor existieren würde. Läuft ausschließlich, solange eine
 * Bluetooth-Verbindung zum Polar-Band besteht (Start/Stop wird ausschließlich
 * von MomentumBleServicePlugin ausgelöst, passend zu den bestehenden
 * Connect-/Disconnect-Momenten in chat.html – siehe dort).
 *
 * Zweck: Android darf Prozesse im Hintergrund (App minimiert, Bildschirm
 * gesperrt) jederzeit beenden, um Speicher freizugeben – außer der Prozess
 * hat einen laufenden Foreground Service. Das ist für die geplante
 * Nacht-Messung entscheidend, sonst würde die BLE-Verbindung (und damit die
 * Puls-Reaktion) mitten in der Nacht unbemerkt abreißen.
 *
 * Die Pflicht-Benachrichtigung ("Momentum misst deinen Puls") ist keine
 * Design-Entscheidung, sondern eine Android-Vorgabe: Ohne sichtbare,
 * dauerhafte Benachrichtigung darf ein Foreground Service gar nicht laufen
 * (das System wirft sonst eine Exception).
 */
public class MomentumBleForegroundService extends Service {

    private static final String CHANNEL_ID = "momentum_ble_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final String TAG = "MomentumBleService";

    // ── Nacht-Erfassung (Schlafqualität) ────────────────────────────
    // Läuft als Handler-Timer INNERHALB dieses Service, bewusst nicht als
    // JS-setInterval in chat.html: Chromium/WebView drosselt JS-Timer bei
    // gesperrtem Bildschirm unabhängig vom Foreground-Service-Schutz, ein
    // Handler in diesem bereits geschützten Prozess dagegen nicht. Felder
    // sind static, weil MomentumBleServicePlugin nicht an die Service-
    // Instanz gebunden ist (nur Start-/Stop-Intents) und so trotzdem lesend/
    // schreibend zugreifen kann.
    //
    // ZEITREIHE STATT SUMMEN (Umstellung auf datengetriebenen Schlafbeginn):
    // Früher hielt dieser Service nur Summen + Zähler. Daraus lässt sich
    // kein ZEITPUNKT rekonstruieren – die Frage "wann hat der Schlaf
    // begonnen?" ist aus einer Summe grundsätzlich nicht beantwortbar.
    // Deshalb jetzt ein Messpunkt pro Tick. Der Speicherbedarf ist
    // unkritisch: 5-Minuten-Takt über den Rahmen 21:00–11:00 sind maximal
    // 168 Einträge à vier Zahlen, rund 8 KB als JSON. Nebengewinn: Eine
    // gespeicherte Nacht lässt sich nachträglich mit anderen Schwellen neu
    // auswerten, statt jede Änderung eine Nacht lang testen zu müssen.
    //
    // Zwei Takte statt einem: NUR innerhalb des Nacht-Rahmens (21:00–11:00,
    // siehe istNachtzeit()) wird tatsächlich ein Messpunkt angelegt.
    // Außerhalb (Tag) tickt der Handler weiterhin alle 5 Minuten, macht
    // dabei aber NICHTS außer erneut die Uhrzeit zu prüfen – so wird der
    // Tag→Nacht-Übergang spätestens nach 5 Minuten erkannt (die Zeit wird
    // bei JEDEM Tick neu geprüft, nicht nur beim Verbindungsaufbau).
    //
    // 5 statt vorher 15 Minuten nachts: Für die Regel "30 Minuten
    // ununterbrochene Ruhe" wären 15-Minuten-Schritte nur zwei Messpunkte –
    // zu grob, um einen Einschlafzeitpunkt zu bestimmen. Der Tick selbst
    // kostet fast nichts (ein Listeneintrag + ein kleiner Schreibvorgang);
    // der BLE-Verkehr, der den Akku wirklich belastet, ändert sich nicht.
    private static final long NACHT_TICK_INTERVALL_MS = 5 * 60 * 1000L; // 5 Minuten (nachts)
    private static final long TAG_TICK_INTERVALL_MS   = 5 * 60 * 1000L; // 5 Minuten (tagsüber, tut nichts außer Uhrzeit prüfen)

    // Reine Sicherung gegen unbegrenztes Wachsen (z. B. wenn die Auswertung
    // über Tage nicht läuft). 21:00–11:00 sind 14 h = 168 Ticks; 240 lässt
    // Luft, ohne dass die Liste je problematisch wird.
    private static final int MAX_MESSPUNKTE = 240;

    // ── Frische der Daten: der Kern der Abbruch-Behandlung ──────────────
    // Früher wurde letzteHerzfrequenz nur überschrieben und nie ungültig.
    // Brach die Verbindung nachts ab, addierte JEDER weitere Tick denselben
    // eingefrorenen Puls weiter, während die Bewegung mangels ACC-Daten auf
    // 0 blieb – ein Verbindungsabbruch sah damit aus wie besonders tiefer
    // Schlaf. Nach einem Prozess-Kill war es schlimmer: die statischen
    // Felder starten bei 0, es wurde also 0 bpm aufaddiert und die Nacht
    // als "sehr gut" gemeldet.
    //
    // Jetzt trägt jeder gemeldete Wert einen Zeitstempel. Ist der Puls
    // älter als DATEN_FRISCHE_MS, gilt der ganze Tick als Lücke (null) und
    // fällt aus der Auswertung – statt sie still zu verfälschen.
    //
    // Der Puls dient dabei als Frische-Anzeiger für die GESAMTE Verbindung:
    // HF-Notifications kommen ca. 1×/s, viel dichter als jedes Tick-
    // Intervall. Bewegung eignet sich dafür nicht – meldeBewegung() wird
    // aus chat.html nur bei Beträgen > 0 aufgerufen, "keine Meldung" ließe
    // sich also nicht von "vollkommen still" unterscheiden.
    private static final long DATEN_FRISCHE_MS = 2 * 60 * 1000L; // 2 Minuten

    private static volatile int letzteHerzfrequenz      = 0;
    private static volatile long letzteHerzfrequenzZeit = 0; // 0 = noch nie ein Wert gemeldet
    private static volatile double bewegungSeitTick     = 0;

    // Double (statt double) bewusst, damit "noch kein Wert gemeldet" (null)
    // von "Wert 0.0" unterscheidbar bleibt: laut pulsVariabilitaetMessen()
    // in chat.html liefert die Variabilität erst ab 5 Messpunkten im
    // gleitenden 45s-Fenster einen Wert.
    private static volatile Double letzteVariabilitaet   = null;
    private static volatile long letzteVariabilitaetZeit = 0;

    /**
     * Ein Messpunkt der Nacht. bpm/bewegung/variabilitaet sind null, wenn zum
     * Tick-Zeitpunkt keine frischen Daten vorlagen – diese Lücken bleiben
     * bewusst in der Reihe stehen (statt übersprungen zu werden), damit die
     * Auswertung in chat.html Abbrüche erkennen und benennen kann.
     */
    public static final class Messpunkt {
        public final long zeit;              // Wanduhrzeit (System.currentTimeMillis)
        public final Integer bpm;
        public final Double bewegung;
        public final Double variabilitaet;

        Messpunkt(long zeit, Integer bpm, Double bewegung, Double variabilitaet) {
            this.zeit = zeit;
            this.bpm = bpm;
            this.bewegung = bewegung;
            this.variabilitaet = variabilitaet;
        }
    }

    private static final List<Messpunkt> messpunkte = new ArrayList<>();

    // ── Absicherung der Zeitreihe (SharedPreferences) ───────────────────
    // Die Liste lebt NUR im Arbeitsspeicher dieses Prozesses – wird er vor
    // der Morgen-Auswertung beendet (Speicherdruck, Reboot), wäre sie ohne
    // diese Absicherung verloren, auch wenn START_STICKY den Service danach
    // neu startet. Deshalb: bei jedem Nacht-Tick den Stand persistieren,
    // beim Service-Start wiederherstellen – aber NUR, wenn er nachweislich
    // aus derselben Nacht stammt (siehe nachtKennung()), sonst verwerfen.
    private static Context appKontext; // ApplicationContext, NICHT die Service-Instanz selbst (kein Leak-Risiko über den static-Verweis)

    private static final String NACHT_PREFS_NAME = "momentum_nacht_erfassung";
    private static final String PREF_KENNUNG     = "nachtKennung";
    private static final String PREF_REIHE       = "messpunkte";

    /**
     * Echte Uhrzeit-Prüfung (Systemzeit des Geräts, java.util.Calendar statt
     * java.time – minSdkVersion 24 < 26, kein Desugaring konfiguriert).
     * Bewusst NICHT an document.hidden/Bildschirmsperre gekoppelt: kurzes
     * Sperren tagsüber soll NICHT in den Nacht-/Akku-Sparmodus wechseln.
     * Bestimmt ausschließlich, ob nachtTick() gerade summiert und welches
     * Tick-Intervall als Nächstes gilt – der Foreground Service selbst
     * läuft davon komplett unabhängig durchgehend weiter.
     */
    // 21:00–11:00 statt vorher 22:00–08:00: Der Rahmen ist seit der
    // Umstellung NUR NOCH eine Leitplanke – er verhindert, dass ein
    // Mittagsschlaf als Nacht gewertet wird, bestimmt aber nicht mehr die
    // Schlafdauer. Die eigentliche Erkennung läuft über die Messwerte
    // (siehe schlaffensterErkennen in chat.html). Weiter gefasst, weil ein
    // enger Rahmen genau die späten Einschläfer und langen Schläfer
    // abschneiden würde, deretwegen die Umstellung überhaupt nötig war.
    private static final int RAHMEN_BEGINN_STUNDE = 21;
    private static final int RAHMEN_ENDE_STUNDE   = 11;

    private static boolean istNachtzeit() {
        int stunde = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return stunde >= RAHMEN_BEGINN_STUNDE || stunde < RAHMEN_ENDE_STUNDE;
    }

    /**
     * Ob der Nacht-Rahmen für heute vorbei ist. Die Morgen-Auswertung in
     * chat.html darf die Zeitreihe erst dann verbrauchen und löschen –
     * vorher würde ein Blick in die App um 3 Uhr die laufende Nacht
     * abschneiden und den Rest bei null beginnen lassen (genau das passierte
     * vor der Umstellung bei JEDEM Laden von chat.html).
     */
    private static boolean rahmenVorbei() {
        return !istNachtzeit();
    }

    /**
     * Eindeutige Kennung für die AKTUELLE Nacht, stabil über den
     * Mitternachts-Wechsel hinweg – das Nacht-Fenster 22:00–08:00 liegt
     * auf zwei Kalendertagen, ein einfacher Datums-String würde also
     * mitten in der Nacht wechseln. Liegt die Uhrzeit vor 8:00, gehört
     * sie noch zur Nacht des VORTAGES, daher der Tagesversatz. Dient
     * ausschließlich dem Vergleich "stammen die in SharedPreferences
     * abgelegten Summen aus derselben, noch laufenden Nacht?".
     */
    private static String nachtKennung() {
        Calendar cal = Calendar.getInstance();
        if (cal.get(Calendar.HOUR_OF_DAY) < RAHMEN_ENDE_STUNDE) {
            cal.add(Calendar.DAY_OF_YEAR, -1); // 00:00–11:00 gehört noch zur Nacht des Vortages
        }
        return cal.get(Calendar.YEAR) + "-" + cal.get(Calendar.DAY_OF_YEAR);
    }

    /** Serialisiert die Zeitreihe. Lücken werden als JSON-null geschrieben, nicht ausgelassen. */
    private static String reiheAlsJson() {
        JSONArray arr = new JSONArray();
        for (Messpunkt m : messpunkte) {
            JSONObject o = new JSONObject();
            try {
                o.put("zeit", m.zeit);
                // JSONObject.put(String, Object) mit null ENTFERNT den Schlüssel –
                // deshalb explizit JSONObject.NULL, damit die Lücke erhalten bleibt.
                o.put("bpm", m.bpm == null ? JSONObject.NULL : m.bpm);
                o.put("bewegung", m.bewegung == null ? JSONObject.NULL : m.bewegung);
                o.put("hrv", m.variabilitaet == null ? JSONObject.NULL : m.variabilitaet);
            } catch (JSONException e) {
                Log.e(TAG, "reiheAlsJson: Messpunkt konnte nicht serialisiert werden.", e);
                continue;
            }
            arr.put(o);
        }
        return arr.toString();
    }

    /** Schreibt die aktuelle Zeitreihe nach SharedPreferences (siehe nachtTick()). */
    private static void nachtReihePersistieren() {
        if (appKontext == null) return; // sollte nach onCreate() nie eintreten, defensiv trotzdem
        appKontext.getSharedPreferences(NACHT_PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_KENNUNG, nachtKennung())
            .putString(PREF_REIHE, reiheAlsJson())
            .apply();
    }

    /**
     * Stellt die Zeitreihe aus SharedPreferences wieder her – NUR, wenn die
     * dort abgelegte Kennung zur aktuellen Nacht passt (siehe
     * nachtKennung()). Gehören die gespeicherten Daten zu einer anderen
     * (bereits ausgewerteten oder länger zurückliegenden) Nacht, werden sie
     * stattdessen verworfen, damit sie sich nicht fälschlich als "laufende
     * Nacht" ausgeben. Wird einmalig beim Service-Start aufgerufen (siehe
     * onStartCommand()).
     */
    private static synchronized void nachtReiheWiederherstellen() {
        if (appKontext == null) return;
        SharedPreferences prefs = appKontext.getSharedPreferences(NACHT_PREFS_NAME, Context.MODE_PRIVATE);
        String gespeicherteKennung = prefs.getString(PREF_KENNUNG, null);

        if (gespeicherteKennung == null || !gespeicherteKennung.equals(nachtKennung())) {
            nachtPrefsLoeschen(); // veraltete/fremde Nacht – nicht stehen lassen
            return;
        }

        String roh = prefs.getString(PREF_REIHE, null);
        if (roh == null) return;

        messpunkte.clear();
        try {
            JSONArray arr = new JSONArray(roh);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                messpunkte.add(new Messpunkt(
                    o.getLong("zeit"),
                    o.isNull("bpm")      ? null : o.getInt("bpm"),
                    o.isNull("bewegung") ? null : o.getDouble("bewegung"),
                    o.isNull("hrv")      ? null : o.getDouble("hrv")
                ));
            }
            Log.d(TAG, "nachtReiheWiederherstellen: " + messpunkte.size()
                + " Messpunkte derselben Nacht übernommen.");
        } catch (JSONException e) {
            Log.e(TAG, "nachtReiheWiederherstellen: Zeitreihe nicht lesbar – wird verworfen.", e);
            messpunkte.clear();
            nachtPrefsLoeschen();
        }
    }

    /** Löscht den abgesicherten Stand vollständig (nach erfolgter Morgen-Auswertung oder bei fremder Nacht-Kennung). */
    private static void nachtPrefsLoeschen() {
        if (appKontext == null) return;
        appKontext.getSharedPreferences(NACHT_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private Handler nachtHandler;
    private final Runnable nachtTickRunnable = new Runnable() {
        @Override
        public void run() {
            boolean nachts = istNachtzeit();
            if (nachts) {
                nachtTick();
            }
            if (nachtHandler != null) {
                nachtHandler.postDelayed(this, nachts ? NACHT_TICK_INTERVALL_MS : TAG_TICK_INTERVALL_MS);
            }
        }
    };

    /**
     * Wird von MomentumBleServicePlugin bei jeder neuen HF-Messung aufgerufen
     * (letzter Wert wird gehalten). Der Zeitstempel ist entscheidend: Ohne
     * ihn ließe sich "aktueller Puls" nicht von "seit zwei Stunden
     * eingefrorener Puls" unterscheiden (siehe DATEN_FRISCHE_MS).
     */
    public static synchronized void meldeHerzfrequenz(int bpm) {
        letzteHerzfrequenz = bpm;
        letzteHerzfrequenzZeit = System.currentTimeMillis();
    }

    /** Wird von MomentumBleServicePlugin nach jeder ausgewerteten ACC-Notification aufgerufen (wird aufsummiert, nicht überschrieben). */
    public static synchronized void meldeBewegung(double betrag) {
        bewegungSeitTick += betrag;
    }

    /**
     * Wird von MomentumBleServicePlugin bei jeder NEUEN, nicht-null
     * Pulsvariabilitäts-Messung aufgerufen (letzter Wert wird gehalten,
     * analog meldeHerzfrequenz – NICHT aufsummiert wie meldeBewegung).
     * Ruft die JS-Seite (bpmEmpfangen in chat.html) nur auf, wenn
     * pulsVariabilitaetMessen() nicht null liefert – vor den ersten 5
     * Messpunkten im 45s-Fenster bleibt letzteVariabilitaet entsprechend
     * unangetastet (null).
     */
    public static synchronized void meldeVariabilitaet(double wert) {
        letzteVariabilitaet = wert;
        letzteVariabilitaetZeit = System.currentTimeMillis();
    }

    /** Liefert die Zeitreihe der laufenden Nacht (Kopie) für die Morgen-Auswertung in chat.html. */
    public static synchronized List<Messpunkt> holeNachtDaten() {
        return new ArrayList<>(messpunkte);
    }

    /** Ob der Nacht-Rahmen vorbei ist – die Auswertung darf erst dann verbrauchen. */
    public static boolean istRahmenVorbei() {
        return rahmenVorbei();
    }

    /** Verwirft die Zeitreihe nach erfolgter Morgen-Auswertung (im Arbeitsspeicher UND im abgesicherten Stand). */
    public static synchronized void nachtDatenZuruecksetzen() {
        int vorher = messpunkte.size();
        messpunkte.clear();
        nachtPrefsLoeschen(); // die Rohdaten sind ausgewertet – der abgesicherte Stand muss mit verschwinden, sonst würde ein Neustart derselben Nacht sie fälschlich wiederherstellen
        Log.d(TAG, "nachtDatenZuruecksetzen: " + vorher + " Messpunkte verworfen.");
    }

    private static synchronized void nachtTick() {
        long jetzt = System.currentTimeMillis();

        // Frische-Prüfung: Liegt der letzte Puls zu lange zurück, war die
        // Verbindung während dieses Ticks tot. Dann wird der Punkt als Lücke
        // eingetragen (alles null) statt eingefrorene Werte weiterzuschleppen.
        // Auch die Bewegung gilt dann als unbekannt – ohne Verbindung kommen
        // keine ACC-Daten, "0" hieße fälschlich "vollkommen still".
        boolean pulsFrisch = letzteHerzfrequenzZeit > 0
            && (jetzt - letzteHerzfrequenzZeit) <= DATEN_FRISCHE_MS;

        Integer bpm = pulsFrisch ? letzteHerzfrequenz : null;
        Double bewegung = pulsFrisch ? bewegungSeitTick : null;

        // Lokale Kopie: vermeidet, dass zwischen Null-Prüfung und Verwendung
        // ein Race mit meldeVariabilitaet() den Wert unter der Hand ändert.
        Double variabilitaet = letzteVariabilitaet;
        boolean hrvFrisch = pulsFrisch && variabilitaet != null && letzteVariabilitaetZeit > 0
            && (jetzt - letzteVariabilitaetZeit) <= DATEN_FRISCHE_MS;
        Double hrv = hrvFrisch ? variabilitaet : null;

        messpunkte.add(new Messpunkt(jetzt, bpm, bewegung, hrv));
        // Sicherung gegen unbegrenztes Wachsen – ältesten Punkt verwerfen.
        while (messpunkte.size() > MAX_MESSPUNKTE) {
            messpunkte.remove(0);
        }

        Log.d(TAG, "Nacht-Tick #" + messpunkte.size() + ": "
            + (pulsFrisch
                ? ("HF=" + letzteHerzfrequenz + ", Bewegung=" + bewegungSeitTick
                   + ", Variabilität=" + (hrv != null ? hrv : "–"))
                : ("LÜCKE – keine frischen Daten seit "
                   + (letzteHerzfrequenzZeit == 0
                      ? "Start des Dienstes"
                      : ((jetzt - letzteHerzfrequenzZeit) / 1000) + " s")
                   + " (Band getrennt?)")));

        bewegungSeitTick = 0;
        nachtReihePersistieren(); // Absicherung: sofort schreiben, falls der Prozess vor der Morgen-Auswertung endet
    }

    @Override
    public IBinder onBind(Intent intent) {
        // Kein gebundener Service – nur gestartet/gestoppt, kein direkter
        // Methodenaufruf-Kanal nötig (Kommunikation läuft ausschließlich über
        // Start-/Stop-Intents vom Plugin aus).
        return null;
    }

    @Override
    public void onCreate() {
        Log.d(TAG, "onCreate: Service-Instanz wird erstellt.");
        super.onCreate();
        appKontext = getApplicationContext(); // für die SharedPreferences-Absicherung der Nacht-Summen, siehe oben
        benachrichtigungskanalErstellen();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand: aufgerufen (startId=" + startId + ").");
        Notification benachrichtigung = benachrichtigungBauen();

        try {
            // Ab Android 10 (API 29) muss der Foreground-Service-Typ explizit beim
            // Start angegeben werden, ab Android 14 (API 34) wird das strikt
            // durchgesetzt und muss zur AndroidManifest.xml-Deklaration passen
            // (siehe android:foregroundServiceType="connectedDevice" dort).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    benachrichtigung,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                );
            } else {
                startForeground(NOTIFICATION_ID, benachrichtigung);
            }
            Log.d(TAG, "onStartCommand: startForeground() erfolgreich aufgerufen, Service läuft im Vordergrund.");
        } catch (Exception e) {
            Log.e(TAG, "onStartCommand: startForeground() ist fehlgeschlagen – Service läuft NICHT im Vordergrund.", e);
        }

        // Nacht-Erfassungstakt starten – nur einmal, onStartCommand kann bei
        // erneutem MomentumBleService.start() (z. B. Reconnect) mehrfach
        // aufgerufen werden, solange der Service bereits läuft.
        if (nachtHandler == null) {
            // Absicherung: falls dieser Prozess seit dem letzten Nacht-Tick
            // derselben Nacht neu gestartet wurde (Speicherdruck-Kill +
            // START_STICKY-Neustart), hier die Zeitreihe aus
            // SharedPreferences übernehmen, BEVOR der Handler weiterzählt.
            nachtReiheWiederherstellen();

            nachtHandler = new Handler(Looper.getMainLooper());
            boolean nachts = istNachtzeit();
            long ersterDelay = nachts ? NACHT_TICK_INTERVALL_MS : TAG_TICK_INTERVALL_MS;
            nachtHandler.postDelayed(nachtTickRunnable, ersterDelay);
            Log.d(TAG, "onStartCommand: Erfassungstakt gestartet (alle " + (ersterDelay / 60000)
                + " Min, " + (nachts ? "Nacht-Fenster aktiv, summiert" : "Tag – summiert nicht") + ").");
        }

        // START_STICKY: Falls das System den Prozess trotz Foreground-Status
        // unter Speicherdruck doch beendet, wird der Service (ohne den
        // ursprünglichen Intent) neu gestartet, sobald wieder Ressourcen frei
        // sind. Passt zum Anwendungsfall (Nacht-Messung) besser als
        // START_NOT_STICKY.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "onDestroy: Service wird beendet/zerstört.");
        if (nachtHandler != null) {
            nachtHandler.removeCallbacks(nachtTickRunnable);
            nachtHandler = null;
            Log.d(TAG, "onDestroy: Nacht-Erfassungstakt gestoppt.");
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Wird ausgelöst, wenn die App aus der Übersicht (Recents) entfernt
        // wird – ein häufiger, vom BLE-Verbindungsstatus unabhängiger Grund,
        // warum Android den Prozess anschließend beendet.
        Log.w(TAG, "onTaskRemoved: App wurde aus den Recents entfernt.");
        super.onTaskRemoved(rootIntent);
    }

    private void benachrichtigungskanalErstellen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel kanal = new NotificationChannel(
                CHANNEL_ID,
                "Puls-Messung",
                NotificationManager.IMPORTANCE_LOW // LOW = kein Ton/Vibration, dezent, wie gefordert
            );
            kanal.setDescription("Zeigt an, dass Momentum aktiv den Puls über das verbundene Band misst.");
            kanal.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(kanal);
                Log.d(TAG, "onCreate: NotificationChannel '" + CHANNEL_ID + "' angelegt/aktualisiert.");
            } else {
                Log.e(TAG, "onCreate: NotificationManager nicht verfügbar – Kanal konnte nicht angelegt werden.");
            }
        }
    }

    private Notification benachrichtigungBauen() {
        Notification benachrichtigung = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Momentum misst deinen Puls")
            .setContentText("Verbunden mit deinem Band – auch bei gesperrtem Bildschirm aktiv.")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true) // vom Nutzer nicht wegwischbar, solange der Service läuft (Android-Vorgabe)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        Log.d(TAG, "onStartCommand: Benachrichtigung gebaut.");
        return benachrichtigung;
    }
}
