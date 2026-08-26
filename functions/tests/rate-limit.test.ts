import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirestoreFake } from './helpers/firestore-fake.js';

const fake = createFirestoreFake();

vi.mock('../src/admin.js', () => ({
  get firestore() {
    return fake.firestore;
  },
  database: {},
}));

const { acquireAIConcurrency, consumeAIRateLimits, releaseAIConcurrency } = await import(
  '../src/bots/rate-limit.js'
);

const UID = 'user-1';
const ROOM = 'room-1';
// A round number keeps every window boundary arithmetic-obvious in the assertions.
const NOW = 1_800_000_000_000;

function windowPath(key: string, identity: string, durationMs: number, now = NOW): string {
  return `rateLimits/${key}_${identity}_${Math.floor(now / durationMs)}`;
}

const USER_MINUTE = windowPath('user-minute', UID, 60_000);
const USER_HOUR = windowPath('user-hour', UID, 3_600_000);
const ROOM_MINUTE = windowPath('room-minute', ROOM, 60_000);
const ROOM_HOUR = windowPath('room-hour', ROOM, 3_600_000);

beforeEach(() => {
  fake.reset();
});

describe('consumeAIRateLimits', () => {
  it('opens all four windows at one and stamps a two-window expiry', async () => {
    await consumeAIRateLimits(UID, ROOM, NOW);

    expect(fake.read(USER_MINUTE)).toEqual({ count: 1, expiresAt: new Date(NOW + 120_000) });
    expect(fake.read(USER_HOUR)).toEqual({ count: 1, expiresAt: new Date(NOW + 7_200_000) });
    expect(fake.read(ROOM_MINUTE)).toEqual({ count: 1, expiresAt: new Date(NOW + 120_000) });
    expect(fake.read(ROOM_HOUR)).toEqual({ count: 1, expiresAt: new Date(NOW + 7_200_000) });
  });

  it('counts every window in a single transaction', async () => {
    await consumeAIRateLimits(UID, ROOM, NOW);

    // Four windows must be read and written atomically. Splitting them would let
    // a concurrent call pass the user check and fail the room check half-written.
    expect(fake.transactionCount).toBe(1);
    expect(fake.writes).toHaveLength(4);
  });

  it('increments an existing count rather than resetting it', async () => {
    fake.seed(USER_MINUTE, { count: 3 });

    await consumeAIRateLimits(UID, ROOM, NOW);

    expect(fake.read(USER_MINUTE)?.count).toBe(4);
  });

  it.each([
    ['the per-user minute window', USER_MINUTE, 5],
    ['the per-user hour window', USER_HOUR, 20],
    ['the per-room minute window', ROOM_MINUTE, 10],
    ['the per-room hour window', ROOM_HOUR, 60],
  ])('rejects when %s is full', async (_label, path, maximum) => {
    fake.seed(path, { count: maximum });

    await expect(consumeAIRateLimits(UID, ROOM, NOW)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('writes nothing when any window is exhausted', async () => {
    fake.seed(ROOM_HOUR, { count: 60 });

    await expect(consumeAIRateLimits(UID, ROOM, NOW)).rejects.toThrow();

    // The throw happens inside the transaction, so no partial count may survive:
    // a rejected request must not consume the user's minute budget.
    expect(fake.writes).toHaveLength(0);
    expect(fake.read(USER_MINUTE)).toBeUndefined();
  });

  it('starts a fresh window on the far side of the boundary', async () => {
    const boundary = Math.floor(NOW / 60_000) * 60_000;
    fake.seed(windowPath('user-minute', UID, 60_000, boundary), { count: 5 });

    // One millisecond later is the same window and still exhausted.
    await expect(consumeAIRateLimits(UID, ROOM, boundary + 1)).rejects.toThrow();

    // The next window is a different document and starts empty.
    await expect(consumeAIRateLimits(UID, ROOM, boundary + 60_000)).resolves.toBeUndefined();
    expect(fake.read(windowPath('user-minute', UID, 60_000, boundary + 60_000))?.count).toBe(1);
  });

  it('keeps user and room budgets independent', async () => {
    fake.seed(USER_MINUTE, { count: 5 });

    await expect(consumeAIRateLimits(UID, ROOM, NOW)).rejects.toThrow();
    // A different user in the same room is unaffected.
    await expect(consumeAIRateLimits('user-2', ROOM, NOW)).resolves.toBeUndefined();
  });
});

describe('acquireAIConcurrency', () => {
  const RUN = 'msg-1_gemini';

  it('takes a lease in every scope with a two-minute expiry', async () => {
    await acquireAIConcurrency(RUN, UID, ROOM, NOW);

    for (const id of ['global', `user_${UID}`, `room_${ROOM}`]) {
      expect(fake.read(`aiConcurrency/${id}`)).toMatchObject({
        leases: [{ runId: RUN, expiresAt: NOW + 120_000 }],
        updatedAt: new Date(NOW),
      });
    }
  });

  it('is idempotent for the same run', async () => {
    await acquireAIConcurrency(RUN, UID, ROOM, NOW);
    const writesAfterFirst = fake.writes.length;

    // The per-user maximum is 1. A retry of the same run must not be told it is
    // competing with itself.
    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW + 1_000)).resolves.toBeUndefined();
    expect(fake.writes).toHaveLength(writesAfterFirst);
    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toHaveLength(1);
  });

  it.each([
    ['global', 'global', 5],
    ['per-user', `user_${UID}`, 1],
    ['per-room', `room_${ROOM}`, 2],
  ])('rejects when the %s scope is saturated', async (_label, id, maximum) => {
    fake.seed(`aiConcurrency/${id}`, {
      leases: Array.from({ length: maximum }, (_, index) => ({
        runId: `other-${index}`,
        expiresAt: NOW + 60_000,
      })),
    });

    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('reclaims expired leases instead of counting them', async () => {
    fake.seed(`aiConcurrency/user_${UID}`, {
      leases: [{ runId: 'abandoned', expiresAt: NOW - 1 }],
    });

    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW)).resolves.toBeUndefined();
    // The dead lease is dropped, not carried forward: a crashed run must not
    // block the user for longer than the lease it failed to release.
    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toEqual([
      { runId: RUN, expiresAt: NOW + 120_000 },
    ]);
  });

  it('treats a lease expiring exactly now as expired', async () => {
    fake.seed(`aiConcurrency/user_${UID}`, {
      leases: [{ runId: 'boundary', expiresAt: NOW }],
    });

    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW)).resolves.toBeUndefined();
  });

  it('ignores malformed lease entries', async () => {
    fake.seed(`aiConcurrency/user_${UID}`, { leases: [null, 'nonsense', 42] });

    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW)).resolves.toBeUndefined();
    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toEqual([
      { runId: RUN, expiresAt: NOW + 120_000 },
    ]);
  });

  it('writes nothing when a later scope rejects', async () => {
    fake.seed(`aiConcurrency/room_${ROOM}`, {
      leases: [
        { runId: 'other-a', expiresAt: NOW + 60_000 },
        { runId: 'other-b', expiresAt: NOW + 60_000 },
      ],
    });

    await expect(acquireAIConcurrency(RUN, UID, ROOM, NOW)).rejects.toThrow();

    // `global` is checked before `room`, so without transactional buffering the
    // global lease would leak on every rejected acquire.
    expect(fake.read('aiConcurrency/global')).toBeUndefined();
  });
});

describe('releaseAIConcurrency', () => {
  const RUN = 'msg-1_gemini';

  it('removes only its own lease from every scope', async () => {
    for (const id of ['global', `user_${UID}`, `room_${ROOM}`]) {
      fake.seed(`aiConcurrency/${id}`, {
        leases: [
          { runId: RUN, expiresAt: NOW + 120_000 },
          { runId: 'someone-else', expiresAt: NOW + 120_000 },
        ],
      });
    }

    await releaseAIConcurrency(RUN, UID, ROOM);

    for (const id of ['global', `user_${UID}`, `room_${ROOM}`]) {
      expect(fake.read(`aiConcurrency/${id}`)?.leases).toEqual([
        { runId: 'someone-else', expiresAt: NOW + 120_000 },
      ]);
    }
  });

  it('merges so an unrelated field survives the release', async () => {
    fake.seed('aiConcurrency/global', {
      leases: [{ runId: RUN, expiresAt: NOW + 120_000 }],
      note: 'kept',
    });

    await releaseAIConcurrency(RUN, UID, ROOM);

    expect(fake.read('aiConcurrency/global')?.note).toBe('kept');
    expect(fake.writes.every((write) => write.merge)).toBe(true);
  });

  it('is safe on a document that was never written', async () => {
    await expect(releaseAIConcurrency(RUN, UID, ROOM)).resolves.toBeUndefined();
    expect(fake.read(`aiConcurrency/user_${UID}`)?.leases).toEqual([]);
  });

  it('releases every scope in one transaction', async () => {
    await releaseAIConcurrency(RUN, UID, ROOM);

    expect(fake.transactionCount).toBe(1);
  });
});
