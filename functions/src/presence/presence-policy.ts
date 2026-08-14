/**
 * Mirrors `src/realtime/presence-state.ts`. The client bundle and the Functions
 * workspace do not share code, so the two copies have to move together: a
 * sweeper that deletes sooner than readers hide would make people blink out,
 * and one that deletes later just leaves rows behind.
 */
export const PRESENCE_HEARTBEAT_MS = 45_000;
export const PRESENCE_STALE_AFTER_MS = PRESENCE_HEARTBEAT_MS * 3;
export const PRESENCE_LEGACY_TRUST_MS = 12 * 60 * 60_000;

export interface PresenceConnection {
  state?: unknown;
  connectedAt?: unknown;
  updatedAt?: unknown;
}

export function isStalePresenceConnection(connection: PresenceConnection, now: number): boolean {
  const { connectedAt, updatedAt } = connection;
  const stamp = typeof updatedAt === 'number' ? updatedAt
    : typeof connectedAt === 'number' ? connectedAt
      : null;
  // Malformed rows carry no evidence either way. Deleting presence is visible
  // to users, so leave them and let the rules keep rejecting the writes.
  if (stamp === null) return false;
  const heartbeating = typeof connectedAt === 'number'
    && typeof updatedAt === 'number'
    && updatedAt > connectedAt;
  return now - stamp >= (heartbeating ? PRESENCE_STALE_AFTER_MS : PRESENCE_LEGACY_TRUST_MS);
}
