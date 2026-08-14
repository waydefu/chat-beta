export const LIVE_CALL_STATUSES = ['creating', 'ringing', 'active', 'ending'] as const;
export const TERMINAL_CALL_STATUSES = ['ended', 'failed', 'rejected', 'missed', 'cancelled'] as const;

export type LiveCallStatus = typeof LIVE_CALL_STATUSES[number];
export type TerminalCallStatus = typeof TERMINAL_CALL_STATUSES[number];
export type CallStatus = LiveCallStatus | TerminalCallStatus;

export interface CallStateSnapshot {
  status: CallStatus;
  startedBy: string;
  operationId: string;
  leaseExpiresAtMs: number;
}

export type StartCallDecision =
  | { action: 'create' }
  | { action: 'resume' }
  | { action: 'replace-stale'; staleStatus: TerminalCallStatus }
  | { action: 'conflict' };

export function isCallStatus(value: unknown): value is CallStatus {
  return typeof value === 'string'
    && ([...LIVE_CALL_STATUSES, ...TERMINAL_CALL_STATUSES] as string[]).includes(value);
}

export function isLiveCallStatus(value: unknown): value is LiveCallStatus {
  return typeof value === 'string' && (LIVE_CALL_STATUSES as readonly string[]).includes(value);
}

export function isTerminalCallStatus(value: unknown): value is TerminalCallStatus {
  return typeof value === 'string' && (TERMINAL_CALL_STATUSES as readonly string[]).includes(value);
}

export function callSignalDocumentId(roomId: string, callId: string): string {
  return `${Buffer.from(roomId).toString('base64url')}.${callId}`;
}

export function isResumableRequestedCall(input: {
  call: CallStateSnapshot;
  operationId: string;
  requesterUid: string;
  nowMs: number;
}): boolean {
  return isLiveCallStatus(input.call.status)
    && input.call.operationId === input.operationId
    && input.call.startedBy === input.requesterUid
    && input.call.leaseExpiresAtMs > input.nowMs;
}

export function staleTerminalStatus(status: LiveCallStatus): TerminalCallStatus {
  if (status === 'creating') return 'failed';
  if (status === 'ringing') return 'missed';
  return 'ended';
}

export function decideCallStart(input: {
  requestedOperationId: string;
  requesterUid: string;
  pointedCall: CallStateSnapshot | null;
  nowMs: number;
}): StartCallDecision {
  const { pointedCall } = input;
  if (!pointedCall || isTerminalCallStatus(pointedCall.status)) return { action: 'create' };
  if (pointedCall.leaseExpiresAtMs <= input.nowMs) {
    return { action: 'replace-stale', staleStatus: staleTerminalStatus(pointedCall.status) };
  }
  if (pointedCall.operationId === input.requestedOperationId && pointedCall.startedBy === input.requesterUid) {
    return { action: 'resume' };
  }
  return { action: 'conflict' };
}

export function confirmedCallStatus(current: LiveCallStatus, isStarter: boolean): LiveCallStatus {
  if (current === 'creating') return isStarter ? 'ringing' : 'creating';
  if (current === 'ringing' && !isStarter) return 'active';
  return current;
}

export function requestedEndStatus(current: CallStatus): CallStatus {
  if (isTerminalCallStatus(current)) return current;
  if (current === 'creating' || current === 'ringing') return 'cancelled';
  return 'ended';
}
