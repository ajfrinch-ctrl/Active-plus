/**
 * Service Worker for Active Plus Coaching Management System.
 *
 * Strategy:
 *   - Navigations: network-first (fresh HTML wins), falling back to cache
 *     so the app still opens offline.
 *   - Same-origin static assets (css/js/png): network-first (so a fresh
 *     deploy shows up at once), falling back to the cache offline.
 *   - Anything else (fonts, Firebase): pass through untouched.
 */

const CACHE_NAME = 'active-plus-v8';
const PRECACHE_URLS = [
  './',
  'index.html',
  'student.html',
  'teacher.html',
  'admin.html',
  'css/style.css',
  'css/home.css',
  'js/firebase.js',
  'js/store.js',
  'js/data.js',
  'js/auth.js',
  'js/app.js',
  'js/exams.js',
  'js/crud.js',
  'js/admin-modules.js',
  'js/student-home.js',
  'js/teacher-home.js',
  'js/admin-home.js',
  'manifest.json',
  'assets/logo.png',
  'assets/logo-transparent.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/favicon-32x32.png',
  'assets/favicon-16x16.png',
  'assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((error) => console.warn('[SW] precache failed:', error.message))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let fonts/Firebase fetch directly

  // Fresh pages first so deploys are visible; cache keeps us usable offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('index.html'))
        )
    );
    return;
  }

  // Static assets: network-first so a new deploy is visible immediately;
  // the cache is only the offline fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') {
    self.skipWaiting();
  }
});
