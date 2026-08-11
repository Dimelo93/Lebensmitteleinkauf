// Service Worker: macht die App offline benutzbar.
//
// Im Laden ist oft kein Empfang - die Liste muss trotzdem sofort da
// sein. Deshalb liegen alle eigenen Dateien im Cache und werden im
// Hintergrund aufgefrischt.

const VERSION = 'einkauf-v1';
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
  './js/katalog.js',
  './js/parse.js',
  './js/analyse.js',
  './js/ui/shell.js',
  './js/ui/liste.js',
  './js/ui/laeden.js',
  './js/ui/vorlagen.js',
  './js/ui/budget.js',
  './js/ui/mehr.js',
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
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL && key !== RUNTIME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase-API und die Quittungs-Analyse nie aus dem Cache bedienen.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/functions/')) {
    return;
  }

  // Seitenaufrufe: erst Netz, sonst die gecachte App-Hülle.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(SHELL).then((cache) => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) ?? new Response('Offline', { status: 503 })),
    );
    return;
  }

  // Eigene Dateien: sofort aus dem Cache, im Hintergrund erneuern.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(SHELL).then((cache) => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
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
