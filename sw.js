const CACHE = "pokebinder-v5";

const PRECACHE = [
  "/",
  "/admin",
  "/create",
  "/manifest.json",
  "/icons/icon.svg",
  "/style.css",
  "/admin.css",
  "/create.css",
  "/app.js",
  "/admin.js",
  "/add-card-modal.js",
  "/binder-loader.js",
  "/favorites.js",
  "/background.js",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Always go to the network for API calls, auth, and non-GET requests
  if (
    e.request.method !== "GET" ||
    url.pathname.startsWith("/.netlify/") ||
    url.hostname !== self.location.hostname
  ) {
    return;
  }

  // Stale-while-revalidate for everything else
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || fresh;
      })
    )
  );
});
