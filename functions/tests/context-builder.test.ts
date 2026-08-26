import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirestoreFake, timestamp } from './helpers/firestore-fake.js';

const fake = createFirestoreFake();

vi.mock('../src/admin.js', () => ({
  get firestore() {
    return fake.firestore;
  },
  database: {},
}));

const { buildBotContext } = await import('../src/bots/context-builder.js');

const ROOM = 'room-1';
const REQUESTER = 'user-1';
const SOURCE_ID = 'msg-source';
const BOT_ID = 'gemini';

const BOT_MENTION = [{ type: 'bot', id: BOT_ID }];

function messagePath(id: string, roomId = ROOM): string {
  return `rooms/${roomId}/messages/${id}`;
}

function seedSource(overrides: Record<string, unknown> = {}): void {
  fake.seed(messagePath(SOURCE_ID), {
    senderId: REQUESTER,
    senderType: 'user',
    senderDisplayName: '提問者',
    text: '@gemini 幫我看看',
    mentions: BOT_MENTION,
    createdAt: timestamp(1_000_000),
    ...overrides,
  });
}

function seedMessage(id: string, createdAt: number, overrides: Record<string, unknown> = {}): void {
  fake.seed(messagePath(id), {
    senderId: 'user-2',
    senderType: 'user',
    senderDisplayName: '同房成員',
    text: `內容 ${id}`,
    createdAt: timestamp(createdAt),
    ...overrides,
  });
}

beforeEach(() => {
  fake.reset();
});

describe('source-message authorization', () => {
  it('refuses when the source message does not exist', async () => {
    await expect(buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('refuses when the requester did not send the source message', async () => {
    seedSource({ senderId: 'someone-else' });

    await expect(buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('refuses when the source message is not a user message', async () => {
    seedSource({ senderType: 'bot' });

    await expect(buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it.each([
    ['no mentions array', {}],
    ['an unstructured mention', { mentions: ['@gemini'] }],
    ['a mention of a different bot', { mentions: [{ type: 'bot', id: 'other-bot' }] }],
    ['a user mention that merely looks like one', { mentions: [{ type: 'user', id: BOT_ID }] }],
  ])('refuses on %s', async (_label, overrides) => {
    seedSource({ mentions: undefined, ...overrides });

    await expect(buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('returns the source text as the prompt', async () => {
    seedSource();

    const { prompt } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(prompt).toBe('@gemini 幫我看看');
  });
});

describe('context selection', () => {
  it('takes the twenty most recent messages by default', async () => {
    seedSource({ createdAt: timestamp(31_000) });
    for (let index = 1; index <= 30; index += 1) {
      seedMessage(`m${String(index).padStart(2, '0')}`, index * 1_000);
    }

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    // The desc-limit-20 window holds the source plus the nineteen before it.
    expect(context).toHaveLength(19);
    expect(context.at(0)?.text).toBe('內容 m12');
    expect(context.at(-1)?.text).toBe('內容 m30');
  });

  it.each(['整理', '摘要', '總結', '今天', '剛才'])(
    'widens the window when the prompt contains %s',
    async (keyword) => {
      seedSource({ text: `@gemini ${keyword}一下`, createdAt: timestamp(31_000) });
      for (let index = 1; index <= 30; index += 1) {
        seedMessage(`m${String(index).padStart(2, '0')}`, index * 1_000);
      }

      const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

      expect(context).toHaveLength(30);
    },
  );

  it('orders context oldest first and breaks ties by id', async () => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('b-later', 2_000);
    seedMessage('a-tied', 1_000);
    seedMessage('b-tied', 1_000);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual([
      '內容 a-tied',
      '內容 b-tied',
      '內容 b-later',
    ]);
  });

  it.each([
    ['deleted messages', { deletedAt: timestamp(5_000) }],
    ['system messages', { senderType: 'system' }],
    ['call messages', { senderType: 'call' }],
    ['messages with no text', { text: '' }],
    ['messages whose text is not a string', { text: { body: 'nope' } }],
  ])('excludes %s', async (_label, overrides) => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('kept', 1_000);
    seedMessage('dropped', 2_000, overrides);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual(['內容 kept']);
  });

  it('never includes the source message itself', async () => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('other', 1_000);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.some((message) => message.text === '@gemini 幫我看看')).toBe(false);
  });

  it('keeps bot replies in context and labels them by display name', async () => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('bot-reply', 1_000, { senderType: 'bot', senderDisplayName: 'Gemini' });

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context).toEqual([{ sender: 'Gemini', text: '內容 bot-reply' }]);
  });

  it('falls back to the sender type when there is no display name', async () => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('anon', 1_000, { senderDisplayName: '' });

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.at(0)?.sender).toBe('user');
  });

  it('never crosses a room boundary', async () => {
    seedSource({ createdAt: timestamp(9_000) });
    seedMessage('mine', 1_000);
    fake.seed(messagePath('theirs', 'room-2'), {
      senderId: 'user-9',
      senderType: 'user',
      senderDisplayName: '別房',
      text: '別房的秘密',
      createdAt: timestamp(8_000),
    });

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual(['內容 mine']);
  });
});

describe('reply context', () => {
  it('pulls in the reply target and the messages after it', async () => {
    seedSource({ replyToId: 'old-target', createdAt: timestamp(31_000) });
    for (let index = 1; index <= 30; index += 1) {
      seedMessage(`m${String(index).padStart(2, '0')}`, index * 1_000);
    }
    // Far older than the default twenty-message window.
    seedMessage('old-target', 500);
    seedMessage('old-neighbour', 400);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    const texts = context.map((message) => message.text);
    expect(texts).toContain('內容 old-target');
    expect(texts).toContain('內容 m01');
    expect(texts).toContain('內容 m04');
  });

  it('does not reach the messages before the reply target (TD-A6)', async () => {
    seedSource({ replyToId: 'old-target', createdAt: timestamp(31_000) });
    for (let index = 1; index <= 30; index += 1) {
      seedMessage(`m${String(index).padStart(2, '0')}`, index * 1_000);
    }
    seedMessage('old-target', 500);
    seedMessage('old-neighbour', 400);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);
    const texts = context.map((message) => message.text);

    // This pins a defect, not a decision. The "before" half of the neighbour
    // lookup is `orderBy('createdAt','desc').endAt(target).limit(5)`. Descending,
    // `endAt` makes the result set run newest -> target, so `limit(5)` returns
    // the five NEWEST messages in the room rather than the five preceding the
    // target. Those are already in the recent window, so the query contributes
    // nothing and the message immediately before the target is never fetched.
    // Registered as TD-A6; flip both assertions when it is fixed.
    expect(texts).not.toContain('內容 old-neighbour');
    expect(texts).toContain('內容 m30');
  });

  it('holds the total at the window size, letting the reply target displace recents', async () => {
    seedSource({ replyToId: 'old-target', createdAt: timestamp(31_000) });
    for (let index = 1; index <= 30; index += 1) {
      seedMessage(`m${String(index).padStart(2, '0')}`, index * 1_000);
    }
    seedMessage('old-target', 500);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    // Priority entries are seeded first and recents fill the remainder, so the
    // reply target is never dropped in favour of a newer message.
    expect(context.length).toBeLessThanOrEqual(20);
    expect(context.map((message) => message.text)).toContain('內容 old-target');
  });

  it('ignores a reply target that no longer exists', async () => {
    seedSource({ replyToId: 'deleted-forever', createdAt: timestamp(9_000) });
    seedMessage('kept', 1_000);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual(['內容 kept']);
  });

  it('ignores a reply target that has no timestamp', async () => {
    seedSource({ replyToId: 'no-clock', createdAt: timestamp(9_000) });
    seedMessage('kept', 1_000);
    fake.seed(messagePath('no-clock'), {
      senderId: 'user-2',
      senderType: 'user',
      senderDisplayName: '同房成員',
      text: '內容 no-clock',
    });

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual(['內容 kept']);
  });

  it('ignores an empty replyToId without querying for it', async () => {
    seedSource({ replyToId: '', createdAt: timestamp(9_000) });
    seedMessage('kept', 1_000);

    const { context } = await buildBotContext(ROOM, SOURCE_ID, BOT_ID, REQUESTER);

    expect(context.map((message) => message.text)).toEqual(['內容 kept']);
  });
});
