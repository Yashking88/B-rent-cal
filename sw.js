const CACHE_VERSION = 'c-rent-v2';
const CACHE_NAME = CACHE_VERSION;
const RUNTIME_CACHE = 'c-rent-runtime-v2';
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json'
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching critical assets');
        return cache.addAll(CRITICAL_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((error) => console.log('Install failed:', error))
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE)
            .map((cacheName) => {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => self.clients.claim())
      .catch((error) => console.log('Activation failed:', error))
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle cross-origin requests
  if (request.url.includes('cdn.tailwindcss.com') || request.url.includes('gstatic.com')) {
    event.respondWith(
      caches.match(request)
        .then((response) => response || fetch(request))
        .catch(() => {
          // Return offline page if available
          return caches.match('/index.html');
        })
    );
    return;
  }

  // Network first for critical assets, cache second for others
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          return response;
        }

        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            // Cache the response
            caches.open(RUNTIME_CACHE)
              .then((cache) => {
                cache.put(request, responseToCache);
              })
              .catch(() => {
                // Caching failed, but response will still be returned
              });

            return response;
          })
          .catch((error) => {
            console.log('Fetch failed; returning offline page instead.', error);
            return caches.match('/index.html');
          });
      })
  );
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
