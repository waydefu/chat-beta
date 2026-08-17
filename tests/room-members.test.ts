import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoomMembership } from '../src/types';

interface FakeCollection { path: string }

const state = vi.hoisted(() => ({
  listeners: new Map<string, (snapshot: { docs: Array<{ data: () => unknown }> }) => void>(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]): FakeCollection => ({ path: segments.join('/') }),
  onSnapshot: (
    target: FakeCollection,
    next: (snapshot: { docs: Array<{ data: () => unknown }> }) => void,
  ) => {
    state.listeners.set(target.path, next);
    return () => state.listeners.delete(target.path);
  },
  doc: () => ({}),
  getDocs: async () => ({ docs: [] }),
  limit: () => ({}),
  orderBy: () => ({}),
  query: () => ({}),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  startAfter: () => ({}),
  updateDoc: async () => undefined,
  where: () => ({}),
  writeBatch: () => ({}),
}));

vi.mock('../src/firebase/firestore-client', () => ({ firestore: {} }));

const { watchRoomMembers } = await import('../src/messages/message.repository');

function emitMembers(members: RoomMembership[]): void {
  state.listeners.get('rooms/room-1/members')?.({
    docs: members.map((member) => ({ data: () => member })),
  });
}

const member = (userId: string, status: RoomMembership['status']): RoomMembership => ({
  userId,
  displayName: userId,
  role: 'member',
  status,
  version: 1,
});

describe('room member subscription', () => {
  beforeEach(() => {
    state.listeners.clear();
  });

  /**
   * `revokeRoomMember` flips the member document to `revoking` in its first
   * transaction and only deletes it after the realtime mirror is cleared. During
   * that window the document still exists and the user is still heartbeating, so
   * this filter is what keeps a member who has just been removed from appearing
   * in the room. It had no test of its own until now.
   */
  it('hides a member the moment revocation starts, before the document is deleted', () => {
    const seen: RoomMembership[][] = [];
    watchRoomMembers('room-1', (value) => seen.push(value), () => undefined);

    emitMembers([member('alice', 'active'), member('mallory', 'revoking')]);

    expect(seen.at(-1)?.map((entry) => entry.userId)).toEqual(['alice']);
  });

  it('passes active members through untouched', () => {
    const seen: RoomMembership[][] = [];
    watchRoomMembers('room-1', (value) => seen.push(value), () => undefined);

    emitMembers([member('alice', 'active'), member('bob', 'active')]);

    expect(seen.at(-1)?.map((entry) => entry.userId)).toEqual(['alice', 'bob']);
  });

  it('reports an empty room rather than staying silent', () => {
    const seen: RoomMembership[][] = [];
    watchRoomMembers('room-1', (value) => seen.push(value), () => undefined);

    emitMembers([member('mallory', 'revoking')]);

    expect(seen.at(-1)).toEqual([]);
  });
});
