import { defineSecret } from 'firebase-functions/params';

export const REGION = 'asia-east1';

export type AppCheckFeature = 'membership' | 'ai' | 'media' | 'notifications' | 'rtc' | 'search' | 'stickers';

export function appCheckEnforced(feature: AppCheckFeature): boolean {
  return new Set((process.env.APP_CHECK_ENFORCED_FEATURES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))
    .has(feature);
}

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const r2AccountId = defineSecret('R2_ACCOUNT_ID');
export const r2AccessKeyId = defineSecret('R2_ACCESS_KEY_ID');
export const r2SecretAccessKey = defineSecret('R2_SECRET_ACCESS_KEY');
export const r2Bucket = defineSecret('R2_BUCKET');
export const livekitUrl = defineSecret('LIVEKIT_URL');
export const livekitApiKey = defineSecret('LIVEKIT_API_KEY');
export const livekitApiSecret = defineSecret('LIVEKIT_API_SECRET');
export const algoliaAppId = defineSecret('ALGOLIA_APP_ID');
export const algoliaAdminKey = defineSecret('ALGOLIA_ADMIN_KEY');
export const algoliaIndexName = defineSecret('ALGOLIA_INDEX_NAME');
