import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';
import { appCheckEnforced, REGION } from '../config.js';
import { getActiveMembership, profileDisplayName } from '../shared/membership.js';
import { operationId, requireAuth, requireRecord, requireString } from '../shared/validation.js';
import { directRoomKey } from './direct-room-key.js';

const ENFORCE_APP_CHECK = appCheckEnforced('membership');

export const createDirectRoom = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const targetUid = requireString(data.userId, 'userId', 128);
    const sourceRoomId = requireString(data.sourceRoomId, 'sourceRoomId', 50);
    if (targetUid === auth.uid) throw new HttpsError('invalid-argument', '不能與自己建立直接對話。');
    await Promise.all([
      getActiveMembership(sourceRoomId, auth.uid),
      getActiveMembership(sourceRoomId, targetUid),
    ]);
    const targetDisplayName = await profileDisplayName(targetUid);
    const key = directRoomKey(auth.uid, targetUid);
    const indexRef = firestore.doc(`directRoomKeys/${key}`);
    const roomId = `dm_${key.slice(0, 32)}`;
    const roomRef = firestore.doc(`rooms/${roomId}`);

    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(indexRef);
      if (existing.exists) return;
      transaction.create(indexRef, { roomId, participants: [auth.uid, targetUid].sort(), createdAt: FieldValue.serverTimestamp() });
      transaction.create(roomRef, {
        schemaVersion: 3,
        name: '直接對話',
        type: 'direct',
        visibility: 'private',
        ownerId: auth.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const [uid, role] of [[auth.uid, 'owner'], [targetUid, 'member']] as const) {
        const version = 1;
        transaction.create(roomRef.collection('members').doc(uid), {
          userId: uid,
          role,
          status: 'active',
          displayName: uid === auth.uid ? String(auth.token.name ?? '使用者') : targetDisplayName,
          version,
          joinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(firestore.doc(`users/${uid}/roomStates/${roomId}`), {
          membershipStatus: 'active', role, roomName: '直接對話', version, updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(firestore.doc(`membershipOperations/${operationId(roomId, uid)}`), {
          roomId, userId: uid, action: 'activate', state: 'pending', version, updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return { roomId };
  },
);
