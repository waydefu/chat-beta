import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Unsubscribe,
} from 'firebase/auth';

import { auth, googleProvider } from '../firebase/auth-client';

// Firebase Auth adapter. UI code consumes these functions without importing the SDK.

export interface AuthenticatedUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export function watchAuth(next: (user: AuthenticatedUser | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, (user) => next(user ? {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  } : null));
}

export async function loginWithGoogle(): Promise<void> {
  await signInWithPopup(auth, googleProvider);
}

export async function logout(): Promise<void> {
  await signOut(auth);
}
