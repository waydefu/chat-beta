import { doc, setDoc } from 'firebase/firestore';
import { firestore } from '../firebase/firestore-client';
import type { AuthenticatedUser } from './auth.repository';

export async function saveOwnProfile(user: AuthenticatedUser): Promise<void> {
  await setDoc(doc(firestore, 'users', user.uid), {
    displayName: user.displayName || '使用者',
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
  }, { merge: true });
}
