/**
 * The room list, extracted from `app/chat.controller.ts` (TD-U1).
 *
 * Same seam as `messages/message.view.ts`: the controller keeps the state and
 * hands it over as getters, so nothing here reads module state. The two
 * containers are stable `byId()` references and are taken once at construction.
 */
import type { RoomPreview, RoomReadState } from '../types';
import { initialOf } from '../utils';

export interface RoomListDeps {
  /** The `#room-list` container. */
  list: HTMLElement;
  /** The `#room-count` badge. */
  count: HTMLElement;
  /** Rooms in display order. */
  rooms: () => Iterable<RoomPreview>;
  /** How many rooms there are, for the badge. */
  roomCount: () => number;
  /** This client's read and membership state for a room. */
  roomState: (roomId: string) => RoomReadState | undefined;
  /** The open room, which renders as active. */
  activeRoomId: () => string;
  onSelect: (room: RoomPreview) => void;
}

export interface RoomListView {
  render: () => void;
  /** Whether `room` has a last message this client has not read. */
  roomUnread: (room: RoomPreview) => boolean;
}

export function createRoomListView(deps: RoomListDeps): RoomListView {
  function roomUnread(room: RoomPreview): boolean {
    const latest = room.lastMessage?.id;
    return Boolean(latest && deps.roomState(room.id)?.lastReadMessageId !== latest);
  }

  function render(): void {
    deps.list.replaceChildren();
    deps.count.textContent = String(deps.roomCount());
    for (const room of deps.rooms()) {
      const joined = deps.roomState(room.id)?.membershipStatus === 'active';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `room-item${room.id === deps.activeRoomId() ? ' active' : ''}`;
      button.dataset.roomId = room.id;
      const avatar = document.createElement('span');
      avatar.className = 'room-initial';
      avatar.textContent = initialOf(room.name);
      const copy = document.createElement('span');
      copy.className = 'room-copy';
      const name = document.createElement('strong');
      name.textContent = room.name;
      const preview = document.createElement('span');
      preview.textContent = joined
        ? room.lastMessage?.preview || '尚無訊息'
        : room.visibility === 'public'
          ? '公開房間 · 點擊加入'
          : '私人房間';
      copy.append(name, preview);
      button.append(avatar, copy);
      if (joined && roomUnread(room)) {
        const unread = document.createElement('span');
        unread.className = 'unread-dot';
        unread.setAttribute('aria-label', '有未讀訊息');
        button.append(unread);
      }
      button.addEventListener('click', () => deps.onSelect(room));
      deps.list.append(button);
    }
  }

  return { render, roomUnread };
}
