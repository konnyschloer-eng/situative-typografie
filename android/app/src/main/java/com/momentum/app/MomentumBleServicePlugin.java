package com.momentum.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

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

    @PluginMethod
    public void start(PluginCall call) {
        // POST_NOTIFICATIONS ist erst ab Android 13 (API 33) eine
        // Laufzeit-Berechtigung – ohne sie zeigt das System die
        // Pflicht-Benachrichtigung nicht an. Der Foreground Service selbst
        // (und damit der Verbindungsschutz) läuft aber so oder so weiter,
        // auch falls die Berechtigung verweigert wird – siehe
        // onNotificationPermissionResult().
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotificationPermissionResult");
            return;
        }
        serviceStarten(call);
    }

    @PermissionCallback
    private void onNotificationPermissionResult(PluginCall call) {
        serviceStarten(call);
    }

    private void serviceStarten(PluginCall call) {
        Intent intent = new Intent(getContext(), MomentumBleForegroundService.class);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), MomentumBleForegroundService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
