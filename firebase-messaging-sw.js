// firebase-messaging-sw.js (無推送功能，作為佔位符)
console.log('Service Worker loaded - No FCM enabled');
self.addEventListener('fetch', event => {
  // 基本快取邏輯（可選）
  event.respondWith(fetch(event.request));
});
