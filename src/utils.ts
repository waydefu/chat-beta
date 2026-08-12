import type { ChatMessage } from './types';

export const ROOM_MAX_LENGTH = 50;
export const MESSAGE_MAX_LENGTH = 1000;

export function normalizeRoomName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateRoomName(value: string): string | null {
  const room = normalizeRoomName(value);
  if (!room) return '請輸入聊天室名稱';
  if (room.length > ROOM_MAX_LENGTH) return `聊天室名稱最多 ${ROOM_MAX_LENGTH} 個字元`;
  const hasControlCharacter = [...room].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (room.includes('/') || hasControlCharacter || room === '.' || room === '..') {
    return '聊天室名稱包含不支援的字元';
  }
  return null;
}

export function validateMessage(value: string): string | null {
  const text = value.trim();
  if (!text) return '訊息不可為空白';
  if (text.length > MESSAGE_MAX_LENGTH) return `訊息最多 ${MESSAGE_MAX_LENGTH} 個字元`;
  return null;
}

export function encodeRoomKey(roomId: string): string {
  const bytes = new TextEncoder().encode(roomId);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function messageMillis(message: ChatMessage): number {
  return message.createdAt?.toMillis() ?? message.clientCreatedAt ?? 0;
}

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const timeDifference = messageMillis(a) - messageMillis(b);
  return timeDifference || a.id.localeCompare(b.id);
}

export function formatMessageTime(message: ChatMessage): string {
  const millis = messageMillis(message);
  if (!millis) return '傳送中';
  return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(new Date(millis));
}

export function initialOf(value: string | null | undefined): string {
  return value?.trim().charAt(0).toUpperCase() || '?';
}

export function truncate(value: string, length = 52): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
