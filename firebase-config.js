// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// !!! 警告：請使用環境變數或後端載入配置
// 示例：Vite 的 .env 檔案
// VITE_FIREBASE_API_KEY=your-api-key
// const firebaseConfig = {
//   apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
//   // ...
// };
const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI",
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  storageBucket: "f-chat-wayde-fu.firebasestorage.app",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7",
  databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
};

let app;
try {
  app = initializeApp(firebaseConfig);
  console.log('Firebase 初始化成功');
} catch (error) {
  console.error('Firebase 初始化失敗：', error.message, error.code);
  alert('應用初始化失敗，請檢查網路或 Firebase 配置');
  throw error; // 終止後續操作
}

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);