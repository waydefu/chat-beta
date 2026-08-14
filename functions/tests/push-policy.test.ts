import { describe, expect, it } from 'vitest';

import {
  canReleasePushClaim,
  chatNotificationBody,
  isPushTokenHash,
  legacyPushTokenDocumentId,
  pushClaimAction,
  pushTokenHash,
} from '../src/notifications/push-policy.js';

describe('push token ownership policy', () => {
  it('uses a stable non-secret document key', () => {
    const hash = pushTokenHash('private-fcm-token');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('private-fcm-token');
    expect(pushTokenHash('private-fcm-token')).toBe(hash);
    expect(isPushTokenHash(hash)).toBe(true);
    expect(isPushTokenHash('private-fcm-token')).toBe(false);
    expect(legacyPushTokenDocumentId('legacy/token')).toBe('legacy_token');
  });

  it('allows only the canonical owner to release a claim', () => {
    expect(canReleasePushClaim('alice', 'alice')).toBe(true);
    expect(canReleasePushClaim('alice', 'bob')).toBe(false);
    expect(canReleasePushClaim(undefined, 'alice')).toBe(false);
  });

  it('distinguishes idempotent refresh from cross-account replacement', () => {
    expect(pushClaimAction(undefined, 'alice')).toBe('create');
    expect(pushClaimAction('alice', 'alice')).toBe('refresh');
    expect(pushClaimAction('alice', 'bob')).toBe('replace');
  });

  it('never includes message text in notification copy', () => {
    expect(chatNotificationBody('text')).toBe('傳送了一則新訊息');
    expect(chatNotificationBody('image')).toBe('傳送了一張圖片');
    expect(chatNotificationBody('secret message contents')).not.toContain('secret');
  });
});
