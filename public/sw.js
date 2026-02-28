const CACHE_NAME = 'fractious-cache-v20260228a';

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for other tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all pages immediately
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-First Strategy:
  // 1. Try to fetch from the network.
  // 2. If successful, store a copy in the cache and return the network response.
  // 3. If the network fails (offline), return the cached response.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Don't cache bad responses
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      })
      .catch(() => {
        // If fetch fails (offline), try to serve from cache
        return caches.match(event.request);
      })
  );
});