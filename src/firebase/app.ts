import { getApps, initializeApp } from 'firebase/app';

export const FIREBASE_REGION = import.meta.env.VITE_FIREBASE_REGION || 'asia-east1';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'f-chat-wayde-fu.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'f-chat-wayde-fu',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:838739455782:web:e7538f588ae374d204dbe7',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://f-chat-wayde-fu-default-rtdb.firebaseio.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '838739455782',
};

export const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
