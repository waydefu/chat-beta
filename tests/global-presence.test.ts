import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRef { path: string }

const state = vi.hoisted(() => ({
  listeners: new Map<string, (snapshot: { val: () => unknown }) => void>(),
  writes: [] as Array<{ path: string; value: unknown }>,
  updates: [] as Array<{ path: string; value: unknown }>,
  removed: [] as string[],
  disconnectRemovals: [] as string[],
  disconnectCancels: [] as string[],
  pushed: 0,
  // The rule on this node validates the merged result, so a partial heartbeat
  // update is rejected whenever the node is missing. These make that reachable.
  failUpdate: 0,
  failSet: 0,
}));

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string): FakeRef => ({ path }),
  push: (parent: FakeRef): FakeRef => ({ path: `${parent.path}/c${++state.pushed}` }),
  onValue: (target: FakeRef, next: (snapshot: { val: () => unknown }) => void) => {
    state.listeners.set(target.path, next);
    return () => state.listeners.delete(target.path);
  },
  onDisconnect: (target: FakeRef) => ({
    remove: async () => { state.disconnectRemovals.push(target.path); },
    cancel: async () => { state.disconnectCancels.push(target.path); },
  }),
  set: async (target: FakeRef, value: unknown) => {
    state.writes.push({ path: target.path, value });
    if (state.failSet > 0) { state.failSet -= 1; throw new Error('permission_denied'); }
  },
  update: async (target: FakeRef, value: unknown) => {
    state.updates.push({ path: target.path, value });
    if (state.failUpdate > 0) { state.failUpdate -= 1; throw new Error('permission_denied'); }
  },
  remove: async (target: FakeRef) => { state.removed.push(target.path); },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

vi.mock('../src/firebase/realtime-client', () => ({ rtdb: {} }));

import { PRESENCE_HEARTBEAT_MS } from '../src/realtime/presence-state';
import { connectGlobalPresence } from '../src/realtime/realtime.repository';

function emit(path: string, value: unknown): void {
  state.listeners.get(path)?.({ val: () => value });
}

function goOnline(): void {
  emit('.info/connected', true);
}

beforeEach(() => {
  state.listeners.clear();
  state.writes.length = 0;
  state.updates.length = 0;
  state.removed.length = 0;
  state.disconnectRemovals.length = 0;
  state.disconnectCancels.length = 0;
  state.pushed = 0;
  state.failUpdate = 0;
  state.failSet = 0;
});

afterEach(() => { vi.useRealTimers(); });

const connectionsOf = (uid: string): string => `realtime/presence/${uid}/connections`;

async function connect(uid: string) {
  const pending = connectGlobalPresence(uid);
  await vi.waitFor(() => expect(state.listeners.has('.info/connected')).toBe(true));
  goOnline();
  return await pending;
}

describe('global presence session', () => {
  it('writes a connection once the socket reports connected', async () => {
    const session = await connect('me');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]?.path).toBe(`${connectionsOf('me')}/c1`);
    expect(state.writes[0]?.value).toMatchObject({ state: 'online' });
    // The removal is armed before the value is written, so a socket that dies
    // mid-handshake cannot leave the node behind.
    expect(state.disconnectRemovals).toEqual([`${connectionsOf('me')}/c1`]);
    await session.close();
  });

  it('reuses one node across reconnects instead of leaving orphans behind', async () => {
    const session = await connect('me');
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(3));
    // Every write lands on the same key. A new key per reconnect would strand
    // the previous node whenever the server had not already reaped it.
    expect(new Set(state.writes.map((write) => write.path)).size).toBe(1);
    expect(state.pushed).toBe(1);
    await session.close();
  });

  it('re-arms the disconnect removal on every reconnect', async () => {
    const session = await connect('me');
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    // The server consumed the first arming when the socket dropped.
    expect(state.disconnectRemovals).toHaveLength(2);
    await session.close();
  });

  it('removes the connection and cancels the disconnect on close', async () => {
    const session = await connect('me');
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    await session.close();
    expect(state.removed).toEqual([`${connectionsOf('me')}/c1`]);
    expect(state.disconnectCancels).toEqual([`${connectionsOf('me')}/c1`]);
  });

  it('stops re-establishing after close', async () => {
    const session = await connect('me');
    await session.close();
    goOnline();
    expect(state.writes).toHaveLength(1);
  });

  it('restores a connection the server removed without any socket transition', async () => {
    vi.useFakeTimers();
    const session = await connect('me');
    expect(state.writes).toHaveLength(1);

    // The server ran onDisconnect for a drop this tab never saw, or the sweeper
    // reaped the node while beats were throttled. `.info/connected` never
    // toggles, so nothing re-establishes; the beat is rejected because a partial
    // update cannot satisfy hasChildren(['state','connectedAt','updatedAt']).
    // Before this fix every later beat was denied against a node that never
    // came back: invisible to everyone else, header still saying connected.
    state.failUpdate = 1;
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(state.updates).toHaveLength(1);

    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    // Re-armed before the write, so the restored node is still reaped on a real
    // disconnect instead of becoming the zombie the timestamp exists to catch.
    expect(state.disconnectRemovals).toHaveLength(2);
    await session.close();
  });

  it('keeps beating after a re-establish fails', async () => {
    vi.useFakeTimers();
    const session = await connect('me');
    state.failSet = 1;
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));

    // establish() stops the heartbeat before it writes. When the write failed,
    // nothing restarted it and nothing else was watching, so presence ended for
    // the rest of the session with no error anyone could see.
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS);
    expect(state.updates.length).toBeGreaterThan(0);
    await session.close();
  });

  it('does not raise a beat while the socket is known to be down', async () => {
    vi.useFakeTimers();
    const session = await connect('me');
    emit('.info/connected', false);

    // A beat raised while offline is queued by the SDK and flushed on reconnect
    // — after the server removed the node and before establish() writes it back
    // — so it can only ever be denied. The reconnect re-establishes anyway.
    await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_MS * 3);
    expect(state.updates).toEqual([]);
    await session.close();
  });

  it('releases its own listeners when the first establish fails', async () => {
    state.failSet = 1;
    const pending = connectGlobalPresence('me');
    await vi.waitFor(() => expect(state.listeners.has('.info/connected')).toBe(true));
    goOnline();
    await expect(pending).rejects.toThrow();
    // Nothing is handed back on this path, so nobody can call close(). The
    // session has to release its own listeners or they outlive the tab.
    expect(state.listeners.size).toBe(0);
  });

  it('reports a member online and drops them when the connection goes stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connect('me');
    const seen: Array<string[]> = [];
    const stop = session.watchOnlineUsers(['alice'], (ids) => seen.push([...ids]), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(connectionsOf('alice'), { tab: { state: 'online', connectedAt: -1, updatedAt: 0 } });
    expect(seen.at(-1)).toEqual(['alice']);

    // Alice's tab was killed: her node stops changing, so nothing re-notifies
    // us. The sweep is what has to notice.
    vi.setSystemTime(10 * 60_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(seen.at(-1)).toEqual([]);

    stop();
    await session.close();
  });


  it('does not leave the node behind when close races an in-flight establish', async () => {
    const session = await connect('me');
    // A reconnect lands, then close() runs before its write settles.
    goOnline();
    await session.close();
    await vi.waitFor(() => expect(state.removed.length).toBeGreaterThan(0));
    // Whatever order they finished in, nothing is left written.
    expect(state.removed).toContain(`${connectionsOf('me')}/c1`);
  });

  it('coalesces overlapping connected events into one establish', async () => {
    const session = await connect('me');
    goOnline();
    goOnline();
    goOnline();
    await vi.waitFor(() => expect(state.writes.length).toBeGreaterThan(1));
    // Three events, but they overlap, so they must not each push their own node.
    expect(state.pushed).toBe(1);
    await session.close();
  });

  it('tells the caller the room is empty instead of staying silent', async () => {
    // "Nobody online" has the signature '', so an empty-string sentinel made it
    // indistinguishable from "nothing emitted yet". The first emission was
    // dropped whenever the user was alone, and the panel kept rendering the
    // room they had just left. Verified in production: the count sat on the
    // previous room's text until somebody else happened to come online.
    const session = await connect('me');
    const seen: Array<string[]> = [];
    const stop = session.watchOnlineUsers(['alice'], (ids) => seen.push([...ids]), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(connectionsOf('alice'), null);
    expect(seen).toEqual([[]]);

    stop();
    await session.close();
  });

  it('still suppresses a repeat of an unchanged empty projection', async () => {
    const session = await connect('me');
    const seen: Array<string[]> = [];
    const stop = session.watchOnlineUsers(['alice', 'bob'], (ids) => seen.push([...ids]), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(connectionsOf('alice'), null);
    emit(connectionsOf('bob'), null);
    // Two members reported absent, but the projection only changed once.
    expect(seen).toEqual([[]]);

    stop();
    await session.close();
  });

  it('excludes the current user from the watch set', async () => {
    const session = await connect('me');
    const seen: Array<string[]> = [];
    const stop = session.watchOnlineUsers(['me'], (ids) => seen.push([...ids]), () => undefined);
    expect(seen).toEqual([[]]);
    expect(state.listeners.has(connectionsOf('me'))).toBe(false);
    stop();
    await session.close();
  });
});
