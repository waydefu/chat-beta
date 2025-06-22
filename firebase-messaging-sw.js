// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// !!! 警告：請將敏感資訊移到後端或使用環境變數
const firebaseConfig = {
  apiKey: 'AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI',
  projectId: 'f-chat-wayde-fu',
  messagingSenderId: '838739455782',
  appId: '1:838739455782:web:e7538f588ae374d204dbe7'
};

if ('serviceWorker' in navigator && 'PushManager' in window) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    try {
      console.log('[firebase-messaging-sw.js] 收到背景推播：', payload);
      const notificationTitle = payload.notification.title;
      const notificationOptions = {
        body: payload.notification.body,
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
      console.error('推播處理失敗：', error);
    }
  });

  self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'view-message') {
      clients.openWindow('/'); // 開啟聊天頁面
    }
  });
} else {
  console.warn('瀏覽器不支援推播通知');
}