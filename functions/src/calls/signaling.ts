import { FieldPath, FieldValue, Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { firestore } from '../admin.js';
import { REGION } from '../config.js';
import { prunePushTargets, pushTargetsForUsers, type PushTarget } from '../notifications/push-registry.js';
import { callSignalDocumentId, isCallStatus, isTerminalCallStatus, type CallStatus } from './call-state.js';

const PAGE_SIZE = 200;
const WRITE_BATCH_SIZE = 400;
const PUSH_BATCH_SIZE = 500;
const SIGNAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TERMINAL_SIGNAL_STATUSES = new Set(['rejected', 'failed']);

async function activeMemberIds(roomId: string, startedBy: string): Promise<string[]> {
  const result: string[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = firestore.collection(`rooms/${roomId}/members`)
      .where('status', '==', 'active')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const member of page.docs) {
      if (member.id !== startedBy) result.push(member.id);
    }
    cursor = page.docs.at(-1);
  } while (cursor);
  return result;
}

async function writeInChunks(
  documents: Array<{ ref: FirebaseFirestore.DocumentReference; data: DocumentData }>,
): Promise<void> {
  for (let index = 0; index < documents.length; index += WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    for (const document of documents.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.set(document.ref, document.data, { merge: true });
    }
    await batch.commit();
  }
}

async function createMissingInChunks(
  documents: Array<{ ref: FirebaseFirestore.DocumentReference; data: DocumentData }>,
): Promise<void> {
  for (let index = 0; index < documents.length; index += WRITE_BATCH_SIZE) {
    const chunk = documents.slice(index, index + WRITE_BATCH_SIZE);
    const snapshots = await firestore.getAll(...chunk.map((document) => document.ref));
    const batch = firestore.batch();
    let writes = 0;
    snapshots.forEach((snapshot, position) => {
      const document = chunk[position];
      if (!snapshot.exists && document) {
        batch.create(document.ref, document.data);
        writes += 1;
      }
    });
    if (writes) await batch.commit();
  }
}

async function notifyIncomingCall(
  uids: string[],
  call: DocumentData,
  roomId: string,
  callId: string,
): Promise<void> {
  const startedAt = Date.now();
  const targets = await pushTargetsForUsers(uids);
  const stale: PushTarget[] = [];
  const kind = call.kind === 'video' ? 'video' : 'voice';
  const title = kind === 'video' ? '視訊來電' : '語音來電';
  const caller = typeof call.startedByDisplayName === 'string' ? call.startedByDisplayName : '聊天室成員';
  for (let index = 0; index < targets.length; index += PUSH_BATCH_SIZE) {
    const batch = targets.slice(index, index + PUSH_BATCH_SIZE);
    const response = await getMessaging().sendEachForMulticast({
      tokens: batch.map((target) => target.token),
      data: {
        type: 'call',
        action: 'incoming',
        title,
        body: `${caller} 邀請你加入通話`,
        roomId,
        callId,
        kind,
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '90' },
        fcmOptions: { link: `/?room=${encodeURIComponent(roomId)}&call=${encodeURIComponent(callId)}` },
      },
    });
    response.responses.forEach((result, position) => {
      const code = result.error?.code;
      const target = batch[position];
      if (target && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
        stale.push(target);
      }
    });
  }
  if (stale.length) await prunePushTargets(stale);
  logger.info('RTC incoming push complete', {
    operation: 'rtc.signal.push', roomId, callId, result: 'complete', recipients: uids.length, targets: targets.length,
    durationMs: Date.now() - startedAt,
  });
}

async function createRingingSignals(call: DocumentData, roomId: string, callId: string): Promise<void> {
  const startedBy = typeof call.startedBy === 'string' ? call.startedBy : '';
  if (!startedBy) return;
  const recipients = await activeMemberIds(roomId, startedBy);
  const expiresAt = Timestamp.fromMillis(Date.now() + SIGNAL_RETENTION_MS);
  await createMissingInChunks(recipients.map((uid) => ({
    ref: firestore.doc(`users/${uid}/incomingCalls/${callSignalDocumentId(roomId, callId)}`),
    data: {
      roomId,
      callId,
      kind: call.kind === 'video' ? 'video' : 'voice',
      status: 'ringing',
      startedBy,
      startedByDisplayName: typeof call.startedByDisplayName === 'string' ? call.startedByDisplayName : '聊天室成員',
      createdAt: call.ringingAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt,
    },
  })));
  const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
  const pushClaim = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(callRef);
    const current = snapshot.data();
    if (!snapshot.exists || !isCallStatus(current?.status)) return { claimed: false, status: null };
    if (current.status !== 'ringing') return { claimed: false, status: current.status };
    if (current.incomingPushClaimedAt) return { claimed: false, status: current.status };
    transaction.update(callRef, {
      incomingPushClaimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, status: current.status };
  });
  if (pushClaim.status && pushClaim.status !== 'ringing') {
    await updateExistingSignals(roomId, callId, pushClaim.status);
    return;
  }
  if (pushClaim.claimed) await notifyIncomingCall(recipients, call, roomId, callId);
}

async function updateExistingSignals(roomId: string, callId: string, status: CallStatus): Promise<void> {
  const terminal = isTerminalCallStatus(status);
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = firestore.collectionGroup('incomingCalls')
      .where('roomId', '==', roomId)
      .where('callId', '==', callId)
      .orderBy(FieldPath.documentId())
      .limit(WRITE_BATCH_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const signals = await query.get();
    const documents = signals.docs.flatMap((signal) => {
      if (TERMINAL_SIGNAL_STATUSES.has(String(signal.data().status))) return [];
      return [{
        ref: signal.ref,
        data: {
          status,
          updatedAt: FieldValue.serverTimestamp(),
          ...(terminal ? { expiresAt: Timestamp.fromMillis(Date.now() + SIGNAL_RETENTION_MS) } : {}),
        },
      }];
    });
    await writeInChunks(documents);
    cursor = signals.docs.at(-1);
  } while (cursor);
}

export const syncCallSignals = onDocumentWritten(
  { region: REGION, document: 'rooms/{roomId}/calls/{callId}', retry: true },
  async (event) => {
    const startedAt = Date.now();
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || !isCallStatus(after.status) || before?.status === after.status) return;
    const { roomId, callId } = event.params;
    if (after.status === 'ringing') await createRingingSignals(after, roomId, callId);
    else if (after.status === 'active' || isTerminalCallStatus(after.status)) {
      await updateExistingSignals(roomId, callId, after.status);
    }
    logger.info('RTC call signals synchronized', {
      operation: 'rtc.signal.sync', roomId, callId, result: after.status, durationMs: Date.now() - startedAt,
    });
  },
);

export const cleanupExpiredCallSignals = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', retryCount: 3 },
  async () => {
    const startedAt = Date.now();
    const expired = await firestore.collectionGroup('incomingCalls')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(PAGE_SIZE)
      .get();
    for (let index = 0; index < expired.docs.length; index += WRITE_BATCH_SIZE) {
      const batch = firestore.batch();
      for (const signal of expired.docs.slice(index, index + WRITE_BATCH_SIZE)) batch.delete(signal.ref);
      await batch.commit();
    }
    logger.info('RTC signal cleanup complete', {
      operation: 'rtc.signal.cleanup', result: 'complete', count: expired.size, durationMs: Date.now() - startedAt,
    });
  },
);
