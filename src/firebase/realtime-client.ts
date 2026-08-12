import { getDatabase } from 'firebase/database';

import { firebaseApp } from './app';

export const rtdb = getDatabase(firebaseApp);
