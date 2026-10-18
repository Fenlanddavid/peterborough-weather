const CACHE_PREFIX = `pb-weather:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const INDEX_URL = new URL('index.html', self.registration.scope).href;
const MANIFEST_URL = new URL('manifest.json?v=2', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['./', './index.html', './manifest.json', MANIFEST_URL, './icon-192.png', './icon-512.png', './favicon.svg']);
    // Include the built JavaScript and CSS so the first offline launch can work.
    const index = await cache.match(INDEX_URL);
    const html = await index.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      .map((match) => new URL(match[1], INDEX_URL).href);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  // Weather data is cached by the app in IndexedDB.
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (event.request.mode === 'navigate' || url.pathname === new URL(MANIFEST_URL).pathname) {
    // Fetch current screens and install settings, retaining offline copies.
    const cacheKey = event.request.mode === 'navigate' ? INDEX_URL : event.request;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: 'no-cache' });
        if (response.ok) {
          await cache.put(cacheKey, response.clone());
          return response;
        }
        return (await cache.match(cacheKey)) || response;
      } catch {
        return (await cache.match(cacheKey)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
