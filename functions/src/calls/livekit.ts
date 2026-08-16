import { FieldValue, Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

import { firestore } from '../admin.js';
import { appCheckEnforced, livekitApiKey, livekitApiSecret, livekitUrl, REGION } from '../config.js';
import { getActiveMembership } from '../shared/membership.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';
import {
  callSignalDocumentId,
  confirmedCallStatus,
  decideCallStart,
  isCallStatus,
  isGrantableCallStatus,
  isLiveCallStatus,
  isResumableRequestedCall,
  isTerminalCallStatus,
  LIVE_CALL_STATUSES,
  requestedEndStatus,
  staleTerminalStatus,
  type CallStateSnapshot,
  type LiveCallStatus,
  type TerminalCallStatus,
} from './call-state.js';

const ENFORCE_APP_CHECK = appCheckEnforced('rtc');
const CONNECT_LEASE_MS = 90_000;
const RING_LEASE_MS = 90_000;
const ACTIVE_LEASE_MS = 120_000;
const END_LEASE_MS = 30_000;
const CALL_SIGNAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const LEGACY_ACTIVE_GRACE_MS = 4 * 60 * 60_000;
const OPERATION_ID = /^[A-Za-z0-9_-]{16,100}$/u;
const FAILURE_CATEGORIES = new Set([
  'aborted',
  'connect-failed',
  'media-permission',
  'provider-disconnected',
  'unknown',
]);

function rtcError(
  errorCode: string,
  message: string,
  code: ConstructorParameters<typeof HttpsError>[0] = 'failed-precondition',
): HttpsError {
  return new HttpsError(code, message, { errorCode });
}

function timestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function stateSnapshot(data: DocumentData | undefined): CallStateSnapshot | null {
  if (!data || !isCallStatus(data.status)) return null;
  const explicitLease = timestampMillis(data.leaseExpiresAt);
  const legacyStartedAt = timestampMillis(data.startedAt);
  return {
    status: data.status,
    startedBy: typeof data.startedBy === 'string' ? data.startedBy : '',
    operationId: typeof data.operationId === 'string' ? data.operationId : '',
    leaseExpiresAtMs: explicitLease || (data.status === 'active' && legacyStartedAt
      ? legacyStartedAt + LEGACY_ACTIVE_GRACE_MS
      : 0),
  };
}

function assertActiveMembership(data: DocumentData | undefined): void {
  if (!data || data.status !== 'active') {
    throw rtcError('CALL_MEMBERSHIP_REQUIRED', '你已不是這個聊天室的有效成員。', 'permission-denied');
  }
}

function requireOperationId(value: unknown): string {
  const operationId = requireString(value, 'operationId', 100);
  if (!OPERATION_ID.test(operationId)) {
    throw rtcError('CALL_OPERATION_INVALID', '通話操作識別碼不正確。', 'invalid-argument');
  }
  return operationId;
}

function leaseDuration(status: LiveCallStatus): number {
  if (status === 'creating') return CONNECT_LEASE_MS;
  if (status === 'ringing') return RING_LEASE_MS;
  if (status === 'ending') return END_LEASE_MS;
  return ACTIVE_LEASE_MS;
}

function activeCallReference(roomId: string, callId: unknown): DocumentReference | null {
  if (typeof callId !== 'string' || !OPERATION_ID.test(callId)) return null;
  return firestore.doc(`rooms/${roomId}/calls/${callId}`);
}

function assertJoinableCall(data: DocumentData | undefined, uid: string, nowMs: number): LiveCallStatus {
  if (!data || !isLiveCallStatus(data.status) || data.status === 'ending') {
    throw rtcError('CALL_NOT_JOINABLE', '通話已經結束或不存在。');
  }
  if (timestampMillis(data.leaseExpiresAt) <= nowMs) {
    throw rtcError('CALL_LEASE_EXPIRED', '通話邀請已過期。');
  }
  if (data.status === 'creating' && data.startedBy !== uid) {
    throw rtcError('CALL_NOT_READY', '通話仍在建立中。');
  }
  return data.status;
}

/**
 * The transport grant. Callables that have *already* established the caller may
 * join return it inline so the client does not spend a second round trip on
 * `getLiveKitTokenV2`. Every round trip costs the client a fresh limited-use
 * App Check attestation, which measured far larger than the handler itself, so
 * the round trip - not the server work - is what is worth removing.
 */
interface LiveKitGrant {
  url: string;
  token: string;
  expiresIn: number;
}

/**
 * The single place a LiveKit grant is minted. The publish sources are derived
 * from the call kind, never from the client: a voice call must not be handed a
 * camera grant.
 */
async function issueLiveKitGrant(input: {
  roomId: string;
  callId: string;
  kind: unknown;
  identity: string;
  displayName: string;
  role: string;
}): Promise<LiveKitGrant> {
  const publishSources = [
    TrackSource.MICROPHONE,
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
    ...(input.kind === 'video' ? [TrackSource.CAMERA] : []),
  ];
  const rtcRoom = `room_${Buffer.from(input.roomId).toString('base64url')}_${input.callId}`;
  const token = new AccessToken(livekitApiKey.value(), livekitApiSecret.value(), {
    identity: input.identity,
    name: input.displayName,
    ttl: '10m',
    metadata: JSON.stringify({ roomId: input.roomId, callId: input.callId, role: input.role }),
  });
  token.addGrant({
    room: rtcRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: publishSources,
  });
  return { url: livekitUrl.value(), token: await token.toJwt(), expiresIn: 600 };
}

/**
 * Best-effort inline grant for a caller/callee whose transition has *already*
 * committed. A mint failure must never fail the transition it is attached to -
 * that would strand a `creating` call and the room lock behind a token problem -
 * so it degrades to no grant and the client falls back to `getLiveKitTokenV2`.
 */
async function tryIssueLiveKitGrant(
  input: Parameters<typeof issueLiveKitGrant>[0] & { status: unknown; operation: string },
): Promise<LiveKitGrant | undefined> {
  if (!isGrantableCallStatus(input.status)) return undefined;
  try {
    return await issueLiveKitGrant(input);
  } catch (error) {
    logger.warn('RTC inline grant skipped', {
      operation: input.operation,
      roomId: input.roomId,
      callId: input.callId,
      result: 'grant-unavailable',
      errorCategory: error instanceof Error ? error.name : 'unknown',
    });
    return undefined;
  }
}

export const getLiveKitTokenV2 = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    secrets: [livekitUrl, livekitApiKey, livekitApiSecret],
  },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    const membership = await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const call = await firestore.runTransaction(async (transaction) => {
      const [callSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(memberRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      return callSnapshot.data();
    });
    assertJoinableCall(call, auth.uid, Date.now());
    const grant = await issueLiveKitGrant({
      roomId,
      callId,
      kind: call?.kind,
      identity: auth.uid,
      displayName: membership.displayName,
      role: membership.role,
    });
    logger.info('RTC token issued', {
      operation: 'rtc.token', roomId, callId, result: 'issued', durationMs: Date.now() - startedAt,
    });
    return grant;
  },
);

export const startLiveKitCallV2 = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    // Held so the created call can carry its grant back in the same response.
    secrets: [livekitUrl, livekitApiKey, livekitApiSecret],
  },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const operationId = requireOperationId(data.operationId);
    const kind = data.kind === 'video' ? 'video' : data.kind === 'voice' ? 'voice' : null;
    if (!kind) throw rtcError('CALL_KIND_INVALID', '通話類型不正確。', 'invalid-argument');
    const membership = await getActiveMembership(roomId, auth.uid);
    const callId = operationId;
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const now = Timestamp.now();
    const result = await firestore.runTransaction(async (transaction) => {
      const [roomSnapshot, requestedSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(callRef),
        transaction.get(memberRef),
      ]);
      if (!roomSnapshot.exists) throw rtcError('CALL_ROOM_NOT_FOUND', '聊天室不存在。', 'not-found');
      assertActiveMembership(memberSnapshot.data());

      const requested = stateSnapshot(requestedSnapshot.data());
      if (requestedSnapshot.exists) {
        if (requested?.operationId !== operationId || requested.startedBy !== auth.uid) {
          throw rtcError('CALL_OPERATION_CONFLICT', '通話操作識別碼已被使用。', 'already-exists');
        }
        if (requested && isResumableRequestedCall({
          call: requested,
          operationId,
          requesterUid: auth.uid,
          nowMs: now.toMillis(),
        })) {
          return { callId, kind: requestedSnapshot.data()?.kind === 'video' ? 'video' as const : 'voice' as const, status: requested.status };
        }
        throw rtcError('CALL_OPERATION_FINISHED', '這次通話操作已經結束，請重新撥號。');
      }

      let pointedRef = activeCallReference(roomId, roomSnapshot.data()?.activeCallId);
      let pointedSnapshot = pointedRef && pointedRef.path !== callRef.path
        ? await transaction.get(pointedRef)
        : null;
      if (!pointedRef) {
        const legacyCalls = await transaction.get(
          firestore.collection(`rooms/${roomId}/calls`)
            .where('status', 'in', [...LIVE_CALL_STATUSES])
            .limit(10),
        );
        if (legacyCalls.size === 10) {
          throw rtcError(
            'CALL_INVARIANT_REPAIR_REQUIRED',
            '聊天室通話狀態需要清理後才能建立新通話。',
            'aborted',
          );
        }
        const freshLegacy = legacyCalls.docs.find((candidate) => (
          candidate.id !== callId && (stateSnapshot(candidate.data())?.leaseExpiresAtMs ?? 0) > now.toMillis()
        ));
        if (freshLegacy) {
          pointedRef = freshLegacy.ref;
          pointedSnapshot = freshLegacy;
        } else {
          for (const staleLegacy of legacyCalls.docs) {
            const staleState = stateSnapshot(staleLegacy.data());
            if (!staleState || !isLiveCallStatus(staleState.status)) continue;
            transaction.update(staleLegacy.ref, {
              status: staleTerminalStatus(staleState.status),
              endedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              failureCategory: 'legacy-lock-recovery',
              leaseExpiresAt: FieldValue.delete(),
            });
          }
        }
      }
      const pointedCall = stateSnapshot(pointedSnapshot?.data());
      const decision = decideCallStart({
        requestedOperationId: operationId,
        requesterUid: auth.uid,
        pointedCall,
        nowMs: now.toMillis(),
      });
      if (decision.action === 'conflict' || decision.action === 'resume') {
        throw rtcError('CALL_ALREADY_ACTIVE', '這個聊天室已有進行中的通話。', 'already-exists');
      }
      if (decision.action === 'replace-stale' && pointedRef && pointedSnapshot?.exists) {
        transaction.update(pointedRef, {
          status: decision.staleStatus,
          endedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          failureCategory: 'lease-expired-on-start',
          leaseExpiresAt: FieldValue.delete(),
        });
      }

      transaction.create(callRef, {
        roomId,
        callId,
        operationId,
        kind,
        status: 'creating',
        startedBy: auth.uid,
        startedByDisplayName: membership.displayName,
        connectedParticipantIds: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + CONNECT_LEASE_MS),
      });
      transaction.update(roomRef, {
        activeCallId: callId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { callId, kind, status: 'creating' as const };
    });
    // Minted only after the lock and the transition have committed, so a token
    // problem can never leave a half-created call holding `activeCallId`.
    const grant = await tryIssueLiveKitGrant({
      roomId,
      callId,
      kind: result.kind,
      status: result.status,
      identity: auth.uid,
      displayName: membership.displayName,
      role: membership.role,
      operation: 'rtc.start',
    });
    logger.info('RTC call intent created', {
      operation: 'rtc.start',
      roomId,
      callId,
      result: result.status,
      grant: grant ? 'inline' : 'deferred',
      durationMs: Date.now() - startedAt,
    });
    return { ...result, grant };
  },
);

export const confirmLiveKitCall = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    const membership = await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const messageRef = firestore.doc(`rooms/${roomId}/messages/call_${callId}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const now = Timestamp.now();
    const result = await firestore.runTransaction(async (transaction) => {
      const [callSnapshot, roomSnapshot, messageSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(roomRef), transaction.get(messageRef),
        transaction.get(memberRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      const call = callSnapshot.data();
      const current = assertJoinableCall(call, auth.uid, now.toMillis());
      const isStarter = call?.startedBy === auth.uid;
      const status = confirmedCallStatus(current, isStarter);
      if (status === 'creating') throw rtcError('CALL_NOT_READY', '請先等待發起者完成連線。');
      const updates: DocumentData = {
        status,
        connectedParticipantIds: FieldValue.arrayUnion(auth.uid),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + leaseDuration(status)),
      };
      if (current === 'creating' && status === 'ringing') {
        updates.ringingAt = FieldValue.serverTimestamp();
        if (!messageSnapshot.exists) {
          transaction.create(messageRef, {
            roomId,
            senderId: auth.uid,
            senderType: 'system',
            senderDisplayName: membership.displayName,
            kind: 'call',
            callId,
            event: 'started',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
      if (current !== 'active' && status === 'active') updates.activeAt = FieldValue.serverTimestamp();
      transaction.update(callRef, updates);
      if (roomSnapshot.exists && roomSnapshot.data()?.activeCallId !== callId) {
        throw rtcError('CALL_LOCK_LOST', '通話鎖定已失效。');
      }
      transaction.update(roomRef, { updatedAt: FieldValue.serverTimestamp() });
      return { callId, status, connectedAtMs: now.toMillis() };
    });
    logger.info('RTC connection confirmed', {
      operation: 'rtc.confirm', roomId, callId, result: result.status, durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

export const respondLiveKitCall = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    // Held so an accepted invitation can carry its grant back in the same response.
    secrets: [livekitUrl, livekitApiKey, livekitApiSecret],
  },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    const action = data.action === 'accepted' ? 'accepted' : data.action === 'rejected' ? 'rejected' : null;
    if (!action) throw rtcError('CALL_RESPONSE_INVALID', '來電回應不正確。', 'invalid-argument');
    const membership = await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const signalRef = firestore.doc(`users/${auth.uid}/incomingCalls/${callSignalDocumentId(roomId, callId)}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const result = await firestore.runTransaction(async (transaction) => {
      const [callSnapshot, roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(roomRef), transaction.get(memberRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      const call = callSnapshot.data();
      if (!callSnapshot.exists || !isLiveCallStatus(call?.status) || call.status === 'creating' || call.status === 'ending') {
        throw rtcError('CALL_NOT_RINGING', '這通來電已經無法回應。');
      }
      transaction.set(signalRef, {
        roomId,
        callId,
        kind: call.kind,
        startedBy: call.startedBy,
        startedByDisplayName: call.startedByDisplayName,
        status: action,
        respondedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + CALL_SIGNAL_RETENTION_MS),
      }, { merge: true });
      if (action === 'rejected' && roomSnapshot.data()?.type === 'direct' && call.status === 'ringing') {
        transaction.update(callRef, {
          status: 'rejected',
          endedBy: auth.uid,
          endedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          leaseExpiresAt: FieldValue.delete(),
        });
        if (roomSnapshot.data()?.activeCallId === callId) {
          transaction.update(roomRef, { activeCallId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
        }
        return { callId, status: 'rejected' as const, kind: call.kind, callStatus: 'rejected' };
      }
      return { callId, status: action, kind: call.kind, callStatus: call.status };
    });
    // Only an acceptance is about to join, so only an acceptance gets a grant;
    // `isGrantableCallStatus` keeps a rejected or already-ending call from getting one.
    const grant = result.status === 'accepted'
      ? await tryIssueLiveKitGrant({
        roomId,
        callId,
        kind: result.kind,
        status: result.callStatus,
        identity: auth.uid,
        displayName: membership.displayName,
        role: membership.role,
        operation: 'rtc.respond',
      })
      : undefined;
    logger.info('RTC invitation response recorded', {
      operation: 'rtc.respond',
      roomId,
      callId,
      result: result.status,
      grant: grant ? 'inline' : 'deferred',
      durationMs: Date.now() - startedAt,
    });
    return { callId: result.callId, status: result.status, grant };
  },
);

export const heartbeatLiveKitCall = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const result = await firestore.runTransaction(async (transaction) => {
      const [snapshot, memberSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(memberRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      const call = snapshot.data();
      if (!snapshot.exists || !isCallStatus(call?.status)) throw rtcError('CALL_NOT_FOUND', '通話不存在。', 'not-found');
      if (isTerminalCallStatus(call.status)) return { callId, status: call.status };
      if (call.startedBy !== auth.uid) return { callId, status: call.status };
      transaction.update(callRef, {
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + leaseDuration(call.status)),
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { callId, status: call.status };
    });
    logger.debug('RTC heartbeat recorded', {
      operation: 'rtc.heartbeat', roomId, callId, result: result.status, durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

export const failLiveKitCall = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    const requestedCategory = typeof data.category === 'string' ? data.category : 'unknown';
    const category = FAILURE_CATEGORIES.has(requestedCategory) ? requestedCategory : 'unknown';
    await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const signalRef = firestore.doc(`users/${auth.uid}/incomingCalls/${callSignalDocumentId(roomId, callId)}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const result = await firestore.runTransaction(async (transaction) => {
      const [callSnapshot, roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(roomRef), transaction.get(memberRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      const call = callSnapshot.data();
      if (!callSnapshot.exists || !isCallStatus(call?.status)) return { callId, status: 'failed' as const };
      if (isTerminalCallStatus(call.status)) return { callId, status: call.status };
      if (call.startedBy !== auth.uid) {
        transaction.set(signalRef, {
          status: 'failed',
          failureCategory: category,
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + CALL_SIGNAL_RETENTION_MS),
        }, { merge: true });
        return { callId, status: 'failed' as const };
      }
      transaction.update(callRef, {
        status: 'failed',
        failureCategory: category,
        failedAt: FieldValue.serverTimestamp(),
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      });
      if (roomSnapshot.data()?.activeCallId === callId) {
        transaction.update(roomRef, { activeCallId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      }
      return { callId, status: 'failed' as const };
    });
    logger.warn('RTC connection failed', {
      operation: 'rtc.fail', roomId, callId, result: result.status, errorCategory: category,
      durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

export const endLiveKitCallV2 = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const startedAt = Date.now();
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireOperationId(data.callId);
    await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const memberRef = firestore.doc(`rooms/${roomId}/members/${auth.uid}`);
    const ending = await firestore.runTransaction(async (transaction) => {
      const [snapshot, memberSnapshot, roomSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(memberRef), transaction.get(roomRef),
      ]);
      assertActiveMembership(memberSnapshot.data());
      const call = snapshot.data();
      if (!snapshot.exists || !isCallStatus(call?.status)) throw rtcError('CALL_NOT_FOUND', '通話不存在。', 'not-found');
      if (isTerminalCallStatus(call.status)) {
        if (roomSnapshot.data()?.activeCallId === callId) {
          transaction.update(roomRef, { activeCallId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
        }
        return { terminal: call.status };
      }
      if (call.startedBy !== auth.uid && !['owner', 'admin'].includes(String(memberSnapshot.data()?.role))) {
        throw rtcError('CALL_END_FORBIDDEN', '只有發起者或房間管理員可以結束通話。', 'permission-denied');
      }
      if (call.status === 'ending') return { terminal: null };
      const endOutcome = requestedEndStatus(call.status);
      transaction.update(callRef, {
        status: 'ending',
        endOutcome,
        endingBy: auth.uid,
        endingAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + END_LEASE_MS),
      });
      return { terminal: null };
    });
    if (ending.terminal) return { callId, status: ending.terminal };

    const result = await firestore.runTransaction(async (transaction) => {
      const [callSnapshot, roomSnapshot] = await Promise.all([
        transaction.get(callRef), transaction.get(roomRef),
      ]);
      const call = callSnapshot.data();
      if (!callSnapshot.exists || !isCallStatus(call?.status)) return { callId, status: 'ended' as const };
      if (isTerminalCallStatus(call.status)) return { callId, status: call.status };
      const status: TerminalCallStatus = isTerminalCallStatus(call.endOutcome) ? call.endOutcome : 'ended';
      transaction.update(callRef, {
        status,
        endedBy: auth.uid,
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      });
      if (roomSnapshot.data()?.activeCallId === callId) {
        transaction.update(roomRef, { activeCallId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      }
      return { callId, status };
    });
    logger.info('RTC call ended', {
      operation: 'rtc.end', roomId, callId, result: result.status, durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

function recoveryStatus(call: DocumentData): TerminalCallStatus {
  if (call.status === 'ending' && isTerminalCallStatus(call.endOutcome)) return call.endOutcome;
  return staleTerminalStatus(call.status as LiveCallStatus);
}

export const cleanupStaleLiveKitCalls = onSchedule(
  { region: REGION, schedule: 'every 5 minutes', retryCount: 3 },
  async () => {
    const startedAt = Date.now();
    const now = Timestamp.now();
    const [stale, legacy] = await Promise.all([
      firestore.collectionGroup('calls')
        .where('status', 'in', ['creating', 'ringing', 'active', 'ending'])
        .where('leaseExpiresAt', '<=', now)
        .limit(100)
        .get(),
      firestore.collectionGroup('calls')
        .where('status', '==', 'active')
        .where('startedAt', '<=', Timestamp.fromMillis(now.toMillis() - LEGACY_ACTIVE_GRACE_MS))
        .limit(100)
        .get(),
    ]);
    const candidates = [...new Map([...stale.docs, ...legacy.docs].map((candidate) => (
      [candidate.ref.path, candidate] as const
    ))).values()];
    for (let index = 0; index < candidates.length; index += 10) {
      await Promise.all(candidates.slice(index, index + 10).map(async (candidate) => {
        await firestore.runTransaction(async (transaction) => {
          const callSnapshot = await transaction.get(candidate.ref);
          const call = callSnapshot.data();
          const snapshot = stateSnapshot(call);
          if (!callSnapshot.exists || !call || !snapshot || !isLiveCallStatus(snapshot.status)
            || snapshot.leaseExpiresAtMs > now.toMillis()) return;
          const roomId = typeof call.roomId === 'string' ? call.roomId : '';
          if (!roomId) return;
          const roomRef = firestore.doc(`rooms/${roomId}`);
          const roomSnapshot = await transaction.get(roomRef);
          const status = recoveryStatus(call);
          transaction.update(candidate.ref, {
            status,
            endedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            failureCategory: call.status === 'creating' ? 'connect-timeout' : `stale-${call.status}`,
            leaseExpiresAt: FieldValue.delete(),
          });
          if (roomSnapshot.data()?.activeCallId === candidate.id) {
            transaction.update(roomRef, { activeCallId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
          }
        });
      }));
    }
    logger.info('RTC stale-call cleanup complete', {
      operation: 'rtc.cleanup', result: 'complete', count: candidates.length, durationMs: Date.now() - startedAt,
    });
  },
);
