import { describe, expect, it } from 'vitest';

import {
  isStalePresenceConnection,
  PRESENCE_STALE_AFTER_MS,
} from '../src/presence/presence-policy.js';

const now = 100_000_000;
const beating = (age: number) => ({ state: 'online', connectedAt: now - age - 1, updatedAt: now - age });
// A connection whose updatedAt never moved past connectedAt: written at connect
// and not beaten since.
const unbeaten = (age: number) => ({ state: 'online', connectedAt: now - age, updatedAt: now - age });

describe('presence sweeper policy', () => {
  it('keeps a connection that is still heartbeating', () => {
    expect(isStalePresenceConnection(beating(1_000), now)).toBe(false);
    expect(isStalePresenceConnection(beating(PRESENCE_STALE_AFTER_MS - 1), now)).toBe(false);
  });

  it('deletes a heartbeating connection that missed its beats', () => {
    expect(isStalePresenceConnection(beating(PRESENCE_STALE_AFTER_MS), now)).toBe(true);
  });

  it('leaves a connection that has not had time to beat yet', () => {
    expect(isStalePresenceConnection(unbeaten(1_000), now)).toBe(false);
    expect(isStalePresenceConnection(unbeaten(PRESENCE_STALE_AFTER_MS - 1), now)).toBe(false);
  });

  it('deletes a connection that never beat, on the same window as one that did (TD-P3)', () => {
    // The twelve-hour compatibility window is gone. It existed for clients that
    // wrote `updatedAt` once and never again; every client heartbeats now, so
    // this shape is an abandoned socket the sweeper is meant to reclaim.
    expect(isStalePresenceConnection(unbeaten(PRESENCE_STALE_AFTER_MS), now)).toBe(true);
    expect(isStalePresenceConnection(unbeaten(12 * 60 * 60_000), now)).toBe(true);
  });

  it('never deletes a row it cannot date', () => {
    expect(isStalePresenceConnection({ state: 'online' }, now)).toBe(false);
    expect(isStalePresenceConnection({}, now)).toBe(false);
  });

  it('hides nothing the reader would still show', () => {
    // The sweeper must not delete sooner than the client stops rendering, or
    // users blink out before the projection agrees they are gone. Both sides now
    // read one window, so this holds for beaten and unbeaten rows alike.
    for (const age of [0, 1_000, PRESENCE_STALE_AFTER_MS - 1, PRESENCE_STALE_AFTER_MS * 10]) {
      for (const connection of [beating(age), unbeaten(age)]) {
        if (!isStalePresenceConnection(connection, now)) continue;
        expect(age).toBeGreaterThanOrEqual(PRESENCE_STALE_AFTER_MS);
      }
    }
  });
});
