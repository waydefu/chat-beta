import {
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type DatabaseReference,
  type OnDisconnect,
} from 'firebase/database';

import { rtdb } from '../firebase/realtime-client';
import type { Unsubscribe } from '../types';
import { encodeRoomKey } from '../utils';
import { hasOnlineConnection, PRESENCE_HEARTBEAT_MS } from './presence-state';

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
  const connectionsPath = `realtime/presence/${uid}/connections`;
  let connection: DatabaseReference | null = null;
  let disconnect: OnDisconnect | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let serverTimeOffset = 0;
  let closed = false;

  const watchOffset = onValue(ref(rtdb, '.info/serverTimeOffset'), (snapshot) => {
    const value = snapshot.val();
    if (typeof value === 'number') serverTimeOffset = value;
  });
  const serverNow = (): number => Date.now() + serverTimeOffset;

  function stopHeartbeat(): void {
    if (heartbeat === null) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }

  // Refreshing updatedAt is what lets every other client tell a live connection
  // from one whose onDisconnect never fired.
  function startHeartbeat(target: DatabaseReference): void {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      if (closed || connection !== target) return;
      void update(target, { updatedAt: serverTimestamp() }).catch(() => undefined);
    }, PRESENCE_HEARTBEAT_MS);
  }

  // The server removes this connection the moment the socket drops. Nothing
  // restores it on its own, so every reconnect has to write a fresh one or the
  // user stays invisible to everyone else for the rest of the session.
  async function establish(): Promise<void> {
    stopHeartbeat();
    connection = null;
    disconnect = null;
    const next = push(ref(rtdb, connectionsPath));
    const handler = onDisconnect(next);
    await handler.remove();
    if (closed) {
      await handler.cancel().catch(() => undefined);
      return;
    }
    try {
      await set(next, {
        state: 'online',
        connectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      await handler.cancel().catch(() => undefined);
      throw error;
    }
    connection = next;
    disconnect = handler;
    startHeartbeat(next);
  }

  let watchConnected: Unsubscribe = () => undefined;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (cause?: Error): void => {
      if (settled) return;
      settled = true;
      if (cause) reject(cause);
      else resolve();
    };
    watchConnected = onValue(ref(rtdb, '.info/connected'), (snapshot) => {
      if (closed || snapshot.val() !== true) return;
      // A later reconnect that fails is not fatal: the next one retries.
      void establish().then(() => settle()).catch((error: Error) => settle(error));
    }, (error) => settle(error));
  });

  return {
    watchOnlineUsers(userIds, next, error) {
      const ids = [...new Set(userIds)].filter((candidate) => candidate && candidate !== uid);
      if (!ids.length) {
        next(new Set());
        return () => undefined;
      }
      const latest = new Map<string, Record<string, { state?: unknown; updatedAt?: unknown }>>();
      let emitted = '';
      const emit = (): void => {
        const active = [...latest].flatMap(([candidate, connections]) => (
          hasOnlineConnection(connections, serverNow()) ? [candidate] : []
        ));
        // Heartbeats retouch every connection on a timer. Only tell the caller
        // when the projection actually changed, so the list does not rebuild
        // itself every beat for every member.
        const signature = active.join(',');
        if (signature === emitted) return;
        emitted = signature;
        next(new Set(active));
      };
      const unsubscribes = ids.map((candidate) => onValue(
        ref(rtdb, `realtime/presence/${candidate}/connections`),
        (snapshot) => {
          latest.set(candidate, (snapshot.val() ?? {}) as Record<string, { state?: unknown; updatedAt?: unknown }>);
          emit();
        },
        error,
      ));
      // A connection that stopped heartbeating stops changing, so onValue never
      // fires again. Without this sweep the reader would hold a dead entry
      // online forever, which is exactly what the timestamp was added to catch.
      const sweep = setInterval(emit, PRESENCE_HEARTBEAT_MS);
      return () => {
        clearInterval(sweep);
        unsubscribes.forEach((unsubscribe) => unsubscribe());
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      watchConnected();
      watchOffset();
      const target = connection;
      const handler = disconnect;
      connection = null;
      disconnect = null;
      if (target && await removeIfPresent(target)) await handler?.cancel().catch(() => undefined);
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
