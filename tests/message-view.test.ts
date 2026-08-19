import { describe, expect, it } from 'vitest';

import { createMessageView, reactionSignatures, textOf, type MessageViewDeps } from '../src/messages/message.view';
import type { ChatMessage, Reaction, RoomCall, RoomReadState } from '../src/types';

/**
 * Covers the parts of `message.view.ts` that do not build DOM. The renderers do,
 * and reaching them needs the injected-document treatment `grounding.view.ts`
 * uses; that refactor is not done yet, so `renderMessage` and its children are
 * exercised only through `pnpm test:e2e`.
 */

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    roomId: 'r1',
    senderId: 'u1',
    senderType: 'user',
    senderDisplayName: 'A',
    kind: 'text',
    text: 'hello',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

function deps(overrides: Partial<MessageViewDeps> = {}): MessageViewDeps {
  return {
    currentUser: () => ({ uid: 'u1' }),
    message: () => undefined,
    messagePosition: () => undefined,
    readStates: () => [],
    reactions: () => [],
    activeCall: () => undefined as RoomCall | undefined,
    callActive: () => false,
    onReply: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onJoinCall: () => {},
    onReact: () => {},
    ...overrides,
  };
}

describe('textOf', () => {
  it('returns the text of a text message', () => {
    expect(textOf(message({ kind: 'text', text: 'hi' }))).toBe('hi');
  });

  it('falls back to the event when a system message has no text', () => {
    expect(textOf(message({ kind: 'system', text: '', event: 'joined' } as Partial<ChatMessage>))).toBe('joined');
  });

  it('distinguishes a started call from an ended one', () => {
    expect(textOf(message({ kind: 'call', event: 'started' } as Partial<ChatMessage>))).toBe('開始了一通電話');
    expect(textOf(message({ kind: 'call', event: 'ended' } as Partial<ChatMessage>))).toBe('通話已結束');
  });

  it('labels a sticker, and falls back to 附件 for an attachment with no text', () => {
    expect(textOf(message({ kind: 'sticker' } as Partial<ChatMessage>))).toBe('貼圖');
    expect(textOf(message({ kind: 'image', text: '' } as Partial<ChatMessage>))).toBe('附件');
  });
});

describe('reactionSignatures', () => {
  const reaction = (messageId: string, userId: string, emoji: string): Reaction =>
    ({ messageId, userId, emoji }) as Reaction;

  it('groups by message', () => {
    const sigs = reactionSignatures([reaction('m1', 'u1', 'a'), reaction('m2', 'u2', 'b')]);
    expect([...sigs.keys()].sort()).toEqual(['m1', 'm2']);
  });

  it('is order-independent, so a reordered snapshot does not look like a change', () => {
    const one = reactionSignatures([reaction('m1', 'u1', 'a'), reaction('m1', 'u2', 'b')]);
    const two = reactionSignatures([reaction('m1', 'u2', 'b'), reaction('m1', 'u1', 'a')]);
    expect(one.get('m1')).toBe(two.get('m1'));
  });

  it('changes when a reaction changes', () => {
    const before = reactionSignatures([reaction('m1', 'u1', 'a')]);
    const after = reactionSignatures([reaction('m1', 'u1', 'b')]);
    expect(before.get('m1')).not.toBe(after.get('m1'));
  });
});

describe('messageReadCount', () => {
  const readState = (lastReadMessageId: string): RoomReadState => ({ lastReadMessageId }) as RoomReadState;

  it('is zero for a message with no position', () => {
    const view = createMessageView(deps());
    expect(view.messageReadCount('m1')).toBe(0);
  });

  it('counts members whose last read is at or past the message', () => {
    const positions = new Map([
      ['m1', 0],
      ['m2', 1],
      ['m3', 2],
    ]);
    const view = createMessageView(
      deps({
        messagePosition: (id) => positions.get(id),
        readStates: () => [readState('m1'), readState('m2'), readState('m3')],
      }),
    );
    expect(view.messageReadCount('m1')).toBe(3);
    expect(view.messageReadCount('m2')).toBe(2);
    expect(view.messageReadCount('m3')).toBe(1);
  });

  it('ignores a member who has read nothing', () => {
    const view = createMessageView(
      deps({
        messagePosition: (id) => (id === 'm1' ? 0 : undefined),
        readStates: () => [{} as RoomReadState],
      }),
    );
    expect(view.messageReadCount('m1')).toBe(0);
  });

  it('reads state through the getter each call, so a room switch is picked up', () => {
    let states: RoomReadState[] = [readState('m1')];
    const view = createMessageView(
      deps({ messagePosition: () => 0, readStates: () => states }),
    );
    expect(view.messageReadCount('m1')).toBe(1);
    states = [];
    expect(view.messageReadCount('m1')).toBe(0);
  });
});
