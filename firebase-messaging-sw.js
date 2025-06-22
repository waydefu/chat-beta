// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI",
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  storageBucket: "f-chat-wayde-fu.firebasestorage.app",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] 收到背景推播：', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/firebase-logo.png'  // 你可以換成自己網站的圖示路徑
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
