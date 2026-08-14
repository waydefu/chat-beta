import { describe, expect, it } from 'vitest';

import {
  hasOnlineConnection,
  onlineRoomMembers,
  PRESENCE_STALE_AFTER_MS,
} from '../src/realtime/presence-state';
import type { RoomMembership } from '../src/types';

const members: RoomMembership[] = [
  { userId: 'self', displayName: '自己', role: 'member', status: 'active', version: 1 },
  { userId: 'alice', displayName: 'Alice', role: 'member', status: 'active', version: 1 },
  { userId: 'bob', displayName: 'Bob', role: 'member', status: 'active', version: 1 },
];

const now = 1_000_000;
const fresh = now - 1_000;
const stale = now - PRESENCE_STALE_AFTER_MS - 1;

describe('global presence projection', () => {
  it('stays online until the last tab or device connection is gone', () => {
    expect(hasOnlineConnection({
      tabA: { state: 'online', updatedAt: fresh },
      phone: { state: 'online', updatedAt: fresh },
    }, now)).toBe(true);
    expect(hasOnlineConnection({ phone: { state: 'away', updatedAt: fresh } }, now)).toBe(true);
    expect(hasOnlineConnection({}, now)).toBe(false);
  });

  it('ignores a connection that stopped heartbeating', () => {
    expect(hasOnlineConnection({ killedTab: { state: 'online', updatedAt: stale } }, now)).toBe(false);
  });

  it('keeps a user online when only one of several connections went stale', () => {
    expect(hasOnlineConnection({
      killedTab: { state: 'online', updatedAt: stale },
      phone: { state: 'online', updatedAt: fresh },
    }, now)).toBe(true);
  });

  it('trusts a connection written before heartbeats existed', () => {
    expect(hasOnlineConnection({ legacy: { state: 'online' } }, now)).toBe(true);
  });

  it('intersects room membership with global presence and excludes self', () => {
    expect(onlineRoomMembers(members, new Set(['self', 'alice', 'outsider']), 'self')).toEqual([
      { uid: 'alice', displayName: 'Alice', online: true },
    ]);
  });
});
