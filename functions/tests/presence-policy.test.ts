import { describe, expect, it } from 'vitest';

import {
  isStalePresenceConnection,
  PRESENCE_LEGACY_TRUST_MS,
  PRESENCE_STALE_AFTER_MS,
} from '../src/presence/presence-policy.js';

const now = 100_000_000;
const beating = (age: number) => ({ state: 'online', connectedAt: now - age - 1, updatedAt: now - age });
const legacy = (age: number) => ({ state: 'online', connectedAt: now - age, updatedAt: now - age });

describe('presence sweeper policy', () => {
  it('keeps a connection that is still heartbeating', () => {
    expect(isStalePresenceConnection(beating(1_000), now)).toBe(false);
    expect(isStalePresenceConnection(beating(PRESENCE_STALE_AFTER_MS - 1), now)).toBe(false);
  });

  it('deletes a heartbeating connection that missed its beats', () => {
    expect(isStalePresenceConnection(beating(PRESENCE_STALE_AFTER_MS), now)).toBe(true);
  });

  it('leaves a pre-heartbeat client alone for the whole compatibility window', () => {
    // Deleting these would knock users on the older build offline mid-session.
    expect(isStalePresenceConnection(legacy(PRESENCE_STALE_AFTER_MS * 10), now)).toBe(false);
    expect(isStalePresenceConnection(legacy(PRESENCE_LEGACY_TRUST_MS - 1), now)).toBe(false);
  });

  it('deletes a pre-heartbeat connection once the window closes', () => {
    expect(isStalePresenceConnection(legacy(PRESENCE_LEGACY_TRUST_MS), now)).toBe(true);
  });

  it('never deletes a row it cannot date', () => {
    expect(isStalePresenceConnection({ state: 'online' }, now)).toBe(false);
    expect(isStalePresenceConnection({}, now)).toBe(false);
  });

  it('hides nothing the reader would still show', () => {
    // The sweeper must not delete sooner than the client stops rendering, or
    // users blink out before the projection agrees they are gone.
    for (const age of [0, 1_000, PRESENCE_STALE_AFTER_MS - 1, PRESENCE_LEGACY_TRUST_MS - 1]) {
      if (!isStalePresenceConnection(beating(age), now)) continue;
      expect(now - (now - age)).toBeGreaterThanOrEqual(PRESENCE_STALE_AFTER_MS);
    }
  });
});
