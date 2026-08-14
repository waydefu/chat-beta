export const OFFLINE_PREFERENCE_KEY = 'chat-lite:trusted-offline';
export const OFFLINE_REVOKE_PENDING_KEY = 'chat-lite:trusted-offline-revoke-pending';
export const OFFLINE_RESULT_KEY = 'chat-lite:trusted-offline-result';
export const OFFLINE_POLICY_VERSION_KEY = 'chat-lite:trusted-offline-policy-v2';

export interface OfflineStartupState {
  preferred: boolean;
  persistent: boolean;
  revocationPending: boolean;
}

export function offlineStartupState(
  preference: string | null,
  pending: string | null,
  policyVersion: string | null = 'complete',
): OfflineStartupState {
  const preferred = preference === 'true';
  const legacyDisabledCacheMayExist = preference === 'false' && policyVersion !== 'complete';
  const revocationPending = pending === 'true' || legacyDisabledCacheMayExist;
  return {
    preferred,
    persistent: preferred && !revocationPending,
    revocationPending,
  };
}
