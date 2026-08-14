import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Messaging } from 'firebase/messaging';

import { firebaseApp } from '../firebase/app';
import { firestore } from '../firebase/firestore-client';

export const PUSH_PREFERENCE_KEY = 'chat-lite:push';

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY ?? '';

let messaging: Messaging | null = null;
let currentToken: string | null = null;
let foregroundUnsub: (() => void) | null = null;

export interface ForegroundCallNotice {
  roomId: string;
  callId: string;
  kind: 'voice' | 'video';
}

/** Firestore document ids cannot contain '/', which FCM tokens do. */
function tokenDocId(token: string): string {
  return token.replaceAll('/', '_');
}

export function pushConfigured(): boolean {
  return VAPID_KEY.length > 0;
}

/**
 * Push needs the VAPID key, a browser that supports the Notifications and Push
 * APIs, and a service worker. Safari only qualifies once the app is installed to
 * the Home Screen, so this can legitimately be false on a perfectly modern phone.
 */
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

/**
 * Requests permission and registers this browser for push. Returns the reason it
 * could not be enabled, or null on success. Never throws.
 */
export async function enablePush(uid: string): Promise<string | null> {
  if (!pushConfigured()) return '尚未設定推播金鑰（VITE_FCM_VAPID_KEY）。';
  if (!(await pushSupported())) return '這個瀏覽器不支援網頁推播。iOS 需先把網站加到主畫面。';

  if (Notification.permission === 'denied') {
    return '通知權限已被封鎖，請到瀏覽器網站設定重新允許。';
  }
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return '你尚未允許通知權限。';
  }

  try {
    // navigator.serviceWorker.ready never rejects - it waits indefinitely for an
    // active worker. Registration is production-only, so check first rather than
    // hanging the toggle forever wherever no worker exists.
    if (!(await navigator.serviceWorker.getRegistration())) {
      return '此環境沒有註冊 Service Worker，無法啟用推播。';
    }
    const registration = await navigator.serviceWorker.ready;
    const { getToken } = await import('firebase/messaging');
    const token = await getToken(await ensureMessaging(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return '無法取得推播權杖，請稍後再試。';
    currentToken = token;
    await setDoc(doc(firestore, 'users', uid, 'pushTokens', tokenDocId(token)), {
      token,
      updatedAt: serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 300),
    });
    return null;
  } catch (error) {
    return error instanceof Error ? `推播註冊失敗：${error.message}` : '推播註冊失敗。';
  }
}

/** Removes this browser's token so the server stops targeting it. */
export async function disablePush(uid: string): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (!token) return;
  try {
    await deleteDoc(doc(firestore, 'users', uid, 'pushTokens', tokenDocId(token)));
    const { deleteToken } = await import('firebase/messaging');
    await deleteToken(await ensureMessaging());
  } catch {
    /* the token document is the thing that matters; a failed deleteToken is harmless */
  }
}

/**
 * While a tab is focused the browser suppresses the OS notification, so surface
 * foreground pushes through the in-app toast instead.
 */
export function watchForegroundPush(
  show: (message: string) => void,
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
      const title = payload.notification?.title ?? payload.data?.title ?? '新訊息';
      const body = payload.notification?.body ?? payload.data?.body ?? '';
      show(body ? `${title}：${body}` : title);
    });
  });
}

export function stopForegroundPush(): void {
  foregroundUnsub?.();
  foregroundUnsub = null;
  currentToken = null;
}

export async function configuredPushState(uid: string): Promise<{
  supported: boolean;
  enabled: boolean;
  error: string | null;
}> {
  const supported = await pushSupported();
  if (!supported) return { supported, enabled: false, error: null };
  const preferred = localStorage.getItem(PUSH_PREFERENCE_KEY) === 'true';
  const enabled = preferred && Notification.permission === 'granted';
  const error = enabled ? await enablePush(uid) : null;
  return { supported, enabled: enabled && !error, error };
}

export async function setPushPreference(uid: string, enabled: boolean): Promise<string | null> {
  const error = enabled ? await enablePush(uid) : (await disablePush(uid), null);
  localStorage.setItem(PUSH_PREFERENCE_KEY, String(enabled && !error));
  return error;
}
