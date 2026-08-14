import {
  loginWithGoogle,
  logout,
  watchAuth,
  type AuthenticatedUser,
} from '../auth/auth.repository';
import type { ChatController } from './chat.controller';
import { applyTheme, preferredTheme, watchSystemTheme } from './theme';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const authView = byId<HTMLElement>('auth-view');
const appView = byId<HTMLElement>('app-view');
const login = byId<HTMLButtonElement>('login-btn');
const logoutButton = byId<HTMLButtonElement>('logout-btn');
const toastRegion = byId<HTMLElement>('toast-region');
let controller: ChatController | undefined;
let generation = 0;

function showError(error: unknown): void {
  const toast = document.createElement('div');
  toast.className = 'toast error';
  toast.textContent = error instanceof Error ? error.message : String(error);
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4500);
}

async function openSignedInApp(user: AuthenticatedUser, expectedGeneration: number): Promise<void> {
  const module = await import('./chat.controller');
  if (expectedGeneration !== generation) return;
  controller ??= module.initializeChatController();
  controller.open(user);
}

export function bootstrap(): void {
  applyTheme(preferredTheme());
  watchSystemTheme(applyTheme);
  login.addEventListener('click', () => void loginWithGoogle().catch(showError));
  logoutButton.addEventListener('click', () => void (async () => {
    logoutButton.disabled = true;
    try {
      await controller?.prepareLogout();
      await logout();
    } finally {
      logoutButton.disabled = false;
    }
  })().catch(showError));
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`).catch(showError);
    navigator.serviceWorker.addEventListener('message', (event) => {
      const requestedRoom = (event.data as { roomId?: unknown } | null)?.roomId;
      if (typeof requestedRoom === 'string') controller?.openRequestedRoom(requestedRoom);
    });
  }
  watchAuth((user) => {
    const expectedGeneration = ++generation;
    if (user) {
      authView.hidden = true;
      appView.hidden = false;
      void openSignedInApp(user, expectedGeneration).catch(showError);
    } else {
      controller?.close();
      authView.hidden = false;
      appView.hidden = true;
    }
  });
}
