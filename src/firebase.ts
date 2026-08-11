import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

export const OFFLINE_PREFERENCE_KEY = 'chat-lite:trusted-offline';

const firebaseConfig = {
  apiKey: 'AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI',
  authDomain: 'f-chat-wayde-fu.firebaseapp.com',
  projectId: 'f-chat-wayde-fu',
  appId: '1:838739455782:web:e7538f588ae374d204dbe7',
  databaseURL: 'https://f-chat-wayde-fu-default-rtdb.firebaseio.com',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const usePersistentCache = localStorage.getItem(OFFLINE_PREFERENCE_KEY) === 'true';
export const firestore = initializeFirestore(firebaseApp, {
  localCache: usePersistentCache
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
});
export const rtdb = getDatabase(firebaseApp);
export const persistentCacheEnabled = usePersistentCache;
