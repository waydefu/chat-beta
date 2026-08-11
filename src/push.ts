import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type Messaging,
  type MessagePayload,
} from 'firebase/messaging';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseApp, firestore } from './firebase';

export const PUSH_PREFERENCE_KEY = 'chat-lite:push';

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY ?? '';

let messaging: Messaging | null = null;
let currentToken: string | null = null;
let foregroundUnsub: (() => void) | null = null;

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
    return await isSupported();
  } catch {
    return false;
  }
}

function ensureMessaging(): Messaging {
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
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(ensureMessaging(), {
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
    await deleteToken(ensureMessaging());
  } catch {
    /* the token document is the thing that matters; a failed deleteToken is harmless */
  }
}

/**
 * While a tab is focused the browser suppresses the OS notification, so surface
 * foreground pushes through the in-app toast instead.
 */
export function watchForegroundPush(show: (message: string) => void): void {
  if (!pushConfigured()) return;
  void pushSupported().then((supported) => {
    if (!supported) return;
    foregroundUnsub?.();
    foregroundUnsub = onMessage(ensureMessaging(), (payload: MessagePayload) => {
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
