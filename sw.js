// Service Worker: macht die App offline benutzbar.
//
// Im Laden ist oft kein Empfang - die Liste muss trotzdem sofort da
// sein. Deshalb liegen alle eigenen Dateien im Cache und werden im
// Hintergrund aufgefrischt.

// Hochzaehlen, sobald sich eine der Dateien unten aendert. Sonst
// liefert der Cache beim naechsten Start noch die alte Fassung -
// bei config.js hiesse das: Zugangsdaten da, App trotzdem offline.
const VERSION = 'einkauf-v10';
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
  './js/version.js',
  './vendor/supabase-js.mjs',
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
      // Nicht warten, bis alle Fenster zu sind. Auf dem iPhone wird
      // eine Web-App vom Homescreen kaum je richtig beendet - sie
      // wird aus dem Speicher wiederhergestellt. Eine neue Fassung
      // blieb sonst wochenlang im Wartezimmer, und die Korrektur kam
      // beim Nutzer nie an.
      await self.skipWaiting();
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

// Wie lange auf das Netz gewartet wird, bevor der Cache einspringt.
// Lang genug fuer ein traeges Mobilnetz, kurz genug, dass es an der
// Kasse nicht stoert.
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

/**
 * Eigene Dateien: erst das Netz, der Cache faengt auf.
 *
 * Vorher andersherum - Cache zuerst, Erneuerung im Hintergrund. Das
 * las sich gut, hatte aber einen Haken: auf dem Telefon wird die App
 * schnell schlafen gelegt, und die Erneuerung im Hintergrund kam nie
 * bis zum Speichern. So blieb dieselbe alte Fassung ueber Tage
 * haengen, und jede Korrektur lief ins Leere.
 *
 * Umgekehrt ist die App online immer aktuell und ohne Netz weiterhin
 * sofort da - nur eben mit dem Stand von zuletzt.
 */
function eigeneDatei(request) {
  const netz = fetch(request).then((response) => {
    if (response && response.ok) {
      const kopie = response.clone();
      caches.open(SHELL).then((cache) => cache.put(request, kopie)).catch(() => {});
    }
    return response;
  });
  // Antworten wir aus dem Cache, darf die offene Anfrage nicht als
  // unbehandelter Fehler enden.
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

  // Der Notausgang kommt immer frisch vom Server, nie aus dem Cache.
  // Sonst waere ausgerechnet er veraltet, wenn man ihn braucht.
  if (url.pathname.endsWith('/frisch.html')) return;

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
