// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

// 硬編碼 Firebase 配置
const firebaseConfig = {
apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI", // 從 Firebase 控制台獲取
authDomain: "f-chat-wayde-fu.firebaseapp.com",
projectId: "f-chat-wayde-fu",
appId: "1:838739455782:web:e7538f588ae374d204dbe7",
databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title || '新訊息';
  const notificationOptions = {
    body: payload.notification.body || '您有一條新訊息',
    icon: '/chat-beta/image/favicon.png',
    data: { click_action: '/chat-beta/' }
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.click_action));
});