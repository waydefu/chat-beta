import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeQuery {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

const store = new Map<string, string>();
let query: FakeQuery;
let listeners: Array<(event: { matches: boolean }) => void>;

function fire(matches: boolean): void {
  for (const listener of [...listeners]) listener({ matches });
}

beforeEach(async () => {
  vi.resetModules();
  store.clear();
  listeners = [];
  query = {
    matches: false,
    addEventListener: vi.fn((_name: string, handler: (event: { matches: boolean }) => void) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_name: string, handler: (event: { matches: boolean }) => void) => {
      listeners = listeners.filter((entry) => entry !== handler);
    }),
  };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
  vi.stubGlobal('window', { matchMedia: () => query });
  vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> } });
});

async function theme() {
  return await import('../src/app/theme');
}

describe('system theme watcher', () => {
  it('registers one DOM listener however many callers subscribe', async () => {
    const { watchSystemTheme } = await theme();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watchSystemTheme(first);
    const stopSecond = watchSystemTheme(second);

    // Two owners of the same state used to mean two media-query listeners with
    // no way to release either.
    expect(query.addEventListener).toHaveBeenCalledTimes(1);

    fire(true);
    expect(first).toHaveBeenCalledWith('dark');
    expect(second).toHaveBeenCalledWith('dark');

    stopFirst();
    stopSecond();
  });

  it('ignores OS changes once an explicit preference is stored', async () => {
    const { storeTheme, watchSystemTheme } = await theme();
    const seen = vi.fn();
    const stop = watchSystemTheme(seen);

    storeTheme('light');
    fire(true);

    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it('releases the listener when the last subscriber goes away', async () => {
    const { watchSystemTheme } = await theme();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watchSystemTheme(first);
    const stopSecond = watchSystemTheme(second);

    stopFirst();
    // One subscriber left, so the shared listener has to stay.
    expect(query.removeEventListener).not.toHaveBeenCalled();
    fire(true);
    expect(second).toHaveBeenCalledWith('dark');

    stopSecond();
    expect(query.removeEventListener).toHaveBeenCalledTimes(1);
    fire(false);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to a subscriber that already unsubscribed', async () => {
    const { watchSystemTheme } = await theme();
    const gone = vi.fn();
    const stop = watchSystemTheme(gone);
    stop();
    fire(true);
    expect(gone).not.toHaveBeenCalled();
  });

  it('re-registers cleanly after the last subscriber left', async () => {
    const { watchSystemTheme } = await theme();
    watchSystemTheme(vi.fn())();
    const later = vi.fn();
    const stop = watchSystemTheme(later);
    expect(query.addEventListener).toHaveBeenCalledTimes(2);
    fire(true);
    expect(later).toHaveBeenCalledWith('dark');
    stop();
  });

  it('prefers a stored theme over the OS, and the OS when there is none', async () => {
    const { preferredTheme, storeTheme } = await theme();
    query.matches = true;
    expect(preferredTheme()).toBe('dark');
    storeTheme('light');
    expect(preferredTheme()).toBe('light');
  });
});
