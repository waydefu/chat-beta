import { randomUUID } from 'node:crypto';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';
import { appCheckEnforced, r2AccessKeyId, r2AccountId, r2Bucket, r2SecretAccessKey, REGION } from '../config.js';
import { getActiveMembership } from '../shared/membership.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';

const BUILT_IN_STICKERS = new Set(['wave', 'heart', 'laugh', 'party', 'thumbs-up', 'coffee']);
const CUSTOM_PACK_ID = 'custom-v1';
const STICKER_LIMIT = 1024 * 1024;
const ENFORCE_APP_CHECK = appCheckEnforced('stickers');

function r2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId.value()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2AccessKeyId.value(), secretAccessKey: r2SecretAccessKey.value() },
  });
}

function validStickerBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'image/png') return [0x89, 0x50, 0x4e, 0x47].every((byte, index) => bytes[index] === byte);
  if (mimeType === 'image/jpeg') return [0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte);
  if (mimeType === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function customSticker(data: FirebaseFirestore.DocumentData | undefined, stickerId: string): FirebaseFirestore.DocumentData | undefined {
  const stickers = data?.stickers;
  if (!stickers || typeof stickers !== 'object') return undefined;
  return (stickers as Record<string, FirebaseFirestore.DocumentData>)[stickerId];
}

const r2Secrets = [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket];

export const requestCustomStickerUpload = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK, secrets: r2Secrets },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const mimeType = requireString(data.mimeType, 'mimeType', 100).toLowerCase();
    const fileName = requireString(data.fileName, 'fileName', 180).replace(/[\\/\p{Cc}]/gu, '_');
    const size = Number(data.size);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
      || !Number.isSafeInteger(size) || size <= 0 || size > STICKER_LIMIT) {
      throw new HttpsError('invalid-argument', '自訂貼圖只支援 1 MB 內的 PNG、JPEG 或 WebP。');
    }
    await getActiveMembership(roomId, auth.uid);
    const stickerId = randomUUID();
    const objectKey = `stickers/${auth.uid}/${CUSTOM_PACK_ID}/${stickerId}`;
    const packRef = firestore.doc(`users/${auth.uid}/stickerPacks/${CUSTOM_PACK_ID}`);
    const usageRef = firestore.doc(`users/${auth.uid}/system/mediaUsage`);
    await firestore.runTransaction(async (transaction) => {
      const [usage, pack] = await Promise.all([transaction.get(usageRef), transaction.get(packRef)]);
      const total = Number(usage.data()?.usedBytes || 0) + Number(usage.data()?.reservedBytes || 0);
      if (total + size > 2 * 1024 * 1024 * 1024) throw new HttpsError('resource-exhausted', '媒體儲存空間不足。');
      const stickerCount = Object.keys((pack.data()?.stickers ?? {}) as Record<string, unknown>).length;
      if (stickerCount >= 100) throw new HttpsError('resource-exhausted', '每個自訂貼圖包最多 100 張貼圖。');
      transaction.set(usageRef, {
        reservedBytes: FieldValue.increment(size), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(packRef, {
        ownerId: auth.uid,
        name: '自訂貼圖',
        updatedAt: FieldValue.serverTimestamp(),
        stickers: {
          [stickerId]: {
            stickerId, objectKey, mimeType, fileName, size, status: 'quarantined',
            createdAt: FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true });
    });
    const uploadUrl = await getSignedUrl(r2Client(), new PutObjectCommand({
      Bucket: r2Bucket.value(), Key: objectKey, ContentType: mimeType, ContentLength: size,
    }), { expiresIn: 600 });
    return { packId: CUSTOM_PACK_ID, stickerId, uploadUrl, expiresIn: 600 };
  },
);

export const finalizeCustomStickerUpload = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK, secrets: r2Secrets },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const stickerId = requireString(data.stickerId, 'stickerId', 80);
    await getActiveMembership(roomId, auth.uid);
    const packRef = firestore.doc(`users/${auth.uid}/stickerPacks/${CUSTOM_PACK_ID}`);
    const pack = (await packRef.get()).data();
    const sticker = customSticker(pack, stickerId);
    if (!sticker || sticker.status !== 'quarantined') throw new HttpsError('failed-precondition', '貼圖上傳狀態不正確。');
    const r2 = r2Client();
    const head = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket.value(), Key: sticker.objectKey }));
    if (head.ContentLength !== sticker.size || head.ContentType !== sticker.mimeType) {
      throw new HttpsError('invalid-argument', '貼圖內容與上傳授權不一致。');
    }
    const sample = await r2.send(new GetObjectCommand({
      Bucket: r2Bucket.value(), Key: sticker.objectKey, Range: 'bytes=0-15',
    }));
    const bytes = new Uint8Array(await sample.Body!.transformToByteArray());
    if (!validStickerBytes(String(sticker.mimeType), bytes)) {
      throw new HttpsError('invalid-argument', '貼圖內容與 MIME 類型不一致。');
    }
    const usageRef = firestore.doc(`users/${auth.uid}/system/mediaUsage`);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(packRef);
      const value = customSticker(current.data(), stickerId);
      if (value?.status === 'ready') return;
      if (value?.status !== 'quarantined') throw new HttpsError('aborted', '貼圖狀態已變更。');
      transaction.update(packRef, {
        [`stickers.${stickerId}.status`]: 'ready',
        [`stickers.${stickerId}.readyAt`]: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(usageRef, {
        reservedBytes: FieldValue.increment(-Number(value.size)),
        usedBytes: FieldValue.increment(Number(value.size)),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { packId: CUSTOM_PACK_ID, stickerId, status: 'ready' };
  },
);

export const sendStickerMessage = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const stickerPackId = requireString(data.stickerPackId, 'stickerPackId', 80);
    const stickerId = requireString(data.stickerId, 'stickerId', 80);
    if (stickerPackId === 'built-in-v1') {
      if (!BUILT_IN_STICKERS.has(stickerId)) throw new HttpsError('invalid-argument', '不支援的貼圖。');
    } else if (stickerPackId === CUSTOM_PACK_ID) {
      const pack = (await firestore.doc(`users/${auth.uid}/stickerPacks/${CUSTOM_PACK_ID}`).get()).data();
      if (customSticker(pack, stickerId)?.status !== 'ready') throw new HttpsError('not-found', '自訂貼圖不存在。');
    } else {
      throw new HttpsError('invalid-argument', '不支援的貼圖包。');
    }
    const membership = await getActiveMembership(roomId, auth.uid);
    const messageRef = firestore.collection(`rooms/${roomId}/messages`).doc();
    await firestore.runTransaction(async (transaction) => {
      transaction.create(messageRef, {
        roomId,
        senderId: auth.uid,
        senderType: 'user',
        senderDisplayName: membership.displayName,
        kind: 'sticker',
        stickerPackId,
        stickerId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(firestore.doc(`rooms/${roomId}`), {
        lastMessage: {
          id: messageRef.id,
          senderId: auth.uid,
          senderDisplayName: membership.displayName,
          kind: 'sticker',
          preview: '貼圖',
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { messageId: messageRef.id };
  },
);

export const getCustomStickerDownloadUrl = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, secrets: r2Secrets },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const messageId = requireString(data.messageId, 'messageId', 150);
    await getActiveMembership(roomId, auth.uid);
    const message = (await firestore.doc(`rooms/${roomId}/messages/${messageId}`).get()).data();
    if (message?.kind !== 'sticker' || message.stickerPackId !== CUSTOM_PACK_ID) {
      throw new HttpsError('not-found', '貼圖訊息不存在。');
    }
    const pack = (await firestore.doc(`users/${String(message.senderId)}/stickerPacks/${CUSTOM_PACK_ID}`).get()).data();
    const sticker = customSticker(pack, String(message.stickerId));
    if (sticker?.status !== 'ready') throw new HttpsError('not-found', '貼圖已無法使用。');
    const url = await getSignedUrl(r2Client(), new GetObjectCommand({
      Bucket: r2Bucket.value(), Key: sticker.objectKey,
      ResponseContentDisposition: 'inline',
    }), { expiresIn: 300 });
    return { url, expiresIn: 300 };
  },
);

export const deleteCustomSticker = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK, secrets: r2Secrets },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const stickerId = requireString(data.stickerId, 'stickerId', 80);
    const packRef = firestore.doc(`users/${auth.uid}/stickerPacks/${CUSTOM_PACK_ID}`);
    const pack = (await packRef.get()).data();
    const sticker = customSticker(pack, stickerId);
    if (!sticker) return { stickerId, deleted: true };
    await r2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket.value(), Key: sticker.objectKey }));
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(packRef);
      const value = customSticker(current.data(), stickerId);
      if (!value) return;
      transaction.update(packRef, {
        [`stickers.${stickerId}`]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const usageField = value.status === 'ready' ? 'usedBytes' : 'reservedBytes';
      transaction.set(firestore.doc(`users/${auth.uid}/system/mediaUsage`), {
        [usageField]: FieldValue.increment(-Number(value.size || 0)),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { stickerId, deleted: true };
  },
);

export const cleanupExpiredCustomStickerUploads = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', retryCount: 3, secrets: r2Secrets },
  async () => {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    const packs = await firestore.collectionGroup('stickerPacks').get();
    let removed = 0;
    for (const packSnapshot of packs.docs) {
      const ownerId = String(packSnapshot.data().ownerId || '');
      const stickers = (packSnapshot.data().stickers ?? {}) as Record<string, FirebaseFirestore.DocumentData>;
      for (const [stickerId, sticker] of Object.entries(stickers)) {
        if (sticker.status !== 'quarantined' || Number(sticker.createdAt?.toMillis?.() || Date.now()) > cutoff) continue;
        await r2Client().send(new DeleteObjectCommand({ Bucket: r2Bucket.value(), Key: sticker.objectKey })).catch(() => undefined);
        await firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(packSnapshot.ref);
          const value = customSticker(current.data(), stickerId);
          if (value?.status !== 'quarantined') return;
          transaction.update(packSnapshot.ref, {
            [`stickers.${stickerId}`]: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (ownerId) transaction.set(firestore.doc(`users/${ownerId}/system/mediaUsage`), {
            reservedBytes: FieldValue.increment(-Number(value.size || 0)),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        removed += 1;
      }
    }
    logger.info('Expired custom sticker cleanup complete', { removed });
  },
);
