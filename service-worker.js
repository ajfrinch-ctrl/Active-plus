/**
 * Service Worker for Active Plus Coaching Management System.
 *
 * Strategy:
 *   - Navigations: network-first (fresh HTML wins), falling back to cache
 *     so the app still opens offline.
 *   - Same-origin static assets (css/js/png/woff2): network-first (so a fresh
 *     deploy shows up at once), falling back to the cache offline. The
 *     bundled Hind Siliguri fonts are same-origin, so they are cached too —
 *     Bengali keeps rendering (and receipts keep exporting) with no network.
 *   - Anything else (Firebase, external requests): pass through untouched.
 */

const CACHE_NAME = 'active-plus-v27';   // bundled Hind Siliguri fonts (offline Bengali), receipt preview on student portal
const PRECACHE_URLS = [
  './',
  'index.html',
  'student.html',
  'teacher.html',
  'admin.html',
  'css/style.css',
  'css/home.css',
  'css/admin-shell.css',
  'css/modern.css',
  'css/student-v2.css',
  'css/fonts.css',
  // Bengali (Hind Siliguri) is part of the app — offline receipt/PDF
  // rendering depends on these files, so they are precached like everything
  // else instead of passing through to the network.
  'assets/fonts/hind-siliguri-bengali-400.woff2',
  'assets/fonts/hind-siliguri-bengali-600.woff2',
  'assets/fonts/hind-siliguri-bengali-700.woff2',
  'assets/fonts/hind-siliguri-latin-400.woff2',
  'assets/fonts/hind-siliguri-latin-600.woff2',
  'assets/fonts/hind-siliguri-latin-700.woff2',
  'assets/fonts/hind-siliguri-latin-ext-400.woff2',
  'assets/fonts/hind-siliguri-latin-ext-600.woff2',
  'assets/fonts/hind-siliguri-latin-ext-700.woff2',
  'js/firebase.js',
  'js/store.js',
  'js/data.js',
  'js/auth.js',
  'js/app.js',
  'js/exams.js',
  'js/crud.js',
  'js/admin-modules.js',
  'js/student-home.js',
  'js/student-prefs.js',
  'js/teacher-home.js',
  'js/admin-home.js',
  'js/pdf.js',
  'js/docs.js',
  'js/preview.js',
  'js/install.js',
  'manifest.json',
  'assets/hero-default.jpg', // the hero backdrop the rearranged home paints behind its banners
  'assets/logo.png', // byte-identical to logo-transparent.png: precaching both wasted ~1 MB per install
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
  if (url.origin !== self.location.origin) return; // let Firebase & other external requests fetch directly

  // Fresh pages first so deploys are visible; cache keeps us usable offline.
  // Only successful responses are cached — a 404/500 error page must never
  // become the offline copy of the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
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
