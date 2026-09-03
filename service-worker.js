/**
 * Service Worker for Active Plus Coaching Management System
 * GitHub Pages compatible
 */

const CACHE_NAME = 'active-plus-v1';
const PRECACHE_URLS = [
  'index.html',
  'css/style.css',
  'js/firebase.js',
  'manifest.json',
  'service-worker.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) return networkResponse;
        
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          if (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || 
              url.pathname.endsWith('.js') || url.pathname.endsWith('.png')) {
            cache.put(event.request, responseToCahce);
          }
        });
        return networkResponse;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') {
    self.skipWaiting();
  }
});