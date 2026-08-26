import { getRemoteConfig } from 'firebase-admin/remote-config';
import { logger } from 'firebase-functions';

import { safeErrorFields } from './ai-errors.js';
import { FALLBACK_MODEL, resolveGeminiModel, type ModelChoice } from './model-policy.js';

const CACHE_MS = 5 * 60_000;
const ERROR_CACHE_MS = 60_000;
let cached: { value: ModelChoice; expiresAt: number } | undefined;

export async function stableGeminiModel(now = Date.now()): Promise<ModelChoice> {
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const template = await getRemoteConfig().getTemplate();
    const defaultValue = template.parameters.gemini_model?.defaultValue as { value?: unknown } | undefined;
    const choice = resolveGeminiModel(defaultValue?.value);
    if (choice.rejected) {
      logger.warn('Remote Config gemini_model is not on the allowlist; using pinned model', {
        operation: 'ai.model.resolve',
        result: 'rejected',
        rejected: choice.rejected,
        model: choice.model,
        modelSource: choice.source,
      });
    }
    cached = { value: choice, expiresAt: now + CACHE_MS };
    return choice;
  } catch (error) {
    logger.warn('Remote Config unavailable; using pinned model', {
      operation: 'ai.model.resolve',
      result: 'unavailable',
      model: FALLBACK_MODEL,
      modelSource: 'fallback',
      ...safeErrorFields(error),
    });
    const choice: ModelChoice = { model: FALLBACK_MODEL, source: 'fallback' };
    cached = { value: choice, expiresAt: now + ERROR_CACHE_MS };
    return choice;
  }
}
