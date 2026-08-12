import { describe, expect, it } from 'vitest';

import { compareMessages } from '../src/utils';
import { messageFixture } from './fixtures/messages';

describe('large message fixture', () => {
  it('generates and orders 5,000 stable messages without mutating their model', () => {
    const messages = messageFixture();
    expect(messages).toHaveLength(5_000);
    expect([...messages].sort(compareMessages).at(-1)?.id).toBe('m_04999');
  });
});
