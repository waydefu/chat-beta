import { describe, expect, it } from 'vitest';

import { geminiCountTokensConfig, geminiGenerationConfig } from '../src/bots/gemini-request-config.js';

describe('Gemini request config', () => {
  it('does not send systemInstruction to the Developer API countTokens endpoint', () => {
    const controller = new AbortController();

    expect(geminiCountTokensConfig(controller.signal)).toEqual({
      abortSignal: controller.signal,
    });
  });

  it('keeps the system instruction and output limit on generation', () => {
    const controller = new AbortController();

    expect(geminiGenerationConfig(controller.signal, 'instruction', 2048)).toEqual({
      abortSignal: controller.signal,
      systemInstruction: 'instruction',
      maxOutputTokens: 2048,
    });
  });
});
