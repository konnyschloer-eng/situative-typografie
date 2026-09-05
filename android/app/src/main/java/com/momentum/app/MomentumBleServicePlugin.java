package com.momentum.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.List;

import org.json.JSONObject;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Capacitor-Bridge-Schicht (echter nativer Android-Code, Java) zwischen
 * chat.html und MomentumBleForegroundService. Das ist EIN CUSTOM-PLUGIN
 * dieser App selbst (kein npm-Paket wie @capacitor-community/bluetooth-le,
 * daher auch die manuelle Registrierung in MainActivity.java statt
 * automatischer Erkennung über node_modules) – die zweite, neue Ebene
 * gegenüber dem bisherigen Plugin-Code: bisher nutzte die App ausschließlich
 * ein FREMDES, fertiges Plugin (bluetooth-le); MomentumBleServicePlugin ist
 * jetzt das erste selbst geschriebene native Plugin dieser App.
 *
 * Auf JS-Seite in chat.html registriert als eigener Capacitor-Plugin-Proxy
 * ("MomentumBleService", per capacitorExports.registerPlugin – exakt dasselbe
 * Muster, das auch bluetooth-le intern verwendet) und ausschließlich an den
 * bestehenden Connect-/Disconnect-Stellen aufgerufen (start() nach
 * erfolgreichem BleClient.connect(), stop() beim Zurücksetzen der
 * Verbindung) – die eigentliche Puls-/BPM-Logik bleibt unangetastet, diese
 * Klasse kennt sie gar nicht.
 */
@CapacitorPlugin(
    name = "MomentumBleService",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class MomentumBleServicePlugin extends Plugin {

    private static final String TAG = "MomentumBleServicePlugin";

    @PluginMethod
    public void start(PluginCall call) {
        Log.d(TAG, "start() von JS aus aufgerufen.");
        // POST_NOTIFICATIONS ist erst ab Android 13 (API 33) eine
        // Laufzeit-Berechtigung – ohne sie zeigt das System die
        // Pflicht-Benachrichtigung nicht an. Der Foreground Service selbst
        // (und damit der Verbindungsschutz) läuft aber so oder so weiter,
        // auch falls die Berechtigung verweigert wird – siehe
        // onNotificationPermissionResult().
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            Log.d(TAG, "start(): POST_NOTIFICATIONS noch nicht gewährt, fordere Berechtigung an.");
            requestPermissionForAlias("notifications", call, "onNotificationPermissionResult");
            return;
        }
        serviceStarten(call);
    }

    @PermissionCallback
    private void onNotificationPermissionResult(PluginCall call) {
        Log.d(TAG, "onNotificationPermissionResult: Berechtigungsstatus=" + getPermissionState("notifications"));
        serviceStarten(call);
    }

    private void serviceStarten(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), MomentumBleForegroundService.class);
            ContextCompat.startForegroundService(getContext(), intent);
            Log.d(TAG, "serviceStarten: startForegroundService() aufgerufen, keine Exception.");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "serviceStarten: startForegroundService() fehlgeschlagen.", e);
            call.reject("Foreground Service konnte nicht gestartet werden: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Log.d(TAG, "stop() von JS aus aufgerufen.");
        try {
            Intent intent = new Intent(getContext(), MomentumBleForegroundService.class);
            boolean liefEndete = getContext().stopService(intent);
            Log.d(TAG, "stop(): stopService() aufgerufen, lief zuvor=" + liefEndete + ".");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "stop(): stopService() fehlgeschlagen.", e);
            call.reject("Foreground Service konnte nicht gestoppt werden: " + e.getMessage(), e);
        }
    }

    // ── Nacht-Erfassung (Schlafqualität) ────────────────────────────
    // Reine Weiterleitung an die statischen Felder in
    // MomentumBleForegroundService (siehe dort für die eigentliche
    // 15-Minuten-Verdichtungslogik) – dieses Plugin bündelt nur den
    // JS-seitigen Zugriff darauf.

    @PluginMethod
    public void meldeHerzfrequenz(PluginCall call) {
        Integer bpm = call.getInt("bpm");
        if (bpm != null) {
            MomentumBleForegroundService.meldeHerzfrequenz(bpm);
        }
        call.resolve();
    }

    @PluginMethod
    public void meldeBewegung(PluginCall call) {
        Double betrag = call.getDouble("betrag");
        if (betrag != null) {
            MomentumBleForegroundService.meldeBewegung(betrag);
        }
        call.resolve();
    }

    // Wird von chat.html (bpmEmpfangen) nur aufgerufen, wenn
    // pulsVariabilitaetMessen() nicht null liefert (ab 5 Messpunkten im
    // 45s-Fenster) – siehe MomentumBleForegroundService.meldeVariabilitaet.
    @PluginMethod
    public void meldeVariabilitaet(PluginCall call) {
        Double wert = call.getDouble("wert");
        if (wert != null) {
            MomentumBleForegroundService.meldeVariabilitaet(wert);
        }
        call.resolve();
    }

    // Liefert die ganze Zeitreihe der Nacht (statt wie früher nur Summen) –
    // aus einer Summe lässt sich kein Schlafbeginn rekonstruieren, siehe
    // MomentumBleForegroundService. Lücken bleiben als JSON-null erhalten,
    // damit die Auswertung Verbindungsabbrüche erkennen kann.
    @PluginMethod
    public void holeNachtDaten(PluginCall call) {
        List<MomentumBleForegroundService.Messpunkt> reihe =
            MomentumBleForegroundService.holeNachtDaten();

        JSArray punkte = new JSArray();
        int mitDaten = 0;
        for (MomentumBleForegroundService.Messpunkt m : reihe) {
            JSObject o = new JSObject();
            o.put("zeit", m.zeit);
            // JSObject erbt von JSONObject: put(String, Object) mit null
            // ENTFERNT den Schlüssel, deshalb explizit JSONObject.NULL.
            o.put("bpm", m.bpm == null ? JSONObject.NULL : m.bpm);
            o.put("bewegung", m.bewegung == null ? JSONObject.NULL : m.bewegung);
            o.put("hrv", m.variabilitaet == null ? JSONObject.NULL : m.variabilitaet);
            punkte.put(o);
            if (m.bpm != null) mitDaten++;
        }

        JSObject ergebnis = new JSObject();
        ergebnis.put("messpunkte", punkte);
        ergebnis.put("rahmenVorbei", MomentumBleForegroundService.istRahmenVorbei());

        Log.d(TAG, "holeNachtDaten: " + reihe.size() + " Messpunkte (" + mitDaten
            + " mit Daten, " + (reihe.size() - mitDaten) + " Lücken), rahmenVorbei="
            + MomentumBleForegroundService.istRahmenVorbei());
        call.resolve(ergebnis);
    }

    @PluginMethod
    public void nachtDatenZuruecksetzen(PluginCall call) {
        MomentumBleForegroundService.nachtDatenZuruecksetzen();
        call.resolve();
    }
}
