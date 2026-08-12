import { describe, expect, it } from 'vitest';
import { compareMessages, encodeRoomKey, normalizeRoomName, validateMessage, validateRoomName } from '../src/utils';
import type { ChatMessage } from '../src/types';

describe('room validation', () => {
  it('normalizes whitespace without changing meaningful text', () => {
    expect(normalizeRoomName('  週末   計畫  ')).toBe('週末 計畫');
  });

  it('rejects empty, slash, control and dot-only names', () => {
    expect(validateRoomName('')).toBeTruthy();
    expect(validateRoomName('a/b')).toBeTruthy();
    expect(validateRoomName('..')).toBeTruthy();
    expect(validateRoomName('bad\u0000room')).toBeTruthy();
  });

  it('encodes unicode room ids into an RTDB-safe key', () => {
    expect(encodeRoomKey('專案 #1')).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encodeRoomKey('專案 #1')).not.toContain('#');
  });
});

describe('message behavior', () => {
  it('enforces non-empty messages and the 1000-character limit', () => {
    expect(validateMessage('   ')).toBeTruthy();
    expect(validateMessage('a'.repeat(1000))).toBeNull();
    expect(validateMessage('a'.repeat(1001))).toBeTruthy();
  });

  it('keeps deterministic chronological ordering', () => {
    const messages: ChatMessage[] = [
      { id: 'b', roomId: 'r', senderId: 'u', senderType: 'user', senderDisplayName: 'U', kind: 'text', text: '2', clientCreatedAt: 20 },
      { id: 'a', roomId: 'r', senderId: 'u', senderType: 'user', senderDisplayName: 'U', kind: 'text', text: '1', clientCreatedAt: 10 },
    ];
    expect(messages.sort(compareMessages).map((message) => message.id)).toEqual(['a', 'b']);
  });
});
