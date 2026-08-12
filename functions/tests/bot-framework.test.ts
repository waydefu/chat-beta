import { describe, expect, it } from 'vitest';

import { BotRegistry, BotRouter } from '../src/bots/bot-registry.js';

describe('bot registry and router', () => {
  it('resolves registered bots and rejects unknown IDs', () => {
    const router = new BotRouter(new BotRegistry([{ id: 'gemini', displayName: 'Gemini', provider: 'gemini' }]));
    expect(router.require('gemini').provider).toBe('gemini');
    expect(() => router.require('unknown')).toThrow('不支援的機器人');
  });

  it('rejects duplicate bot IDs', () => {
    expect(() => new BotRegistry([
      { id: 'gemini', displayName: 'One', provider: 'gemini' },
      { id: 'gemini', displayName: 'Two', provider: 'other' },
    ])).toThrow('Duplicate bot ID');
  });
});
