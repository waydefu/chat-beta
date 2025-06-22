// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// !!! 警告：請從後端動態載入配置
// 示例：fetch('/api/firebase-config').then(res => res.json()).then(config => firebase.initializeApp(config));
const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI",
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  storageBucket: "f-chat-wayde-fu.firebasestorage.app",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7",
  databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
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
          icon: '/image/logo.png' || '/default-icon.png',
          actions: [
            {
              action: 'view-message',
              title: '查看訊息'
            }
          ]
        };
        self.registration.showNotification(notificationTitle, notificationOptions);
      } catch (error) {
        console.error('推播處理失敗：', error.message, error.code);
      }
    });

    self.addEventListener('notificationclick', event => {
      event.notification.close();
      if (event.action === 'view-message') {
        clients.openWindow('/');
      }
    });
  } catch (error) {
    console.error('Firebase Messaging 初始化失敗：', error.message, error.code);
  }
} else {
  console.warn('瀏覽器不支援推播通知');
}