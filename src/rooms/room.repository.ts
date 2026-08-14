import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
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
  const batch = writeBatch(firestore);
  const readState = {
    lastReadMessageId: messageId,
    lastReadAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(doc(firestore, 'rooms', roomId, 'readStates', uid), readState, { merge: true });
  batch.set(doc(firestore, 'users', uid, 'roomStates', roomId), readState, { merge: true });
  await batch.commit();
}

export const PUBLIC_ROOM_WINDOW = 100;
export const ROOM_STATE_WINDOW = 250;

async function getRoomsByIds(roomIds: readonly string[]): Promise<RoomPreview[]> {
  const rooms: RoomPreview[] = [];
  for (let index = 0; index < roomIds.length; index += 30) {
    const ids = roomIds.slice(index, index + 30);
    if (!ids.length) continue;
    const snapshot = await getDocs(query(
      collection(firestore, 'rooms'),
      where(documentId(), 'in', ids),
    ));
    rooms.push(...snapshot.docs.map(roomFromSnapshot));
  }
  return rooms;
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
    const privateRooms = await getRoomsByIds(privateIds);
    if (currentGeneration !== generation) return;
    const merged = new Map(publicRooms);
    for (const room of privateRooms) merged.set(room.id, room);
    next([...merged.values()].sort((a, b) => {
      const time = (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0);
      return time || a.name.localeCompare(b.name, 'zh-Hant');
    }), states);
  };

  const publicUnsubscribe = onSnapshot(
    query(
      collection(firestore, 'rooms'),
      where('visibility', '==', 'public'),
      orderBy('updatedAt', 'desc'),
      limit(PUBLIC_ROOM_WINDOW),
    ),
    (snapshot) => {
      publicRooms = new Map(snapshot.docs.map((room) => [room.id, roomFromSnapshot(room)]));
      void emit().catch((cause: unknown) => error(cause instanceof Error ? cause : new Error(String(cause))));
    },
    (cause) => error(cause),
  );
  const statesUnsubscribe = onSnapshot(
    query(collection(firestore, 'users', uid, 'roomStates'), orderBy('updatedAt', 'desc'), limit(ROOM_STATE_WINDOW)),
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
