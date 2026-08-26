import type { DocumentData } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';
import { hasBotMention } from './bot-routing.js';

interface ContextMessage {
  sender: string;
  text: string;
}

interface ContextCandidate extends ContextMessage {
  id: string;
  createdAt: number;
}

const DEFAULT_LIMIT = 20;
const LARGE_LIMIT = 200;

function textOf(data: DocumentData): string {
  return typeof data.text === 'string' ? data.text : '';
}

function candidateOf(snapshot: { id: string; data(): DocumentData }): ContextCandidate | null {
  const data = snapshot.data();
  if (data.deletedAt || !['user', 'bot'].includes(String(data.senderType))) return null;
  const text = textOf(data);
  if (!text) return null;
  return {
    id: snapshot.id,
    sender: String(data.senderDisplayName || data.senderType),
    text,
    createdAt: Number(data.createdAt?.toMillis?.() || 0),
  };
}

export async function buildBotContext(
  roomId: string,
  sourceMessageId: string,
  botId: string,
  requesterUid: string,
): Promise<{ prompt: string; context: ContextMessage[] }> {
  const sourceRef = firestore.doc(`rooms/${roomId}/messages/${sourceMessageId}`);
  const sourceSnapshot = await sourceRef.get();
  const source = sourceSnapshot.data();
  if (!sourceSnapshot.exists || source?.senderId !== requesterUid || source.senderType !== 'user') {
    throw new HttpsError('permission-denied', '只能要求機器人回覆自己發送的訊息。');
  }
  if (!hasBotMention(source, botId)) {
    throw new HttpsError('failed-precondition', '訊息沒有結構化的機器人 mention。');
  }
  const prompt = textOf(source);
  const wantsLargerContext = /整理|摘要|總結|今天|剛才/u.test(prompt);
  const limit = wantsLargerContext ? LARGE_LIMIT : DEFAULT_LIMIT;
  const messages = firestore.collection(`rooms/${roomId}/messages`);
  const snapshot = await messages
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const candidates = new Map<string, ContextCandidate>();
  const recentIds: string[] = [];
  for (const message of snapshot.docs) {
    const candidate = candidateOf(message);
    if (candidate && candidate.id !== sourceMessageId) {
      candidates.set(candidate.id, candidate);
      recentIds.push(candidate.id);
    }
  }

  const priorityIds = new Set<string>();
  if (typeof source.replyToId === 'string' && source.replyToId) {
    const target = await messages.doc(source.replyToId).get();
    const targetData = target.data();
    const targetTimestamp = targetData?.createdAt;
    if (target.exists && targetTimestamp) {
      // Both cursors start AT the target and walk outwards. `endAt` here would
      // instead anchor the far end of a descending scan, making `limit(5)` take
      // the five newest messages in the room rather than the five before the
      // target — see TD-A6.
      const [before, after] = await Promise.all([
        messages.orderBy('createdAt', 'desc').startAt(targetTimestamp).limit(5).get(),
        messages.orderBy('createdAt', 'asc').startAt(targetTimestamp).limit(5).get(),
      ]);
      for (const nearby of [...before.docs, ...after.docs]) {
        const candidate = candidateOf(nearby);
        if (!candidate || candidate.id === sourceMessageId) continue;
        candidates.set(candidate.id, candidate);
        priorityIds.add(candidate.id);
      }
    }
  }

  const selected = new Map<string, ContextCandidate>();
  for (const id of priorityIds) {
    const candidate = candidates.get(id);
    if (candidate) selected.set(id, candidate);
  }
  for (const id of recentIds) {
    if (selected.size >= limit) break;
    const candidate = candidates.get(id);
    if (candidate) selected.set(id, candidate);
  }
  const context = [...selected.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map(({ sender, text }) => ({ sender, text }));
  return { prompt, context };
}
