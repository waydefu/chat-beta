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
