/**
 * "Zum Startbildschirm hinzufügen" – Knopf und Installation.
 *
 * Eingebunden wird die Datei auf jeder Seite (für den Service Worker).
 * Den Knopf gibt es nur dort, wo im HTML ein Element mit
 * id="install-app" steht – aktuell im Fuß der Startseite.
 *
 * Drei Fälle, die der Browser vorgibt:
 *
 *   Android / Chrome / Edge   Der Browser meldet sich mit
 *                             "beforeinstallprompt". Erst dann erscheint der
 *                             Knopf, ein Klick öffnet den Systemdialog.
 *   iPhone / iPad             Apple bietet keine Schnittstelle an. Der Knopf
 *                             erscheint trotzdem und zeigt in zwei Schritten,
 *                             wo "Zum Home-Bildschirm" steckt.
 *   Bereits installiert       Kein Knopf. Weder in der installierten App noch
 *                             nach einer erfolgreichen Installation.
 *
 * Der Knopf drängt sich nirgends auf: kein Aufklappen von selbst, kein
 * Banner, keine Wiedervorlage.
 */
'use strict';
(function () {
  /* ── Service Worker (Voraussetzung für die Installation) ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* Ohne Service Worker läuft die App normal weiter – nur ohne Zwischenspeicher. */
      });
    });
  }

  var installEvent = null; // von "beforeinstallprompt" aufgehoben
  var button = null;

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    var ua = window.navigator.userAgent;
    return (
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS meldet sich seit Version 13 als Mac – erkennbar am Touchscreen.
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    );
  }

  function show() {
    if (button) button.hidden = false;
  }

  function hide() {
    if (button) button.hidden = true;
    closeSheet();
  }

  /* ── Anleitung für iPhone und iPad ── */

  var sheet = null;

  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeSheet();
  }

  function openSheet() {
    if (sheet) return closeSheet();

    sheet = document.createElement('div');
    sheet.className = 'a2hs-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Zum Startbildschirm hinzufügen');
    sheet.innerHTML =
      '<div class="a2hs-sheet__box">' +
      '<p class="a2hs-sheet__title">In zwei Schritten auf den Startbildschirm</p>' +
      '<ol class="a2hs-sheet__steps">' +
      '<li>Unten in der Safari-Leiste auf <b>Teilen</b> tippen ' +
      '<svg class="a2hs-sheet__glyph" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.5 8.6 6.9M12 3.5l3.4 3.4M12 3.5v11.2" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M6.5 10.5h-1v10h13v-10h-1" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></li>' +
      '<li><b>Zum Home-Bildschirm</b> wählen und mit <b>Hinzufügen</b> bestätigen.</li>' +
      '</ol>' +
      '<button type="button" class="a2hs-sheet__close">Verstanden</button>' +
      '</div>';

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet || e.target.classList.contains('a2hs-sheet__close')) closeSheet();
    });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(sheet);
    sheet.querySelector('.a2hs-sheet__close').focus();
  }

  /* ── Verdrahtung ── */

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // Kein automatisches Banner – der Knopf entscheidet.
    installEvent = e;
    if (!isStandalone()) show();
  });

  window.addEventListener('appinstalled', function () {
    installEvent = null;
    hide();
  });

  function onClick() {
    if (installEvent) {
      var prompted = installEvent;
      installEvent = null;
      prompted.prompt();
      prompted.userChoice.then(function (choice) {
        if (choice.outcome === 'accepted') hide();
        else installEvent = prompted; // Abgelehnt: Knopf bleibt, ohne zu drängen.
      });
      return;
    }
    openSheet(); // iPhone/iPad: Anleitung statt Systemdialog
  }

  function init() {
    button = document.getElementById('install-app');
    if (!button) return;
    button.addEventListener('click', onClick);
    // Auf iOS gibt es kein "beforeinstallprompt" – dort zeigt der Knopf die
    // Anleitung und muss deshalb von Anfang an sichtbar sein.
    if (isIos() && !isStandalone()) show();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
