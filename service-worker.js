const CACHE_NAME = "push-shell-v1";

/* Separate, version-independent cache for third-party CDN assets
   (Firebase SDK modules, MediaPipe wasm/model files). Kept apart from
   CACHE_NAME so that a future app-shell version bump does not force
   re-downloading these large, rarely-changing files. */
const CDN_CACHE_NAME = "push-cdn-v1";

/* Only these origins are cached. They serve versioned/static SDK and
   model files needed for offline face tracking. Firebase Auth
   (identitytoolkit.googleapis.com) and the Realtime Database itself
   (*.firebasedatabase.app) are deliberately NOT in this list — those
   are live network calls, not static assets, and caching them would
   be meaningless (there is no "offline" version of live data) or
   actively wrong (stale auth tokens). */
const CDN_CACHE_ORIGINS = new Set([
  "https://www.gstatic.com",          // Firebase SDK ES modules
  "https://cdn.jsdelivr.net",         // MediaPipe tasks-vision bundle + wasm
  "https://storage.googleapis.com"    // MediaPipe face_detector model file
]);

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./offline.html",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== CDN_CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request)
          .then(response => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
            return response;
          })
          .catch(async () => {
            return (
              (await caches.match(request)) ||
              (await caches.match("./index.html")) ||
              (await caches.match("./offline.html"))
            );
          })
      );
      return;
    }

    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request)
          .then(response => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    );
    return;
  }

  /* Cross-origin: only the whitelisted static-asset CDNs are cached.
     Firebase auth/database traffic is left completely untouched —
     those are live calls, not something a cache can serve. */
  if (!CDN_CACHE_ORIGINS.has(url.origin)) return;

  event.respondWith(
    caches.open(CDN_CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const network = fetch(request)
          .then(response => {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        /* Cache-first when available: instant offline boot for a
           previously-used face detector. When online, the network
           fetch above still runs in the background and refreshes the
           cache for next time (stale-while-revalidate). */
        return cached || network;
      })
    )
  );
});
