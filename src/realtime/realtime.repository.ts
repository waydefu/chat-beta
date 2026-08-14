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
} from 'firebase/database';

import { rtdb } from '../firebase/realtime-client';
import type { Unsubscribe } from '../types';
import { encodeRoomKey } from '../utils';
import { hasOnlineConnection, PRESENCE_HEARTBEAT_MS, type PresenceConnectionState } from './presence-state';

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
  // One node for the whole session, re-set on every reconnect. Pushing a fresh
  // key each time orphans the previous node whenever the server has not already
  // run its onDisconnect, and nothing afterwards can reach it: the heartbeat
  // only follows the current ref, and close() only removes the current ref.
  const connection = push(ref(rtdb, `realtime/presence/${uid}/connections`));
  const disconnect = onDisconnect(connection);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
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
  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeat = setInterval(() => {
      if (closed) return;
      void update(connection, { updatedAt: serverTimestamp() }).catch(() => undefined);
    }, PRESENCE_HEARTBEAT_MS);
  }

  // The server removes this node the moment the socket drops. Nothing restores
  // it on its own, so every reconnect has to write it again or the user stays
  // invisible to everyone else for the rest of the session.
  async function establish(): Promise<void> {
    stopHeartbeat();
    await disconnect.remove();
    if (closed) return;
    await set(connection, {
      state: 'online',
      connectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // close() may have run while that write was in flight; it would have found
    // nothing to remove, so undo the write here instead of leaking a node.
    if (closed) {
      await removeIfPresent(connection);
      return;
    }
    startHeartbeat();
  }

  // .info/connected can report true more than once without an intervening
  // disconnect. Coalescing keeps two runs from racing over the same node.
  function establishOnce(): Promise<void> {
    if (inFlight) return inFlight;
    const run = establish().finally(() => {
      if (inFlight === run) inFlight = null;
    });
    inFlight = run;
    return run;
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
      void establishOnce().then(() => settle()).catch((error: Error) => settle(error));
    }, (error) => settle(error));
  });

  return {
    watchOnlineUsers(userIds, next, error) {
      const ids = [...new Set(userIds)].filter((candidate) => candidate && candidate !== uid);
      if (!ids.length) {
        next(new Set());
        return () => undefined;
      }
      const latest = new Map<string, Record<string, PresenceConnectionState>>();
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
          latest.set(candidate, (snapshot.val() ?? {}) as Record<string, PresenceConnectionState>);
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
      // Let any in-flight establish finish, so it cannot write the node back
      // after the removal below.
      await inFlight?.catch(() => undefined);
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
