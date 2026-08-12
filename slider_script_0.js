
    function umrechnen(wert, vonMin, vonMax, zuMin, zuMax) {
      return zuMin + (wert - vonMin) / (vonMax - vonMin) * (zuMax - zuMin);
    }

    // ═══════════════════════════════════════════════════════════
    // 1 — INTENSITÄT: 7 statische Situra-Schnitte, dünn → fett.
    // Exakt dieselbe Stufen-Logik wie intensitaetZuSchriftschnitt()
    // in chat.html: ein 100–900-Rohwert wird in 7 gleich große
    // Stufen geteilt – jede Stufe zeigt GENAU einen Schnitt, kein
    // fließendes Überblenden (Situra ist keine Variable Font).
    // ═══════════════════════════════════════════════════════════
    const SITURA_SCHRIFTSCHNITTE = [
      'Situra-Thin', 'Situra-Light', 'Situra-Regular', 'Situra-Medium',
      'Situra-SemiBold', 'Situra-Bold', 'Situra-Black'
    ];

    function intensitaetZuSchriftschnitt(intensitaet) {
      const stufenBreite = 800 / SITURA_SCHRIFTSCHNITTE.length; // (900−100) / 7
      const index = Math.min(
        SITURA_SCHRIFTSCHNITTE.length - 1,
        Math.max(0, Math.floor((intensitaet - 100) / stufenBreite))
      );
      return SITURA_SCHRIFTSCHNITTE[index];
    }

    const reglerIntensitaet = document.getElementById('regler-intensitaet');
    const wortIntensitaet   = document.getElementById('wort-intensitaet');
    const wertIntensitaet   = document.getElementById('wert-intensitaet');

    function intensitaetAktualisieren() {
      const wert    = Number(reglerIntensitaet.value);
      const schnitt = intensitaetZuSchriftschnitt(wert);
      wortIntensitaet.style.fontFamily = `'${schnitt}', 'Inter', sans-serif`;
      wertIntensitaet.innerHTML = `<strong>${schnitt}</strong> · ${wert}`;
    }
    reglerIntensitaet.addEventListener('input', intensitaetAktualisieren);
    intensitaetAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 2 — TEMPO: letter-spacing, stufenlos (−0.04em … 0.12em),
    // identischer Wertebereich/Mapping wie in chat.html.
    // ═══════════════════════════════════════════════════════════
    const reglerTempo = document.getElementById('regler-tempo');
    const wortTempo    = document.getElementById('wort-tempo');
    const wertTempo    = document.getElementById('wert-tempo');

    function tempoAktualisieren() {
      const wert    = Number(reglerTempo.value);
      const spacing = umrechnen(wert, 100, 900, -0.04, 0.12);
      wortTempo.style.letterSpacing = `${spacing.toFixed(3)}em`;
      wertTempo.innerHTML = `<strong>${spacing.toFixed(3)}em</strong> · ${wert}`;
    }
    reglerTempo.addEventListener('input', tempoAktualisieren);
    tempoAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 3 — STABILITÄT: Zitter-Stärke, 0 (ruhig) … 10 (stark).
    // Buchstaben werden EINMALIG in Spans zerlegt; jeder Buchstabe
    // bekommt eine eigene, leicht zufällige Dauer/Verzögerung für
    // organisches, asynchrones Zittern (wie in chat.html/onboarding.
    // html) – die STÄRKE (--amp/--rot) wird direkt vom Regler gesetzt.
    // ═══════════════════════════════════════════════════════════
    const reglerStabilitaet = document.getElementById('regler-stabilitaet');
    const wortStabilitaet   = document.getElementById('wort-stabilitaet');
    const wertStabilitaet   = document.getElementById('wert-stabilitaet');

    (function buchstabenVorbereiten() {
      const text = wortStabilitaet.textContent;
      wortStabilitaet.textContent = '';
      for (const zeichen of text) {
        const span = document.createElement('span');
        span.textContent = zeichen;
        span.classList.add('zitter-buchstabe');
        const dauer     = (0.3 + Math.random() * 0.4).toFixed(2);
        const verzoeger = (-Math.random() * 1.2).toFixed(2);
        span.style.animationName           = 'situraZittern';
        span.style.animationDuration       = `${dauer}s`;
        span.style.animationTimingFunction = 'ease-in-out';
        span.style.animationIterationCount = 'infinite';
        span.style.animationDelay          = `${verzoeger}s`;
        wortStabilitaet.appendChild(span);
      }
    })();

    function stabilitaetAktualisieren() {
      const wert = Number(reglerStabilitaet.value); // 0–10
      const amp  = wert;              // px – direkt die Reglerstärke
      const rot  = wert * 1.2;        // Grad – proportional zur Stärke

      wortStabilitaet.querySelectorAll('.zitter-buchstabe').forEach(function (span) {
        span.style.setProperty('--amp', `${amp}px`);
        span.style.setProperty('--rot', `${rot}deg`);
        span.style.animationPlayState = wert > 0 ? 'running' : 'paused';
      });

      wertStabilitaet.innerHTML = wert <= 0
        ? `<strong>ruhig</strong> · 0`
        : `<strong>${amp.toFixed(1)}px</strong> · ${wert}`;
    }
    reglerStabilitaet.addEventListener('input', stabilitaetAktualisieren);
    stabilitaetAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 4 — WACHHEIT: Unschärfe (blur), stufenlos – 0 = müde/unscharf,
    // 100 = wach/scharf. Deutlich stärker als früher (war 2px, kaum
    // wahrnehmbar bei der großen Wort-Schriftgröße dieser Seite) –
    // bei voller Unschärfe (0) noch klar als "Hallo" lesbar, aber der
    // Unterschied zu "wach" (scharf) ist jetzt unübersehbar. Dieselbe
    // Konstante wird auch vom kombinierten Regler-Block (Abschnitt 7)
    // für die dortige Wachheit-Achse verwendet.
    // ═══════════════════════════════════════════════════════════
    const reglerWachheit = document.getElementById('regler-wachheit');
    const wortWachheit    = document.getElementById('wort-wachheit');
    const wertWachheit    = document.getElementById('wert-wachheit');
    const BLUR_MAX = 5.0;

    function wachheitAktualisieren() {
      const wert = Number(reglerWachheit.value);
      const blur = umrechnen(wert, 0, 100, BLUR_MAX, 0);
      wortWachheit.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      wertWachheit.innerHTML = `<strong>${blur.toFixed(2)}px</strong> · ${wert}`;
    }
    reglerWachheit.addEventListener('input', wachheitAktualisieren);
    wachheitAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 5 — ATMUNG: Deckkraft (opacity), stufenlos –
    // 0 = aufgewühlt/blass (0.35), 100 = gefasst/kräftig (1).
    // ═══════════════════════════════════════════════════════════
    const reglerGefasstheit = document.getElementById('regler-gefasstheit');
    const wortGefasstheit    = document.getElementById('wort-gefasstheit');
    const wertGefasstheit    = document.getElementById('wert-gefasstheit');
    const TRANSPARENZ_MIN = 0.35;

    function gefasstheitAktualisieren() {
      const wert = Number(reglerGefasstheit.value);
      const deckkraft = umrechnen(wert, 0, 100, TRANSPARENZ_MIN, 1);
      wortGefasstheit.style.opacity = deckkraft.toFixed(2);
      wertGefasstheit.innerHTML = `<strong>${deckkraft.toFixed(2)}</strong> · ${wert}`;
    }
    reglerGefasstheit.addEventListener('input', gefasstheitAktualisieren);
    gefasstheitAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 6 — TEMPERATUR: Schriftgröße kühl → warm, stufenlos.
    // kühl = klein, warm = groß. Bewusst NUR ±12% um die tatsächlich
    // gerenderte Basisgröße (per getComputedStyle erfasst, VOR jeder
    // Inline-Überschreibung, da .dimension-wort eine responsive
    // clamp()-Größe hat) – die Schriftgrößen-Hierarchie bleibt so in
    // engen Grenzen.
    // ═══════════════════════════════════════════════════════════
    const reglerTonalitaet = document.getElementById('regler-tonalitaet');
    const wortTonalitaet    = document.getElementById('wort-tonalitaet');
    const wertTonalitaet    = document.getElementById('wert-tonalitaet');
    const TON_GROESSE_BASIS_PX = parseFloat(getComputedStyle(wortTonalitaet).fontSize);
    const TON_GROESSE_MIN_PX   = TON_GROESSE_BASIS_PX * 0.88;
    const TON_GROESSE_MAX_PX   = TON_GROESSE_BASIS_PX * 1.12;

    function tonalitaetAktualisieren() {
      const wert = Number(reglerTonalitaet.value);
      const groesse = umrechnen(wert, 0, 100, TON_GROESSE_MIN_PX, TON_GROESSE_MAX_PX);
      wortTonalitaet.style.fontSize = `${groesse.toFixed(1)}px`;
      const label = wert < 35 ? 'klein' : wert > 65 ? 'groß' : 'mittel';
      wertTonalitaet.innerHTML = `<strong>${label}</strong> · ${wert}`;
    }
    reglerTonalitaet.addEventListener('input', tonalitaetAktualisieren);
    tonalitaetAktualisieren();

    // ═══════════════════════════════════════════════════════════
    // 7 — KOMBINIERT: alle sechs Achsen auf EIN gemeinsames Wort.
    // Jede Achse bleibt technisch unabhängig – Intensität/Tempo/
    // Wachheit/Atmung/Temperatur setzen je eine eigene CSS-
    // Eigenschaft auf dem Wort-Container (fontFamily/letterSpacing/
    // filter/opacity/color), Stabilität wirkt wie in Abschnitt 3 auf
    // die einzeln zerlegten Buchstaben-Spans darin – sie überschreiben
    // sich also nie gegenseitig. kombiAchseEinrichten() bindet Regler +
    // Schalter pro Achse: ist der Schalter aus, wird IMMER neutral()
    // angewendet statt anwenden(reglerWert), unabhängig von der
    // Reglerposition (siehe Anforderung "deaktivierte Achsen ohne
    // Einfluss").
    // ═══════════════════════════════════════════════════════════
    const wortKombiniert = document.getElementById('wort-kombiniert');

    // Buchstaben einmalig in Spans zerlegen (exakt wie Abschnitt 3) –
    // nötig, damit Stabilität/Zittern pro Buchstabe wirken kann. Die
    // übrigen Achsen setzen ihre Eigenschaften weiterhin auf dem
    // umschließenden wortKombiniert-Element selbst (wird an die
    // Buchstaben-Spans vererbt, z. B. font-family/opacity/color).
    (function buchstabenVorbereitenKombiniert() {
      const text = wortKombiniert.textContent;
      wortKombiniert.textContent = '';
      for (const zeichen of text) {
        const span = document.createElement('span');
        span.textContent = zeichen;
        span.classList.add('zitter-buchstabe');
        const dauer     = (0.3 + Math.random() * 0.4).toFixed(2);
        const verzoeger = (-Math.random() * 1.2).toFixed(2);
        span.style.animationName           = 'situraZittern';
        span.style.animationDuration       = `${dauer}s`;
        span.style.animationTimingFunction = 'ease-in-out';
        span.style.animationIterationCount = 'infinite';
        span.style.animationDelay          = `${verzoeger}s`;
        wortKombiniert.appendChild(span);
      }
    })();

    // Bindet Schalter + Regler EINER Achse ans gemeinsame Wort.
    // konfig.anwenden(wert, wertEl) setzt die Eigenschaft passend zum
    // aktuellen Reglerwert; konfig.neutral() setzt exakt diese eine
    // Eigenschaft zurück, ohne die der anderen Achsen zu berühren.
    function kombiAchseEinrichten(name, konfig) {
      const wrapper  = document.getElementById(`kombi-achse-${name}`);
      const schalter = document.getElementById(`schalter-k-${name}`);
      const regler   = document.getElementById(`regler-k-${name}`);
      const wertEl   = document.getElementById(`wert-k-${name}`);

      function aktualisieren() {
        const aktiv = schalter.checked;
        wrapper.classList.toggle('kombi-achse--aus', !aktiv);
        regler.disabled = !aktiv;
        if (aktiv) {
          konfig.anwenden(Number(regler.value), wertEl);
        } else {
          konfig.neutral();
          wertEl.textContent = 'Aus';
        }
      }

      schalter.addEventListener('change', aktualisieren);
      regler.addEventListener('input', aktualisieren);
      aktualisieren();
    }

    kombiAchseEinrichten('intensitaet', {
      anwenden(wert, wertEl) {
        const schnitt = intensitaetZuSchriftschnitt(wert);
        wortKombiniert.style.fontFamily = `'${schnitt}', 'Inter', sans-serif`;
        wertEl.innerHTML = `<strong>${schnitt}</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.style.fontFamily = `'Situra-Regular', 'Inter', sans-serif`;
      }
    });

    kombiAchseEinrichten('tempo', {
      anwenden(wert, wertEl) {
        const spacing = umrechnen(wert, 100, 900, -0.04, 0.12);
        wortKombiniert.style.letterSpacing = `${spacing.toFixed(3)}em`;
        wertEl.innerHTML = `<strong>${spacing.toFixed(3)}em</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.style.letterSpacing = 'normal';
      }
    });

    kombiAchseEinrichten('stabilitaet', {
      anwenden(wert, wertEl) {
        const amp = wert;         // px – direkt die Reglerstärke
        const rot = wert * 1.2;   // Grad – proportional zur Stärke
        wortKombiniert.querySelectorAll('.zitter-buchstabe').forEach(function (span) {
          span.style.setProperty('--amp', `${amp}px`);
          span.style.setProperty('--rot', `${rot}deg`);
          span.style.animationPlayState = wert > 0 ? 'running' : 'paused';
        });
        wertEl.innerHTML = wert <= 0
          ? `<strong>ruhig</strong> · 0`
          : `<strong>${amp.toFixed(1)}px</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.querySelectorAll('.zitter-buchstabe').forEach(function (span) {
          span.style.setProperty('--amp', '0px');
          span.style.setProperty('--rot', '0deg');
          span.style.animationPlayState = 'paused';
        });
      }
    });

    kombiAchseEinrichten('wachheit', {
      anwenden(wert, wertEl) {
        const blur = umrechnen(wert, 0, 100, BLUR_MAX, 0);
        wortKombiniert.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
        wertEl.innerHTML = `<strong>${blur.toFixed(2)}px</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.style.filter = 'none';
      }
    });

    kombiAchseEinrichten('gefasstheit', {
      anwenden(wert, wertEl) {
        const deckkraft = umrechnen(wert, 0, 100, TRANSPARENZ_MIN, 1);
        wortKombiniert.style.opacity = deckkraft.toFixed(2);
        wertEl.innerHTML = `<strong>${deckkraft.toFixed(2)}</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.style.opacity = '1';
      }
    });

    kombiAchseEinrichten('tonalitaet', {
      anwenden(wert, wertEl) {
        // Dieselbe ±12%-Basis wie Abschnitt 6 (TON_GROESSE_MIN_PX/MAX_PX,
        // siehe dort) – wortKombiniert teilt dieselbe .dimension-wort-
        // Klasse/Basisgröße wie wortTonalitaet.
        const groesse = umrechnen(wert, 0, 100, TON_GROESSE_MIN_PX, TON_GROESSE_MAX_PX);
        wortKombiniert.style.fontSize = `${groesse.toFixed(1)}px`;
        const label = wert < 35 ? 'klein' : wert > 65 ? 'groß' : 'mittel';
        wertEl.innerHTML = `<strong>${label}</strong> · ${wert}`;
      },
      neutral() {
        wortKombiniert.style.fontSize = '';
      }
    });
  