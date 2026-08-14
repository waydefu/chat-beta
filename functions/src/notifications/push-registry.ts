import { FieldValue, Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { firestore } from '../admin.js';
import { appCheckEnforced, REGION } from '../config.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';
import {
  canReleasePushClaim,
  isPushTokenHash,
  legacyPushTokenDocumentId,
  pushClaimAction,
  pushTokenHash,
} from './push-policy.js';

const ENFORCE_APP_CHECK = appCheckEnforced('notifications');
const CLAIM_SCHEMA_VERSION = 1;
const USER_QUERY_CHUNK = 30;
const TARGET_PAGE_SIZE = 500;
// Each target deletes a canonical claim and one user mirror. Keep the resulting
// write batch below Firestore's 500-operation limit.
const WRITE_BATCH_SIZE = 200;
const STALE_TOKEN_AGE_MS = 90 * 24 * 60 * 60_000;
const STALE_CLEANUP_PAGES = 5;

export interface PushTarget {
  uid: string;
  token: string;
  tokenHash: string;
  claimRef: DocumentReference;
  userTokenRef: DocumentReference;
}

function callableOptions() {
  return {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
  } as const;
}

export const claimPushToken = onCall(callableOptions(), async (request) => {
  const startedAt = Date.now();
  const uid = requireAuth(request).uid;
  const data = requireRecord(request.data);
  const token = requireString(data.token, 'token', 2_048);
  const userAgent = typeof data.userAgent === 'string' ? data.userAgent.slice(0, 300) : '';
  const hash = pushTokenHash(token);
  const requestedPreviousHash = data.previousTokenHash === undefined
    ? null
    : requireString(data.previousTokenHash, 'previousTokenHash', 64);
  if (requestedPreviousHash && !isPushTokenHash(requestedPreviousHash)) {
    throw new HttpsError('invalid-argument', 'previousTokenHash 格式不正確。', { errorCode: 'PUSH_TOKEN_INVALID' });
  }
  const previousHash = requestedPreviousHash && requestedPreviousHash !== hash ? requestedPreviousHash : null;
  const claimRef = firestore.doc(`pushTokenClaims/${hash}`);
  const userTokenRef = firestore.doc(`users/${uid}/pushTokens/${hash}`);
  const legacyId = legacyPushTokenDocumentId(token);
  let replacedOwner = false;

  await firestore.runTransaction(async (transaction) => {
    const claim = await transaction.get(claimRef);
    const previousClaimRef = previousHash ? firestore.doc(`pushTokenClaims/${previousHash}`) : null;
    const previousClaim = previousClaimRef ? await transaction.get(previousClaimRef) : null;
    const priorUid = claim.data()?.uid;
    const action = pushClaimAction(priorUid, uid);
    if (action === 'replace' && typeof priorUid === 'string') {
      transaction.delete(firestore.doc(`users/${priorUid}/pushTokens/${hash}`));
      if (legacyId !== hash) transaction.delete(firestore.doc(`users/${priorUid}/pushTokens/${legacyId}`));
      replacedOwner = true;
    }
    if (legacyId !== hash) transaction.delete(firestore.doc(`users/${uid}/pushTokens/${legacyId}`));
    if (previousClaimRef && previousClaim && canReleasePushClaim(previousClaim.data()?.uid, uid)) {
      transaction.delete(previousClaimRef);
      transaction.delete(firestore.doc(`users/${uid}/pushTokens/${previousClaimRef.id}`));
    }
    const timestamps = claim.exists ? {} : { createdAt: FieldValue.serverTimestamp() };
    transaction.set(claimRef, {
      uid,
      token,
      userAgent,
      schemaVersion: CLAIM_SCHEMA_VERSION,
      ...timestamps,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(userTokenRef, {
      token,
      tokenHash: hash,
      userAgent,
      ownershipVersion: CLAIM_SCHEMA_VERSION,
      ...timestamps,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('Push token claim complete', {
    operation: 'push.token.claim', result: 'complete', replacedOwner, durationMs: Date.now() - startedAt,
  });
  return { tokenHash: hash, uid };
});

export const releasePushToken = onCall(callableOptions(), async (request) => {
  const startedAt = Date.now();
  const uid = requireAuth(request).uid;
  const data = requireRecord(request.data);
  const token = typeof data.token === 'string' ? requireString(data.token, 'token', 2_048) : null;
  const requestedHash = typeof data.tokenHash === 'string' ? requireString(data.tokenHash, 'tokenHash', 64) : '';
  const hash = token ? pushTokenHash(token) : requestedHash;
  if (!isPushTokenHash(hash)) {
    throw new HttpsError('invalid-argument', 'tokenHash 格式不正確。', { errorCode: 'PUSH_TOKEN_INVALID' });
  }
  const claimRef = firestore.doc(`pushTokenClaims/${hash}`);
  const legacyId = token ? legacyPushTokenDocumentId(token) : null;
  let released = false;

  await firestore.runTransaction(async (transaction) => {
    const claim = await transaction.get(claimRef);
    if (canReleasePushClaim(claim.data()?.uid, uid)) {
      transaction.delete(claimRef);
      transaction.delete(firestore.doc(`users/${uid}/pushTokens/${hash}`));
      released = true;
    } else {
      transaction.delete(firestore.doc(`users/${uid}/pushTokens/${hash}`));
    }
    if (legacyId && legacyId !== hash) transaction.delete(firestore.doc(`users/${uid}/pushTokens/${legacyId}`));
  });

  logger.info('Push token release complete', {
    operation: 'push.token.release', result: 'complete', released, durationMs: Date.now() - startedAt,
  });
  return { released };
});

export async function pushTargetsForUsers(uids: readonly string[]): Promise<PushTarget[]> {
  const uniqueUids = [...new Set(uids)];
  const result: PushTarget[] = [];
  for (let uidIndex = 0; uidIndex < uniqueUids.length; uidIndex += USER_QUERY_CHUNK) {
    const uidChunk = uniqueUids.slice(uidIndex, uidIndex + USER_QUERY_CHUNK);
    if (!uidChunk.length) continue;
    let cursor: QueryDocumentSnapshot | undefined;
    do {
      let query = firestore.collection('pushTokenClaims')
        .where('uid', 'in', uidChunk)
        .limit(TARGET_PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const claim of page.docs) {
        const data = claim.data();
        if (typeof data.uid !== 'string' || typeof data.token !== 'string' || !data.token) continue;
        result.push({
          uid: data.uid,
          token: data.token,
          tokenHash: claim.id,
          claimRef: claim.ref,
          userTokenRef: firestore.doc(`users/${data.uid}/pushTokens/${claim.id}`),
        });
      }
      cursor = page.size === TARGET_PAGE_SIZE ? page.docs.at(-1) : undefined;
    } while (cursor);
  }
  return result;
}

export async function prunePushTargets(targets: readonly PushTarget[]): Promise<void> {
  const unique = new Map(targets.map((target) => [target.tokenHash, target]));
  const entries = [...unique.values()];
  for (let index = 0; index < entries.length; index += WRITE_BATCH_SIZE) {
    const batch = firestore.batch();
    for (const target of entries.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.delete(target.claimRef);
      batch.delete(target.userTokenRef);
    }
    await batch.commit();
  }
}

export const cleanupStalePushTokens = onSchedule(
  { region: REGION, schedule: 'every day 04:25', timeZone: 'Asia/Taipei', retryCount: 3 },
  async () => {
    const startedAt = Date.now();
    const cutoff = Timestamp.fromMillis(Date.now() - STALE_TOKEN_AGE_MS);
    let removed = 0;
    for (let pageIndex = 0; pageIndex < STALE_CLEANUP_PAGES; pageIndex += 1) {
      const page = await firestore.collection('pushTokenClaims')
        .where('updatedAt', '<=', cutoff)
        .orderBy('updatedAt')
        .limit(WRITE_BATCH_SIZE)
        .get();
      if (page.empty) break;
      const batch = firestore.batch();
      for (const claim of page.docs) {
        batch.delete(claim.ref);
        const uid = claim.data().uid;
        if (typeof uid === 'string') batch.delete(firestore.doc(`users/${uid}/pushTokens/${claim.id}`));
      }
      await batch.commit();
      removed += page.size;
      if (page.size < WRITE_BATCH_SIZE) break;
    }
    logger.info('Stale push token cleanup complete', {
      operation: 'push.token.cleanup', result: 'complete', removed, durationMs: Date.now() - startedAt,
    });
  },
);
