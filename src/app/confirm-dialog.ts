/**
 * The confirmation dialog, extracted from `chat.controller.ts` (TD-U1).
 *
 * The elements are stable `byId()` references and are taken once. The returned
 * promise resolves on the dialog's own `close` event, so dismissing it any way
 * the platform allows — Escape included — resolves false rather than hanging.
 */
export interface ConfirmDialogElements {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  copy: HTMLElement;
  action: HTMLElement;
}

export type ShowConfirm = (title: string, copy: string, action?: string) => Promise<boolean>;

export function createConfirmDialog(elements: ConfirmDialogElements): ShowConfirm {
  return function showConfirm(title: string, copy: string, action = '確認'): Promise<boolean> {
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.title.textContent = title;
    elements.copy.textContent = copy;
    elements.action.textContent = action;
    const focusable = [...elements.dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!elements.dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    elements.dialog.addEventListener('keydown', trapFocus);
    elements.dialog.showModal();
    focusable[0]?.focus();
    return new Promise((resolve) => {
      elements.dialog.addEventListener('close', () => {
        elements.dialog.removeEventListener('keydown', trapFocus);
        restoreFocus?.focus();
        resolve(elements.dialog.returnValue === 'confirm');
      }, {
        once: true,
      });
    });
  };
}
