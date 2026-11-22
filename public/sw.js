// The shell is public. Authenticated workspace data is stored separately by signed-in identity.
const CACHE = "bekah-shell-v1";
const ASSETS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/brand/hb-app-icon.svg",
  "/brand/hb-horizontal.svg", "/brand/hb-horizontal-reverse.svg", "/brand/fonts/Fraunces-Variable.woff2",
  "/brand/fonts/SourceSans3-Variable.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    const shell = await (await cache.match("/")).text();
    const chunks = [...new Set(shell.match(/\/_next\/static\/[\w./%~-]+\.(?:js|css)/g) ?? [])];
    await cache.addAll(chunks);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("bekah-shell-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put("/", response.clone());
      return response;
    }).catch(() => caches.match("/")));
    return;
  }
  if (!/^\/(?:_next\/static\/|brand\/|icon-)/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const existing = await cache.match(request);
    if (existing) return existing;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const kitchen = windows.find((client) => new URL(client.url).pathname === "/");
    if (kitchen) await kitchen.focus();
    else await self.clients.openWindow("/");
  })());
});
