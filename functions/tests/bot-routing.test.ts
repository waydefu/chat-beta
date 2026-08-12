import { describe, expect, it } from 'vitest';

import { hasBotMention } from '../src/bots/bot-routing.js';

describe('structured bot routing', () => {
  it('requires a structured bot mention instead of matching plain text', () => {
    expect(hasBotMention({ text: '@Gemini hello', mentions: [] }, 'gemini')).toBe(false);
    expect(hasBotMention({
      text: '@Gemini hello',
      mentions: [{ type: 'bot', id: 'gemini', label: 'Gemini', start: 0, end: 7 }],
    }, 'gemini')).toBe(true);
  });

  it('does not route bot-authored final messages recursively', () => {
    const finalBotMessage = { senderType: 'bot', mentions: [] };
    expect(hasBotMention(finalBotMessage, 'gemini')).toBe(false);
  });
});
