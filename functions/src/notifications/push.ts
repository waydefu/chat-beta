import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { firestore } from '../admin.js';
import { REGION } from '../config.js';
import { chatNotificationBody } from './push-policy.js';
import { prunePushTargets, pushTargetsForUsers, type PushTarget } from './push-registry.js';

const MEMBER_PAGE_SIZE = 200;
const STATE_LOOKUP_SIZE = 250;
const SEND_BATCH_SIZE = 500;

async function activeRecipientIds(roomId: string, senderId: unknown): Promise<string[]> {
  const recipients: string[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    let query = firestore.collection(`rooms/${roomId}/members`)
      .where('status', '==', 'active')
      .orderBy(FieldPath.documentId())
      .limit(MEMBER_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const member of page.docs) if (member.id !== senderId) recipients.push(member.id);
    cursor = page.size === MEMBER_PAGE_SIZE ? page.docs.at(-1) : undefined;
  } while (cursor);
  return recipients;
}

async function unmutedRecipientIds(roomId: string, uids: readonly string[]): Promise<string[]> {
  const result: string[] = [];
  for (let index = 0; index < uids.length; index += STATE_LOOKUP_SIZE) {
    const chunk = uids.slice(index, index + STATE_LOOKUP_SIZE);
    const states = await firestore.getAll(...chunk.map((uid) => firestore.doc(`users/${uid}/roomStates/${roomId}`)));
    states.forEach((state, position) => {
      const uid = chunk[position];
      if (uid && state.exists && state.data()?.membershipStatus === 'active' && state.data()?.muted !== true) result.push(uid);
    });
  }
  return result;
}

function isStaleTokenCode(code: string | undefined): boolean {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument';
}

export const notifyOnMessage = onDocumentCreated(
  { region: REGION, document: 'rooms/{roomId}/messages/{messageId}', retry: true },
  async (event) => {
    const startedAt = Date.now();
    const message = event.data?.data();
    if (!message || message.senderType === 'system' || message.kind === 'call') return;
    const { roomId, messageId } = event.params;
    const recipients = await activeRecipientIds(roomId, message.senderId);
    const unmuted = await unmutedRecipientIds(roomId, recipients);
    const targets = await pushTargetsForUsers(unmuted);
    if (!targets.length) {
      logger.info('Chat push complete', {
        operation: 'push.chat.send', roomId, result: 'no-targets', recipients: unmuted.length,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const author = String(message.senderDisplayName || '聊天室成員').slice(0, 100);
    const body = chatNotificationBody(message.kind);
    const stale: PushTarget[] = [];
    let successCount = 0;
    for (let index = 0; index < targets.length; index += SEND_BATCH_SIZE) {
      const batch = targets.slice(index, index + SEND_BATCH_SIZE);
      const response = await getMessaging().sendEachForMulticast({
        tokens: batch.map((entry) => entry.token),
        data: {
          type: 'chat',
          privacy: 'redacted',
          title: `${author} · 新訊息`,
          body,
          roomId,
          messageId,
        },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          fcmOptions: { link: `/?room=${encodeURIComponent(roomId)}` },
        },
      });
      successCount += response.successCount;
      response.responses.forEach((result, position) => {
        const target = batch[position];
        if (target && isStaleTokenCode(result.error?.code)) stale.push(target);
      });
    }
    if (stale.length) await prunePushTargets(stale);
    logger.info('Chat push complete', {
      operation: 'push.chat.send', roomId, result: 'complete', recipients: unmuted.length,
      targets: targets.length, delivered: successCount, stale: stale.length, durationMs: Date.now() - startedAt,
    });
  },
);
