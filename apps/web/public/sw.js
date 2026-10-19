// Kanso's service worker: keeps the app shell available offline, so downloaded chapters can be
// read without a connection. Pages are network-first (always fresh online); hashed build files
// and the SQLite build are cache-first. The API (proxy, images, sync) is never cached here.

const CACHE = 'kanso-shell-v1';
const ROUTES = ['/', '/history', '/browse', '/downloads', '/settings', '/manga', '/reader', '/source', '/source-settings', '/connect'];
const STATIC = /^\/(_next\/static\/|sqlite\/|icon|apple-icon)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set(['/sqlite/index.mjs', '/sqlite/sqlite3.wasm']);
      for (const route of ROUTES) {
        const res = await fetch(route, { credentials: 'same-origin' }).catch(() => null);
        if (!res?.ok) continue;
        const html = await res.clone().text();
        for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
        await cache.put(route, res);
      }
      await Promise.all([...assets].map((a) => cache.add(a).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Pages are static shells; the query string only says what to show.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) await cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await cache.match(url.pathname)) ?? (await cache.match('/')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
