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
  apiKey: 'YOUR_API_KEY', // 替換為您的 API 金鑰
  authDomain: 'YOUR_AUTH_DOMAIN', // 替換為您的認證網域
  projectId: 'YOUR_PROJECT_ID', // 替換為您的專案 ID
  appId: 'YOUR_APP_ID', // 替換為您的應用 ID
  databaseURL: 'YOUR_DATABASE_URL' // 替換為您的 Realtime Database URL
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