import { describe, expect, it } from 'vitest';

import {
  hasOnlineConnection,
  onlineRoomMembers,
  PRESENCE_LEGACY_TRUST_MS,
  PRESENCE_STALE_AFTER_MS,
} from '../src/realtime/presence-state';
import type { RoomMembership } from '../src/types';

const members: RoomMembership[] = [
  { userId: 'self', displayName: '自己', role: 'member', status: 'active', version: 1 },
  { userId: 'alice', displayName: 'Alice', role: 'member', status: 'active', version: 1 },
  { userId: 'bob', displayName: 'Bob', role: 'member', status: 'active', version: 1 },
];

const now = 100_000_000;
// A heartbeating connection is one whose updatedAt has moved past connectedAt.
const beating = (age: number) => ({ state: 'online', connectedAt: now - age - 1, updatedAt: now - age });
// A pre-heartbeat client leaves the two stamps identical forever.
const legacy = (age: number) => ({ state: 'online', connectedAt: now - age, updatedAt: now - age });

describe('global presence projection', () => {
  it('stays online until the last tab or device connection is gone', () => {
    expect(hasOnlineConnection({ tabA: beating(1_000), phone: beating(2_000) }, now)).toBe(true);
    expect(hasOnlineConnection({ phone: { ...beating(1_000), state: 'away' } }, now)).toBe(true);
    expect(hasOnlineConnection({}, now)).toBe(false);
  });

  it('drops a heartbeating connection that missed its beats', () => {
    expect(hasOnlineConnection({ killed: beating(PRESENCE_STALE_AFTER_MS + 1) }, now)).toBe(false);
    expect(hasOnlineConnection({ alive: beating(PRESENCE_STALE_AFTER_MS - 1) }, now)).toBe(true);
  });

  it('keeps a user online when only one of several connections went stale', () => {
    expect(hasOnlineConnection({
      killed: beating(PRESENCE_STALE_AFTER_MS + 1),
      phone: beating(1_000),
    }, now)).toBe(true);
  });

  it('keeps a client that never heartbeats visible for the compatibility window', () => {
    // The whole point: a user on the pre-heartbeat build is sitting right there.
    expect(hasOnlineConnection({ old: legacy(PRESENCE_STALE_AFTER_MS * 10) }, now)).toBe(true);
    expect(hasOnlineConnection({ old: legacy(PRESENCE_LEGACY_TRUST_MS - 1) }, now)).toBe(true);
  });

  it('still expires a non-heartbeating connection once the window closes', () => {
    expect(hasOnlineConnection({ old: legacy(PRESENCE_LEGACY_TRUST_MS + 1) }, now)).toBe(false);
  });

  it('shows a user rather than hiding them when the timestamps are unusable', () => {
    expect(hasOnlineConnection({ broken: { state: 'online' } }, now)).toBe(true);
  });

  it('intersects room membership with global presence and excludes self', () => {
    expect(onlineRoomMembers(members, new Set(['self', 'alice', 'outsider']), 'self')).toEqual([
      { uid: 'alice', displayName: 'Alice', online: true },
    ]);
  });
});
