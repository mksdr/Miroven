// In production builds, scripts/finalize-sw.mjs automatically replaces this with a deterministic build-hash cache name.
const CACHE_NAME = "miroven-shell-dev";
const APP_SHELL = ["/", "/manifest.webmanifest", "/theme-init.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // API/session/file responses must always use the network, including navigations.
  if (url.origin !== self.location.origin) return;
  const shellPage = url.pathname === "/";
  if (!shellPage && !APP_SHELL.includes(url.pathname) && !url.pathname.startsWith("/_next/static/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, clone));
          }
          return response;
        })
        .catch(async () => (await caches.match(url.pathname)) ?? caches.match("/")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
