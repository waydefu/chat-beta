// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// !!! 警告：請將敏感資訊移到後端或使用環境變數
const firebaseConfig = {
  apiKey: 'AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI',
  authDomain: 'f-chat-wayde-fu.firebaseapp.com',
  projectId: 'f-chat-wayde-fu',
  appId: '1:838739455782:web:e7538f588ae374d204dbe7',
  databaseURL: 'https://f-chat-wayde-fu-default-rtdb.firebaseio.com'
};

let app;
try {
  app = initializeApp(firestoreConfig);
} catch (error) {
  console.error('Firebase 初始化失敗：', error);
  alert('應用初始化失敗，請稍後重試');
}

export const auth = app ? getAuth(app) : null;
export const provider = app ? new GoogleAuthProvider() : null;
export const firestore = app ? getFirestore(app) : null;
export const rtdb = app ? getDatabase(app) : null;