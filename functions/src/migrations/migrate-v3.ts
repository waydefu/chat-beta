import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';

import { operationId } from '../shared/validation.js';

const args = process.argv.slice(2);
let firestore: Firestore;

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`Missing required ${name}=<value> argument.`);
  return value;
}

interface RoomAudit {
  roomId: string;
  ownerId: string | null;
  inferredMembers: string[];
  messageCount: number;
  legacyMessageCount: number;
  orphanMessageIds: string[];
  nonMemberSenderIds: string[];
  action: 'skip' | 'migrate' | 'quarantine';
}

function migrationMessage(roomId: string, messageId: string, data: DocumentData): DocumentData {
  const senderId = String(data.senderId || data.uid || 'unknown');
  const senderDisplayName = String(data.senderDisplayName || data.user || '使用者');
  return {
    roomId,
    senderId,
    senderType: data.senderType || 'user',
    senderDisplayName,
    kind: data.kind || 'text',
    text: typeof data.text === 'string' ? data.text : '',
    createdAt: data.createdAt || data.timestamp || Timestamp.now(),
    migrationSourceId: messageId,
  };
}

async function auditRoom(room: DocumentReference): Promise<RoomAudit> {
  const [roomSnapshot, readStates, messages] = await Promise.all([
    room.get(),
    room.collection('readStates').get(),
    room.collection('messages').get(),
  ]);
  const data = roomSnapshot.data() || {};
  const ownerId = typeof data.ownerId === 'string' && data.ownerId
    ? data.ownerId
    : typeof data.createdBy === 'string' && data.createdBy ? data.createdBy : null;
  const inferredMembers = [...new Set([
    ...(ownerId ? [ownerId] : []),
    ...readStates.docs.map((state) => state.id),
  ])];
  const legacyMessageCount = messages.docs.filter((message) => {
    const value = message.data();
    return value.roomId !== room.id || !value.senderId || !value.senderType || !value.kind || !value.createdAt;
  }).length;
  const orphanMessageIds = messages.docs
    .filter((message) => !message.data().senderId && !message.data().uid)
    .map((message) => message.id);
  const inferredMemberSet = new Set(inferredMembers);
  const nonMemberSenderIds = [...new Set(messages.docs.flatMap((message) => {
    const senderId = message.data().senderId || message.data().uid;
    return typeof senderId === 'string' && senderId && !inferredMemberSet.has(senderId) ? [senderId] : [];
  }))];
  return {
    roomId: room.id,
    ownerId,
    inferredMembers,
    messageCount: messages.size,
    legacyMessageCount,
    orphanMessageIds,
    nonMemberSenderIds,
    action: data.schemaVersion === 3 && data.migrationStatus === 'complete' && legacyMessageCount === 0
      ? 'skip'
      : ownerId ? 'migrate' : 'quarantine',
  };
}

async function migrateRoom(audit: RoomAudit): Promise<void> {
  const roomRef = firestore.doc(`rooms/${audit.roomId}`);
  if (audit.action === 'quarantine') {
    await roomRef.set({
      schemaVersion: 3,
      migrationStatus: 'quarantined',
      migrationReason: 'missing-createdBy',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }
  if (audit.action === 'skip' || !audit.ownerId) return;
  await firestore.runTransaction(async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    const room = roomSnapshot.data() || {};
    transaction.set(roomRef, {
      schemaVersion: 3,
      name: typeof room.name === 'string' ? room.name : audit.roomId,
      type: room.type === 'direct' ? 'direct' : 'group',
      visibility: room.visibility === 'private' ? 'private' : 'public',
      ownerId: audit.ownerId,
      createdAt: room.createdAt || FieldValue.serverTimestamp(),
      migrationStatus: 'membership-pending',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  const room = (await roomRef.get()).data() || {};
  for (const uid of audit.inferredMembers) {
    await firestore.runTransaction(async (transaction) => {
      const role = uid === audit.ownerId ? 'owner' : 'member';
      const version = 1;
      const memberRef = roomRef.collection('members').doc(uid);
      const operationRef = firestore.doc(`membershipOperations/${operationId(audit.roomId, uid)}`);
      const [member, operation] = await Promise.all([
        transaction.get(memberRef), transaction.get(operationRef),
      ]);
      const previousOperation = operation.data();
      const previousVersion = Math.max(Number(member.data()?.version || 0), Number(previousOperation?.version || 0));
      if (previousVersion > version || previousOperation?.action === 'revoke') return;
      transaction.set(memberRef, {
        userId: uid,
        role,
        status: 'active',
        displayName: uid,
        version,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(firestore.doc(`users/${uid}/roomStates/${audit.roomId}`), {
        membershipStatus: 'active',
        role,
        roomName: typeof room.name === 'string' ? room.name : audit.roomId,
        version,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(operationRef, {
        roomId: audit.roomId,
        userId: uid,
        action: 'activate',
        state: 'pending',
        version,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }
  await roomRef.set({ migrationStatus: 'complete', updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  const messages = await roomRef.collection('messages').get();
  for (let index = 0; index < messages.docs.length; index += 400) {
    const batch = firestore.batch();
    for (const message of messages.docs.slice(index, index + 400)) {
      const data = message.data();
      if (data.roomId === audit.roomId && data.senderId && data.senderType && data.kind && data.createdAt) continue;
      batch.set(message.ref, migrationMessage(audit.roomId, message.id, data), { merge: true });
    }
    await batch.commit();
  }
}

async function run(): Promise<void> {
  const apply = args.includes('--apply');
  const expectedProject = requiredArgument('--project');
  const confirmApply = argument('--confirm-apply');
  const firestoreBackup = argument('--firestore-backup');
  const rtdbBackup = argument('--rtdb-backup');
  if (apply && confirmApply !== expectedProject) {
    throw new Error(`Apply requires --confirm-apply=${expectedProject}.`);
  }
  if (apply && (!firestoreBackup?.trim() || !rtdbBackup?.trim())) {
    throw new Error('Apply requires both --firestore-backup=<reference> and --rtdb-backup=<reference>.');
  }

  process.env.GOOGLE_CLOUD_PROJECT ??= expectedProject;
  const [{ firestore: configuredFirestore }, { getApp }] = await Promise.all([
    import('../admin.js'),
    import('firebase-admin/app'),
  ]);
  firestore = configuredFirestore;
  const actualProject = getApp().options.projectId
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT;
  if (actualProject !== expectedProject) {
    throw new Error(`Refusing migration: expected project ${expectedProject}, Admin SDK resolved ${actualProject || 'unknown'}.`);
  }

  const rooms = await firestore.collection('rooms').get();
  const audits: RoomAudit[] = [];
  for (const room of rooms.docs) audits.push(await auditRoom(room.ref));
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    projectId: actualProject,
    backupReferences: apply ? { firestore: firestoreBackup, rtdb: rtdbBackup } : undefined,
    generatedAt: new Date().toISOString(),
    totals: {
      rooms: audits.length,
      migrate: audits.filter((room) => room.action === 'migrate').length,
      quarantine: audits.filter((room) => room.action === 'quarantine').length,
      legacyMessages: audits.reduce((sum, room) => sum + room.legacyMessageCount, 0),
      orphanMessages: audits.reduce((sum, room) => sum + room.orphanMessageIds.length, 0),
      nonMemberSenders: audits.reduce((sum, room) => sum + room.nonMemberSenderIds.length, 0),
    },
    rooms: audits,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!apply) return;
  for (const audit of audits) await migrateRoom(audit);
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
