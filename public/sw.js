/*
 * Brandit service worker. It does one small job: when a page cannot load because the phone is offline,
 * show a friendly "you are offline" page instead of the browser's error.
 *
 * It never stores pages, prices, orders or anything about a person. Everything else goes straight to the network,
 * so a customer always sees the current price and the current state of their order.
 */
const CACHE = 'brandit-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only page loads, only GET, only our own site. Forms, uploads, payments and API calls are never touched.
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(OFFLINE)) || new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })),
  );
});
