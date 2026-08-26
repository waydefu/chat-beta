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

function isLive(connection: PresenceConnectionState, serverNow: number): boolean {
  if (connection.state !== 'online' && connection.state !== 'away') return false;
  const { connectedAt, updatedAt } = connection;
  const stamp = typeof updatedAt === 'number' ? updatedAt
    : typeof connectedAt === 'number' ? connectedAt
      : null;
  // The rules require both timestamps, so this is unreachable in production.
  // If it ever happens, show the user rather than hide them over bad metadata.
  if (stamp === null) return true;
  // One window for every connection. A freshly established node has not beaten
  // yet, but its stamp is the connect time, so it stays inside the window until
  // long after the first beat is due.
  return serverNow - stamp < PRESENCE_STALE_AFTER_MS;
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

/**
 * Revoked members are excluded here, not upstream, because this is the only
 * place where membership and liveness are both in hand.
 *
 * Presence is global: `realtime/presence/{uid}` carries no room dimension, its
 * owner holds the only write permission, and the heartbeat rebuilds the node
 * within one beat of any server-side delete. Revocation therefore cannot make a
 * user's presence go away -- nor should it, since they may still be in other
 * rooms. What revocation changes is membership, so membership is what this
 * projection has to honour.
 *
 * The Firestore subscription already drops non-active members before they get
 * here, which is why nothing was visibly wrong. That left the guarantee resting
 * on one filter clause in another module with no test of its own: delete it and
 * a revoked member reappears in the list, online. Checking status here keeps the
 * projection correct for whatever it is handed.
 */
export function onlineRoomMembers(
  members: RoomMembership[],
  onlineUserIds: ReadonlySet<string>,
  selfUid: string,
): OnlineUser[] {
  return members.flatMap((member): OnlineUser[] => (
    member.status === 'active' && member.userId !== selfUid && onlineUserIds.has(member.userId)
      ? [{ uid: member.userId, displayName: member.displayName || '使用者', online: true }]
      : []
  ));
}
