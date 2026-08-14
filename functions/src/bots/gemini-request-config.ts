import type { CountTokensConfig, GenerateContentConfig } from '@google/genai';

export function geminiCountTokensConfig(abortSignal: AbortSignal): CountTokensConfig {
  // The Gemini Developer API rejects systemInstruction and tools on
  // countTokens even though the SDK's shared config type exposes them.
  // The instruction and tools are supplied to generateContentStream below.
  return { abortSignal };
}

export function geminiGenerationConfig(
  abortSignal: AbortSignal,
  systemInstruction: string,
  maxOutputTokens: number,
): GenerateContentConfig {
  return {
    abortSignal,
    systemInstruction,
    maxOutputTokens,
    tools: [{ googleSearch: {} }],
  };
}
