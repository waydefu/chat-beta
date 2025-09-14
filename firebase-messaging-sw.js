// firebase-messaging-sw.js (無推送功能，作為基本快取服務工作者)
console.log('Service Worker loaded - Basic cache mode');
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
