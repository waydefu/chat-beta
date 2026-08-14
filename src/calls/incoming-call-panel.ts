import type { IncomingCallSignal } from '../types';

export interface IncomingCallHandlers {
  accept(signal: IncomingCallSignal): void;
  reject(signal: IncomingCallSignal): void;
}

function action(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

export class IncomingCallPanel {
  private readonly root = document.createElement('aside');
  private readonly caller = document.createElement('strong');
  private readonly detail = document.createElement('p');
  private readonly accept = action('接聽', 'incoming-call-action accept');
  private readonly reject = action('拒絕', 'incoming-call-action reject');
  private signal: IncomingCallSignal | null = null;
  private restoreFocus: HTMLElement | null = null;
  private background: HTMLElement | null = null;

  constructor(handlers: IncomingCallHandlers) {
    this.root.className = 'incoming-call-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '對方來電');
    const copy = document.createElement('div');
    copy.className = 'incoming-call-copy';
    this.detail.textContent = '正在來電';
    copy.append(this.caller, this.detail);
    const actions = document.createElement('div');
    actions.className = 'incoming-call-actions';
    actions.append(this.reject, this.accept);
    const card = document.createElement('div');
    card.className = 'incoming-call-card';
    card.append(copy, actions);
    this.root.append(card);
    this.accept.addEventListener('click', () => {
      if (this.signal) handlers.accept(this.signal);
    });
    this.reject.addEventListener('click', () => {
      if (this.signal) handlers.reject(this.signal);
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.signal) {
        event.preventDefault();
        handlers.reject(this.signal);
        return;
      }
      if (event.key === 'Tab') {
        const next = event.shiftKey ? this.accept : this.reject;
        const boundary = event.shiftKey ? this.reject : this.accept;
        if (document.activeElement === boundary) {
          event.preventDefault();
          next.focus();
        }
      }
    });
  }

  show(signal: IncomingCallSignal): void {
    this.signal = signal;
    this.caller.textContent = signal.startedByDisplayName || '聊天室成員';
    this.detail.textContent = signal.kind === 'video' ? '邀請你加入視訊通話' : '邀請你加入語音通話';
    if (!this.root.isConnected) {
      this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.background = document.getElementById('app-view');
      if (this.background) this.background.inert = true;
      document.body.append(this.root);
      this.accept.focus();
    }
  }

  setBusy(busy: boolean): void {
    this.accept.disabled = busy;
    this.reject.disabled = busy;
    this.root.setAttribute('aria-busy', String(busy));
  }

  hide(): void {
    this.signal = null;
    this.root.remove();
    if (this.background) this.background.inert = false;
    this.background = null;
    this.restoreFocus?.focus();
    this.restoreFocus = null;
  }

  destroy(): void {
    this.hide();
  }
}
