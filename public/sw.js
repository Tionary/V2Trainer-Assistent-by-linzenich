/**
 * Service Worker – zwei Aufgaben, mehr nicht:
 *
 *   1. Er macht die App "installierbar". Chrome und Edge blenden den Knopf
 *      "Zum Startbildschirm hinzufügen" nur ein, wenn eine Seite einen
 *      Service Worker mit fetch-Behandlung mitbringt (zusätzlich zum
 *      manifest.webmanifest).
 *   2. Er legt die unveränderlichen Beiwerk-Dateien (Schriften, Icons,
 *      PDF-Bibliotheken, Bilder) in einen Zwischenspeicher. Das spart im
 *      Studio-WLAN spürbar Ladezeit.
 *
 * Bewusst NICHT zwischengespeichert werden HTML-Seiten und alles unter
 * /api/, /login, /logout, /s/. Sonst könnte ein abgemeldeter Browser noch
 * Inhalte aus dem Speicher zeigen oder eine Anmeldeseite als vermeintliche
 * Modulseite ausliefern.
 */
const CACHE = 'trainer-assistent-static-v1';

/** Nur Dateien aus diesen Ordnern landen im Zwischenspeicher. */
const CACHEABLE = ['/icons/', '/fonts/', '/vendor/', '/fms-img/'];
const CACHEABLE_FILES = ['/favicon.svg', '/trainer-assistent-logo.png', '/by-linzenich-weiss.png'];

/** Seite, die erscheint, wenn das Gerät offline ist. */
const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Keine Verbindung · Trainer-Assistent</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;
       font-family:ui-sans-serif,system-ui,sans-serif;color:#f2efe8;background:#0a261f}
  .box{max-width:22rem}
  h1{font-size:1.25rem;margin:0 0 .6rem}
  p{font-size:.95rem;line-height:1.6;color:#9fb3aa;margin:0 0 1.4rem}
  button{font:inherit;font-weight:700;color:#0a261f;background:#d8b889;border:0;cursor:pointer;
         padding:.7rem 1.4rem;border-radius:9999px}
</style></head>
<body><div class="box">
  <h1>Keine Verbindung</h1>
  <p>Der Trainer-Assistent braucht Internet. Sobald das Netz wieder da ist,
     geht es hier weiter.</p>
  <button type="button" onclick="location.reload()">Erneut versuchen</button>
</div></body></html>`;

self.addEventListener('install', (event) => {
  // Icons vorab holen, damit das Startbild auch ohne Netz sitzt.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/icons/icon-192.png', '/icons/icon-512.png']))
      .catch(() => undefined) // Ein fehlgeschlagener Vorab-Download darf nichts blockieren.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isCacheable(url) {
  return (
    url.origin === self.location.origin &&
    (CACHEABLE.some((prefix) => url.pathname.startsWith(prefix)) ||
      CACHEABLE_FILES.includes(url.pathname))
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isCacheable(url)) {
    // Erst Speicher, dann Netz – diese Dateien ändern sich nur bei einem Deploy.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            // Eine Weiterleitung auf /login ist keine Schriftdatei: nicht ablegen.
            if (response.ok && !response.redirected) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Alles andere kommt immer frisch aus dem Netz; nur wenn das scheitert und
  // eine Seite aufgerufen wurde, erscheint der Offline-Hinweis.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_PAGE, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
  }
});
