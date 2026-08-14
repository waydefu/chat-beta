import { collection, doc, limit, onSnapshot, query, where } from 'firebase/firestore';

import { firestore } from '../firebase/firestore-client';
import type { IncomingCallSignal, RoomCall, Unsubscribe } from '../types';

const VISIBLE_SIGNAL_STATUSES = ['ringing', 'accepted', 'active'];

export function watchIncomingCalls(
  uid: string,
  next: (signals: IncomingCallSignal[]) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(firestore, 'users', uid, 'incomingCalls'),
      where('status', 'in', VISIBLE_SIGNAL_STATUSES),
      limit(10),
    ),
    (snapshot) => next(snapshot.docs.map((document) => ({
      callId: document.id,
      ...document.data(),
    } as IncomingCallSignal)).sort((left, right) => (
      (right.createdAt?.toMillis() ?? 0) - (left.createdAt?.toMillis() ?? 0)
    ))),
    error,
  );
}

export function watchCallState(
  roomId: string,
  callId: string,
  next: (call: RoomCall | null) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(firestore, 'rooms', roomId, 'calls', callId), (snapshot) => {
    next(snapshot.exists() ? { callId: snapshot.id, ...snapshot.data() } as RoomCall : null);
  }, error);
}
