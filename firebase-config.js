// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// 使用環境變數（Vite 範例）或後端 API 載入配置
// 本地開發：設置 .env 檔案
// GitHub Pages：從後端 API 或 build 時注入
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
  console.error('Firebase 初始化失敗：', {
    message: error.message,
    code: error.code,
    stack: error.stack
  });
  alert('應用初始化失敗，請檢查網路或 Firebase 配置');
  throw error;
}

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);
export { app }; // 為未來推播功能匯出 app