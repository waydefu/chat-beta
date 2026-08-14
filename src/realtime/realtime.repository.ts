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
import type { Unsubscribe } from '../types';
import { encodeRoomKey } from '../utils';
import { hasOnlineConnection } from './presence-state';

export interface GlobalPresenceSession {
  watchOnlineUsers(userIds: string[], next: (onlineUserIds: Set<string>) => void, error: (cause: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

export interface RealtimeRoomSession {
  setTyping(active: boolean): Promise<void>;
  watchTyping(next: (names: string[]) => void, error: (cause: Error) => void): Unsubscribe;
  watchAiDrafts(next: (drafts: Map<string, { botId: string; text: string; status: string }>) => void, error: (cause: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

async function removeIfPresent(target: DatabaseReference): Promise<boolean> {
  try {
    await remove(target);
    return true;
  } catch {
    // onDisconnect or a membership revocation may already have removed it.
    return false;
  }
}

export async function connectGlobalPresence(uid: string): Promise<GlobalPresenceSession> {
  const connection = push(ref(rtdb, `realtime/presence/${uid}/connections`));
  const disconnect = onDisconnect(connection);
  await disconnect.remove();
  try {
    await set(connection, {
      state: 'online',
      connectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    await disconnect.cancel().catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    watchOnlineUsers(userIds, next, error) {
      const ids = [...new Set(userIds)].filter((candidate) => candidate && candidate !== uid);
      if (!ids.length) {
        next(new Set());
        return () => undefined;
      }
      const online = new Map(ids.map((candidate) => [candidate, false]));
      const emit = (): void => next(new Set([...online].flatMap(([candidate, active]) => active ? [candidate] : [])));
      const unsubscribes = ids.map((candidate) => onValue(
        ref(rtdb, `realtime/presence/${candidate}/connections`),
        (snapshot) => {
          const connections = (snapshot.val() ?? {}) as Record<string, { state?: unknown }>;
          online.set(candidate, hasOnlineConnection(connections));
          emit();
        },
        error,
      ));
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    async close() {
      if (closed) return;
      closed = true;
      if (await removeIfPresent(connection)) await disconnect.cancel().catch(() => undefined);
    },
  };
}

export async function connectRealtimeRoom(
  roomId: string,
  user: { uid: string; displayName: string },
): Promise<RealtimeRoomSession> {
  const base = `realtime/rooms/${encodeRoomKey(roomId)}`;
  const activity = push(ref(rtdb, `${base}/activity/${user.uid}`));
  const typing = ref(rtdb, `${base}/typing/${user.uid}/${activity.key}`);
  const disconnects = [onDisconnect(typing), onDisconnect(activity)];
  await Promise.all(disconnects.map((handler) => handler.remove()));
  await set(activity, { state: 'active', updatedAt: serverTimestamp() });

  let closed = false;
  return {
    async setTyping(active) {
      if (closed) return;
      if (active) await set(typing, { displayName: user.displayName, updatedAt: serverTimestamp() });
      else await removeIfPresent(typing);
    },
    watchTyping(next, error) {
      return onValue(ref(rtdb, `${base}/typing`), (snapshot) => {
        const value = (snapshot.val() ?? {}) as Record<string, Record<string, { displayName?: string }>>;
        next(Object.entries(value).flatMap(([candidateUid, connections]) => candidateUid === user.uid
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
      const removed = await Promise.all([removeIfPresent(typing), removeIfPresent(activity)]);
      await Promise.all(disconnects.map((handler, index) => (
        removed[index] ? handler.cancel().catch(() => undefined) : Promise.resolve()
      )));
    },
  };
}
