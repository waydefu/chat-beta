// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// 從環境變數或後端 API 載入配置，適配 GitHub Pages
// 示例：使用後端 API 或 GitHub Secrets（透過 build 工具注入）
const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI", // 應從環境變數或後端 API 獲取
  authDomain: 'f-chat-wayde-fu.firebaseapp.com',
  projectId: 'f-chat-wayde-fu',
  appId: '1:838739455782:web:e7538f588ae374d204dbe7',
  databaseURL: 'https://f-chat-wayde-fu-default-rtdb.firebaseio.com'
};

if ('serviceWorker' in navigator && 'PushManager' in window) {
  try {
    firebase.initializeApp(firebaseConfig);
    console.log('[firebase-messaging-sw.js] Firebase 初始化成功');
    const messaging = firebase.messaging();

    // 目前不實現推播通知，保留 Service Worker 結構以便未來擴展
    // 示例：未來可添加 messaging.onBackgroundMessage
    self.addEventListener('install', event => {
      console.log('[firebase-messaging-sw.js] Service Worker 安裝成功');
      event.waitUntil(self.skipWaiting());
    });

    self.addEventListener('activate', event => {
      console.log('[firebase-messaging-sw.js] Service Worker 啟動成功');
      event.waitUntil(self.clients.claim());
    });

  } catch (error) {
    console.error('[firebase-messaging-sw.js] Firebase 初始化失敗：', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
  }
} else {
  console.warn('[firebase-messaging-sw.js] 瀏覽器不支援 Service Worker 或 Push API');
}