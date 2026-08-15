import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeRef { path: string; key: string }

const state = vi.hoisted(() => ({
  listeners: new Map<string, (snapshot: { val: () => unknown }) => void>(),
  writes: [] as Array<{ path: string; value: unknown }>,
  removed: [] as string[],
  pushed: 0,
}));

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string): FakeRef => ({ path, key: path.split('/').at(-1) ?? '' }),
  push: (parent: FakeRef): FakeRef => {
    const key = `c${++state.pushed}`;
    return { path: `${parent.path}/${key}`, key };
  },
  onValue: (target: FakeRef, next: (snapshot: { val: () => unknown }) => void) => {
    state.listeners.set(target.path, next);
    return () => state.listeners.delete(target.path);
  },
  onDisconnect: () => ({ remove: async () => undefined, cancel: async () => undefined }),
  set: async (target: FakeRef, value: unknown) => { state.writes.push({ path: target.path, value }); },
  update: async () => undefined,
  remove: async (target: FakeRef) => { state.removed.push(target.path); },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

vi.mock('../src/firebase/realtime-client', () => ({ rtdb: {} }));

import { connectRealtimeRoom, watchRealtimeConnection } from '../src/realtime/realtime.repository';
import { TYPING_STALE_AFTER_MS, TYPING_SWEEP_MS } from '../src/realtime/typing-state';
import { encodeRoomKey } from '../src/utils';

const base = `realtime/rooms/${encodeRoomKey('room-1')}`;

function emit(path: string, value: unknown): void {
  state.listeners.get(path)?.({ val: () => value });
}

beforeEach(() => {
  state.listeners.clear();
  state.writes.length = 0;
  state.removed.length = 0;
  state.pushed = 0;
});

afterEach(() => { vi.useRealTimers(); });

const typing = (name: string, updatedAt: number) => ({ displayName: name, updatedAt });

describe('realtime socket watch', () => {
  it('reports the socket state rather than assuming it stayed up', () => {
    const seen: boolean[] = [];
    const stop = watchRealtimeConnection((connected) => seen.push(connected), () => undefined);
    emit('.info/connected', true);
    emit('.info/connected', false);
    emit('.info/connected', true);
    expect(seen).toEqual([true, false, true]);
    stop();
    emit('.info/connected', false);
    expect(seen).toEqual([true, false, true]);
  });

  it('treats anything other than a literal true as not connected', () => {
    const seen: boolean[] = [];
    watchRealtimeConnection((connected) => seen.push(connected), () => undefined);
    emit('.info/connected', null);
    expect(seen).toEqual([false]);
  });
});

describe('room typing subscription', () => {
  it('hides an entry whose owner stopped refreshing it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(`${base}/typing`, { alice: { tab: typing('Alice', 0) } });
    expect(seen.at(-1)).toEqual(['Alice']);

    // Alice's tab was killed and onDisconnect never fired, so her node stops
    // changing and nothing re-notifies us. Only the sweep can retire it.
    vi.setSystemTime(TYPING_STALE_AFTER_MS + 1);
    await vi.advanceTimersByTimeAsync(TYPING_STALE_AFTER_MS + 1);
    expect(seen.at(-1)).toEqual([]);

    stop();
    await session.close();
  });

  it('judges freshness against the server clock, not this tab clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    // This tab is ten seconds behind the server; the stamp is a server stamp.
    emit('.info/serverTimeOffset', 10_000);
    emit(`${base}/typing`, { alice: { tab: typing('Alice', 9_000) } });
    // Against the local clock this looks 9s in the future; against the server
    // clock it is 1s old, which is what the entry actually is.
    expect(seen.at(-1)).toEqual(['Alice']);

    stop();
    await session.close();
  });

  it('separates a stale tab from a live one belonging to the same user', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TYPING_STALE_AFTER_MS * 2);
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(`${base}/typing`, {
      alice: { dead: typing('Alice', 0), live: typing('Alice', TYPING_STALE_AFTER_MS * 2 - 100) },
      bob: { dead: typing('Bob', 0) },
    });
    expect(seen.at(-1)).toEqual(['Alice']);

    stop();
    await session.close();
  });

  it('does not rewrite the indicator on every sweep when nothing changed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(`${base}/typing`, { alice: { tab: typing('Alice', 0) } });
    const afterFirst = seen.length;

    // Several sweeps inside the freshness window: the projection is unchanged,
    // so the caller must not be told about it again.
    await vi.advanceTimersByTimeAsync(TYPING_SWEEP_MS * 2);
    expect(seen.length).toBe(afterFirst);

    stop();
    await session.close();
  });

  it('stops sweeping once the subscription is released', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(`${base}/typing`, { alice: { tab: typing('Alice', 0) } });
    const afterFirst = seen.length;

    stop();
    vi.setSystemTime(TYPING_STALE_AFTER_MS * 5);
    await vi.advanceTimersByTimeAsync(TYPING_STALE_AFTER_MS * 5);
    // A released room must not keep waking up to re-project a room nobody is in.
    expect(seen.length).toBe(afterFirst);
    expect(state.listeners.has(`${base}/typing`)).toBe(false);

    await session.close();
  });

  it('never reports the current user back to themselves', async () => {
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    const seen: string[][] = [];
    const stop = session.watchTyping((names) => seen.push(names), () => undefined);

    emit('.info/serverTimeOffset', 0);
    emit(`${base}/typing`, { me: { tab: typing('我', Date.now()) } });
    expect(seen.at(-1)).toEqual([]);

    stop();
    await session.close();
  });

  it('releases the server-time listener when the room closes', async () => {
    const session = await connectRealtimeRoom('room-1', { uid: 'me', displayName: '我' });
    expect(state.listeners.has('.info/serverTimeOffset')).toBe(true);
    await session.close();
    expect(state.listeners.has('.info/serverTimeOffset')).toBe(false);
  });
});
