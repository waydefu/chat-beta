import { describe, expect, it, vi } from 'vitest';

import {
  isTypingEntryFresh,
  typingNames,
  TYPING_IDLE_CLEAR_MS,
  TYPING_STALE_AFTER_MS,
} from '../src/realtime/typing-state';
import { TypingSignal, type TypingSignalTimers, type TypingTarget } from '../src/realtime/typing-signal';

const now = 1_000_000;
const at = (age: number) => ({ displayName: 'Alice', updatedAt: now - age });

describe('typing freshness', () => {
  it('keeps an entry a live typist is still refreshing', () => {
    expect(isTypingEntryFresh(at(0), now)).toBe(true);
    expect(isTypingEntryFresh(at(TYPING_STALE_AFTER_MS - 1), now)).toBe(true);
  });

  it('drops an entry whose owner stopped refreshing it', () => {
    // This is the orphan onDisconnect never reaped: without the timestamp check
    // it holds "正在輸入…" on screen for the whole room, forever.
    expect(isTypingEntryFresh(at(TYPING_STALE_AFTER_MS), now)).toBe(false);
    expect(isTypingEntryFresh(at(TYPING_STALE_AFTER_MS * 10), now)).toBe(false);
  });

  it('leaves room for the composer idle clear plus write latency', () => {
    expect(TYPING_STALE_AFTER_MS).toBeGreaterThan(TYPING_IDLE_CLEAR_MS);
  });

  it('treats a missing or non-numeric stamp as stale rather than typing forever', () => {
    expect(isTypingEntryFresh({ displayName: 'Alice' }, now)).toBe(false);
    expect(isTypingEntryFresh({ displayName: 'Alice', updatedAt: 'soon' }, now)).toBe(false);
  });

  it('tolerates a stamp slightly ahead of this clock', () => {
    expect(isTypingEntryFresh({ updatedAt: now + 500 }, now)).toBe(true);
  });
});

describe('typing projection', () => {
  it('reports fresh typists and excludes the current user', () => {
    expect(typingNames({
      alice: { tabA: at(500) },
      bob: { tabA: at(500) },
      me: { tabA: { displayName: '我', updatedAt: now } },
    }, 'me', now)).toEqual(['Alice', 'Alice']);
  });

  it('keeps a user typing on one tab while another tab of theirs went stale', () => {
    expect(typingNames({
      alice: { dead: at(TYPING_STALE_AFTER_MS + 1), live: at(100) },
    }, 'me', now)).toEqual(['Alice']);
  });

  it('drops a user once every one of their tabs is stale', () => {
    expect(typingNames({
      alice: { dead: at(TYPING_STALE_AFTER_MS + 1), alsoDead: at(TYPING_STALE_AFTER_MS + 9) },
    }, 'me', now)).toEqual([]);
  });

  it('falls back to a placeholder when the name is missing but the entry is live', () => {
    expect(typingNames({ alice: { tab: { updatedAt: now } } }, 'me', now)).toEqual(['有人']);
  });

  it('handles an emptied subtree', () => {
    expect(typingNames({}, 'me', now)).toEqual([]);
    expect(typingNames({ alice: {} }, 'me', now)).toEqual([]);
  });
});

function fakeTimers(): TypingSignalTimers & { run(): void; pending(): number } {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    setTimeout(handler) {
      const handle = nextHandle++;
      scheduled.set(handle, handler);
      return handle;
    },
    clearTimeout(handle) { scheduled.delete(handle); },
    run() {
      for (const handler of [...scheduled.values()]) handler();
      scheduled.clear();
    },
    pending() { return scheduled.size; },
  };
}

function target(): TypingTarget & { writes: boolean[] } {
  const writes: boolean[] = [];
  return { writes, setTyping: async (active) => { writes.push(active); } };
}

describe('typing signal ownership', () => {
  it('does not send room A cleanup into room B after a switch', () => {
    const timers = fakeTimers();
    const roomA = target();
    const roomB = target();
    const signalA = new TypingSignal(roomA, () => undefined, timers);

    signalA.update(true);
    expect(roomA.writes).toEqual([true]);

    // The user leaves room A well inside the 1.8s idle window; the room scope
    // disposes its signal, and room B gets its own.
    signalA.dispose();
    const signalB = new TypingSignal(roomB, () => undefined, timers);

    timers.run();

    expect(roomA.writes).toEqual([true]);
    // Room B never asked to stop typing and must not be told that it did.
    expect(roomB.writes).toEqual([]);
    signalB.dispose();
  });

  it('clears its own room once the typist goes idle', () => {
    const timers = fakeTimers();
    const room = target();
    const signal = new TypingSignal(room, () => undefined, timers);
    signal.update(true);
    timers.run();
    expect(room.writes).toEqual([true, false]);
    signal.dispose();
  });

  it('re-arms on every keystroke instead of stacking timers', () => {
    const timers = fakeTimers();
    const room = target();
    const signal = new TypingSignal(room, () => undefined, timers);
    signal.update(true);
    signal.update(true);
    signal.update(true);
    expect(timers.pending()).toBe(1);
    timers.run();
    expect(room.writes).toEqual([true, true, true, false]);
    signal.dispose();
  });

  it('leaves no timer behind when the composer is emptied or the signal disposed', () => {
    const timers = fakeTimers();
    const room = target();
    const signal = new TypingSignal(room, () => undefined, timers);
    signal.update(true);
    signal.update(false);
    expect(timers.pending()).toBe(0);
    signal.update(true);
    signal.dispose();
    expect(timers.pending()).toBe(0);
    // A disposed signal is inert, even if something still holds a reference.
    signal.update(true);
    expect(room.writes).toEqual([true, false, true]);
  });

  it('reports a rejected write to its owner rather than swallowing it', async () => {
    const onError = vi.fn();
    const failure = new Error('permission-denied');
    const signal = new TypingSignal({ setTyping: async () => { throw failure; } }, onError, fakeTimers());
    signal.update(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(failure);
    signal.dispose();
  });
});
