// Service Worker: macht Faden offline benutzbar.
//
// Gleiche Strategie wie die Einkaufsliste (../sw.js, dort steht das
// Warum im Detail): eigene Dateien erst vom Netz mit kurzer Frist,
// der Cache faengt auf. Eigener Geltungsbereich: dieser Worker
// gehoert nur zu faden/, die Einkaufsliste behaelt ihren.

// Hochzaehlen, sobald sich eine der Dateien unten aendert.
const VERSION = 'faden-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './css/app.css',
  './js/app.js',
  './js/state.js',
  './js/sync.js',
  './js/util.js',
  './js/md.js',
  './js/chat.js',
  './js/version.js',
  './js/ui/shell.js',
  './js/ui/editor.js',
  './js/ui/fokus.js',
  './js/ui/erfassen.js',
  './js/ui/aufraeumen.js',
  './js/ui/heute.js',
  './js/ui/notizen.js',
  './js/ui/projekte.js',
  './js/ui/fragen.js',
  './js/ui/mehr.js',
  '../vendor/supabase-js.mjs',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      // Einzeln statt addAll: eine fehlende Datei soll nicht die
      // gesamte Installation scheitern lassen.
      await Promise.all(
        PRECACHE.map((path) =>
          cache.add(new Request(path, { cache: 'reload' })).catch((err) => {
            console.warn('Nicht im Cache:', path, err.message);
          }),
        ),
      );
      // Nicht warten, bis alle Fenster zu sind - auf dem iPhone wird
      // eine Homescreen-App kaum je richtig beendet, eine neue
      // Fassung bliebe sonst wochenlang im Wartezimmer.
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Nur eigene alte Zwischenspeicher wegwerfen - auf derselben
      // Domain liegen auch die der Einkaufsliste.
      await Promise.all(
        keys
          .filter((key) => key.startsWith('faden-') && key !== SHELL && key !== RUNTIME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Wie lange auf das Netz gewartet wird, bevor der Cache einspringt.
const NETZ_FRIST_MS = 2500;

function mitFrist(promise, ms) {
  return new Promise((resolve, reject) => {
    const uhr = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    promise.then(
      (wert) => { clearTimeout(uhr); resolve(wert); },
      (fehler) => { clearTimeout(uhr); reject(fehler); },
    );
  });
}

/** Eigene Dateien: erst das Netz, der Cache faengt auf. */
function eigeneDatei(request) {
  const netz = fetch(request).then((response) => {
    if (response && response.ok) {
      const kopie = response.clone();
      caches.open(SHELL).then((cache) => cache.put(request, kopie)).catch(() => {});
    }
    return response;
  });
  netz.catch(() => {});

  return caches.match(request).then(async (cached) => {
    if (!cached) return netz;
    try {
      return await mitFrist(netz, NETZ_FRIST_MS);
    } catch {
      return cached;
    }
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase-API und die Edge Function nie aus dem Cache bedienen.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/functions/')) {
    return;
  }

  // Der Notausgang kommt immer frisch vom Server, nie aus dem Cache.
  // Steht VOR dem Navigations-Zweig: auch der Aufruf von frisch.html
  // ist eine Navigation, und ihre Antwort darf auf keinen Fall als
  // App-Hülle im Cache landen.
  if (url.pathname.endsWith('/frisch.html')) return;

  // Seitenaufrufe: erst Netz, sonst die gecachte App-Hülle.
  if (request.mode === 'navigate') {
    // Als Hülle gespeichert wird nur eine gesunde Antwort auf die
    // App-Adresse selbst - sonst vergiftet eine 404- oder Fehlerseite
    // den Offline-Start.
    const istShell = url.pathname.endsWith('/faden/') || url.pathname.endsWith('/faden/index.html');
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (istShell && response.ok) {
            caches.open(SHELL).then((cache) => cache.put('./index.html', response.clone()));
          }
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) ?? new Response('Offline', { status: 503 })),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(eigeneDatei(request));
    return;
  }

  // Fremde Quellen (die Supabase-Bibliothek vom CDN): einmal holen,
  // danach aus dem Cache - sonst startet die App ohne Netz nicht.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          caches.open(RUNTIME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
    }),
  );
});
