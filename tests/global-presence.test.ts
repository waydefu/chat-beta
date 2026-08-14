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
  set: async (target: FakeRef, value: unknown) => { state.writes.push({ path: target.path, value }); },
  update: async (target: FakeRef, value: unknown) => { state.updates.push({ path: target.path, value }); },
  remove: async (target: FakeRef) => { state.removed.push(target.path); },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

vi.mock('../src/firebase/realtime-client', () => ({ rtdb: {} }));

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

  it('writes a fresh connection after every reconnect', async () => {
    const session = await connect('me');
    // The server already deleted the first node when the socket dropped.
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]?.path).toBe(`${connectionsOf('me')}/c2`);
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(3));
    await session.close();
  });

  it('removes only the current connection on close', async () => {
    const session = await connect('me');
    goOnline();
    await vi.waitFor(() => expect(state.writes).toHaveLength(2));
    await session.close();
    expect(state.removed).toEqual([`${connectionsOf('me')}/c2`]);
    expect(state.disconnectCancels).toEqual([`${connectionsOf('me')}/c2`]);
  });

  it('stops re-establishing after close', async () => {
    const session = await connect('me');
    await session.close();
    goOnline();
    expect(state.writes).toHaveLength(1);
  });

  it('reports a member online and drops them when the connection goes stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connect('me');
    const seen: Array<string[]> = [];
    const stop = session.watchOnlineUsers(['alice'], (ids) => seen.push([...ids]), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(connectionsOf('alice'), { tab: { state: 'online', updatedAt: 0 } });
    expect(seen.at(-1)).toEqual(['alice']);

    // Alice's tab was killed: her node stops changing, so nothing re-notifies
    // us. The sweep is what has to notice.
    vi.setSystemTime(10 * 60_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(seen.at(-1)).toEqual([]);

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
