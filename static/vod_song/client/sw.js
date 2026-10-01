const CACHE_NAME = 'huoshanktv-cache-v4-pad-api';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/assets/images/party.png',
  '/assets/images/song.png',
  '/assets/images/order.png',
  '/assets/fonts/all.min.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.map((k) => {
        if (k !== CACHE_NAME) return caches.delete(k);
      })))
    ])
  );
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return resp;
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const network = fetch(request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return resp;
    });
    return cached || network;
  });
}

function networkFirst(request) {
  return fetch(request).then((resp) => {
    const copy = resp.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    return resp;
  }).catch(() => caches.match(request));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const dest = req.destination;
  if (dest === 'image' || dest === 'font') {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (dest === 'style') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (dest === 'script') {
    event.respondWith(networkFirst(req));
    return;
  }
  if (dest === 'document') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }
});
