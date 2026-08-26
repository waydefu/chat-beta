/**
 * The room list, extracted from `app/chat.controller.ts` (TD-U1).
 *
 * Same seam as `messages/message.view.ts`: the controller keeps the state and
 * hands it over as getters, so nothing here reads module state. The two
 * containers are stable `byId()` references and are taken once at construction.
 *
 * Rendering is keyed by room id and updates in place. It used to call
 * `replaceChildren()`, which rebuilt every row on every render -- and `render()`
 * runs inside the `watchAvailableRooms` subscription, so a message in any room
 * rebuilt the whole sidebar. With `.room-item` carrying an entrance animation,
 * that was visible: the list flashed, and each row repainted while it did.
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
  /**
   * Injected for tests, the same seam `bots/grounding.view.ts` uses. Production
   * never passes it.
   */
  doc?: { createElement(tagName: string): HTMLElement };
}

export interface RoomListView {
  render: () => void;
  /** Whether `room` has a last message this client has not read. */
  roomUnread: (room: RoomPreview) => boolean;
}

export function createRoomListView(deps: RoomListDeps): RoomListView {
  // The click handler is bound once per node, so it cannot close over a room
  // object that a later render replaced. It looks the room up instead.
  const shown = new Map<string, RoomPreview>();

  function roomUnread(room: RoomPreview): boolean {
    const latest = room.lastMessage?.id;
    return Boolean(latest && deps.roomState(room.id)?.lastReadMessageId !== latest);
  }

  function previewOf(room: RoomPreview, joined: boolean): string {
    if (joined) return room.lastMessage?.preview || '尚無訊息';
    return room.visibility === 'public' ? '公開房間 · 點擊加入' : '私人房間';
  }

  // Guarded the same way `grounding.view.ts` guards its default: resolving the
  // global eagerly would break every non-DOM test that only calls `roomUnread`.
  const doc = deps.doc
    ?? (typeof document !== 'undefined' ? document : (undefined as unknown as NonNullable<RoomListDeps['doc']>));

  function create(roomId: string): HTMLElement {
    const button = doc.createElement('button') as HTMLButtonElement;
    button.type = 'button';
    button.dataset.roomId = roomId;
    const avatar = doc.createElement('span');
    avatar.className = 'room-initial';
    const copy = doc.createElement('span');
    copy.className = 'room-copy';
    copy.append(doc.createElement('strong'), doc.createElement('span'));
    button.append(avatar, copy);
    button.addEventListener('click', () => {
      const room = shown.get(roomId);
      if (room) deps.onSelect(room);
    });
    return button;
  }

  function apply(button: HTMLElement, room: RoomPreview): void {
    const joined = deps.roomState(room.id)?.membershipStatus === 'active';
    const className = `room-item${room.id === deps.activeRoomId() ? ' active' : ''}`;
    // Assigning an unchanged className is a no-op, but assigning the same value
    // is still cheaper to guard than to let it invalidate style resolution.
    if (button.className !== className) button.className = className;

    const [avatar, copy] = button.children;
    const initial = initialOf(room.name);
    if (avatar && avatar.textContent !== initial) avatar.textContent = initial;

    const [name, preview] = copy?.children ?? [];
    if (name && name.textContent !== room.name) name.textContent = room.name;
    const previewText = previewOf(room, joined);
    if (preview && preview.textContent !== previewText) preview.textContent = previewText;

    const dot = button.querySelector('.unread-dot');
    const wantsDot = joined && roomUnread(room);
    if (wantsDot && !dot) {
      const unread = doc.createElement('span');
      unread.className = 'unread-dot';
      unread.setAttribute('aria-label', '有未讀訊息');
      button.append(unread);
    } else if (!wantsDot && dot) {
      dot.remove();
    }
  }

  function render(): void {
    deps.count.textContent = String(deps.roomCount());

    const existing = new Map<string, HTMLElement>();
    for (const child of deps.list.children) {
      const id = (child as HTMLElement).dataset.roomId;
      if (id) existing.set(id, child as HTMLElement);
    }

    shown.clear();
    // `cursor` walks the nodes already in place. A row that is already where it
    // belongs is left completely alone -- not moved, not re-inserted -- because
    // re-inserting a node is what replays its entrance animation.
    let cursor = deps.list.firstElementChild;
    for (const room of deps.rooms()) {
      shown.set(room.id, room);
      const reused = existing.get(room.id);
      const button = reused ?? create(room.id);
      apply(button, room);
      if (reused) existing.delete(room.id);
      if (button === cursor) {
        cursor = button.nextElementSibling;
      } else {
        deps.list.insertBefore(button, cursor);
      }
    }
    for (const stale of existing.values()) stale.remove();
  }

  return { render, roomUnread };
}
