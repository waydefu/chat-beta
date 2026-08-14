import type { OnlineUser, RoomMembership } from '../types';

export interface PresenceConnectionState {
  state?: unknown;
}

export function hasOnlineConnection(connections: Record<string, PresenceConnectionState>): boolean {
  return Object.values(connections).some((connection) => (
    connection.state === 'online' || connection.state === 'away'
  ));
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
