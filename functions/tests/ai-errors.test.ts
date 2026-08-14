import { describe, expect, it } from 'vitest';

import { aiErrorMessage, classifyProviderError, safeErrorFields } from '../src/bots/ai-errors.js';

describe('AI provider error classification', () => {
  it('maps quota exhaustion to a retryable rate-limit code', () => {
    expect(classifyProviderError({ status: 429 })).toBe('AI_RATE_LIMITED');
    expect(classifyProviderError({ code: 'RESOURCE_EXHAUSTED' })).toBe('AI_RATE_LIMITED');
  });

  it('treats a rejected key as a deployment problem, not a user error', () => {
    expect(classifyProviderError({ status: 403 })).toBe('AI_CONFIGURATION_ERROR');
    expect(classifyProviderError({ status: 400, message: 'API key not valid' })).toBe('AI_CONFIGURATION_ERROR');
  });

  it('separates timeouts from generic outages', () => {
    expect(classifyProviderError({ status: 504 })).toBe('AI_TIMEOUT');
    expect(classifyProviderError({ code: 'DEADLINE_EXCEEDED' })).toBe('AI_TIMEOUT');
    expect(classifyProviderError({ status: 503 })).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(classifyProviderError({ name: 'FetchError', message: 'fetch failed' })).toBe('AI_PROVIDER_UNAVAILABLE');
  });

  it('reports cancellation from either the flag or the error', () => {
    expect(classifyProviderError({ status: 500 }, true)).toBe('AI_CANCELLED');
    expect(classifyProviderError({ name: 'AbortError' })).toBe('AI_CANCELLED');
  });

  it('does not guess when it cannot tell', () => {
    expect(classifyProviderError(undefined)).toBe('AI_UNKNOWN');
    expect(classifyProviderError('boom')).toBe('AI_UNKNOWN');
    expect(classifyProviderError({ message: 'something odd' })).toBe('AI_UNKNOWN');
  });

  it('gives every code a Traditional Chinese message', () => {
    for (const code of [
      'AI_RATE_LIMITED', 'AI_PROVIDER_UNAVAILABLE', 'AI_TIMEOUT', 'AI_CANCELLED',
      'AI_CONTEXT_TOO_LARGE', 'AI_ALREADY_RUNNING', 'AI_PERMISSION_DENIED',
      'AI_CONFIGURATION_ERROR', 'AI_UNKNOWN',
    ] as const) {
      expect(aiErrorMessage(code)).toMatch(/[\u4e00-\u9fff]/u);
    }
  });
});

describe('AI error log serialization', () => {
  it('keeps only the shallow identity fields', () => {
    const error = Object.assign(new Error('quota exceeded for prompt: 使用者的私人訊息'), {
      code: 'RESOURCE_EXHAUSTED',
      status: 429,
    });
    expect(safeErrorFields(error)).toEqual({
      errorName: 'Error',
      errorCode: 'RESOURCE_EXHAUSTED',
      errorStatus: 429,
    });
  });

  it('never carries a message, request or response through', () => {
    const fields = safeErrorFields({
      name: 'ApiError',
      message: '完整的聊天內容',
      request: { contents: 'prompt' },
      response: { text: 'reply' },
      details: { apiKey: 'AIzaSECRET' },
    });
    expect(JSON.stringify(fields)).not.toContain('聊天');
    expect(JSON.stringify(fields)).not.toContain('AIza');
    expect(JSON.stringify(fields)).not.toContain('prompt');
    expect(fields).toEqual({ errorName: 'ApiError' });
  });

  it('tolerates non-objects', () => {
    expect(safeErrorFields(null)).toEqual({});
    expect(safeErrorFields('nope')).toEqual({});
  });
});
