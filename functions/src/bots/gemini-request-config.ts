import type { CountTokensConfig, GenerateContentConfig } from '@google/genai';

export function geminiCountTokensConfig(abortSignal: AbortSignal): CountTokensConfig {
  // The Gemini Developer API rejects systemInstruction on countTokens even
  // though the SDK's shared config type exposes it. The instruction is still
  // supplied to generateContentStream below.
  return { abortSignal };
}

export function geminiGenerationConfig(
  abortSignal: AbortSignal,
  systemInstruction: string,
  maxOutputTokens: number,
): GenerateContentConfig {
  return { abortSignal, systemInstruction, maxOutputTokens };
}
