import type { OnlineUser, RoomMembership } from '../types';

export interface PresenceConnectionState {
  state?: unknown;
  connectedAt?: unknown;
  updatedAt?: unknown;
}

/**
 * A heartbeating client refreshes `updatedAt` on this interval, so anything
 * older than a few missed beats is gone: a killed tab, or a socket the server
 * never reaped. One such entry is enough to hold its owner online forever,
 * which is why the timestamp has to be read rather than merely written.
 */
export const PRESENCE_HEARTBEAT_MS = 45_000;
export const PRESENCE_STALE_AFTER_MS = PRESENCE_HEARTBEAT_MS * 3;

/**
 * Clients from before heartbeats existed write `updatedAt` once at connect and
 * never touch it again, so the strict window would hide people who are sitting
 * right there. They get a long window instead of an exemption: a user who never
 * reloads stays visible while they keep the tab open, and a connection they
 * abandoned still disappears the same day. Delete this once the seven-day
 * legacy gate closes and no pre-heartbeat client can still be connected.
 */
export const PRESENCE_LEGACY_TRUST_MS = 12 * 60 * 60_000;

function isLive(connection: PresenceConnectionState, serverNow: number): boolean {
  if (connection.state !== 'online' && connection.state !== 'away') return false;
  const { connectedAt, updatedAt } = connection;
  const stamp = typeof updatedAt === 'number' ? updatedAt
    : typeof connectedAt === 'number' ? connectedAt
      : null;
  // The rules require both timestamps, so this is unreachable in production.
  // If it ever happens, show the user rather than hide them over bad metadata.
  if (stamp === null) return true;
  // Only a heartbeat moves `updatedAt` past `connectedAt`. A connection where
  // they are still equal is either pre-heartbeat or younger than one beat, and
  // both want the forgiving window.
  const heartbeating = typeof connectedAt === 'number'
    && typeof updatedAt === 'number'
    && updatedAt > connectedAt;
  return serverNow - stamp < (heartbeating ? PRESENCE_STALE_AFTER_MS : PRESENCE_LEGACY_TRUST_MS);
}

export function hasOnlineConnection(
  connections: Record<string, PresenceConnectionState>,
  serverNow: number,
): boolean {
  return Object.values(connections).some((connection) => isLive(connection, serverNow));
}

/**
 * `onlineRoomMembers` deliberately excludes the current user — you are not your
 * own room presence — but the count it produces is therefore "other members",
 * and rendering it as "N 位在線" told a user sitting alone in a room that nobody
 * was there, including themselves. The projection is right; only the sentence
 * was wrong, so the fix belongs here and not in the intersection above.
 */
export function presenceSummary(otherOnlineCount: number, roomOpen: boolean): string {
  if (!roomOpen) return '尚未選擇聊天室';
  return otherOnlineCount === 0 ? '只有你在線' : `你和其他 ${otherOnlineCount} 位在線`;
}

export function onlineRoomMembers(
  members: RoomMembership[],
  onlineUserIds: ReadonlySet<string>,
  selfUid: string,
): OnlineUser[] {
  return members.flatMap((member): OnlineUser[] => (
    member.userId !== selfUid && onlineUserIds.has(member.userId)
      ? [{ uid: member.userId, displayName: member.displayName || '使用者', online: true }]
      : []
  ));
}
