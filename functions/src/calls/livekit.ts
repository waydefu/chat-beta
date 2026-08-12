import { randomUUID } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';
import { appCheckEnforced, livekitApiKey, livekitApiSecret, livekitUrl, REGION } from '../config.js';
import { getActiveMembership } from '../shared/membership.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';

const ENFORCE_APP_CHECK = appCheckEnforced('rtc');

export const getLiveKitToken = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    secrets: [livekitUrl, livekitApiKey, livekitApiSecret],
  },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireString(data.callId, 'callId', 100);
    const membership = await getActiveMembership(roomId, auth.uid);
    const call = (await firestore.doc(`rooms/${roomId}/calls/${callId}`).get()).data();
    if (call?.status !== 'active') throw new HttpsError('failed-precondition', '通話已經結束或不存在。');
    const publishSources = [
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
      ...(call.kind === 'video' ? [TrackSource.CAMERA] : []),
    ];
    const rtcRoom = `room_${Buffer.from(roomId).toString('base64url')}_${callId}`;
    const token = new AccessToken(livekitApiKey.value(), livekitApiSecret.value(), {
      identity: auth.uid,
      name: membership.displayName,
      ttl: '10m',
      metadata: JSON.stringify({ roomId, callId, role: membership.role }),
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
  },
);

export const startLiveKitCall = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const kind = data.kind === 'video' ? 'video' : data.kind === 'voice' ? 'voice' : null;
    if (!kind) throw new HttpsError('invalid-argument', '通話類型不正確。');
    const membership = await getActiveMembership(roomId, auth.uid);
    const callId = randomUUID();
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    const messageRef = firestore.doc(`rooms/${roomId}/messages/call_${callId}`);
    await firestore.runTransaction(async (transaction) => {
      transaction.create(callRef, {
        roomId,
        callId,
        kind,
        status: 'active',
        startedBy: auth.uid,
        startedAt: FieldValue.serverTimestamp(),
      });
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
      transaction.update(firestore.doc(`rooms/${roomId}`), { updatedAt: FieldValue.serverTimestamp() });
    });
    return { callId, kind };
  },
);

export const endLiveKitCall = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const callId = requireString(data.callId, 'callId', 100);
    const membership = await getActiveMembership(roomId, auth.uid);
    const callRef = firestore.doc(`rooms/${roomId}/calls/${callId}`);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(callRef);
      const call = snapshot.data();
      if (!snapshot.exists) throw new HttpsError('not-found', '通話不存在。');
      if (call?.status === 'ended') return;
      if (call?.startedBy !== auth.uid && !['owner', 'admin'].includes(String(membership.role))) {
        throw new HttpsError('permission-denied', '只有發起者或房間管理員可以結束通話。');
      }
      transaction.update(callRef, {
        status: 'ended',
        endedBy: auth.uid,
        endedAt: FieldValue.serverTimestamp(),
      });
    });
    return { callId, status: 'ended' };
  },
);
