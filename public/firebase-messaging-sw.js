const CACHE_PREFIX = 'chat-lite-';
const CURRENT_CACHE = 'chat-lite-v4-shell';
const BASE_PATH = '/chat-beta/';
const SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}privacy.html`,
  `${BASE_PATH}terms.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}image/logo-v2.png`,
  `${BASE_PATH}image/chat-background.webp`,
  `${BASE_PATH}image/chat-light.webp`,
  `${BASE_PATH}image/chat-dark.webp`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CURRENT_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((name) => {
        if (name === 'chat-lite-v1') return caches.delete(name);
        if (name.startsWith(CACHE_PREFIX) && name !== CURRENT_CACHE) return caches.delete(name);
        return Promise.resolve(false);
      })))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CURRENT_CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match(BASE_PATH))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (!response.ok) return response;
      const copy = response.clone();
      void caches.open(CURRENT_CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })),
  );
});
