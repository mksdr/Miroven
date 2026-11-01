// In production builds, scripts/finalize-sw.mjs automatically replaces this with a deterministic build-hash cache name.
const CACHE_NAME = "miroven-shell-dev";
// Replaced at build time with emitted JS/CSS, including lazy feature chunks.
const BUILD_ASSETS = [];
const APP_SHELL = ["/", "/manifest.webmanifest", "/theme-init.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([
        // Always refresh unhashed shell files; reuse HTTP-cached content-addressed chunks.
        ...APP_SHELL.map((url) => new Request(url, { cache: "reload", credentials: "omit" })),
        ...BUILD_ASSETS.map((url) => new Request(url, { cache: "force-cache", credentials: "omit" })),
      ]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) =>
        key !== CACHE_NAME && (key.startsWith("miroven-shell-") || key.startsWith("private-journal-shell-"))
      ).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // API/session/file responses must always use the network, including navigations.
  if (url.origin !== self.location.origin) return;
  const shellPage = url.pathname === "/";
  if (!shellPage && !APP_SHELL.includes(url.pathname) && !BUILD_ASSETS.includes(url.pathname)) return;

  // Keep the shell and hashed chunks from the same build until SW activation.
  if (shellPage && event.request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) =>
        (await cache.match("/")) ?? fetch(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match(url.pathname)) ?? fetch(event.request)),
  );
});
