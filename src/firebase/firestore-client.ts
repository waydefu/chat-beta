import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

import { firebaseApp } from './app';

export const OFFLINE_PREFERENCE_KEY = 'chat-lite:trusted-offline';
const persistent = localStorage.getItem(OFFLINE_PREFERENCE_KEY) === 'true';

export const firestore = initializeFirestore(firebaseApp, {
  localCache: persistent
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
});
export const persistentCacheEnabled = persistent;
