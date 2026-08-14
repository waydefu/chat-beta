import { describe, expect, it } from 'vitest';

import { ALLOWED_MODELS, FALLBACK_MODEL, resolveGeminiModel } from '../src/bots/model-policy.js';

describe('gemini model policy', () => {
  it('pins a current model as the fallback', () => {
    // Production Remote Config is empty, so this constant is what actually runs.
    expect(FALLBACK_MODEL).toBe('gemini-3.6-flash');
    expect(ALLOWED_MODELS.has(FALLBACK_MODEL)).toBe(true);
  });

  it('never allows a model Google has shut down', () => {
    expect(ALLOWED_MODELS.has('gemini-2.0-flash')).toBe(false);
    expect(resolveGeminiModel('gemini-2.0-flash')).toMatchObject({
      model: FALLBACK_MODEL,
      source: 'fallback',
      rejected: 'gemini-2.0-flash',
    });
  });

  it('accepts an allowlisted model from Remote Config', () => {
    expect(resolveGeminiModel('gemini-2.5-flash')).toEqual({
      model: 'gemini-2.5-flash',
      source: 'remote-config',
    });
  });

  it('trims whitespace a console paste leaves behind', () => {
    expect(resolveGeminiModel('  gemini-3.6-flash \n')).toEqual({
      model: 'gemini-3.6-flash',
      source: 'remote-config',
    });
  });

  it('catches a typo instead of carrying it to the provider', () => {
    const choice = resolveGeminiModel('gemini-3.6-flahs');
    expect(choice.model).toBe(FALLBACK_MODEL);
    expect(choice.source).toBe('fallback');
    expect(choice.rejected).toBe('gemini-3.6-flahs');
  });

  it('falls back when Remote Config has no value at all', () => {
    for (const empty of [undefined, null, '', '   ', 42, {}]) {
      expect(resolveGeminiModel(empty)).toEqual({ model: FALLBACK_MODEL, source: 'fallback' });
    }
  });
});
