const VERSION = "v5";
const CACHE = `discover-shell-${VERSION}`;
const CATALOG_CACHE = "discover-catalog-v4";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./viewer.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE && key !== CATALOG_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // O catálogo é administrado pelo app para respeitar seu TTL.
  if (url.pathname.endsWith("/catalog/discover.json")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
