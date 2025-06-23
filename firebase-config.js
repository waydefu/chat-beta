// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// 硬編碼 Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI", // 從 Firebase 控制台獲取
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7",
  databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
};

// 直接初始化 app
const app = initializeApp(firebaseConfig);
try {
  console.log('Firebase 初始化成功');
} catch (error) {
  console.error('Firebase 初始化失敗：', error.message, error.code);
  alert('應用初始化失敗，請檢查網路或 Firebase 配置');
  throw error;
}

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);
export { app };