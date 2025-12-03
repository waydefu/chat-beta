const CACHE_NAME = 'chat-lite-v1';
const ASSETS_TO_CACHE = [
  '/chat-beta/',
  '/chat-beta/index.html',
  '/chat-beta/style.css',
  '/chat-beta/main.js',
  '/chat-beta/firebase-config.js',
  '/chat-beta/image/favicon.png',
  '/chat-beta/image/logo.png',
  '/chat-beta/image/背景.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
