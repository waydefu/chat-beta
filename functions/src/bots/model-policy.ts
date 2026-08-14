/**
 * The pinned model. Remote Config `gemini_model` overrides it, but only with a
 * value on the allowlist -- production Remote Config is currently empty, so
 * this constant is the model that actually runs, not a theoretical backstop.
 */
export const FALLBACK_MODEL = 'gemini-3.6-flash';

/**
 * Deliberately a closed set. A typo in the Console ("gemini-3.6-flahs") or a
 * model Google has since retired would otherwise only surface as a failed
 * generation in front of a user, one request at a time.
 */
export const ALLOWED_MODELS: ReadonlySet<string> = new Set([
  'gemini-3.6-flash',
  'gemini-2.5-flash',
]);

export type ModelSource = 'remote-config' | 'fallback';

export interface ModelChoice {
  model: string;
  source: ModelSource;
  /** Present only when a configured value was refused, for the warning log. */
  rejected?: string;
}

export function resolveGeminiModel(configured: unknown): ModelChoice {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  if (!trimmed) return { model: FALLBACK_MODEL, source: 'fallback' };
  // Falling back beats failing closed here: an unusable Remote Config value
  // would take the whole bot down, and the allowlist already guarantees
  // whatever we fall back to is a model that exists.
  if (!ALLOWED_MODELS.has(trimmed)) {
    return { model: FALLBACK_MODEL, source: 'fallback', rejected: trimmed };
  }
  return { model: trimmed, source: 'remote-config' };
}
