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

if (!firebaseConfig.messagingSenderId) {
  console.error('Missing messagingSenderId in firebaseConfig');
  throw new Error('Firebase configuration incomplete');
}

const app = initializeApp(firebaseConfig);
console.log('Firebase app initialized:', app.name);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const firestore = getFirestore(app);
const rtdb = getDatabase(app);

export { auth, provider, firestore, rtdb, app };
