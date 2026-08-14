import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '../firebase/firestore-client';
import type { Attachment, ChatMessage, Mention, Reaction, RoomCall, RoomMembership, RoomReadState } from '../types';

export const MESSAGE_PAGE_SIZE = 50;

export interface MessagePage {
  messages: ChatMessage[];
  changedIds: string[];
  oldest: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

function mapMessage(snapshot: QueryDocumentSnapshot<DocumentData>): ChatMessage {
  return {
    id: snapshot.id,
    ...snapshot.data({ serverTimestamps: 'estimate' }),
    pending: snapshot.metadata.hasPendingWrites,
  } as ChatMessage;
}

export function watchRecentMessages(
  roomId: string,
  next: (page: MessagePage) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  const messagesQuery = query(
    collection(firestore, 'rooms', roomId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(MESSAGE_PAGE_SIZE),
  );
  return onSnapshot(messagesQuery, { includeMetadataChanges: true }, (snapshot) => {
    next({
      messages: snapshot.docs.map(mapMessage).reverse(),
      changedIds: snapshot.docChanges({ includeMetadataChanges: true })
        .filter((change) => change.type !== 'removed')
        .map((change) => change.doc.id),
      oldest: snapshot.docs.at(-1) ?? null,
      hasMore: snapshot.size === MESSAGE_PAGE_SIZE,
    });
  }, (cause) => error(cause));
}

export async function loadOlderMessages(
  roomId: string,
  oldest: QueryDocumentSnapshot<DocumentData>,
): Promise<MessagePage> {
  const snapshot = await getDocs(query(
    collection(firestore, 'rooms', roomId, 'messages'),
    orderBy('createdAt', 'desc'),
    startAfter(oldest),
    limit(MESSAGE_PAGE_SIZE),
  ));
  return {
    messages: snapshot.docs.map(mapMessage).reverse(),
    changedIds: snapshot.docs.map((document) => document.id),
    oldest: snapshot.docs.at(-1) ?? oldest,
    hasMore: snapshot.size === MESSAGE_PAGE_SIZE,
  };
}

export async function sendTextMessage(input: {
  roomId: string;
  senderId: string;
  senderDisplayName: string;
  text: string;
  mentions: Mention[];
  replyToId?: string;
}): Promise<string> {
  const messageRef = doc(collection(firestore, 'rooms', input.roomId, 'messages'));
  const batch = writeBatch(firestore);
  batch.set(messageRef, {
    roomId: input.roomId,
    senderId: input.senderId,
    senderType: 'user',
    senderDisplayName: input.senderDisplayName,
    kind: 'text',
    text: input.text,
    mentions: input.mentions,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    createdAt: serverTimestamp(),
    clientCreatedAt: Date.now(),
  });
  batch.update(doc(firestore, 'rooms', input.roomId), {
    lastMessage: {
      id: messageRef.id,
      senderId: input.senderId,
      senderDisplayName: input.senderDisplayName,
      kind: 'text',
      preview: input.text.slice(0, 120),
      createdAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return messageRef.id;
}

export async function editTextMessage(roomId: string, messageId: string, text: string, mentions: Mention[]): Promise<void> {
  await updateDoc(doc(firestore, 'rooms', roomId, 'messages', messageId), {
    text,
    mentions,
    editedAt: serverTimestamp(),
  });
}

export async function softDeleteMessage(roomId: string, messageId: string): Promise<void> {
  await updateDoc(doc(firestore, 'rooms', roomId, 'messages', messageId), {
    text: '此訊息已刪除',
    mentions: [],
    deletedAt: serverTimestamp(),
  });
}

export function watchRoomMembers(
  roomId: string,
  next: (members: RoomMembership[]) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(firestore, 'rooms', roomId, 'members'), (snapshot) => {
    next(snapshot.docs.map((member) => member.data() as RoomMembership).filter((member) => member.status === 'active'));
  }, error);
}

/**
 * Only live calls. A call that has ended simply leaves the map, which is how the
 * message list knows to stop offering "join" on an old invitation.
 */
export function watchActiveCalls(
  roomId: string,
  next: (calls: Map<string, RoomCall>) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(firestore, 'rooms', roomId, 'calls'), where('status', 'in', ['creating', 'ringing', 'active', 'ending'])),
    (snapshot) => next(new Map(snapshot.docs.map((call) => [call.id, call.data() as RoomCall]))),
    error,
  );
}

export function watchReactions(
  roomId: string,
  messageIds: string[],
  next: (reactions: Reaction[]) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  const ids = [...new Set(messageIds)].slice(-60);
  if (!ids.length) {
    next([]);
    return () => undefined;
  }
  const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => ids.slice(index * 30, index * 30 + 30));
  const buckets = new Map<number, Reaction[]>();
  const ready = new Set<number>();
  const unsubscribes = chunks.map((chunk, index) => onSnapshot(
    query(collection(firestore, 'rooms', roomId, 'reactions'), where('messageId', 'in', chunk)),
    (snapshot) => {
      buckets.set(index, snapshot.docs.map((reaction) => reaction.data() as Reaction));
      ready.add(index);
      if (ready.size === chunks.length) next([...buckets.values()].flat());
    },
    error,
  ));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export async function setReaction(roomId: string, messageId: string, uid: string, emoji: string | null): Promise<void> {
  const reactionRef = doc(firestore, 'rooms', roomId, 'reactions', `${messageId}_${uid}`);
  if (!emoji) {
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(reactionRef);
    return;
  }
  const { setDoc } = await import('firebase/firestore');
  await setDoc(reactionRef, { messageId, userId: uid, emoji, updatedAt: serverTimestamp() });
}

export function watchReadStates(
  roomId: string,
  next: (states: Map<string, RoomReadState>) => void,
  error: (cause: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(firestore, 'rooms', roomId, 'readStates'), (snapshot) => {
    next(new Map(snapshot.docs.map((state) => [state.id, state.data() as RoomReadState])));
  }, error);
}

export async function getAttachment(roomId: string, attachmentId: string): Promise<Attachment | null> {
  const { getDoc } = await import('firebase/firestore');
  const snapshot = await getDoc(doc(firestore, 'rooms', roomId, 'attachments', attachmentId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Attachment) : null;
}
