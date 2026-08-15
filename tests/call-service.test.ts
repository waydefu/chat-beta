import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallProvider, CallSession } from '../src/calls/providers/call-provider';

const callFunctionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/firebase/callables', () => ({ callFunction: callFunctionMock }));

import { endCall, heartbeatCall, joinCall, rejectCall, startCall } from '../src/calls/call.service';

function session(): CallSession {
  return {
    leave: vi.fn(async () => undefined),
    setMicrophone: vi.fn(async () => undefined),
    setCamera: vi.fn(async () => undefined),
    setScreenShare: vi.fn(async () => undefined),
  };
}

function provider(join: CallProvider['join']): CallProvider {
  return { join };
}

const base = {
  roomId: 'room',
  kind: 'voice' as const,
  stage: {} as HTMLElement,
  onCreated: vi.fn(),
  onParticipants: vi.fn(),
  onTransportState: vi.fn(),
};

describe('call service orchestration', () => {
  beforeEach(() => {
    callFunctionMock.mockReset();
    base.onCreated.mockReset();
  });

  it('rolls back a media failure without replacing the primary error', async () => {
    callFunctionMock.mockImplementation(async (name: string, data: { operationId?: string }) => {
      if (name === 'startLiveKitCallV2') return { callId: data.operationId, status: 'creating' };
      if (name === 'failLiveKitCall') throw new Error('rollback unavailable');
      throw new Error(`unexpected callable ${name}`);
    });
    const mediaFailure = new DOMException('denied', 'NotAllowedError');
    const transport = provider(vi.fn(async () => { throw mediaFailure; }));

    await expect(startCall(transport, base, new AbortController().signal)).rejects.toMatchObject({
      code: 'call',
      message: '麥克風或相機權限遭拒，請在瀏覽器設定中允許後重試。',
      cause: mediaFailure,
    });
    expect(callFunctionMock.mock.calls.map((entry) => entry[0])).toEqual([
      'startLiveKitCallV2', 'failLiveKitCall',
    ]);
    expect(callFunctionMock.mock.calls[1]?.[1]).toMatchObject({ category: 'media-permission' });
  });

  it('uses the deterministic operation id to roll back a lost/aborted start response', async () => {
    const controller = new AbortController();
    callFunctionMock.mockImplementation(async (name: string, data: { operationId?: string }) => {
      if (name === 'startLiveKitCallV2') {
        controller.abort();
        return { callId: data.operationId, status: 'creating' };
      }
      if (name === 'failLiveKitCall') return { status: 'failed' };
      throw new Error(`unexpected callable ${name}`);
    });
    const join = vi.fn(async () => session());

    await expect(startCall(provider(join), base, controller.signal)).rejects.toMatchObject({
      code: 'call', message: '通話連線已取消。',
    });
    expect(base.onCreated).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
    expect(callFunctionMock.mock.calls[1]?.[1]).toMatchObject({
      callId: callFunctionMock.mock.calls[0]?.[1].operationId,
      category: 'aborted',
    });
  });

  it('warms the transport before the create callable, not after the token comes back', async () => {
    const order: string[] = [];
    callFunctionMock.mockImplementation(async (name: string, data: { operationId?: string }) => {
      order.push(name);
      if (name === 'startLiveKitCallV2') return { callId: data.operationId, status: 'creating' };
      if (name === 'confirmLiveKitCall') return { callId: data.operationId, status: 'ringing', connectedAtMs: 1 };
      throw new Error(`unexpected callable ${name}`);
    });
    const transport: CallProvider = {
      prepare: () => { order.push('prepare'); },
      join: async () => { order.push('join'); return session(); },
    };

    await startCall(transport, base, new AbortController().signal);

    // The transport SDK is the largest chunk in the app and does not depend on
    // the call existing. Downloading it only once the token has arrived put its
    // whole transfer on the critical path.
    expect(order).toEqual(['prepare', 'startLiveKitCallV2', 'join', 'confirmLiveKitCall']);
  });

  it('warms the transport when accepting an existing call too', async () => {
    const order: string[] = [];
    callFunctionMock.mockImplementation(async (name: string) => {
      order.push(name);
      if (name === 'confirmLiveKitCall') return { callId: 'call', status: 'active', connectedAtMs: 1 };
      return { callId: 'call', status: 'accepted' };
    });
    const transport: CallProvider = {
      prepare: () => { order.push('prepare'); },
      join: async () => session(),
    };

    await joinCall(transport, {
      roomId: 'room', callId: 'call', kind: 'voice', stage: {} as HTMLElement,
      onParticipants: vi.fn(), onTransportState: vi.fn(),
    }, new AbortController().signal);

    expect(order[0]).toBe('prepare');
    expect(order[1]).toBe('respondLiveKitCall');
  });

  it('still works for a provider that declares no warm-up', async () => {
    callFunctionMock.mockImplementation(async (name: string, data: { operationId?: string }) => {
      if (name === 'startLiveKitCallV2') return { callId: data.operationId, status: 'creating' };
      return { callId: data.operationId, status: 'ringing', connectedAtMs: 1 };
    });
    await expect(startCall(provider(vi.fn(async () => session())), base, new AbortController().signal))
      .resolves.toMatchObject({ status: 'ringing' });
  });

  it('reports an abort raised while the transport is still connecting', async () => {
    const controller = new AbortController();
    callFunctionMock.mockImplementation(async (name: string, data: { operationId?: string }) => {
      if (name === 'startLiveKitCallV2') return { callId: data.operationId, status: 'creating' };
      if (name === 'failLiveKitCall') return { status: 'failed' };
      throw new Error(`unexpected callable ${name}`);
    });
    // The provider observes the signal itself; this stands in for the real one
    // tearing down its room when the cancel button fires mid-connect.
    const join = vi.fn(async (_options: unknown, signal: AbortSignal) => {
      controller.abort();
      signal.throwIfAborted();
      return session();
    });

    await expect(startCall(provider(join), base, controller.signal)).rejects.toMatchObject({
      code: 'call', message: '通話連線已取消。',
    });
    // Cancelling must not strand the room lock: the call was created, so the
    // rollback has to reach the server under the same operation id.
    expect(callFunctionMock.mock.calls.map((entry) => entry[0])).toEqual([
      'startLiveKitCallV2', 'failLiveKitCall',
    ]);
    expect(callFunctionMock.mock.calls[1]?.[1]).toMatchObject({
      callId: callFunctionMock.mock.calls[0]?.[1].operationId,
      category: 'aborted',
    });
  });

  it('uses limited-use App Check tokens for every service transition', async () => {
    callFunctionMock.mockImplementation(async (name: string) => {
      if (name === 'confirmLiveKitCall') return { callId: 'call', status: 'active', connectedAtMs: 1 };
      if (name === 'heartbeatLiveKitCall') return { callId: 'call', status: 'active' };
      return { callId: 'call', status: 'accepted' };
    });
    await joinCall(provider(vi.fn(async () => session())), {
      roomId: 'room', callId: 'call', kind: 'voice', stage: {} as HTMLElement,
      onParticipants: vi.fn(), onTransportState: vi.fn(),
    }, new AbortController().signal);
    await rejectCall('room', 'call');
    await heartbeatCall('room', 'call');
    await endCall('room', 'call');

    expect(callFunctionMock).toHaveBeenCalledTimes(5);
    expect(callFunctionMock.mock.calls.every((entry) => (
      (entry[2] as { limitedUseAppCheckTokens?: boolean } | undefined)?.limitedUseAppCheckTokens === true
    ))).toBe(true);
  });
});
