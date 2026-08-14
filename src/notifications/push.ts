import type { Messaging } from 'firebase/messaging';

import { callFunction } from '../firebase/callables';
import { firebaseApp } from '../firebase/app';

export const PUSH_PREFERENCE_KEY = 'chat-lite:push';
const PUSH_OWNERSHIP_MIGRATION_KEY = 'chat-lite:push-owner-v1';
const PUSH_TOKEN_HASH_KEY = 'chat-lite:push-token-hash-v1';
const PUSH_CALLABLE_OPTIONS = { limitedUseAppCheckTokens: true } as const;
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY ?? '';

let messaging: Messaging | null = null;
let currentRegistration: { uid: string; token: string; tokenHash: string } | null = null;
let foregroundUnsub: (() => void) | null = null;

export interface ForegroundCallNotice {
  roomId: string;
  callId: string;
  kind: 'voice' | 'video';
}

export interface ForegroundChatNotice {
  roomId: string;
  title: string;
  body: string;
}

export function pushConfigured(): boolean {
  return VAPID_KEY.length > 0;
}

export async function pushSupported(): Promise<boolean> {
  if (!pushConfigured()) return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    const { isSupported } = await import('firebase/messaging');
    return await isSupported();
  } catch {
    return false;
  }
}

async function ensureMessaging(): Promise<Messaging> {
  const { getMessaging } = await import('firebase/messaging');
  messaging ??= getMessaging(firebaseApp);
  return messaging;
}

async function getBrowserToken(): Promise<string | null> {
  if (!(await navigator.serviceWorker.getRegistration())) return null;
  const registration = await navigator.serviceWorker.ready;
  const { getToken } = await import('firebase/messaging');
  return await getToken(await ensureMessaging(), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }) || null;
}

async function claimBrowserToken(uid: string, token: string): Promise<void> {
  const previousTokenHash = localStorage.getItem(PUSH_TOKEN_HASH_KEY) ?? undefined;
  const result = await callFunction<{
    token: string;
    userAgent: string;
    previousTokenHash?: string;
  }, { tokenHash: string }>('claimPushToken', {
    token,
    userAgent: navigator.userAgent.slice(0, 300),
    ...(previousTokenHash ? { previousTokenHash } : {}),
  }, PUSH_CALLABLE_OPTIONS);
  currentRegistration = { uid, token, tokenHash: result.tokenHash };
  localStorage.setItem(PUSH_TOKEN_HASH_KEY, result.tokenHash);
}

async function releaseServerToken(input: { token?: string; tokenHash?: string }): Promise<{ released: boolean }> {
  return await callFunction('releasePushToken', input, PUSH_CALLABLE_OPTIONS);
}

/**
 * A logout is safe when either the canonical server claim is removed or the
 * browser token is invalidated. Only a double failure blocks the transition.
 */
async function discardBrowserToken(uid: string, token: string): Promise<void> {
  const [server, browser] = await Promise.allSettled([
    releaseServerToken({ token }),
    import('firebase/messaging').then(async ({ deleteToken }) => deleteToken(await ensureMessaging())),
  ]);
  const browserInvalidated = browser.status === 'fulfilled' && browser.value;
  if (server.status === 'rejected' && !browserInvalidated) {
    throw new Error('無法安全移除推播權杖，請確認網路後再試。');
  }
  if (currentRegistration?.uid === uid && currentRegistration.token === token) currentRegistration = null;
  localStorage.removeItem(PUSH_TOKEN_HASH_KEY);
}

export async function enablePush(uid: string): Promise<string | null> {
  if (!pushConfigured()) return '尚未設定推播金鑰（VITE_FCM_VAPID_KEY）。';
  if (!(await pushSupported())) return '這個瀏覽器不支援網頁推播。iOS 需先把網站加到主畫面。';
  if (Notification.permission === 'denied') return '通知權限已被封鎖，請到瀏覽器網站設定重新允許。';
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return '你尚未允許通知權限。';
  }

  try {
    const token = await getBrowserToken();
    if (!token) return '此環境沒有可用的 Service Worker，無法啟用推播。';
    const prior = currentRegistration;
    if (prior && prior.uid === uid && prior.token !== token) await releaseServerToken({ token: prior.token });
    await claimBrowserToken(uid, token);
    return null;
  } catch (error) {
    return error instanceof Error ? `推播註冊失敗：${error.message}` : '推播註冊失敗。';
  }
}

/** Removes both the canonical ownership claim and this browser's FCM token. */
export async function disablePush(uid: string): Promise<void> {
  let token = currentRegistration?.uid === uid ? currentRegistration.token : null;
  if (!token && 'Notification' in window && Notification.permission === 'granted' && await pushSupported()) {
    token = await getBrowserToken();
  }
  if (token) {
    await discardBrowserToken(uid, token);
    return;
  }
  const tokenHash = localStorage.getItem(PUSH_TOKEN_HASH_KEY);
  if (tokenHash) {
    await releaseServerToken({ tokenHash });
    localStorage.removeItem(PUSH_TOKEN_HASH_KEY);
  }
}

export async function releasePushForLogout(uid: string): Promise<void> {
  await disablePush(uid);
}

export function watchForegroundPush(
  onChat: (notice: ForegroundChatNotice) => void,
  onCall?: (notice: ForegroundCallNotice) => void,
): void {
  if (!pushConfigured()) return;
  void pushSupported().then(async (supported) => {
    if (!supported) return;
    foregroundUnsub?.();
    const { onMessage } = await import('firebase/messaging');
    foregroundUnsub = onMessage(await ensureMessaging(), (payload) => {
      if (payload.data?.type === 'call' && payload.data.roomId && payload.data.callId) {
        onCall?.({
          roomId: payload.data.roomId,
          callId: payload.data.callId,
          kind: payload.data.kind === 'video' ? 'video' : 'voice',
        });
        return;
      }
      onChat({
        roomId: payload.data?.roomId ?? '',
        title: payload.notification?.title ?? payload.data?.title ?? '新訊息',
        body: payload.notification?.body ?? payload.data?.body ?? '',
      });
    });
  });
}

export function stopForegroundPush(): void {
  foregroundUnsub?.();
  foregroundUnsub = null;
}

export async function configuredPushState(uid: string): Promise<{
  supported: boolean;
  enabled: boolean;
  error: string | null;
}> {
  const supported = await pushSupported();
  if (!supported) return { supported, enabled: false, error: null };
  const preferred = localStorage.getItem(PUSH_PREFERENCE_KEY) === 'true';
  if (preferred && Notification.permission === 'denied') {
    try {
      await disablePush(uid);
      localStorage.setItem(PUSH_PREFERENCE_KEY, 'false');
      return { supported, enabled: false, error: '通知權限已撤銷，這個瀏覽器的伺服器權杖已停用。' };
    } catch (error) {
      return { supported, enabled: false, error: error instanceof Error ? error.message : '撤銷推播權杖失敗。' };
    }
  }
  if (!preferred && Notification.permission === 'granted'
    && localStorage.getItem(PUSH_OWNERSHIP_MIGRATION_KEY) !== 'complete') {
    try {
      await disablePush(uid);
      localStorage.setItem(PUSH_OWNERSHIP_MIGRATION_KEY, 'complete');
    } catch (error) {
      return { supported, enabled: false, error: error instanceof Error ? error.message : '舊推播權杖清理失敗。' };
    }
  }
  const enabled = preferred && Notification.permission === 'granted';
  const error = enabled ? await enablePush(uid) : null;
  return { supported, enabled: enabled && !error, error };
}

export async function setPushPreference(uid: string, enabled: boolean): Promise<string | null> {
  try {
    const error = enabled ? await enablePush(uid) : (await disablePush(uid), null);
    localStorage.setItem(PUSH_PREFERENCE_KEY, String(enabled && !error));
    return error;
  } catch (error) {
    return error instanceof Error ? error.message : '推播設定失敗。';
  }
}
