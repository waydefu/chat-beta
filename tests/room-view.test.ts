import { describe, expect, it } from 'vitest';

import { createRoomListView, type RoomListDeps } from '../src/rooms/room.view';
import type { RoomPreview, RoomReadState } from '../src/types';

/**
 * Covers `roomUnread`, the only logic in `room.view.ts` that does not build
 * DOM. `render()` does, and reaching it needs the injected-document treatment
 * `grounding.view.ts` uses; until that exists it is exercised by
 * `pnpm test:e2e`.
 *
 * The containers are never touched by these tests, so a bare object stands in.
 */
const container = {} as HTMLElement;

function deps(overrides: Partial<RoomListDeps> = {}): RoomListDeps {
  return {
    list: container,
    count: container,
    rooms: () => [],
    roomCount: () => 0,
    roomState: () => undefined,
    activeRoomId: () => '',
    onSelect: () => {},
    ...overrides,
  };
}

const room = (overrides: Partial<RoomPreview> = {}): RoomPreview =>
  ({ id: 'r1', name: 'Room', visibility: 'public', ...overrides }) as RoomPreview;

const state = (lastReadMessageId?: string): RoomReadState => ({ lastReadMessageId }) as RoomReadState;

describe('roomUnread', () => {
  it('is false for a room with no messages', () => {
    const view = createRoomListView(deps());
    expect(view.roomUnread(room())).toBe(false);
  });

  it('is true when the latest message has not been read', () => {
    const view = createRoomListView(deps({ roomState: () => state('m1') }));
    expect(view.roomUnread(room({ lastMessage: { id: 'm2' } } as Partial<RoomPreview>))).toBe(true);
  });

  it('is false once the latest message is the one last read', () => {
    const view = createRoomListView(deps({ roomState: () => state('m2') }));
    expect(view.roomUnread(room({ lastMessage: { id: 'm2' } } as Partial<RoomPreview>))).toBe(false);
  });

  it('is true when the room has a message but no read state at all', () => {
    const view = createRoomListView(deps({ roomState: () => undefined }));
    expect(view.roomUnread(room({ lastMessage: { id: 'm1' } } as Partial<RoomPreview>))).toBe(true);
  });

  it('reads state through the getter each call, so a fresh read is picked up', () => {
    let current = state('m1');
    const view = createRoomListView(deps({ roomState: () => current }));
    const target = room({ lastMessage: { id: 'm2' } } as Partial<RoomPreview>);
    expect(view.roomUnread(target)).toBe(true);
    current = state('m2');
    expect(view.roomUnread(target)).toBe(false);
  });
});
