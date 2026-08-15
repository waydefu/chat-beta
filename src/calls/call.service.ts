import { callFunction } from '../firebase/callables';
import { DomainError } from '../shared/errors/domain-error';
import type { CallTimingRecorder } from './call-timing';
import type { CallParticipant, CallProvider, CallSession, CallTransportState } from './providers/call-provider';
import { RTC_CALLABLE_OPTIONS } from './rtc-callable-options';

type ServerCallStatus = 'creating' | 'ringing' | 'active' | 'ending' | 'ended' | 'failed' | 'rejected' | 'missed' | 'cancelled';

interface ServerCallResponse {
  callId: string;
  status: ServerCallStatus;
  connectedAtMs?: number;
}

export interface StartCallRequest {
  roomId: string;
  kind: 'voice' | 'video';
  stage: HTMLElement;
  timeline?: CallTimingRecorder;
  onCreated(callId: string): void;
  onParticipants(participants: CallParticipant[]): void;
  onTransportState(state: CallTransportState): void;
}

export interface JoinExistingCallRequest {
  roomId: string;
  callId: string;
  kind: 'voice' | 'video';
  stage: HTMLElement;
  timeline?: CallTimingRecorder;
  onParticipants(participants: CallParticipant[]): void;
  onTransportState(state: CallTransportState): void;
}

export interface ConnectedCall {
  callId: string;
  session: CallSession;
  status: 'ringing' | 'active';
  connectedAtMs: number;
}

const CALL_ERROR_MESSAGES: Record<string, string> = {
  CALL_ALREADY_ACTIVE: '這個聊天室已有進行中的通話。',
  CALL_CONNECT_FAILED: '無法建立通話連線，請稍後再試。',
  CALL_END_FORBIDDEN: '只有發起者或房間管理員可以結束通話。',
  CALL_LEASE_EXPIRED: '通話邀請已過期。',
  CALL_INVARIANT_REPAIR_REQUIRED: '聊天室的舊通話狀態正在清理，請稍後再試。',
  CALL_LOCK_LOST: '通話鎖定已失效，請重新撥號。',
  CALL_MEMBERSHIP_REQUIRED: '你已不是這個聊天室的有效成員。',
  CALL_NOT_JOINABLE: '通話已經結束。',
  CALL_NOT_READY: '通話仍在建立中，請稍候。',
  CALL_OPERATION_FINISHED: '這次通話已結束，請重新撥號。',
  CALL_OPERATION_INVALID: '通話操作識別碼不正確。',
};

function serverErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === 'object' && typeof (details as { errorCode?: unknown }).errorCode === 'string') {
    return (details as { errorCode: string }).errorCode;
  }
  return undefined;
}

function callError(error: unknown, fallback: string): DomainError {
  if (error instanceof DomainError) return error;
  const code = serverErrorCode(error);
  if (code && CALL_ERROR_MESSAGES[code]) return new DomainError('call', CALL_ERROR_MESSAGES[code], error);
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new DomainError('call', '麥克風或相機權限遭拒，請在瀏覽器設定中允許後重試。', error);
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new DomainError('call', '通話連線已取消。', error);
  }
  return new DomainError('call', fallback, error);
}

function failureCategory(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'media-permission';
  return 'connect-failed';
}

async function reportConnectionFailure(roomId: string, callId: string, error: unknown): Promise<void> {
  await callFunction('failLiveKitCall', {
    roomId,
    callId,
    category: failureCategory(error),
  }, RTC_CALLABLE_OPTIONS);
}

async function confirmConnection(roomId: string, callId: string): Promise<ServerCallResponse> {
  return callFunction('confirmLiveKitCall', { roomId, callId }, RTC_CALLABLE_OPTIONS);
}

export async function startCall(
  provider: CallProvider,
  request: StartCallRequest,
  signal: AbortSignal,
): Promise<ConnectedCall> {
  const operationId = crypto.randomUUID();
  const callId = operationId;
  // Nothing has been created yet, so this is outside the try on purpose: there
  // is no server state to roll back if it misbehaves, and `prepare` is defined
  // as non-throwing. It starts the transport's heavy download now so it overlaps
  // the create and token round trips rather than queueing behind both.
  provider.prepare?.();
  try {
    const started = await callFunction<{
      roomId: string;
      kind: string;
      operationId: string;
    }, ServerCallResponse>('startLiveKitCallV2', {
      roomId: request.roomId,
      kind: request.kind,
      operationId,
    }, RTC_CALLABLE_OPTIONS);
    if (started.callId !== callId) throw new Error('RTC server returned a mismatched operation id.');
    request.timeline?.mark('callCreated');
    signal.throwIfAborted();
    request.onCreated(callId);
    const session = await provider.join({
      roomId: request.roomId,
      callId,
      audio: true,
      video: request.kind === 'video',
      stage: request.stage,
      timeline: request.timeline,
      onParticipants: request.onParticipants,
      onTransportState: request.onTransportState,
    }, signal);
    try {
      const confirmed = await confirmConnection(request.roomId, callId);
      request.timeline?.mark('serverConfirmed');
      return {
        callId,
        session,
        status: confirmed.status === 'active' ? 'active' : 'ringing',
        connectedAtMs: confirmed.connectedAtMs ?? Date.now(),
      };
    } catch (error) {
      await session.leave().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await reportConnectionFailure(request.roomId, callId, error).catch(() => undefined);
    throw callError(error, '無法建立通話連線，請稍後再試。');
  }
}

export async function joinCall(
  provider: CallProvider,
  request: JoinExistingCallRequest,
  signal: AbortSignal,
): Promise<ConnectedCall> {
  provider.prepare?.();
  try {
    await callFunction('respondLiveKitCall', {
      roomId: request.roomId,
      callId: request.callId,
      action: 'accepted',
    }, RTC_CALLABLE_OPTIONS);
    request.timeline?.mark('callCreated');
    signal.throwIfAborted();
    const session = await provider.join({
      roomId: request.roomId,
      callId: request.callId,
      audio: true,
      video: request.kind === 'video',
      stage: request.stage,
      timeline: request.timeline,
      onParticipants: request.onParticipants,
      onTransportState: request.onTransportState,
    }, signal);
    try {
      const confirmed = await confirmConnection(request.roomId, request.callId);
      request.timeline?.mark('serverConfirmed');
      return {
        callId: request.callId,
        session,
        status: confirmed.status === 'ringing' ? 'ringing' : 'active',
        connectedAtMs: confirmed.connectedAtMs ?? Date.now(),
      };
    } catch (error) {
      await session.leave().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await reportConnectionFailure(request.roomId, request.callId, error).catch(() => undefined);
    throw callError(error, '無法加入通話，請稍後再試。');
  }
}

export async function rejectCall(roomId: string, callId: string): Promise<void> {
  try {
    await callFunction('respondLiveKitCall', {
      roomId,
      callId,
      action: 'rejected',
    }, RTC_CALLABLE_OPTIONS);
  } catch (error) {
    throw callError(error, '無法拒絕這通來電。');
  }
}

export async function heartbeatCall(roomId: string, callId: string): Promise<ServerCallStatus> {
  const response = await callFunction<{ roomId: string; callId: string }, ServerCallResponse>(
    'heartbeatLiveKitCall',
    { roomId, callId },
    RTC_CALLABLE_OPTIONS,
  );
  return response.status;
}

export async function endCall(roomId: string, callId: string): Promise<void> {
  try {
    await callFunction('endLiveKitCallV2', { roomId, callId }, RTC_CALLABLE_OPTIONS);
  } catch (error) {
    throw callError(error, '無法同步通話結束狀態，系統稍後會自動回收。');
  }
}
