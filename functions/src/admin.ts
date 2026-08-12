import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();

export const firestore = getFirestore();
export const database = getDatabase();
