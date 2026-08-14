const CACHE_PREFIX = 'chat-lite-';
const CURRENT_CACHE = 'chat-lite-v6-shell';
const BASE_PATH = new URL(self.registration.scope).pathname;
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

// Push is handled directly off the raw event rather than through the Firebase
// messaging SDK: that would need importScripts() from the gstatic CDN on every
// service worker start, which defeats the offline shell this worker exists for.
// The sender must therefore use a data payload (see functions/src/notifications/push.ts).
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'Chat Lite', body: event.data.text() } };
  }
  const data = payload.data || {};
  const notification = payload.notification || {};
  const isCall = data.type === 'call';
  const roomId = data.roomId || '';
  const callId = data.callId || '';
  const title = notification.title || data.title || 'Chat Lite';
  const body = notification.body || data.body || '你有一則新訊息';

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: `${BASE_PATH}image/logo-v2.png`,
    badge: `${BASE_PATH}image/logo-v2.png`,
    // Calls and chat messages have separate replacement/lifecycle semantics.
    tag: isCall && callId ? `chat-lite-call-${callId}` : roomId ? `chat-lite-room-${roomId}` : 'chat-lite',
    renotify: Boolean(roomId || callId),
    requireInteraction: isCall,
    actions: isCall ? [
      { action: 'open-call', title: '查看來電' },
      { action: 'dismiss', title: '忽略' },
    ] : undefined,
    data: { type: isCall ? 'call' : 'message', roomId, callId, kind: data.kind || '' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const type = event.notification.data && event.notification.data.type;
  const roomId = event.notification.data && event.notification.data.roomId;
  const callId = event.notification.data && event.notification.data.callId;
  const target = roomId
    ? `${BASE_PATH}?room=${encodeURIComponent(roomId)}${type === 'call' && callId ? `&call=${encodeURIComponent(callId)}` : ''}`
    : BASE_PATH;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(BASE_PATH) && 'focus' in client) {
          if (roomId) client.postMessage({ type: type === 'call' ? 'open-call' : 'open-room', roomId, callId });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
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

  // Stale-while-revalidate. A plain cache-first read never re-fetches, so anything
  // served from a stable URL (the images, the manifest) stays frozen at whatever was
  // cached first and only ever changes when CURRENT_CACHE is bumped by hand. Serving
  // the cached copy and refreshing it in the background keeps offline support while
  // letting updated assets land on the next load.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CURRENT_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch((error) => {
          // Offline with a cached copy already served: nothing to do. Without one,
          // let the failure surface to the page.
          if (cached) return cached;
          throw error;
        });
      return cached || network;
    }),
  );
});
