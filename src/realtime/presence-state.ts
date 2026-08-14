import type { OnlineUser, RoomMembership } from '../types';

export interface PresenceConnectionState {
  state?: unknown;
  updatedAt?: unknown;
}

/**
 * A connection is re-armed on every reconnect and its `updatedAt` is refreshed
 * on a heartbeat, so anything older than this missed several beats in a row and
 * is treated as gone. Without it a connection whose `onDisconnect` never fired —
 * a killed tab, a dropped socket the server has not reaped — marks its owner
 * online forever, because one stale entry is enough to satisfy the projection.
 */
export const PRESENCE_HEARTBEAT_MS = 45_000;
export const PRESENCE_STALE_AFTER_MS = PRESENCE_HEARTBEAT_MS * 3;

function isLive(connection: PresenceConnectionState, serverNow: number): boolean {
  if (connection.state !== 'online' && connection.state !== 'away') return false;
  // A connection written before heartbeats existed carries no usable timestamp.
  // Trust it rather than hiding a user who is genuinely here.
  if (typeof connection.updatedAt !== 'number') return true;
  return serverNow - connection.updatedAt < PRESENCE_STALE_AFTER_MS;
}

export function hasOnlineConnection(
  connections: Record<string, PresenceConnectionState>,
  serverNow: number,
): boolean {
  return Object.values(connections).some((connection) => isLive(connection, serverNow));
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
