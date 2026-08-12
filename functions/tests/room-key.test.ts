import { describe, expect, it } from 'vitest';

import { directRoomKey } from '../src/rooms/direct-room-key.js';
import { roomKey } from '../src/shared/validation.js';

describe('room identifiers', () => {
  it('creates an RTDB-safe unicode room key', () => {
    expect(roomKey('專案 #1')).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('creates the same direct-room identity regardless of order', () => {
    expect(directRoomKey('alice', 'bob')).toBe(directRoomKey('bob', 'alice'));
  });
});
