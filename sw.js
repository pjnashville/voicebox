const CACHE_VERSION = 27;
const CACHE_NAME = `voicebox-v${CACHE_VERSION}`;
const BASE = '/voicebox/';
const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css',
  BASE + 'app.js',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png'
];

// Install: cache all assets with cache-busting query params
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((url) =>
          fetch(url + '?v=' + CACHE_VERSION, { cache: 'no-cache' })
            .then((resp) => {
              if (!resp.ok) throw new Error(`Failed to fetch ${url}`);
              return cache.put(url, resp);
            })
        )
      )
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Activate: delete all old caches, claim all clients immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() =>
        // Notify all clients to reload with the new version
        self.clients.matchAll({ type: 'window' }).then((clients) =>
          clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }))
        )
      )
  );
});

// Fetch: cache-first for app shell, passthrough for API calls
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't cache API calls (different hostname)
  if (url.hostname !== location.hostname) return;

  // Strip cache-busting params for cache matching
  url.search = '';
  const cleanUrl = url.toString();

  e.respondWith(
    caches.match(cleanUrl).then((cached) => cached || fetch(e.request))
  );
});
