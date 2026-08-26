import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirestoreFake, timestamp } from './helpers/firestore-fake.js';

// `geminiApiKey.value()` reads this. Setting it is cheaper and truer than
// mocking config.js: the real `defineSecret` then behaves exactly as it does in
// production, including refusing to resolve an undeclared secret.
process.env.GEMINI_API_KEY = 'test-key';

const fake = createFirestoreFake();
const draftWrites: Array<{ path: string; value: Record<string, unknown> }> = [];

vi.mock('../src/admin.js', () => ({
  get firestore() {
    return fake.firestore;
  },
  database: {
    ref: (path: string) => ({
      async set(value: Record<string, unknown>) {
        draftWrites.push({ path, value });
      },
    }),
  },
}));

const countTokens = vi.fn();
const generateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { countTokens, generateContentStream };
  },
}));

vi.mock('../src/bots/model-config.js', () => ({
  stableGeminiModel: async () => ({ model: 'gemini-test-pin', source: 'pinned' }),
}));

const getActiveMembership = vi.fn();
vi.mock('../src/shared/membership.js', () => ({
  getActiveMembership: (...args: unknown[]) => getActiveMembership(...args),
}));

const { generateGeminiReply } = await import('../src/bots/gemini.js');

const UID = 'user-1';
const ROOM = 'room-1';
const SOURCE = 'msg-1';
const RUN = `${SOURCE}_gemini`;
const REQUEST_PATH = `rooms/${ROOM}/aiRequests/${RUN}`;
const MESSAGE_PATH = `rooms/${ROOM}/messages/ai_${RUN}`;

function chunk(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, ...extra };
}

function streamOf(chunks: Array<Record<string, unknown>>, onEach?: (index: number) => void) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of chunks.entries()) {
        onEach?.(index);
        yield value;
      }
    },
  };
}

interface CallOptions {
  chunks?: Array<Record<string, unknown>>;
  onChunk?: (index: number) => void;
  tokens?: number | number[];
  streamError?: unknown;
  signal?: AbortSignal;
}

function invoke(options: CallOptions = {}) {
  const tokens = options.tokens ?? 100;
  const sequence = Array.isArray(tokens) ? [...tokens] : null;
  countTokens.mockImplementation(async () => ({
    totalTokens: sequence ? sequence.shift() ?? sequence.at(-1) ?? 0 : tokens,
  }));
  if (options.streamError) {
    generateContentStream.mockImplementation(async () => {
      throw options.streamError;
    });
  } else {
    generateContentStream.mockImplementation(async () =>
      streamOf(options.chunks ?? [chunk('hello')], options.onChunk));
  }

  const sent: Array<{ runId: string; text: string }> = [];
  const controller = new AbortController();
  const response = {
    signal: options.signal ?? controller.signal,
    sendChunk: async (payload: { runId: string; text: string }) => {
      sent.push(payload);
    },
  };
  const request = {
    auth: { uid: UID, token: {} },
    data: { roomId: ROOM, sourceMessageId: SOURCE, botId: 'gemini' },
    acceptsStreaming: true,
    rawRequest: {},
  };
  // `run` is the handler firebase-functions exposes for exactly this, and it
  // forwards both arguments, so the streaming response object arrives intact.
  const result = (generateGeminiReply as unknown as {
    run(request: unknown, response: unknown): Promise<Record<string, unknown>>;
  }).run(request, response);
  return { result, sent, controller };
}

function seedSourceMessage(): void {
  fake.seed(`rooms/${ROOM}/messages/${SOURCE}`, {
    senderId: UID,
    senderType: 'user',
    senderDisplayName: '提問者',
    text: '@gemini 幫我看看',
    mentions: [{ type: 'bot', id: 'gemini' }],
    createdAt: timestamp(1_000),
  });
}

beforeEach(() => {
  fake.reset();
  draftWrites.length = 0;
  countTokens.mockReset();
  generateContentStream.mockReset();
  getActiveMembership.mockReset();
  getActiveMembership.mockResolvedValue({ userId: UID, role: 'member', status: 'active' });
  seedSourceMessage();
});

describe('first request', () => {
  it('takes the lease, streams, and writes the final message once', async () => {
    const { result, sent } = invoke({ chunks: [chunk('你好'), chunk('，世界')] });

    await expect(result).resolves.toMatchObject({
      runId: RUN,
      finalMessageId: `ai_${RUN}`,
      model: 'gemini-test-pin',
      replayed: false,
    });

    expect(sent).toEqual([
      { runId: RUN, text: '你好' },
      { runId: RUN, text: '，世界' },
    ]);
    expect(fake.read(MESSAGE_PATH)).toMatchObject({
      senderId: 'gemini',
      senderType: 'bot',
      kind: 'text',
      text: '你好，世界',
      replyToId: SOURCE,
    });
    expect(fake.read(REQUEST_PATH)).toMatchObject({
      status: 'complete',
      attempt: 1,
      finalMessageId: `ai_${RUN}`,
    });
  });

  it('uses the deterministic ids that make a retry idempotent', async () => {
    await invoke().result;

    // If either id were random, a retry would produce a second message rather
    // than colliding with the first.
    expect(fake.read(REQUEST_PATH)).toBeDefined();
    expect(fake.read(MESSAGE_PATH)).toBeDefined();
  });

  it('records usage metadata when the provider reports it', async () => {
    await invoke({
      chunks: [chunk('答', {
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
      })],
    }).result;

    expect(fake.read(REQUEST_PATH)?.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
  });

  it('writes the room preview in the same transaction as the message', async () => {
    await invoke({ chunks: [chunk('這是一則回覆')] }).result;

    const roomWrite = fake.writes.find((write) => write.path === `rooms/${ROOM}`);
    expect(roomWrite?.data.lastMessage).toMatchObject({
      id: `ai_${RUN}`,
      senderId: 'gemini',
      preview: '這是一則回覆',
    });
    // One transaction covering ledger, message and room. Splitting it would let
    // a reader see a room preview for a message that does not exist.
    expect(roomWrite?.operation).toBe('update');
  });

  it('never persists a draft to Firestore, only to the realtime path', async () => {
    await invoke({ chunks: [chunk('串流片段')] }).result;

    expect(draftWrites.every((write) => write.path.startsWith('realtime/rooms/'))).toBe(true);
    expect(fake.writes.some((write) => String(write.data.status) === 'streaming')).toBe(false);
  });
});

describe('replay and the lease', () => {
  it('replays a completed run without calling the provider', async () => {
    fake.seed(REQUEST_PATH, { status: 'complete', attempt: 1, model: 'gemini-test-pin' });

    const { result } = invoke();

    await expect(result).resolves.toMatchObject({ replayed: true, model: 'gemini-test-pin' });
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(fake.read(MESSAGE_PATH)).toBeUndefined();
  });

  it('refuses a second run while the lease is still held', async () => {
    fake.seed(REQUEST_PATH, {
      status: 'running',
      attempt: 1,
      leaseExpiresAt: timestamp(Date.now() + 60_000),
    });

    await expect(invoke().result).rejects.toMatchObject({
      code: 'already-exists',
      details: { code: 'AI_ALREADY_RUNNING' },
    });
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('re-acquires an expired lease and counts the attempt', async () => {
    fake.seed(REQUEST_PATH, {
      status: 'running',
      attempt: 1,
      leaseExpiresAt: timestamp(Date.now() - 1),
    });

    await expect(invoke().result).resolves.toMatchObject({ replayed: false });
    expect(fake.read(REQUEST_PATH)?.attempt).toBe(2);
  });

  it('takes the lease before any provider call', async () => {
    let leaseAtProviderTime: unknown;
    countTokens.mockImplementation(async () => {
      leaseAtProviderTime = fake.read(REQUEST_PATH)?.status;
      return { totalTokens: 10 };
    });
    generateContentStream.mockImplementation(async () => streamOf([chunk('ok')]));

    await (generateGeminiReply as unknown as {
      run(request: unknown, response: unknown): Promise<unknown>;
    }).run(
      { auth: { uid: UID, token: {} }, data: { roomId: ROOM, sourceMessageId: SOURCE, botId: 'gemini' }, acceptsStreaming: true },
      { signal: new AbortController().signal, sendChunk: async () => undefined },
    );

    expect(leaseAtProviderTime).toBe('running');
  });
});

describe('cancellation', () => {
  it('leaves no final message behind', async () => {
    const controller = new AbortController();
    const { result } = invoke({
      chunks: [chunk('第一段'), chunk('第二段')],
      onChunk: (index) => {
        if (index === 1) controller.abort();
      },
      signal: controller.signal,
    });

    await expect(result).rejects.toMatchObject({ details: { code: 'AI_CANCELLED' } });

    // The whole point of the row: a cancelled run must never leave a permanent
    // message. Partial text reached the requester and the draft, and stops there.
    expect(fake.read(MESSAGE_PATH)).toBeUndefined();
    expect(fake.read(REQUEST_PATH)).toMatchObject({ status: 'cancelled' });
    expect(draftWrites.at(-1)?.value).toMatchObject({ status: 'cancelled' });
  });

  it('releases concurrency on the way out', async () => {
    const controller = new AbortController();
    const { result } = invoke({
      chunks: [chunk('a'), chunk('b')],
      onChunk: (index) => {
        if (index === 1) controller.abort();
      },
      signal: controller.signal,
    });
    await expect(result).rejects.toThrow();

    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toEqual([]);
  });
});

describe('provider failures', () => {
  it.each([
    ['a 429', { status: 429, message: 'quota' }, 'resource-exhausted', 'AI_RATE_LIMITED'],
    ['a 503', { status: 503, message: 'upstream down' }, 'unavailable', 'AI_PROVIDER_UNAVAILABLE'],
    ['a 504', { status: 504, message: 'deadline' }, 'deadline-exceeded', 'AI_TIMEOUT'],
    ['a rejected key', { status: 403, message: 'denied' }, 'failed-precondition', 'AI_CONFIGURATION_ERROR'],
  ])('maps %s to its domain code', async (_label, streamError, httpsCode, domainCode) => {
    await expect(invoke({ streamError }).result).rejects.toMatchObject({
      code: httpsCode,
      details: { code: domainCode },
    });

    expect(fake.read(REQUEST_PATH)).toMatchObject({ status: 'failed', failureCategory: domainCode });
  });

  it('never lets the provider message reach the caller', async () => {
    // Provider errors quote the request, which is the user's chat content.
    const secret = '使用者剛剛說的私密內容';
    const error = await invoke({ streamError: { status: 500, message: secret } }).result
      .then(() => null, (thrown: unknown) => thrown);

    expect(JSON.stringify(error)).not.toContain(secret);
    expect((error as { message: string }).message).toBe('Gemini 暫時無法使用，請稍後再試。');
  });

  it('fails when the model produces nothing', async () => {
    await expect(invoke({ chunks: [chunk('   ')] }).result).rejects.toThrow();
    expect(fake.read(MESSAGE_PATH)).toBeUndefined();
  });

  it('releases concurrency after a provider failure', async () => {
    await expect(invoke({ streamError: { status: 500 } }).result).rejects.toThrow();

    // A leaked lease locks the user out until it expires two minutes later.
    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toEqual([]);
  });
});

describe('context budget', () => {
  it('trims and retries before giving up', async () => {
    fake.seed(`rooms/${ROOM}/messages/older`, {
      senderId: 'user-2',
      senderType: 'user',
      senderDisplayName: '同房成員',
      text: '之前的訊息',
      createdAt: timestamp(500),
    });

    await invoke({ tokens: [30_000, 100], chunks: [chunk('ok')] }).result;

    // Over budget once, trimmed, under budget on the recount: the request is
    // never sent untrimmed.
    expect(countTokens).toHaveBeenCalledTimes(2);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('refuses when trimming cannot get under the budget', async () => {
    await expect(invoke({ tokens: 30_000 }).result).rejects.toMatchObject({
      code: 'invalid-argument',
      details: { code: 'AI_CONTEXT_TOO_LARGE' },
    });

    expect(generateContentStream).not.toHaveBeenCalled();
    expect(fake.read(REQUEST_PATH)).toMatchObject({ failureCategory: 'AI_CONTEXT_TOO_LARGE' });
  });
});

describe('authorization', () => {
  it('refuses a caller who is not an active member', async () => {
    getActiveMembership.mockRejectedValue(
      Object.assign(new Error('not a member'), { code: 'permission-denied' }),
    );

    await expect(invoke().result).rejects.toThrow();
    expect(fake.read(REQUEST_PATH)).toBeUndefined();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before touching the ledger', async () => {
    const call = (generateGeminiReply as unknown as {
      run(request: unknown, response: unknown): Promise<unknown>;
    }).run(
      { data: { roomId: ROOM, sourceMessageId: SOURCE, botId: 'gemini' }, acceptsStreaming: false },
      { signal: new AbortController().signal, sendChunk: async () => undefined },
    );

    await expect(call).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses a bot id this provider does not serve', async () => {
    const call = (generateGeminiReply as unknown as {
      run(request: unknown, response: unknown): Promise<unknown>;
    }).run(
      {
        auth: { uid: UID, token: {} },
        data: { roomId: ROOM, sourceMessageId: SOURCE, botId: 'some-other-bot' },
        acceptsStreaming: false,
      },
      { signal: new AbortController().signal, sendChunk: async () => undefined },
    );

    await expect(call).rejects.toThrow();
    expect(generateContentStream).not.toHaveBeenCalled();
  });
});
