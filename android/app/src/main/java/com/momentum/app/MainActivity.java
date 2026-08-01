package com.momentum.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // MomentumBleServicePlugin ist ein eigenes, app-lokales Plugin
        // (keine npm-Abhängigkeit wie bluetooth-le) – solche Plugins werden
        // nicht automatisch erkannt und müssen hier vor super.onCreate()
        // registriert werden, damit die Bridge sie beim Aufbau kennt.
        registerPlugin(MomentumBleServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
