importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI",
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log('[firebase-messaging-sw.js] 收到背景推播：', payload);
  const notificationTitle = payload.notification?.title || '新訊息';
  const notificationOptions = {
    body: payload.notification?.body || '您有新的聊天訊息',
    icon: '/chat-beta/image/logo.png',
    data: payload.data || {},
    actions: [{ action: 'view-message', title: '查看訊息' }]
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'view-message') {
    const url = '/chat-beta/';
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
        const client = clientsArr.find(c => c.url.includes(url) && 'focus' in c);
        if (client) return client.focus();
        return clients.openWindow(url);
      })
    );
  }
});