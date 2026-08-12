import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData } from 'firebase-admin/firestore';

export function requireAuth(request: CallableRequest): NonNullable<CallableRequest['auth']> {
  if (!request.auth) throw new HttpsError('unauthenticated', '請先登入。');
  return request.auth;
}

export function requireString(value: unknown, name: string, maximum = 150): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${name} 必須是字串。`);
  const result = value.trim();
  if (!result || result.length > maximum) {
    throw new HttpsError('invalid-argument', `${name} 長度不正確。`);
  }
  return result;
}

export function requireRecord(value: unknown): DocumentData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', '請求格式不正確。');
  }
  return value as DocumentData;
}

export function normalizeRoomName(value: unknown): string {
  const room = requireString(value, 'roomName', 50).replace(/\s+/gu, ' ');
  const invalid = [...room].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
  if (invalid || room.includes('/') || room === '.' || room === '..') {
    throw new HttpsError('invalid-argument', '聊天室名稱包含不支援的字元。');
  }
  return room;
}

export function roomKey(roomId: string): string {
  return Buffer.from(roomId, 'utf8').toString('base64url');
}

export function operationId(roomId: string, uid: string): string {
  return `${roomKey(roomId)}_${uid}`;
}
