import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

initializeApp();

const MAX_BODY = 120;
// FCM rejects sendEachForMulticast above 500 tokens per call.
const BATCH_SIZE = 500;

/**
 * Web Push cannot be sent from the browser: FCM only accepts sends from a trusted
 * server. This trigger is that server. It notifies every room member except the
 * author, skipping anyone whose lastReadAt is already past the message.
 */
export const notifyOnMessage = onDocumentCreated(
  'rooms/{roomId}/messages/{messageId}',
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const { roomId } = event.params;
    const firestore = getFirestore();

    const readStates = await firestore.collection(`rooms/${roomId}/readStates`).get();

    // Everyone who has ever opened this room is a member worth notifying.
    const recipients = readStates.docs
      .map((doc) => doc.id)
      .filter((uid) => uid !== message.uid);
    if (!recipients.length) return;

    const tokenLists = await Promise.all(recipients.map(async (uid) => {
      const snapshot = await firestore.collection(`users/${uid}/pushTokens`).get();
      return snapshot.docs.map((doc) => ({ uid, ref: doc.ref, token: doc.data().token }));
    }));
    const targets = tokenLists.flat().filter((entry) => typeof entry.token === 'string' && entry.token);
    if (!targets.length) return;

    const author = message.user || '有人';
    const body = String(message.text || '').slice(0, MAX_BODY);

    const stale = [];
    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      const batch = targets.slice(index, index + BATCH_SIZE);
      const response = await getMessaging().sendEachForMulticast({
        tokens: batch.map((entry) => entry.token),
        // Data-only: the service worker builds the notification itself so it can
        // control the tag, icon and click target.
        data: {
          title: `${author} · ${roomId}`,
          body,
          roomId,
        },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          fcmOptions: { link: `/chat-beta/?room=${encodeURIComponent(roomId)}` },
        },
      });
      response.responses.forEach((result, position) => {
        const code = result.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          stale.push(batch[position].ref);
        }
      });
    }

    if (stale.length) {
      logger.info(`Pruning ${stale.length} dead push token(s)`);
      await Promise.all(stale.map((ref) => ref.delete().catch(() => undefined)));
    }
  },
);
