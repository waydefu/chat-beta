import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { database, firestore } from '../admin.js';
import { appCheckEnforced, REGION } from '../config.js';
import { requireRoomManager } from '../shared/membership.js';
import { mirrorTransitionAllowed, shouldHaveRealtimeMirror } from './membership-policy.js';
import {
  normalizeRoomName,
  operationId,
  requireAuth,
  requireRecord,
  requireString,
  roomKey,
} from '../shared/validation.js';

type MembershipAction = 'activate' | 'revoke';

interface MembershipOperation {
  roomId: string;
  userId: string;
  action: MembershipAction;
  state: 'pending' | 'complete';
  version: number;
}

const ENFORCE_APP_CHECK = appCheckEnforced('membership');

async function removeRealtimeAccess(roomId: string, uid: string, version = 0): Promise<void> {
  await removeRealtimeAccessAtKey(roomKey(roomId), uid, version, operationId(roomId, uid));
}

async function removeRealtimeAccessAtKey(
  key: string,
  uid: string,
  version: number,
  revocationOperationId?: string,
): Promise<void> {
  const baseRef = database.ref(`realtime/rooms/${key}`);
  const result = await baseRef.transaction((current: Record<string, Record<string, unknown>> | null) => {
    const value = current ?? {};
    const versions = (value.membershipVersions ?? {}) as Record<string, {
      status?: unknown;
      version?: unknown;
      operationId?: unknown;
      updatedAt?: unknown;
    }>;
    if (!mirrorTransitionAllowed(versions[uid], version, 'revoke')) return;

    const members = (value.members ?? {}) as Record<string, unknown>;
    const presence = (value.presence ?? {}) as Record<string, unknown>;
    const typing = (value.typing ?? {}) as Record<string, unknown>;
    const activity = (value.activity ?? {}) as Record<string, unknown>;
    delete members[uid];
    delete presence[uid];
    delete typing[uid];
    delete activity[uid];
    versions[uid] = {
      status: 'revoked',
      version,
      ...(revocationOperationId ? { operationId: revocationOperationId } : {}),
      updatedAt: Date.now(),
    };
    value.members = members;
    value.membershipVersions = versions;
    value.presence = presence;
    value.typing = typing;
    value.activity = activity;
    return value;
  });
  if (!result.committed) {
    throw new HttpsError('aborted', '偵測到較新的即時授權版本；撤銷將由 reconciliation 重新判定。');
  }
}

async function removeOrphanRealtimeAccess(key: string, uid: string): Promise<void> {
  await database.ref(`realtime/rooms/${key}`).transaction((current: Record<string, Record<string, unknown>> | null) => {
    const value = current ?? {};
    const members = (value.members ?? {}) as Record<string, unknown>;
    const versions = (value.membershipVersions ?? {}) as Record<string, unknown>;
    const presence = (value.presence ?? {}) as Record<string, unknown>;
    const typing = (value.typing ?? {}) as Record<string, unknown>;
    const activity = (value.activity ?? {}) as Record<string, unknown>;
    delete members[uid];
    delete presence[uid];
    delete typing[uid];
    delete activity[uid];
    versions[uid] = { status: 'revoked', version: 0, updatedAt: Date.now(), reason: 'orphan' };
    value.members = members;
    value.membershipVersions = versions;
    value.presence = presence;
    value.typing = typing;
    value.activity = activity;
    return value;
  });
}

async function finalizeRevocation(roomId: string, uid: string, version: number): Promise<void> {
  const memberRef = firestore.doc(`rooms/${roomId}/members/${uid}`);
  const roomStateRef = firestore.doc(`users/${uid}/roomStates/${roomId}`);
  const operationRef = firestore.doc(`membershipOperations/${operationId(roomId, uid)}`);
  await firestore.runTransaction(async (transaction) => {
    const [memberSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(operationRef),
    ]);
    const member = memberSnapshot.data();
    const operation = operationSnapshot.data() as MembershipOperation | undefined;
    if (operation?.action !== 'revoke' || Number(operation.version) !== version) {
      throw new HttpsError('aborted', '成員狀態已變更，請重新整理。');
    }
    if (!memberSnapshot.exists && operation.state === 'complete') return;
    if (member?.status !== 'revoking' || Number(member.version) !== version) {
      throw new HttpsError('aborted', '成員狀態已變更，請重新整理。');
    }
    transaction.delete(memberRef);
    transaction.delete(roomStateRef);
    transaction.set(operationRef, {
      state: 'complete',
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function completeRevocation(roomId: string, uid: string, version: number): Promise<void> {
  await removeRealtimeAccess(roomId, uid, version);
  await finalizeRevocation(roomId, uid, version);
}

export async function reconcileMembership(roomId: string, uid: string): Promise<void> {
  const memberRef = firestore.doc(`rooms/${roomId}/members/${uid}`);
  const operationRef = firestore.doc(`membershipOperations/${operationId(roomId, uid)}`);
  const [memberSnapshot, operationSnapshot] = await Promise.all([memberRef.get(), operationRef.get()]);
  const member = memberSnapshot.data();
  const operation = operationSnapshot.data() as MembershipOperation | undefined;
  const version = Math.max(Number(member?.version || 0), Number(operation?.version || 0));

  if (!member || !memberSnapshot.exists || !shouldHaveRealtimeMirror(member, operation)) {
    await removeRealtimeAccess(roomId, uid, version);
    return;
  }

  const baseRef = database.ref(`realtime/rooms/${roomKey(roomId)}`);
  const result = await baseRef.transaction((current: Record<string, Record<string, unknown>> | null) => {
    const value = current ?? {};
    const versions = (value.membershipVersions ?? {}) as Record<string, { status?: unknown; version?: unknown; updatedAt?: unknown }>;
    const prior = versions[uid];
    if (!mirrorTransitionAllowed(prior, version, 'activate')) return;
    const mirrors = (value.members ?? {}) as Record<string, unknown>;
    mirrors[uid] = {
      status: 'active',
      role: member.role,
      displayName: member.displayName,
      version,
      updatedAt: Date.now(),
    };
    versions[uid] = { status: 'active', version, updatedAt: Date.now() };
    value.members = mirrors;
    value.membershipVersions = versions;
    return value;
  });
  if (!result.committed) return;

  if (operation?.action === 'activate' && operation.state === 'pending') {
    await operationRef.set({ state: 'complete', completedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

export const createOrJoinPublicRoom = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = normalizeRoomName(data.roomName);
    const displayName = requireString(auth.token.name ?? '使用者', 'displayName', 100);
    const photoURL = typeof auth.token.picture === 'string' ? auth.token.picture.slice(0, 500) : undefined;
    const roomRef = firestore.doc(`rooms/${roomId}`);
    const memberRef = roomRef.collection('members').doc(auth.uid);
    const roomStateRef = firestore.doc(`users/${auth.uid}/roomStates/${roomId}`);
    const opRef = firestore.doc(`membershipOperations/${operationId(roomId, auth.uid)}`);

    const version = await firestore.runTransaction(async (transaction) => {
      const [roomSnapshot, memberSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
        transaction.get(opRef),
      ]);
      const room = roomSnapshot.data();
      if (roomSnapshot.exists && room?.visibility !== 'public' && !memberSnapshot.exists) {
        throw new HttpsError('permission-denied', '這是私人聊天室。');
      }
      const previousOperation = operationSnapshot.data() as MembershipOperation | undefined;
      if (memberSnapshot.data()?.status === 'revoking' || (
        previousOperation?.action === 'revoke' && previousOperation.state === 'pending'
      )) {
        throw new HttpsError('failed-precondition', '成員撤銷尚未完成，暫時無法重新加入。');
      }
      const priorVersion = Math.max(
        Number(memberSnapshot.data()?.version || 0),
        Number(operationSnapshot.data()?.version || 0),
      );
      const nextVersion = priorVersion + 1;
      const isOwner = !roomSnapshot.exists;
      if (!roomSnapshot.exists) {
        transaction.create(roomRef, {
          schemaVersion: 3,
          name: roomId,
          type: 'group',
          visibility: 'public',
          ownerId: auth.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.set(memberRef, {
        userId: auth.uid,
        role: isOwner ? 'owner' : (memberSnapshot.data()?.role ?? 'member'),
        status: 'active',
        displayName,
        ...(photoURL ? { photoURL } : {}),
        version: nextVersion,
        joinedAt: memberSnapshot.exists ? memberSnapshot.data()?.joinedAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(roomStateRef, {
        membershipStatus: 'active',
        role: isOwner ? 'owner' : (memberSnapshot.data()?.role ?? 'member'),
        roomName: room?.name ?? roomId,
        version: nextVersion,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(opRef, {
        roomId,
        userId: auth.uid,
        action: 'activate',
        state: 'pending',
        version: nextVersion,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return nextVersion;
    });

    let realtimeReady = true;
    try {
      await reconcileMembership(roomId, auth.uid);
    } catch (error) {
      realtimeReady = false;
      logger.error('RTDB membership mirror will be retried', { roomId, uid: auth.uid, error });
    }
    return { roomId, version, realtimeReady };
  },
);

export const revokeRoomMember = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const targetUid = requireString(data.userId, 'userId', 128);
    await requireRoomManager(roomId, auth.uid);
    if (targetUid === auth.uid) throw new HttpsError('failed-precondition', '管理員不能用此操作移除自己。');

    const memberRef = firestore.doc(`rooms/${roomId}/members/${targetUid}`);
    const roomStateRef = firestore.doc(`users/${targetUid}/roomStates/${roomId}`);
    const opRef = firestore.doc(`membershipOperations/${operationId(roomId, targetUid)}`);
    const version = await firestore.runTransaction(async (transaction) => {
      const [memberSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(opRef),
      ]);
      const member = memberSnapshot.data();
      if (!memberSnapshot.exists) throw new HttpsError('not-found', '找不到成員。');
      if (member?.role === 'owner') throw new HttpsError('failed-precondition', '不能移除房間擁有者。');
      if (member?.status === 'revoking') return Number(member.version);
      const nextVersion = Math.max(Number(member?.version || 0), Number(operationSnapshot.data()?.version || 0)) + 1;
      transaction.update(memberRef, {
        status: 'revoking',
        version: nextVersion,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(roomStateRef, {
        membershipStatus: 'revoking',
        role: member?.role ?? 'member',
        roomName: roomId,
        version: nextVersion,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(opRef, {
        roomId,
        userId: targetUid,
        action: 'revoke',
        state: 'pending',
        version: nextVersion,
        requestedBy: auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return nextVersion;
    });

    await completeRevocation(roomId, targetUid, version);
    return { roomId, userId: targetUid, revoked: true };
  },
);

export const syncMembershipMirror = onDocumentWritten(
  { region: REGION, document: 'rooms/{roomId}/members/{userId}', retry: true },
  async (event) => {
    const member = event.data?.after.data();
    if (member?.status === 'revoking') {
      await completeRevocation(event.params.roomId, event.params.userId, Number(member.version || 0));
      return;
    }
    await reconcileMembership(event.params.roomId, event.params.userId);
  },
);

export const reconcileMembershipMirrors = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', retryCount: 3 },
  async () => {
    const members = await firestore.collectionGroup('members').get();
    const canonical = new Map<string, Set<string>>();
    for (const member of members.docs) {
      const roomId = member.ref.parent.parent?.id;
      if (!roomId) continue;
      const data = member.data();
      if (data.status === 'active') {
        await reconcileMembership(roomId, member.id);
        const key = roomKey(roomId);
        const roomMembers = canonical.get(key) ?? new Set<string>();
        roomMembers.add(member.id);
        canonical.set(key, roomMembers);
      } else if (data.status === 'revoking') {
        await completeRevocation(roomId, member.id, Number(data.version || 0));
      } else {
        await removeRealtimeAccess(roomId, member.id, Number(data.version || 0));
      }
    }

    const mirrorSnapshot = await database.ref('realtime/rooms').get();
    const rooms = (mirrorSnapshot.val() ?? {}) as Record<string, { members?: Record<string, unknown> }>;
    let removals = 0;
    for (const [key, room] of Object.entries(rooms)) {
      for (const uid of Object.keys(room.members ?? {})) {
        if (!canonical.get(key)?.has(uid)) {
          await removeOrphanRealtimeAccess(key, uid);
          removals += 1;
        }
      }
    }
    logger.info('Membership reconciliation complete', { activeMemberships: members.size, removals });
  },
);
