// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI",
  authDomain: "f-chat-wayde-fu.firebaseapp.com",
  projectId: "f-chat-wayde-fu",
  storageBucket: "f-chat-wayde-fu.firebasestorage.app",
  messagingSenderId: "838739455782",
  appId: "1:838739455782:web:e7538f588ae374d204dbe7",
  databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);
