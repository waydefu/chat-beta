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
    elements.title.textContent = title;
    elements.copy.textContent = copy;
    elements.action.textContent = action;
    elements.dialog.showModal();
    return new Promise((resolve) => {
      elements.dialog.addEventListener('close', () => resolve(elements.dialog.returnValue === 'confirm'), {
        once: true,
      });
    });
  };
}
