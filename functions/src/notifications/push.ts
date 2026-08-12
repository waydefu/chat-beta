import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { firestore } from '../admin.js';
import { REGION } from '../config.js';

const MAX_BODY = 120;
const BATCH_SIZE = 500;

export const notifyOnMessage = onDocumentCreated(
  { region: REGION, document: 'rooms/{roomId}/messages/{messageId}', retry: true },
  async (event) => {
    const message = event.data?.data();
    if (!message || message.senderType === 'system') return;
    const { roomId } = event.params;
    const members = await firestore.collection(`rooms/${roomId}/members`).where('status', '==', 'active').get();
    const recipients = members.docs.map((member) => member.id).filter((uid) => uid !== message.senderId);
    if (!recipients.length) return;

    const tokenLists = await Promise.all(recipients.map(async (uid) => {
      const [tokens, state] = await Promise.all([
        firestore.collection(`users/${uid}/pushTokens`).get(),
        firestore.doc(`users/${uid}/roomStates/${roomId}`).get(),
      ]);
      if (state.data()?.muted === true) return [];
      return tokens.docs.map((token) => ({ uid, ref: token.ref, token: token.data().token }));
    }));
    const targets = tokenLists.flat().filter((entry) => typeof entry.token === 'string' && entry.token);
    if (!targets.length) return;

    const author = String(message.senderDisplayName || '有人');
    const body = message.kind === 'text' ? String(message.text || '').slice(0, MAX_BODY) : '傳送了一則新訊息';
    const stale: FirebaseFirestore.DocumentReference[] = [];
    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      const batch = targets.slice(index, index + BATCH_SIZE);
      const response = await getMessaging().sendEachForMulticast({
        tokens: batch.map((entry) => entry.token as string),
        data: { title: `${author} · ${roomId}`, body, roomId, messageId: event.params.messageId },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          fcmOptions: { link: `/?room=${encodeURIComponent(roomId)}` },
        },
      });
      response.responses.forEach((result, position) => {
        const code = result.error?.code;
        const target = batch[position];
        if (target && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
          stale.push(target.ref);
        }
      });
    }
    if (stale.length) {
      logger.info('Pruning stale push tokens', { count: stale.length });
      await Promise.all(stale.map((ref) => ref.delete().catch(() => undefined)));
    }
  },
);
