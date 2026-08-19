/**
 * Transient notifications, extracted from `chat.controller.ts` (TD-U1).
 *
 * The region is a stable `byId()` reference and is taken once. Nothing here
 * reads module state.
 */
const TOAST_LIFETIME_MS = 4500;

export type ToastKind = 'info' | 'error';

export type Toast = (message: string, kind?: ToastKind) => void;

export function createToast(region: HTMLElement): Toast {
  return function toast(message: string, kind: ToastKind = 'info'): void {
    const element = document.createElement('div');
    element.className = `toast${kind === 'error' ? ' error' : ''}`;
    element.textContent = message;
    region.append(element);
    window.setTimeout(() => element.remove(), TOAST_LIFETIME_MS);
  };
}
