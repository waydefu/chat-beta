import { describe, expect, it } from 'vitest';

import {
  hasOnlineConnection,
  onlineRoomMembers,
  presenceSummary,
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
// A connection whose updatedAt never moved past connectedAt: it was written at
// connect and has not beaten since.
const unbeaten = (age: number) => ({ state: 'online', connectedAt: now - age, updatedAt: now - age });

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

  it('keeps a connection that has not had time to beat yet', () => {
    // A node is written at connect with the two stamps equal, and the first beat
    // is due at 45s — comfortably inside the 135s window, so nothing special is
    // needed to carry it there.
    expect(hasOnlineConnection({ fresh: unbeaten(1_000) }, now)).toBe(true);
    expect(hasOnlineConnection({ fresh: unbeaten(PRESENCE_STALE_AFTER_MS - 1) }, now)).toBe(true);
  });

  it('expires a connection that never beat, on the same window as one that did (TD-P3)', () => {
    // This used to survive twelve hours, because `updatedAt === connectedAt` was
    // read as "pre-heartbeat build, be forgiving". Every client heartbeats now,
    // so that shape means an abandoned socket, and a zombie is a zombie whether
    // or not it ever beat.
    expect(hasOnlineConnection({ zombie: unbeaten(PRESENCE_STALE_AFTER_MS) }, now)).toBe(false);
    expect(hasOnlineConnection({ zombie: unbeaten(12 * 60 * 60_000) }, now)).toBe(false);
  });

  it('shows a user rather than hiding them when the timestamps are unusable', () => {
    expect(hasOnlineConnection({ broken: { state: 'online' } }, now)).toBe(true);
  });

  it('intersects room membership with global presence and excludes self', () => {
    expect(onlineRoomMembers(members, new Set(['self', 'alice', 'outsider']), 'self')).toEqual([
      { uid: 'alice', displayName: 'Alice', online: true },
    ]);
  });

  // A revoked member keeps their global presence node: it is keyed by uid with
  // no room dimension, their own client still owns the write, and the heartbeat
  // rebuilds it within one beat of any server-side delete. So "revoked users are
  // not shown online" cannot be a property of the presence data -- it has to be
  // a property of this projection, which is the last place both facts meet.
  it('never reports a member who is no longer active, however online they are', () => {
    const revoking: RoomMembership[] = [
      { userId: 'alice', displayName: 'Alice', role: 'member', status: 'active', version: 1 },
      { userId: 'mallory', displayName: 'Mallory', role: 'member', status: 'revoking', version: 2 },
    ];
    expect(onlineRoomMembers(revoking, new Set(['alice', 'mallory']), 'self')).toEqual([
      { uid: 'alice', displayName: 'Alice', online: true },
    ]);
  });

  it('drops a revoked member even when they are the only one online', () => {
    const revoking: RoomMembership[] = [
      { userId: 'mallory', displayName: 'Mallory', role: 'member', status: 'revoking', version: 2 },
    ];
    expect(onlineRoomMembers(revoking, new Set(['mallory']), 'self')).toEqual([]);
  });
});

describe('presence summary wording', () => {
  it('says you are there when the room holds nobody else', () => {
    // The projection excludes self by design, so its count is "other members".
    // Rendering that as "0 位在線" told a user sitting in the room that nobody
    // was — including themselves.
    const alone = onlineRoomMembers(members, new Set(['self']), 'self');
    expect(alone).toEqual([]);
    expect(presenceSummary(alone.length, true)).toBe('只有你在線');
  });

  it('counts the others without dropping you from the sentence', () => {
    const others = onlineRoomMembers(members, new Set(['self', 'alice', 'bob']), 'self');
    expect(others).toHaveLength(2);
    expect(presenceSummary(others.length, true)).toBe('你和其他 2 位在線');
    expect(presenceSummary(1, true)).toBe('你和其他 1 位在線');
  });

  it('does not claim you are alone in a room when no room is open', () => {
    expect(presenceSummary(0, false)).toBe('尚未選擇聊天室');
  });
});
