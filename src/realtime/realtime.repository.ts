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
import { typingNames, TYPING_SWEEP_MS, type TypingConnectionState } from './typing-state';

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

/**
 * The raw socket state, which is a different question from "did the room
 * subscription succeed". The header needs both: one says the mirror is reachable
 * at all, the other says this room is authorised on it.
 */
export function watchRealtimeConnection(
  next: (connected: boolean) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onValue(ref(rtdb, '.info/connected'), (snapshot) => next(snapshot.val() === true), error);
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
  let connected = false;

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
    heartbeat = setInterval(() => void beat(), PRESENCE_HEARTBEAT_MS);
  }

  /**
   * A beat is a partial update, and the rule on this node validates the merged
   * result against `hasChildren(['state','connectedAt','updatedAt'])`. So a beat
   * is not merely useless when the node is missing — it is rejected outright,
   * and it is the reader's only evidence that this session is still alive.
   *
   * The node goes missing without any transition this tab can see. The server
   * runs `onDisconnect` the moment it stops seeing the socket, which it can do
   * while the SDK still reports connected, and `cleanupStalePresence` reaps a
   * connection whose beats were throttled while the tab was in the background.
   * `.info/connected` never goes false→true in either case, so the reconnect
   * path below never runs, nothing rewrites the node, and every later beat is
   * denied against a node that will never come back: the user is invisible to
   * everyone else for the rest of the session while the header still says
   * connected, and the console fills with `permission_denied`.
   *
   * The beat that failed is the only thing that knows, so it is what repairs it.
   * `establish()` re-arms the disconnect removal before it writes, so a restored
   * node is still reaped on a real disconnect rather than becoming the zombie
   * the timestamp was added to catch.
   */
  async function beat(): Promise<void> {
    if (closed) return;
    // A beat raised while the socket is known to be down is queued by the SDK
    // and flushed on reconnect — after the server has already removed the node
    // and before `establish()` has written it back. It can only ever be denied,
    // and the reconnect re-establishes anyway.
    if (!connected) return;
    try {
      await update(connection, { updatedAt: serverTimestamp() });
    } catch {
      if (closed) return;
      await establishOnce().catch(() => undefined);
    }
  }

  // The server removes this node the moment the socket drops. Nothing restores
  // it on its own, so every reconnect has to write it again or the user stays
  // invisible to everyone else for the rest of the session.
  async function establish(): Promise<void> {
    stopHeartbeat();
    try {
      await disconnect.remove();
      if (closed) return;
      await set(connection, {
        state: 'online',
        connectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // close() may have run while that write was in flight; it would have found
      // nothing to remove, so undo the write here instead of leaking a node.
      if (closed) await removeIfPresent(connection);
    } finally {
      // Even a failed attempt has to leave a beat behind. This runs on every
      // reconnect, and the comment above it used to say "a later reconnect that
      // fails is not fatal: the next one retries" — but there is no next one
      // unless the socket happens to drop again. Without a beat, one failed
      // re-establish ended presence for the rest of the session, silently.
      if (!closed) startHeartbeat();
    }
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
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (cause?: Error): void => {
        if (settled) return;
        settled = true;
        if (cause) reject(cause);
        else resolve();
      };
      watchConnected = onValue(ref(rtdb, '.info/connected'), (snapshot) => {
        connected = snapshot.val() === true;
        if (closed || !connected) return;
        // A later reconnect that fails is not fatal: the heartbeat retries.
        void establishOnce().then(() => settle()).catch((error: Error) => settle(error));
      }, (error) => settle(error));
    });
  } catch (error) {
    // Nothing is handed back on this path, so nobody can ever call close().
    // Release what has already started rather than leaving a timer and two
    // listeners running for the lifetime of the tab.
    closed = true;
    stopHeartbeat();
    watchConnected();
    watchOffset();
    throw error;
  }

  return {
    watchOnlineUsers(userIds, next, error) {
      const ids = [...new Set(userIds)].filter((candidate) => candidate && candidate !== uid);
      if (!ids.length) {
        next(new Set());
        return () => undefined;
      }
      const latest = new Map<string, Record<string, PresenceConnectionState>>();
      // Null, not '': "nobody is online" is itself a signature of '', so an
      // empty-string sentinel collides with it and swallows the very first
      // emission whenever the user is alone. The caller then never learns the
      // list is empty and keeps rendering whatever the previous room left.
      let emitted: string | null = null;
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

  // Typing entries are judged against the server clock they were stamped with,
  // not this tab's, so a skewed client neither hides live typists nor holds dead
  // ones. Same reasoning as the presence session, which tracks its own offset.
  let serverTimeOffset = 0;
  const watchOffset = onValue(ref(rtdb, '.info/serverTimeOffset'), (snapshot) => {
    const value = snapshot.val();
    if (typeof value === 'number') serverTimeOffset = value;
  });
  const serverNow = (): number => Date.now() + serverTimeOffset;

  let closed = false;
  return {
    async setTyping(active) {
      if (closed) return;
      if (active) await set(typing, { displayName: user.displayName, updatedAt: serverTimestamp() });
      else await removeIfPresent(typing);
    },
    watchTyping(next, error) {
      let latest: Record<string, Record<string, TypingConnectionState>> = {};
      let emitted: string | null = null;
      const emit = (): void => {
        const names = typingNames(latest, user.uid, serverNow());
        // The sweep re-evaluates on a timer, so without this the indicator would
        // be rewritten every couple of seconds for no change.
        const signature = names.join('\u0000');
        if (signature === emitted) return;
        emitted = signature;
        next(names);
      };
      const stop = onValue(ref(rtdb, `${base}/typing`), (snapshot) => {
        latest = (snapshot.val() ?? {}) as Record<string, Record<string, TypingConnectionState>>;
        emit();
      }, error);
      // An orphaned entry stops changing, so onValue never fires for it again.
      // Nothing but this sweep can retire it.
      const sweep = setInterval(emit, TYPING_SWEEP_MS);
      return () => {
        clearInterval(sweep);
        stop();
      };
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
      watchOffset();
      const removed = await Promise.all([removeIfPresent(typing), removeIfPresent(activity)]);
      await Promise.all(disconnects.map((handler, index) => (
        removed[index] ? handler.cancel().catch(() => undefined) : Promise.resolve()
      )));
    },
  };
}
