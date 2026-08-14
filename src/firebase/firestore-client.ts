import {
  clearIndexedDbPersistence,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  waitForPendingWrites,
} from 'firebase/firestore';

import { firebaseApp } from './app';
import {
  OFFLINE_PREFERENCE_KEY,
  OFFLINE_POLICY_VERSION_KEY,
  OFFLINE_RESULT_KEY,
  OFFLINE_REVOKE_PENDING_KEY,
  offlineStartupState,
} from './offline-policy';

export {
  OFFLINE_POLICY_VERSION_KEY,
  OFFLINE_PREFERENCE_KEY,
  OFFLINE_RESULT_KEY,
  OFFLINE_REVOKE_PENDING_KEY,
} from './offline-policy';

const startup = offlineStartupState(
  localStorage.getItem(OFFLINE_PREFERENCE_KEY),
  localStorage.getItem(OFFLINE_REVOKE_PENDING_KEY),
  localStorage.getItem(OFFLINE_POLICY_VERSION_KEY),
);

export const firestore = initializeFirestore(firebaseApp, {
  localCache: startup.persistent
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
});
export const persistentCacheEnabled = startup.persistent;
export const offlineRevocationPending = startup.revocationPending;

export type OfflineRevocationResult = 'cleared' | 'blocked-by-other-tabs' | 'offline' | 'failed';

export function enableTrustedOfflineCache(): void {
  localStorage.setItem(OFFLINE_PREFERENCE_KEY, 'true');
  localStorage.setItem(OFFLINE_POLICY_VERSION_KEY, 'complete');
  localStorage.removeItem(OFFLINE_REVOKE_PENDING_KEY);
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

/**
 * The caller must stop room/session listeners first. We flush acknowledged
 * writes before changing the startup mode, then clear only after termination.
 */
export async function revokeTrustedOfflineCache(): Promise<OfflineRevocationResult> {
  if (!navigator.onLine) return 'offline';
  try {
    await waitForPendingWrites(firestore);
  } catch {
    return 'failed';
  }
  localStorage.setItem(OFFLINE_PREFERENCE_KEY, 'false');
  localStorage.setItem(OFFLINE_REVOKE_PENDING_KEY, 'true');
  try {
    await terminate(firestore);
  } catch {
    return 'failed';
  }
  try {
    await clearIndexedDbPersistence(firestore);
    localStorage.removeItem(OFFLINE_REVOKE_PENDING_KEY);
    localStorage.setItem(OFFLINE_POLICY_VERSION_KEY, 'complete');
    return 'cleared';
  } catch (error) {
    return errorCode(error).endsWith('failed-precondition') ? 'blocked-by-other-tabs' : 'failed';
  }
}

export function storeOfflineRevocationResult(result: OfflineRevocationResult): void {
  sessionStorage.setItem(OFFLINE_RESULT_KEY, result);
}

export function consumeOfflineRevocationResult(): OfflineRevocationResult | null {
  const value = sessionStorage.getItem(OFFLINE_RESULT_KEY);
  sessionStorage.removeItem(OFFLINE_RESULT_KEY);
  return value === 'cleared' || value === 'blocked-by-other-tabs' || value === 'offline' || value === 'failed'
    ? value
    : null;
}
