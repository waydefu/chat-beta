// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// 硬編碼 Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI", // 從 Firebase 控制台獲取
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7"
};

if ('serviceWorker' in navigator && 'PushManager' in window) {
  try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase Messaging 初始化成功');
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage(payload => {
      try {
        console.log('[firebase-messaging-sw.js] 收到背景推播：', payload);
        const notificationTitle = payload.notification?.title || '新訊息';
        const notificationOptions = {
          body: payload.notification?.body || '您有新的聊天訊息',
          icon: '/chat-beta/image/logo.png',
          data: payload.data || {},
          actions: [{ action: 'view-message', title: '查看訊息' }]
        };
        self.registration.showNotification(notificationTitle, notificationOptions);
      } catch (error) {
        console.error('推播處理失敗：', error.message, error.code, { payload });
      }
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
  } catch (error) {
    console.error('Firebase Messaging 初始化失敗：', error.message, error.code);
  }
} else {
  console.warn('瀏覽器不支援推播通知');
}