import { getRemoteConfig } from 'firebase-admin/remote-config';
import { logger } from 'firebase-functions';

const FALLBACK_MODEL = 'gemini-2.5-flash';
const CACHE_MS = 5 * 60_000;
let cached: { value: string; expiresAt: number } | undefined;

export async function stableGeminiModel(now = Date.now()): Promise<string> {
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const template = await getRemoteConfig().getTemplate();
    const defaultValue = template.parameters.gemini_model?.defaultValue as { value?: unknown } | undefined;
    const configured = typeof defaultValue?.value === 'string' ? defaultValue.value.trim() : '';
    const value = configured || FALLBACK_MODEL;
    cached = { value, expiresAt: now + CACHE_MS };
    return value;
  } catch (error) {
    logger.warn('Remote Config gemini_model unavailable; using pinned fallback', { error });
    cached = { value: FALLBACK_MODEL, expiresAt: now + 60_000 };
    return FALLBACK_MODEL;
  }
}
