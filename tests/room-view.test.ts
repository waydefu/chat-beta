import { describe, expect, it } from 'vitest';

import { createRoomListView, type RoomListDeps } from '../src/rooms/room.view';
import type { RoomPreview, RoomReadState } from '../src/types';
import { createElement, createMiniDocument, outline, type MiniElement } from './helpers/mini-dom';

/**
 * `roomUnread` is pure. `render()` builds DOM, and now reaches it through the
 * injected-document seam `grounding.view.ts` established, with `mini-dom` on
 * the other end.
 *
 * The identity assertions are the point of the file. Comparing rendered text
 * cannot distinguish a reused node from a recreated one, and recreating is the
 * defect: `.room-item` carries an entrance animation, so a rebuilt row replays
 * it, and `render()` runs on every room subscription event.
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

interface Harness {
  render: () => void;
  list: MiniElement;
  rows: () => MiniElement[];
  ids: () => Array<string | undefined>;
  selected: string[];
}

function harness(overrides: Partial<RoomListDeps> = {}): Harness {
  const list = createElement('div');
  const count = createElement('span');
  const selected: string[] = [];
  const view = createRoomListView(deps({
    list: list as unknown as HTMLElement,
    count: count as unknown as HTMLElement,
    doc: createMiniDocument(),
    onSelect: (room) => selected.push(room.id),
    ...overrides,
  }));
  return {
    render: view.render,
    list,
    rows: () => list.children,
    ids: () => list.children.map((child) => child.dataset.roomId),
    selected,
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

describe('render keeps rows rather than rebuilding them', () => {
  it('reuses the same node when nothing about the room changed', () => {
    const rooms: RoomPreview[] = [room({ id: 'a', name: 'A' }), room({ id: 'b', name: 'B' })];
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length });

    view.render();
    const before = [...view.rows()];
    view.render();

    // Identity, not equality. `toEqual` would pass against a full rebuild.
    expect(view.rows()[0]).toBe(before[0]);
    expect(view.rows()[1]).toBe(before[1]);
  });

  it('reuses the node when only the preview changed', () => {
    let rooms: RoomPreview[] = [room({ id: 'a', name: 'A' })];
    const view = harness({
      rooms: () => rooms,
      roomCount: () => rooms.length,
      roomState: () => ({ membershipStatus: 'active' }) as RoomReadState,
    });

    view.render();
    const before = view.rows()[0];
    rooms = [room({ id: 'a', name: 'A', lastMessage: { id: 'm9', preview: '新訊息' } } as Partial<RoomPreview>)];
    view.render();

    // This is the case that used to flash the whole sidebar: a message arriving
    // in any room re-ran render(), which rebuilt every row.
    expect(view.rows()[0]).toBe(before);
    expect(outline(view.rows()[0]!)[1]?.text).toBe('A|新訊息');
  });

  it('adds only the new row when a room appears', () => {
    let rooms: RoomPreview[] = [room({ id: 'a', name: 'A' })];
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length });

    view.render();
    const first = view.rows()[0];
    rooms = [room({ id: 'a', name: 'A' }), room({ id: 'b', name: 'B' })];
    view.render();

    expect(view.rows()).toHaveLength(2);
    expect(view.rows()[0]).toBe(first);
    expect(view.rows()[1]).not.toBe(first);
  });

  it('removes the row for a room that went away, and keeps the rest', () => {
    let rooms: RoomPreview[] = [room({ id: 'a' }), room({ id: 'b' }), room({ id: 'c' })];
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length });

    view.render();
    const [a, , c] = [...view.rows()];
    rooms = [room({ id: 'a' }), room({ id: 'c' })];
    view.render();

    expect(view.ids()).toEqual(['a', 'c']);
    expect(view.rows()[0]).toBe(a);
    expect(view.rows()[1]).toBe(c);
  });

  it('reorders by moving the existing nodes, not by making new ones', () => {
    let rooms: RoomPreview[] = [room({ id: 'a' }), room({ id: 'b' }), room({ id: 'c' })];
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length });

    view.render();
    const [a, b, c] = [...view.rows()];
    rooms = [room({ id: 'c' }), room({ id: 'a' }), room({ id: 'b' })];
    view.render();

    expect(view.ids()).toEqual(['c', 'a', 'b']);
    expect(view.rows()).toEqual([c, a, b]);
  });

  it('tracks the active room without replacing the row', () => {
    const rooms = [room({ id: 'a' }), room({ id: 'b' })];
    let active = 'a';
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length, activeRoomId: () => active });

    view.render();
    const [a, b] = [...view.rows()];
    expect(a?.className).toBe('room-item active');
    active = 'b';
    view.render();

    expect(a?.className).toBe('room-item');
    expect(b?.className).toBe('room-item active');
    expect(view.rows()).toEqual([a, b]);
  });

  it('adds and removes the unread dot in place', () => {
    const rooms = [room({ id: 'a', lastMessage: { id: 'm2' } } as Partial<RoomPreview>)];
    let read = 'm1';
    const view = harness({
      rooms: () => rooms,
      roomCount: () => rooms.length,
      roomState: () => ({ membershipStatus: 'active', lastReadMessageId: read }) as RoomReadState,
    });

    view.render();
    const row = view.rows()[0];
    expect(row?.querySelector('.unread-dot')).not.toBeNull();

    read = 'm2';
    view.render();
    expect(view.rows()[0]).toBe(row);
    expect(row?.querySelector('.unread-dot')).toBeNull();
  });

  it('selects the current room object, not the one captured when the row was built', () => {
    let rooms = [room({ id: 'a', name: 'A' })];
    const view = harness({ rooms: () => rooms, roomCount: () => rooms.length });

    view.render();
    const row = view.rows()[0];
    rooms = [room({ id: 'a', name: 'A renamed' })];
    view.render();
    row?.dispatch('click');

    // The listener is bound once at creation, so it must look the room up
    // rather than close over the object it was built with.
    expect(view.selected).toEqual(['a']);
  });

  it('keeps the count badge in step', () => {
    let rooms = [room({ id: 'a' })];
    const list = createElement('div');
    const count = createElement('span');
    const view = createRoomListView(deps({
      list: list as unknown as HTMLElement,
      count: count as unknown as HTMLElement,
      doc: createMiniDocument(),
      rooms: () => rooms,
      roomCount: () => rooms.length,
    }));

    view.render();
    expect(count.textContent).toBe('1');
    rooms = [room({ id: 'a' }), room({ id: 'b' })];
    view.render();
    expect(count.textContent).toBe('2');
  });
});
