/**
 * The online-member list and the connection indicator, extracted from
 * `app/chat.controller.ts` (TD-U1).
 *
 * Same seam as `messages/message.view.ts` and `rooms/room.view.ts`: state
 * arrives as getters, containers are taken once. Nothing here subscribes —
 * the controller still owns the presence subscription and calls `render()`.
 */
import type { OnlineUser } from '../types';
import { initialOf } from '../utils';
import { connectionStatusView, type RealtimeConnectionState } from './connection-status';
import { presenceSummary } from './presence-state';

const STATUS_DOT_CLASS: Record<string, string> = {
  online: 'status-dot online',
  pending: 'status-dot pending',
  offline: 'status-dot offline',
  down: 'status-dot down',
};

export interface PresenceViewDeps {
  /** The `#presence-list` container. */
  list: HTMLElement;
  /** The `#presence-count` label. */
  count: HTMLElement;
  /** Members currently online in the open room. */
  onlineUsers: () => readonly OnlineUser[];
  /** False before a room is open, which changes the summary wording. */
  hasRoom: () => boolean;
}

export interface PresenceView {
  render: () => void;
}

export function createPresenceView(deps: PresenceViewDeps): PresenceView {
  function render(): void {
    deps.list.replaceChildren();
    const users = deps.onlineUsers();
    deps.count.textContent = presenceSummary(users.length, deps.hasRoom());
    for (const online of users) {
      const item = document.createElement('div');
      item.className = 'presence-item';
      const avatar = document.createElement('span');
      avatar.className = 'presence-avatar';
      avatar.textContent = initialOf(online.displayName);
      const copy = document.createElement('span');
      copy.className = 'presence-copy';
      const name = document.createElement('strong');
      name.textContent = online.displayName;
      const status = document.createElement('span');
      status.textContent = '在線';
      copy.append(name, status);
      item.append(avatar, copy);
      deps.list.append(item);
    }
  }

  return { render };
}

/**
 * Render the connection dot and label into `target`.
 *
 * Standalone rather than part of the factory: it needs no controller state
 * beyond the value it is given.
 */
export function renderConnectionStatus(target: HTMLElement, state: RealtimeConnectionState): void {
  const view = connectionStatusView(state);
  const dot = document.createElement('span');
  dot.className = STATUS_DOT_CLASS[view.tone] ?? 'status-dot';
  dot.setAttribute('aria-hidden', 'true');
  target.replaceChildren(dot, document.createTextNode(view.label));
}
