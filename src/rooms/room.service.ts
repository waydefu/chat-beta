import { DomainError, toDomainError } from '../shared/errors/domain-error';
import { normalizeRoomName, validateRoomName } from '../utils';

interface JoinRoomResponse {
  roomId: string;
  version: number;
  realtimeReady: boolean;
}

export async function createOrJoinPublicRoom(roomName: string): Promise<JoinRoomResponse> {
  const validation = validateRoomName(roomName);
  if (validation) throw new DomainError('validation', validation);
  try {
    const { callFunction } = await import('../firebase/callables');
    return await callFunction<{ roomName: string }, JoinRoomResponse>('createOrJoinPublicRoom', {
      roomName: normalizeRoomName(roomName),
    });
  } catch (error) {
    throw toDomainError(error, '無法建立或加入聊天室。');
  }
}

export async function removeRoomMember(roomId: string, userId: string): Promise<void> {
  const { callFunction } = await import('../firebase/callables');
  await callFunction('revokeRoomMember', { roomId, userId });
}
