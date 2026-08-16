import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallJoinOptions } from '../src/calls/providers/call-provider';

/**
 * The transport is where the two device invariants actually live: local capture
 * now runs alongside negotiation rather than after it, and nothing the user
 * cancelled or that failed to connect may be left holding a microphone. Neither
 * is reachable from `call.service`, so the provider is exercised against a
 * stand-in SDK whose connect and capture settle independently.
 */
const lk = vi.hoisted(() => {
  interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
  interface FakeTrack { kind: string; stop(): void }
  function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => undefined);
    return { promise, resolve, reject };
  }
  const state = {
    connecting: defer<void>(),
    capturing: defer<FakeTrack[]>(),
    captureOptions: [] as unknown[],
    published: [] as unknown[],
    stopped: [] as string[],
    disconnects: 0,
    connectArgs: [] as string[],
    reset(): void {
      state.connecting = defer<void>();
      state.capturing = defer<FakeTrack[]>();
      state.captureOptions = [];
      state.published = [];
      state.stopped = [];
      state.disconnects = 0;
      state.connectArgs = [];
    },
    track(kind: string): FakeTrack {
      return { kind, stop: () => { state.stopped.push(kind); } };
    },
  };
  return state;
});

vi.mock('livekit-client', () => {
  class Room {
    remoteParticipants = new Map();

    localParticipant = {
      videoTrackPublications: new Map(),
      publishTrack: async (track: unknown): Promise<void> => { lk.published.push(track); },
      setMicrophoneEnabled: async (): Promise<void> => undefined,
      setCameraEnabled: async (): Promise<void> => undefined,
      setScreenShareEnabled: async (): Promise<void> => undefined,
    };

    on(): this { return this; }

    off(): this { return this; }

    async connect(url: string, token: string): Promise<void> {
      lk.connectArgs.push(url, token);
      return lk.connecting.promise;
    }

    async disconnect(): Promise<void> {
      lk.disconnects += 1;
      // The real SDK abandons an in-flight connect when the room is torn down.
      lk.connecting.reject(new Error('disconnected'));
    }
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_target, key) => String(key) }),
    Track: { Kind: { Audio: 'audio', Video: 'video' } },
    createLocalTracks: (createOptions: unknown) => {
      lk.captureOptions.push(createOptions);
      return lk.capturing.promise;
    },
  };
});

const callFunctionMock = vi.hoisted(() => vi.fn());
vi.mock('../src/firebase/callables', () => ({ callFunction: callFunctionMock }));

import { LiveKitCallProvider } from '../src/calls/providers/livekit-call-provider';

const grant = { url: 'wss://provider.example', token: 'grant-token' };

function options(overrides: Partial<CallJoinOptions> = {}): CallJoinOptions {
  return {
    roomId: 'room',
    callId: 'call',
    audio: true,
    video: false,
    credential: grant,
    stage: {} as HTMLElement,
    onParticipants: vi.fn(),
    onTransportState: vi.fn(),
    ...overrides,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * The provider reaches the SDK through a dynamic import, so how many turns it
 * takes to get to a given point is not fixed. Waiting on the observable state
 * instead of on a turn count keeps these from bleeding into each other.
 */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) await tick();
  if (!condition()) throw new Error(`timed out waiting for ${what}`);
}

/** Capture is the first thing the connect path does, so it is the checkpoint. */
const captureStarted = (): Promise<void> => waitFor(
  () => lk.captureOptions.length === 1,
  'local capture to start',
);

/**
 * Several cases reject while the test is still driving the fake SDK, before the
 * assertion attaches its handler. Claiming the rejection up front keeps that
 * from being reported as an unhandled one; the returned promise still rejects.
 */
function start(join: CallJoinOptions, signal: AbortSignal): Promise<unknown> {
  const started = new LiveKitCallProvider().join(join, signal);
  started.catch(() => undefined);
  return started;
}

describe('livekit transport startup', () => {
  beforeEach(() => {
    lk.reset();
    callFunctionMock.mockReset();
  });

  it('acquires local media while the transport is still negotiating', async () => {
    const join = start(options(), new AbortController().signal);
    await captureStarted();

    // Capture is in flight with the connect unresolved. Serialising them put
    // the whole getUserMedia prompt after negotiation for no reason.
    expect(lk.connectArgs).toEqual([grant.url, grant.token]);
    expect(lk.published).toHaveLength(0);

    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio')]);
    await expect(join).resolves.toMatchObject({ leave: expect.any(Function) });
    expect(lk.published).toHaveLength(1);
  });

  it('never opens the camera for a voice call', async () => {
    const join = start(options(), new AbortController().signal);
    await captureStarted();
    expect(lk.captureOptions[0]).toEqual({ audio: true, video: false });

    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio')]);
    await join;
  });

  it('opens the camera only when the call is a video call', async () => {
    const join = start(options({ video: true }), new AbortController().signal);
    await captureStarted();
    expect(lk.captureOptions[0]).toEqual({ audio: true, video: true });

    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio'), lk.track('video')]);
    await join;
    expect(lk.published).toHaveLength(2);
  });

  it('stops media that was acquired for a connection that failed', async () => {
    const join = start(options(), new AbortController().signal);
    await captureStarted();
    lk.connecting.reject(new Error('negotiation failed'));

    await expect(join).rejects.toThrow('negotiation failed');
    // The prompt is answered after the failure; the track must still not
    // survive the attempt that asked for it.
    lk.capturing.resolve([lk.track('audio')]);
    await waitFor(() => lk.stopped.length === 1, 'the orphaned track to be stopped');
    expect(lk.stopped).toEqual(['audio']);
    expect(lk.published).toHaveLength(0);
  });

  it('cancels without waiting for an unanswered permission prompt', async () => {
    const abort = new AbortController();
    const join = start(options(), abort.signal);
    await captureStarted();

    abort.abort();
    await waitFor(() => lk.disconnects === 1, 'the transport to be torn down');
    // Neither the connect nor the prompt has settled, yet the teardown has
    // already run: cancelling must not cost a full connect, and must not wait
    // for a prompt the user may never answer.
    expect(lk.disconnects).toBe(1);
    await expect(join).rejects.toThrow();

    lk.capturing.resolve([lk.track('audio')]);
    await waitFor(() => lk.stopped.length === 1, 'the cancelled capture to be stopped');
    expect(lk.stopped).toEqual(['audio']);
    expect(lk.published).toHaveLength(0);
  });

  it('stops media acquired for a call that was cancelled after it connected', async () => {
    const abort = new AbortController();
    const join = start(options(), abort.signal);
    await captureStarted();
    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio')]);
    abort.abort();

    await expect(join).rejects.toThrow();
    await waitFor(() => lk.stopped.length === 1, 'the cancelled capture to be stopped');
    expect(lk.stopped).toEqual(['audio']);
  });

  it('spends a token round trip only when the transition did not inline a grant', async () => {
    callFunctionMock.mockResolvedValue(grant);
    const join = start(options({ credential: undefined }), new AbortController().signal);
    await captureStarted();
    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio')]);
    await join;

    expect(callFunctionMock.mock.calls.map((entry) => entry[0])).toEqual(['getLiveKitTokenV2']);
    expect(callFunctionMock.mock.calls[0]?.[2]).toMatchObject({ limitedUseAppCheckTokens: true });
  });

  it('asks for no token at all when the grant came back with the transition', async () => {
    const join = start(options(), new AbortController().signal);
    await captureStarted();
    lk.connecting.resolve();
    lk.capturing.resolve([lk.track('audio')]);
    await join;

    expect(callFunctionMock).not.toHaveBeenCalled();
  });
});
