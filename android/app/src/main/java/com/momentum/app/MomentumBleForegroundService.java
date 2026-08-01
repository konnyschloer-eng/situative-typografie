package com.momentum.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

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

    @Override
    public IBinder onBind(Intent intent) {
        // Kein gebundener Service – nur gestartet/gestoppt, kein direkter
        // Methodenaufruf-Kanal nötig (Kommunikation läuft ausschließlich über
        // Start-/Stop-Intents vom Plugin aus).
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        benachrichtigungskanalErstellen();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification benachrichtigung = benachrichtigungBauen();

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

        // START_STICKY: Falls das System den Prozess trotz Foreground-Status
        // unter Speicherdruck doch beendet, wird der Service (ohne den
        // ursprünglichen Intent) neu gestartet, sobald wieder Ressourcen frei
        // sind. Passt zum Anwendungsfall (Nacht-Messung) besser als
        // START_NOT_STICKY.
        return START_STICKY;
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
            }
        }
    }

    private Notification benachrichtigungBauen() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Momentum misst deinen Puls")
            .setContentText("Verbunden mit deinem Band – auch bei gesperrtem Bildschirm aktiv.")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true) // vom Nutzer nicht wegwischbar, solange der Service läuft (Android-Vorgabe)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }
}
