import { describe, expect, it } from 'vitest';

import { expiredDraftIds } from '../src/bots/draft-policy.js';

const now = 1_000_000;

describe('AI draft expiry', () => {
  it('removes drafts whose TTL has passed', () => {
    expect(expiredDraftIds({ a: { expiresAt: now - 1 }, b: { expiresAt: now } }, now)).toEqual(['a', 'b']);
  });

  it('keeps a draft still inside its TTL', () => {
    expect(expiredDraftIds({ live: { expiresAt: now + 1 } }, now)).toEqual([]);
  });

  it('treats an undatable draft as expired rather than pinning it forever', () => {
    expect(expiredDraftIds({ broken: {}, alsoBroken: { expiresAt: 'soon' } }, now))
      .toEqual(['broken', 'alsoBroken']);
  });

  it('handles an empty room', () => {
    expect(expiredDraftIds({}, now)).toEqual([]);
  });
});
