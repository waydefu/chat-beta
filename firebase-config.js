// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// 您的 Firebase 配置（從 Firebase 控制台獲取）
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  databaseURL: "YOUR_DATABASE_URL"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const firestore = getFirestore(app);
const rtdb = getDatabase(app);

export { auth, provider, firestore, rtdb, app };