import { describe, expect, it } from 'vitest';

import {
  callSignalDocumentId,
  confirmedCallStatus,
  decideCallStart,
  isResumableRequestedCall,
  requestedEndStatus,
  isGrantableCallStatus,
  staleTerminalStatus,
  type CallStateSnapshot,
} from '../src/calls/call-state.js';

function call(overrides: Partial<CallStateSnapshot> = {}): CallStateSnapshot {
  return {
    status: 'creating',
    startedBy: 'alice',
    operationId: 'operation-a',
    leaseExpiresAtMs: 2_000,
    ...overrides,
  };
}

describe('server call lifecycle policy', () => {
  it('resumes only the same caller operation and rejects concurrent starts', () => {
    expect(decideCallStart({
      requestedOperationId: 'operation-a', requesterUid: 'alice', pointedCall: call(), nowMs: 1_000,
    })).toEqual({ action: 'resume' });
    expect(decideCallStart({
      requestedOperationId: 'operation-b', requesterUid: 'alice', pointedCall: call(), nowMs: 1_000,
    })).toEqual({ action: 'conflict' });
    expect(decideCallStart({
      requestedOperationId: 'operation-a', requesterUid: 'bob', pointedCall: call(), nowMs: 1_000,
    })).toEqual({ action: 'conflict' });
  });

  it('does not resume an expired or cross-user operation document', () => {
    expect(isResumableRequestedCall({
      call: call(), operationId: 'operation-a', requesterUid: 'alice', nowMs: 1_999,
    })).toBe(true);
    expect(isResumableRequestedCall({
      call: call(), operationId: 'operation-a', requesterUid: 'alice', nowMs: 2_000,
    })).toBe(false);
    expect(isResumableRequestedCall({
      call: call(), operationId: 'operation-a', requesterUid: 'bob', nowMs: 1_000,
    })).toBe(false);
  });

  it('names recipient signals by room and call to prevent cross-room collisions', () => {
    expect(callSignalDocumentId('room-a', 'operation-a')).not.toBe(callSignalDocumentId('room-b', 'operation-a'));
    expect(callSignalDocumentId('room-a', 'operation-a')).not.toContain('/');
  });

  it('replaces an expired lock with a deterministic recovery outcome', () => {
    expect(decideCallStart({
      requestedOperationId: 'operation-b', requesterUid: 'bob', pointedCall: call(), nowMs: 2_000,
    })).toEqual({ action: 'replace-stale', staleStatus: 'failed' });
    expect(staleTerminalStatus('ringing')).toBe('missed');
    expect(staleTerminalStatus('active')).toBe('ended');
    expect(staleTerminalStatus('ending')).toBe('ended');
  });

  it('does not declare active until a non-starter confirms connection', () => {
    expect(confirmedCallStatus('creating', true)).toBe('ringing');
    expect(confirmedCallStatus('ringing', true)).toBe('ringing');
    expect(confirmedCallStatus('ringing', false)).toBe('active');
    expect(confirmedCallStatus('active', false)).toBe('active');
  });

  it('grants transport credentials only for a status that can still be joined', () => {
    // A grant handed out here outlives the call it belongs to, so `ending` and
    // every terminal status must stay ineligible even though `ending` is live.
    expect(isGrantableCallStatus('creating')).toBe(true);
    expect(isGrantableCallStatus('ringing')).toBe(true);
    expect(isGrantableCallStatus('active')).toBe(true);
    expect(isGrantableCallStatus('ending')).toBe(false);
    for (const status of ['ended', 'failed', 'rejected', 'missed', 'cancelled']) {
      expect(isGrantableCallStatus(status)).toBe(false);
    }
    expect(isGrantableCallStatus(undefined)).toBe(false);
    expect(isGrantableCallStatus('nonsense')).toBe(false);
  });

  it('ends idempotently with an outcome that preserves pre-connection cancellation', () => {
    expect(requestedEndStatus('creating')).toBe('cancelled');
    expect(requestedEndStatus('ringing')).toBe('cancelled');
    expect(requestedEndStatus('active')).toBe('ended');
    expect(requestedEndStatus('ending')).toBe('ended');
    expect(requestedEndStatus('failed')).toBe('failed');
    expect(requestedEndStatus('ended')).toBe('ended');
  });
});
