import {
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  type DatabaseReference,
} from 'firebase/database';

import { rtdb } from '../firebase/realtime-client';
import type { OnlineUser, Unsubscribe } from '../types';
import { encodeRoomKey } from '../utils';

export interface RealtimeRoomSession {
  setTyping(active: boolean): Promise<void>;
  watchPresence(next: (users: OnlineUser[]) => void, error: (cause: Error) => void): Unsubscribe;
  watchTyping(next: (names: string[]) => void, error: (cause: Error) => void): Unsubscribe;
  watchAiDrafts(next: (drafts: Map<string, { botId: string; text: string; status: string }>) => void, error: (cause: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

export async function connectRealtimeRoom(
  roomId: string,
  user: { uid: string; displayName: string },
): Promise<RealtimeRoomSession> {
  const base = `realtime/rooms/${encodeRoomKey(roomId)}`;
  const connection = push(ref(rtdb, `${base}/presence/${user.uid}/connections`));
  const typing = ref(rtdb, `${base}/typing/${user.uid}/${connection.key}`);
  const activity = ref(rtdb, `${base}/activity/${user.uid}/${connection.key}`);
  const disconnects = [onDisconnect(connection), onDisconnect(typing), onDisconnect(activity)];
  await Promise.all(disconnects.map((handler) => handler.remove()));
  await Promise.all([
    set(connection, { displayName: user.displayName, connectedAt: serverTimestamp() }),
    set(activity, { state: 'active', updatedAt: serverTimestamp() }),
  ]);

  let closed = false;
  const closeRef = async (target: DatabaseReference): Promise<void> => {
    try { await remove(target); } catch { /* mirror may already be revoked */ }
  };
  return {
    async setTyping(active) {
      if (closed) return;
      if (active) await set(typing, { displayName: user.displayName, updatedAt: serverTimestamp() });
      else await closeRef(typing);
    },
    watchPresence(next, error) {
      return onValue(ref(rtdb, `${base}/presence`), (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, { connections?: Record<string, { displayName?: string }> }>;
        next(Object.entries(value).flatMap(([uid, state]) => {
          const connections = Object.values(state.connections ?? {});
          if (!connections.length) return [];
          return [{ uid, displayName: connections[0]?.displayName || '使用者', online: true }];
        }));
      }, error);
    },
    watchTyping(next, error) {
      return onValue(ref(rtdb, `${base}/typing`), (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, Record<string, { displayName?: string }>>;
        next(Object.entries(value).flatMap(([uid, connections]) => uid === user.uid
          ? []
          : [Object.values(connections)[0]?.displayName || '有人']));
      }, error);
    },
    watchAiDrafts(next, error) {
      return onValue(ref(rtdb, `${base}/aiDrafts`), (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, { botId: string; text: string; status: string }>;
        next(new Map(Object.entries(value)));
      }, error);
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([closeRef(connection), closeRef(typing), closeRef(activity)]);
      await Promise.all(disconnects.map((handler) => handler.cancel().catch(() => undefined)));
    },
  };
}
