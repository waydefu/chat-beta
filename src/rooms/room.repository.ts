import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../firebase/firestore-client';
import type { RoomPreview, RoomReadState } from '../types';

function roomFromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): RoomPreview {
  return { id: snapshot.id, ...snapshot.data() } as RoomPreview;
}

export async function markRoomRead(uid: string, roomId: string, messageId: string): Promise<void> {
  await setDoc(doc(firestore, 'rooms', roomId, 'readStates', uid), {
    lastReadMessageId: messageId,
    lastReadAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(firestore, 'users', uid, 'roomStates', roomId), {
    lastReadMessageId: messageId,
    lastReadAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export function watchAvailableRooms(
  uid: string,
  next: (rooms: RoomPreview[], states: Map<string, RoomReadState>) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  let publicRooms = new Map<string, RoomPreview>();
  let states = new Map<string, RoomReadState>();
  let generation = 0;

  const emit = async (): Promise<void> => {
    const currentGeneration = ++generation;
    const privateIds = [...states.entries()]
      .filter(([id, state]) => state.membershipStatus === 'active' && !publicRooms.has(id))
      .map(([id]) => id);
    const privateRooms = await Promise.all(privateIds.map(async (roomId) => {
      const snapshot = await getDoc(doc(firestore, 'rooms', roomId));
      return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as RoomPreview) : null;
    }));
    if (currentGeneration !== generation) return;
    const merged = new Map(publicRooms);
    for (const room of privateRooms) if (room) merged.set(room.id, room);
    next([...merged.values()].sort((a, b) => {
      const time = (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0);
      return time || a.name.localeCompare(b.name, 'zh-Hant');
    }), states);
  };

  const publicUnsubscribe = onSnapshot(
    query(collection(firestore, 'rooms'), where('visibility', '==', 'public'), orderBy('updatedAt', 'desc')),
    (snapshot) => {
      publicRooms = new Map(snapshot.docs.map((room) => [room.id, roomFromSnapshot(room)]));
      void emit().catch((cause: unknown) => error(cause instanceof Error ? cause : new Error(String(cause))));
    },
    (cause) => error(cause),
  );
  const statesUnsubscribe = onSnapshot(
    collection(firestore, 'users', uid, 'roomStates'),
    (snapshot) => {
      states = new Map(snapshot.docs.map((state) => [state.id, state.data() as RoomReadState]));
      void emit().catch((cause: unknown) => error(cause instanceof Error ? cause : new Error(String(cause))));
    },
    (cause) => error(cause),
  );
  return () => {
    generation += 1;
    publicUnsubscribe();
    statesUnsubscribe();
  };
}
