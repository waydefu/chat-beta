import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';
import {
  r2AccessKeyId,
  r2AccountId,
  r2Bucket,
  r2SecretAccessKey,
  appCheckEnforced, REGION,
} from '../config.js';
import { getActiveMembership } from '../shared/membership.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';

const USER_QUOTA = 2 * 1024 * 1024 * 1024;
const ROOM_QUOTA = 5 * 1024 * 1024 * 1024;
const ENFORCE_APP_CHECK = appCheckEnforced('media');

const MIME_LIMITS = new Map<string, { type: 'image' | 'video' | 'audio' | 'file'; maximum: number; signatures?: number[][] }>([
  ['image/jpeg', { type: 'image', maximum: 10 * 1024 * 1024, signatures: [[0xff, 0xd8, 0xff]] }],
  ['image/png', { type: 'image', maximum: 10 * 1024 * 1024, signatures: [[0x89, 0x50, 0x4e, 0x47]] }],
  ['image/webp', { type: 'image', maximum: 10 * 1024 * 1024, signatures: [[0x52, 0x49, 0x46, 0x46]] }],
  ['image/avif', { type: 'image', maximum: 10 * 1024 * 1024 }],
  ['video/mp4', { type: 'video', maximum: 100 * 1024 * 1024 }],
  ['video/webm', { type: 'video', maximum: 100 * 1024 * 1024 }],
  ['audio/webm', { type: 'audio', maximum: 20 * 1024 * 1024 }],
  ['audio/ogg', { type: 'audio', maximum: 20 * 1024 * 1024 }],
  ['audio/mpeg', { type: 'audio', maximum: 20 * 1024 * 1024, signatures: [[0x49, 0x44, 0x33], [0xff, 0xfb]] }],
  ['application/pdf', { type: 'file', maximum: 25 * 1024 * 1024, signatures: [[0x25, 0x50, 0x44, 0x46]] }],
  ['text/plain', { type: 'file', maximum: 5 * 1024 * 1024 }],
  ['application/zip', { type: 'file', maximum: 25 * 1024 * 1024, signatures: [[0x50, 0x4b, 0x03, 0x04]] }],
]);

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId.value()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2AccessKeyId.value(), secretAccessKey: r2SecretAccessKey.value() },
  });
}

function safeFileName(value: unknown): string {
  return requireString(value, 'fileName', 180).replace(/[\\/\p{Cc}]/gu, '_');
}

function matchesSignature(bytes: Uint8Array, signatures: number[][] | undefined): boolean {
  if (!signatures?.length) return true;
  return signatures.some((signature) => signature.every((byte, index) => bytes[index] === byte));
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function matchesMagicBytes(mimeType: string, bytes: Uint8Array, signatures: number[][] | undefined): boolean {
  if (!matchesSignature(bytes, signatures)) return false;
  if (mimeType === 'image/webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  if (mimeType === 'image/avif') return ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12));
  if (mimeType === 'video/mp4') return ascii(bytes, 4, 8) === 'ftyp';
  if (mimeType === 'video/webm' || mimeType === 'audio/webm') {
    return [0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte);
  }
  if (mimeType === 'audio/ogg') return ascii(bytes, 0, 4) === 'OggS';
  if (mimeType === 'text/plain') return !bytes.includes(0);
  return true;
}

export const requestUpload = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    secrets: [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket],
  },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const fileName = safeFileName(data.fileName);
    const mimeType = requireString(data.mimeType, 'mimeType', 100).toLowerCase();
    const size = Number(data.size);
    const duration = typeof data.duration === 'number' && Number.isFinite(data.duration)
      ? Math.max(0, Math.min(3_600, data.duration))
      : undefined;
    const policy = MIME_LIMITS.get(mimeType);
    if (!policy || !Number.isSafeInteger(size) || size <= 0 || size > policy.maximum) {
      throw new HttpsError('invalid-argument', '檔案類型或大小不符合限制。');
    }
    await getActiveMembership(roomId, auth.uid);
    const attachmentId = randomUUID();
    const objectKey = `rooms/${roomId}/${auth.uid}/${attachmentId}`;
    const attachmentRef = firestore.doc(`rooms/${roomId}/attachments/${attachmentId}`);
    const userUsageRef = firestore.doc(`users/${auth.uid}/system/mediaUsage`);
    const roomUsageRef = firestore.doc(`rooms/${roomId}/system/mediaUsage`);
    await firestore.runTransaction(async (transaction) => {
      const [userUsage, roomUsage] = await Promise.all([
        transaction.get(userUsageRef), transaction.get(roomUsageRef),
      ]);
      const userTotal = Number(userUsage.data()?.usedBytes || 0) + Number(userUsage.data()?.reservedBytes || 0);
      const roomTotal = Number(roomUsage.data()?.usedBytes || 0) + Number(roomUsage.data()?.reservedBytes || 0);
      if (userTotal + size > USER_QUOTA || roomTotal + size > ROOM_QUOTA) {
        throw new HttpsError('resource-exhausted', '媒體儲存空間不足。');
      }
      transaction.set(userUsageRef, { reservedBytes: FieldValue.increment(size), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(roomUsageRef, { reservedBytes: FieldValue.increment(size), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(attachmentRef, {
        id: attachmentId,
        roomId,
        ownerId: auth.uid,
        type: policy.type,
        objectKey,
        mimeType,
        fileName,
        size,
        ...(duration !== undefined ? { duration } : {}),
        status: 'quarantined',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    });
    const command = new PutObjectCommand({ Bucket: r2Bucket.value(), Key: objectKey, ContentType: mimeType, ContentLength: size });
    const uploadUrl = await getSignedUrl(client(), command, { expiresIn: 600 });
    return { attachmentId, uploadUrl, expiresIn: 600 };
  },
);

export const finalizeUpload = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    secrets: [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket],
  },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const attachmentId = requireString(data.attachmentId, 'attachmentId', 64);
    const membership = await getActiveMembership(roomId, auth.uid);
    const attachmentRef = firestore.doc(`rooms/${roomId}/attachments/${attachmentId}`);
    const attachmentSnapshot = await attachmentRef.get();
    const attachment = attachmentSnapshot.data();
    const messageId = `attachment_${attachmentId}`;
    if (attachmentSnapshot.exists && attachment?.ownerId === auth.uid && attachment.status === 'ready') {
      return { attachmentId, messageId, status: 'ready' };
    }
    if (!attachmentSnapshot.exists || attachment?.ownerId !== auth.uid || attachment.status !== 'quarantined') {
      throw new HttpsError('failed-precondition', '附件狀態不正確。');
    }
    const r2 = client();
    const head = await r2.send(new HeadObjectCommand({ Bucket: r2Bucket.value(), Key: attachment.objectKey }));
    if (head.ContentLength !== attachment.size || head.ContentType !== attachment.mimeType) {
      throw new HttpsError('invalid-argument', '上傳內容與授權資料不一致。');
    }
    const sample = await r2.send(new GetObjectCommand({ Bucket: r2Bucket.value(), Key: attachment.objectKey, Range: 'bytes=0-31' }));
    const bytes = new Uint8Array(await sample.Body!.transformToByteArray());
    const policy = MIME_LIMITS.get(String(attachment.mimeType));
    if (!policy || !matchesMagicBytes(String(attachment.mimeType), bytes, policy.signatures)) {
      throw new HttpsError('invalid-argument', '檔案內容與 MIME 類型不一致。');
    }
    const userUsageRef = firestore.doc(`users/${auth.uid}/system/mediaUsage`);
    const roomUsageRef = firestore.doc(`rooms/${roomId}/system/mediaUsage`);
    const messageRef = firestore.doc(`rooms/${roomId}/messages/${messageId}`);
    const roomRef = firestore.doc(`rooms/${roomId}`);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(attachmentRef);
      if (current.data()?.status !== 'quarantined') return;
      transaction.update(attachmentRef, {
        status: 'ready',
        readyAt: FieldValue.serverTimestamp(),
        expiresAt: FieldValue.delete(),
      });
      for (const usageRef of [userUsageRef, roomUsageRef]) {
        transaction.set(usageRef, {
          reservedBytes: FieldValue.increment(-attachment.size),
          usedBytes: FieldValue.increment(attachment.size),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      transaction.create(messageRef, {
        roomId,
        senderId: auth.uid,
        senderType: 'user',
        senderDisplayName: membership.displayName,
        kind: policy.type,
        attachmentIds: [attachmentId],
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(roomRef, {
        lastMessage: {
          id: messageId,
          senderId: auth.uid,
          senderDisplayName: membership.displayName,
          kind: policy.type,
          preview: attachment.fileName,
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { attachmentId, messageId, status: 'ready' };
  },
);

export const getAttachmentDownloadUrl = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket],
  },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const attachmentId = requireString(data.attachmentId, 'attachmentId', 64);
    const inline = data.disposition === 'inline';
    await getActiveMembership(roomId, auth.uid);
    const attachment = (await firestore.doc(`rooms/${roomId}/attachments/${attachmentId}`).get()).data();
    if (attachment?.status !== 'ready') throw new HttpsError('not-found', '附件尚未完成或已不存在。');
    const command = new GetObjectCommand({
      Bucket: r2Bucket.value(), Key: attachment.objectKey,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(String(attachment.fileName))}`,
    });
    return { url: await getSignedUrl(client(), command, { expiresIn: 300 }), expiresIn: 300 };
  },
);

export const cleanupExpiredUploads = onSchedule(
  {
    region: REGION,
    schedule: 'every 60 minutes',
    retryCount: 3,
    secrets: [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket],
  },
  async () => {
    const expired = await firestore.collectionGroup('attachments')
      .where('status', '==', 'quarantined')
      .where('expiresAt', '<=', new Date())
      .limit(100)
      .get();
    const r2 = client();
    for (const snapshot of expired.docs) {
      const attachment = snapshot.data();
      await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket.value(), Key: attachment.objectKey })).catch(() => undefined);
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(snapshot.ref);
        if (current.data()?.status !== 'quarantined') return;
        transaction.update(snapshot.ref, {
          status: 'failed',
          failureCategory: 'expired',
          failedAt: FieldValue.serverTimestamp(),
        });
        const roomId = String(current.data()?.roomId || '');
        const ownerId = String(current.data()?.ownerId || '');
        const size = Number(current.data()?.size || 0);
        if (roomId && ownerId && size > 0) {
          transaction.set(firestore.doc(`users/${ownerId}/system/mediaUsage`), {
            reservedBytes: FieldValue.increment(-size), updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          transaction.set(firestore.doc(`rooms/${roomId}/system/mediaUsage`), {
            reservedBytes: FieldValue.increment(-size), updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
    }
    logger.info('Expired upload cleanup complete', { count: expired.size });
  },
);

export const cleanupOrphanR2Objects = onSchedule(
  {
    region: REGION,
    schedule: 'every day 03:30',
    retryCount: 3,
    secrets: [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket],
  },
  async () => {
    const r2 = client();
    const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
    let continuationToken: string | undefined;
    let removed = 0;
    do {
      const page = await r2.send(new ListObjectsV2Command({
        Bucket: r2Bucket.value(), Prefix: 'rooms/', ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents ?? []) {
        if (!object.Key || !object.LastModified || object.LastModified.getTime() > cutoff) continue;
        const parts = object.Key.split('/');
        const roomId = parts[1];
        const attachmentId = parts[3];
        if (!roomId || !attachmentId) continue;
        const exists = (await firestore.doc(`rooms/${roomId}/attachments/${attachmentId}`).get()).exists;
        if (!exists) {
          await r2.send(new DeleteObjectCommand({ Bucket: r2Bucket.value(), Key: object.Key }));
          removed += 1;
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    logger.info('Orphan R2 cleanup complete', { removed });
  },
);
