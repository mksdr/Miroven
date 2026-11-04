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

function isAppCache(key) {
  return key.startsWith("miroven-shell-") || key.startsWith("private-journal-shell-");
}

// Snapshot only during activation: an older worker must never delete a newer
// worker's in-progress installation. If this worker is later restarted, defer
// cleanup to the next activation rather than guessing which builds are older.
let obsoleteCaches = [];

// A claimed page can still execute an older build. Keep its lazy chunks until
// a navigation has no other open windows that could still need those chunks.
async function removeUnusedCaches(navigation) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const navigatingIds = navigation
    ? [navigation.clientId, navigation.resultingClientId, navigation.replacesClientId].filter(Boolean)
    : [];
  if (windows.some((client) => !navigatingIds.includes(client.id))) return;
  await Promise.all(obsoleteCaches.map((key) => caches.delete(key)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => {
    obsoleteCaches = keys.filter((key) => key !== CACHE_NAME && isAppCache(key));
    return removeUnusedCaches();
  }).then(() => self.clients.claim()));
});

async function installedAsset(pathname) {
  const current = await (await caches.open(CACHE_NAME)).match(pathname);
  if (current) return current;
  // Only consult app-owned caches; never serve an unrelated cache's response.
  const keys = await caches.keys();
  for (const key of keys.filter((key) => key !== CACHE_NAME && isAppCache(key))) {
    const cached = await (await caches.open(key)).match(pathname);
    if (cached) return cached;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // API/session/file responses must always use the network, including navigations.
  if (url.origin !== self.location.origin) return;
  const shellPage = url.pathname === "/";
  // Root fetches may request a different representation; never substitute shell HTML.
  if (shellPage && event.request.mode !== "navigate") return;
  const shellFile = APP_SHELL.includes(url.pathname);
  const executable = url.pathname.startsWith("/_next/static/") && /\.(?:js|css)$/.test(url.pathname);
  if (!shellFile && !executable) return;

  if ((shellPage && event.request.mode === "navigate") || (shellFile && !shellPage)) {
    const network = fetch(new Request(event.request, { cache: "no-cache" }))
      .then((response) => {
        if (!response.ok) throw new Error("App shell unavailable");
        return response;
      });
    const response = network.catch(async (error) => {
      const cached = await (await caches.open(CACHE_NAME)).match(url.pathname);
      if (cached) return cached;
      throw error;
    });
    // Do not put network HTML into this build's cache: it may reference a newer
    // set of chunks whose complete offline installation has not finished yet.
    event.respondWith(response);
    if (shellPage) {
      event.waitUntil(network.then(() => removeUnusedCaches(event)).catch(() => undefined));
    }
    return;
  }

  event.respondWith(installedAsset(url.pathname).then((cached) => {
    if (!cached) return fetch(event.request);
    if (event.request.destination === "worker" || event.request.destination === "sharedworker") {
      // A cached Response carries its original URL without the Worker's fragment.
      // Safari uses that URL for self.location, losing Turbopack's #params config.
      // A response with no URL keeps the requested Worker URL, including its
      // fragment. Preserve CSP/MIME headers and stream the cached body as usual.
      return new Response(cached.body, {
        status: cached.status, statusText: cached.statusText, headers: cached.headers,
      });
    }
    return cached;
  }));
});
