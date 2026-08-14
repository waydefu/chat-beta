import { describe, expect, it } from 'vitest';

import { hasOnlineConnection, onlineRoomMembers } from '../src/realtime/presence-state';
import type { RoomMembership } from '../src/types';

const members: RoomMembership[] = [
  { userId: 'self', displayName: '自己', role: 'member', status: 'active', version: 1 },
  { userId: 'alice', displayName: 'Alice', role: 'member', status: 'active', version: 1 },
  { userId: 'bob', displayName: 'Bob', role: 'member', status: 'active', version: 1 },
];

describe('global presence projection', () => {
  it('stays online until the last tab or device connection is gone', () => {
    expect(hasOnlineConnection({ tabA: { state: 'online' }, phone: { state: 'online' } })).toBe(true);
    expect(hasOnlineConnection({ phone: { state: 'away' } })).toBe(true);
    expect(hasOnlineConnection({})).toBe(false);
  });

  it('intersects room membership with global presence and excludes self', () => {
    expect(onlineRoomMembers(members, new Set(['self', 'alice', 'outsider']), 'self')).toEqual([
      { uid: 'alice', displayName: 'Alice', online: true },
    ]);
  });
});
