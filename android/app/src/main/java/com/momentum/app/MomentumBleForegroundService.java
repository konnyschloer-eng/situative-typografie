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

import java.util.Calendar;

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
    // schreibend zugreifen kann. Bewusst nur Summen + Zähler im
    // Arbeitsspeicher – keine Einzelmesspunkte (siehe Plan). Zusätzlich bei
    // jedem Tick in SharedPreferences abgesichert (siehe nachtSummen-
    // Persistieren/-Wiederherstellen weiter unten), falls der Prozess vor
    // der Morgen-Auswertung endet.
    // Zwei Takte statt einem: NUR innerhalb des Nacht-Fensters (22:00–08:00,
    // siehe istNachtzeit()) wird tatsächlich in die Schlaf-Summen aufsummiert
    // (grobe 4-Stufen-Einordnung, siehe nachtAuswertungPruefen in chat.html –
    // avgHF/avgBewegung = Summe/anzahlMesspunkte, keine Zeitreihen-Analyse,
    // daher unkritisch, ob daraus 96 oder 32 Ticks pro Nacht werden).
    // Außerhalb des Fensters (Tag) tickt der Handler weiterhin (alle 5 Min,
    // der ursprüngliche/"bisherige" Takt von vor dieser Optimierung), macht
    // dabei aber NICHTS außer erneut die Uhrzeit zu prüfen – so wird der
    // Tag→Nacht-Übergang spätestens nach 5 Minuten erkannt, der
    // Nacht→Tag-Übergang spätestens nach 15 Minuten (die Zeit wird bei
    // JEDEM Tick neu geprüft, nicht nur einmal beim Verbindungsaufbau).
    private static final long NACHT_TICK_INTERVALL_MS = 15 * 60 * 1000L; // 15 Minuten (nachts)
    private static final long TAG_TICK_INTERVALL_MS   =  5 * 60 * 1000L; // 5 Minuten (tagsüber, unverändert zum ursprünglichen Takt)

    private static volatile int letzteHerzfrequenz     = 0;
    private static volatile double bewegungSeitTick     = 0;
    private static volatile long summeHerzfrequenz      = 0;
    private static volatile double summeBewegung        = 0;
    private static volatile int anzahlMesspunkte        = 0;

    // ── Pulsvariabilität (Annäherung an HRV) – eigenes Summenpaar ───────
    // EIGENER Zähler nötig (statt anzahlMesspunkte mitzuverwenden): laut
    // pulsVariabilitaetMessen() in chat.html liefert die Variabilität erst
    // ab 5 Messpunkten im gleitenden 45s-Fenster einen Wert – direkt nach
    // Verbindungsaufbau oder nach kurzen Empfangslücken kann
    // letzteVariabilitaet also noch null sein, während bereits ein
    // gültiger letzteHerzfrequenz-Wert vorliegt. Double (statt double)
    // bewusst, damit "noch kein Wert gemeldet" (null) von "Wert 0.0"
    // unterscheidbar bleibt.
    private static volatile Double letzteVariabilitaet         = null;
    private static volatile double summeVariabilitaet          = 0;
    private static volatile int anzahlVariabilitaetsmesspunkte = 0;

    // ── Absicherung der Nacht-Summen (SharedPreferences) ────────────────
    // Die obigen Felder leben NUR im Arbeitsspeicher dieses Prozesses –
    // wird der Prozess vor der Morgen-Auswertung beendet (Speicherdruck,
    // Reboot), sind sie ohne diese Absicherung verloren, auch wenn
    // START_STICKY den Service danach neu startet (die statischen Felder
    // beginnen dann wieder bei 0). Deshalb: bei jedem Nacht-Tick den
    // aktuellen Stand persistieren, beim Service-Start wiederherstellen –
    // aber NUR, wenn der gespeicherte Stand nachweislich aus derselben
    // Nacht stammt (siehe nachtKennung()), sonst verwerfen.
    private static Context appKontext; // ApplicationContext, NICHT die Service-Instanz selbst (kein Leak-Risiko über den static-Verweis)

    private static final String NACHT_PREFS_NAME = "momentum_nacht_erfassung";
    private static final String PREF_KENNUNG     = "nachtKennung";
    private static final String PREF_SUMME_HF    = "summeHerzfrequenz";
    private static final String PREF_SUMME_BEW   = "summeBewegung";
    private static final String PREF_ANZAHL      = "anzahlMesspunkte";
    private static final String PREF_SUMME_VAR   = "summeVariabilitaet";
    private static final String PREF_ANZAHL_VAR  = "anzahlVariabilitaetsmesspunkte";

    /**
     * Echte Uhrzeit-Prüfung (Systemzeit des Geräts, java.util.Calendar statt
     * java.time – minSdkVersion 24 < 26, kein Desugaring konfiguriert).
     * Bewusst NICHT an document.hidden/Bildschirmsperre gekoppelt: kurzes
     * Sperren tagsüber soll NICHT in den Nacht-/Akku-Sparmodus wechseln.
     * Bestimmt ausschließlich, ob nachtTick() gerade summiert und welches
     * Tick-Intervall als Nächstes gilt – der Foreground Service selbst
     * läuft davon komplett unabhängig durchgehend weiter.
     */
    private static boolean istNachtzeit() {
        int stunde = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return stunde >= 22 || stunde < 8;
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
        if (cal.get(Calendar.HOUR_OF_DAY) < 8) {
            cal.add(Calendar.DAY_OF_YEAR, -1); // 00:00–08:00 gehört noch zur Nacht des Vortages
        }
        return cal.get(Calendar.YEAR) + "-" + cal.get(Calendar.DAY_OF_YEAR);
    }

    /** Schreibt den aktuellen Nacht-Summenstand nach SharedPreferences (siehe nachtTick()). */
    private static void nachtSummenPersistieren() {
        if (appKontext == null) return; // sollte nach onCreate() nie eintreten, defensiv trotzdem
        SharedPreferences.Editor editor = appKontext
            .getSharedPreferences(NACHT_PREFS_NAME, Context.MODE_PRIVATE)
            .edit();
        editor.putString(PREF_KENNUNG, nachtKennung());
        editor.putLong(PREF_SUMME_HF, summeHerzfrequenz);
        // SharedPreferences kennt kein putDouble – als String statt Float
        // gespeichert, um keine Präzision zu verlieren.
        editor.putString(PREF_SUMME_BEW, String.valueOf(summeBewegung));
        editor.putInt(PREF_ANZAHL, anzahlMesspunkte);
        editor.putString(PREF_SUMME_VAR, String.valueOf(summeVariabilitaet));
        editor.putInt(PREF_ANZAHL_VAR, anzahlVariabilitaetsmesspunkte);
        editor.apply();
    }

    /**
     * Stellt die Nacht-Summen aus SharedPreferences wieder her – NUR, wenn
     * die dort abgelegte Kennung zur aktuellen Nacht passt (siehe
     * nachtKennung()). Gehören die gespeicherten Daten zu einer anderen
     * (bereits ausgewerteten oder länger zurückliegenden) Nacht, werden
     * sie stattdessen verworfen, damit sie sich nicht fälschlich als
     * "laufende Nacht" ausgeben. Wird einmalig beim Service-Start
     * aufgerufen (siehe onStartCommand()).
     */
    private static void nachtSummenWiederherstellen() {
        if (appKontext == null) return;
        SharedPreferences prefs = appKontext.getSharedPreferences(NACHT_PREFS_NAME, Context.MODE_PRIVATE);
        String gespeicherteKennung = prefs.getString(PREF_KENNUNG, null);

        if (gespeicherteKennung == null || !gespeicherteKennung.equals(nachtKennung())) {
            nachtPrefsLoeschen(); // veraltete/fremde Nacht – nicht stehen lassen
            return;
        }

        summeHerzfrequenz = prefs.getLong(PREF_SUMME_HF, 0);
        summeBewegung = Double.parseDouble(prefs.getString(PREF_SUMME_BEW, "0"));
        anzahlMesspunkte = prefs.getInt(PREF_ANZAHL, 0);
        summeVariabilitaet = Double.parseDouble(prefs.getString(PREF_SUMME_VAR, "0"));
        anzahlVariabilitaetsmesspunkte = prefs.getInt(PREF_ANZAHL_VAR, 0);
        Log.d(TAG, "nachtSummenWiederherstellen: Summen derselben Nacht übernommen (anzahlMesspunkte="
            + anzahlMesspunkte + ", anzahlVariabilitaetsmesspunkte=" + anzahlVariabilitaetsmesspunkte + ").");
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

    /** Wird von MomentumBleServicePlugin bei jeder neuen HF-Messung aufgerufen (letzter Wert wird gehalten). */
    public static synchronized void meldeHerzfrequenz(int bpm) {
        letzteHerzfrequenz = bpm;
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
    }

    /** Einfacher Werte-Container für holeNachtDaten() – reine Datenhaltung, keine Logik. */
    public static final class NachtDaten {
        public final long summeHerzfrequenz;
        public final double summeBewegung;
        public final int anzahlMesspunkte;
        public final double summeVariabilitaet;
        public final int anzahlVariabilitaetsmesspunkte;

        NachtDaten(long summeHerzfrequenz, double summeBewegung, int anzahlMesspunkte,
                   double summeVariabilitaet, int anzahlVariabilitaetsmesspunkte) {
            this.summeHerzfrequenz = summeHerzfrequenz;
            this.summeBewegung = summeBewegung;
            this.anzahlMesspunkte = anzahlMesspunkte;
            this.summeVariabilitaet = summeVariabilitaet;
            this.anzahlVariabilitaetsmesspunkte = anzahlVariabilitaetsmesspunkte;
        }
    }

    /** Liefert die bisherigen Nacht-Summen (read-only) für die Morgen-Auswertung in chat.html. */
    public static synchronized NachtDaten holeNachtDaten() {
        return new NachtDaten(summeHerzfrequenz, summeBewegung, anzahlMesspunkte,
            summeVariabilitaet, anzahlVariabilitaetsmesspunkte);
    }

    /** Verwirft die Nacht-Summen nach erfolgter Morgen-Auswertung (im Arbeitsspeicher UND im abgesicherten Stand). */
    public static synchronized void nachtDatenZuruecksetzen() {
        summeHerzfrequenz = 0;
        summeBewegung = 0;
        anzahlMesspunkte = 0;
        summeVariabilitaet = 0;
        anzahlVariabilitaetsmesspunkte = 0;
        nachtPrefsLoeschen(); // die Rohsummen sind ausgewertet – der abgesicherte Stand muss mit verschwinden, sonst würde ein Neustart derselben Nacht sie fälschlich wiederherstellen
        Log.d(TAG, "nachtDatenZuruecksetzen: Nacht-Summen verworfen.");
    }

    private static synchronized void nachtTick() {
        summeHerzfrequenz += letzteHerzfrequenz;
        summeBewegung += bewegungSeitTick;
        anzahlMesspunkte++;

        // Lokale Kopie: vermeidet, dass zwischen Null-Prüfung und Verwendung
        // ein Race mit meldeVariabilitaet() den Wert unter der Hand ändert.
        Double variabilitaet = letzteVariabilitaet;
        if (variabilitaet != null) {
            summeVariabilitaet += variabilitaet;
            anzahlVariabilitaetsmesspunkte++;
        }

        Log.d(TAG, "Nacht-Tick #" + anzahlMesspunkte + ": HF=" + letzteHerzfrequenz
            + ", Bewegung=" + bewegungSeitTick
            + ", Variabilität=" + (variabilitaet != null ? variabilitaet : "–")
            + " (Summen bisher: HF=" + summeHerzfrequenz + ", Bewegung=" + summeBewegung
            + ", Variabilität=" + summeVariabilitaet + "/" + anzahlVariabilitaetsmesspunkte + ")");

        bewegungSeitTick = 0;
        nachtSummenPersistieren(); // Absicherung: sofort schreiben, falls der Prozess vor der Morgen-Auswertung endet
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
            // Absicherung (Change 4): falls dieser Prozess seit dem letzten
            // Nacht-Tick derselben Nacht neu gestartet wurde (Speicherdruck-
            // Kill + START_STICKY-Neustart), hier den Summenstand aus
            // SharedPreferences übernehmen, BEVOR der Handler weiterzählt.
            nachtSummenWiederherstellen();

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
