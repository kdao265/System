// SYSTEM Personal Beta service worker.
//
// Scope is deliberately tiny. SYSTEM is an authenticated private app, so this worker
// is not an offline cache: it exists because current Chromium/Android installability
// expects a service worker with a fetch handler for a real installed app (WebAPK).
//
// Cached, and only these versioned static assets:
//   - the web app manifest
//   - the committed PWA icon set
//
// Never cached or intercepted, because they must stay network-authoritative:
//   - authentication endpoints and session/cookie traffic
//   - Supabase API and RPC responses (including Quest/EXP mutations)
//   - HTML, React Server Component payloads and Server Action responses
//   - application JavaScript/CSS, so an installed app cannot run stale code
//
// Every request outside the allowlist falls through untouched (`return` without
// `respondWith`), so the browser handles it exactly as if no worker existed.
const CACHE_VERSION = "system-static-v1";
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // `reload` bypasses the HTTP cache so a new revision cannot archive a stale copy.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE_VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!PRECACHE.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(url.pathname, response.clone());
    return response;
  })());
});
