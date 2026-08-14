import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { get, ref, set, type Database } from 'firebase/database';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const ROOM_ID = 'general';
const ROOM_KEY = 'Z2VuZXJhbA';
let environment: RulesTestEnvironment;

function testFirestore(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

function testDatabase(context: RulesTestContext): Database {
  return context.database() as unknown as Database;
}

async function seedFirestore(status: 'active' | 'revoking' = 'active'): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = testFirestore(context);
    await setDoc(doc(database, 'rooms', ROOM_ID), {
      schemaVersion: 3,
      name: 'General',
      type: 'group',
      visibility: 'public',
      ownerId: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const [uid, role, memberStatus] of [
      ['owner', 'owner', 'active'],
      ['alice', 'member', status],
    ] as const) {
      await setDoc(doc(database, 'rooms', ROOM_ID, 'members', uid), {
        userId: uid,
        role,
        status: memberStatus,
        displayName: uid,
        version: 1,
      });
    }
    await setDoc(doc(database, 'rooms', ROOM_ID, 'messages', 'm1'), {
      roomId: ROOM_ID,
      senderId: 'alice',
      senderType: 'user',
      senderDisplayName: 'Alice',
      kind: 'text',
      text: 'Original',
      mentions: [],
      createdAt: new Date(),
    });
  });
}

async function seedMirror(uid = 'alice', roomKey = ROOM_KEY): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(testDatabase(context), `realtime/rooms/${roomKey}/members/${uid}`), {
      status: 'active', role: 'member', displayName: uid, version: 1,
    });
  });
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-chat-lite',
    firestore: { rules: readFileSync(resolve('firestore.rules'), 'utf8') },
    database: { rules: readFileSync(resolve('database.rules.json'), 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearDatabase();
});

afterAll(async () => environment.cleanup());

describe('Firestore room ACL', () => {
  it('denies anonymous room metadata and allows signed-in public metadata', async () => {
    await seedFirestore();
    await assertFails(getDoc(doc(testFirestore(environment.unauthenticatedContext()), 'rooms', ROOM_ID)));
    await assertSucceeds(getDoc(doc(testFirestore(environment.authenticatedContext('bob')), 'rooms', ROOM_ID)));
  });

  it('denies messages to non-members and revoking members', async () => {
    await seedFirestore();
    await assertFails(getDoc(doc(testFirestore(environment.authenticatedContext('bob')), 'rooms', ROOM_ID, 'messages', 'm1')));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(testFirestore(context), 'rooms', ROOM_ID, 'members', 'alice'), { status: 'revoking' });
    });
    await assertFails(getDoc(doc(testFirestore(environment.authenticatedContext('alice')), 'rooms', ROOM_ID, 'messages', 'm1')));
  });

  it('allows active members to read and create only authored user text', async () => {
    await seedFirestore();
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertSucceeds(getDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'm1')));
    await assertSucceeds(setDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'm2'), {
      roomId: ROOM_ID,
      senderId: 'alice',
      senderType: 'user',
      senderDisplayName: 'Alice',
      kind: 'text',
      text: 'Hello @Gemini',
      mentions: [{ type: 'bot', id: 'gemini', label: 'Gemini', start: 6, end: 13 }],
      createdAt: serverTimestamp(),
      clientCreatedAt: Date.now(),
    }));
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'bad-mention'), {
      roomId: ROOM_ID,
      senderId: 'alice',
      senderType: 'user',
      senderDisplayName: 'Alice',
      kind: 'text',
      text: 'Hello',
      mentions: [{ type: 'bot', id: 'gemini', label: 'Gemini', start: 0, end: 99 }],
      createdAt: serverTimestamp(),
    }));
  });

  it('rejects sender spoofing and client bot/system writes', async () => {
    await seedFirestore();
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const base = {
      roomId: ROOM_ID,
      senderDisplayName: 'Alice',
      kind: 'text',
      text: 'forged',
      createdAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'spoof'), { ...base, senderId: 'owner', senderType: 'user' }));
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'bot'), { ...base, senderId: 'gemini', senderType: 'bot' }));
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'system'), { ...base, senderId: 'system', senderType: 'system' }));
  });

  it('prevents self elevation, member removal, and owner removal from clients', async () => {
    await seedFirestore();
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const owner = testFirestore(environment.authenticatedContext('owner'));
    await assertFails(updateDoc(doc(alice, 'rooms', ROOM_ID, 'members', 'alice'), { role: 'owner' }));
    await assertFails(deleteDoc(doc(owner, 'rooms', ROOM_ID, 'members', 'alice')));
    await assertFails(deleteDoc(doc(owner, 'rooms', ROOM_ID, 'members', 'owner')));
  });

  it('allows only the author to edit or soft-delete mutable text fields', async () => {
    await seedFirestore();
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const owner = testFirestore(environment.authenticatedContext('owner'));
    await assertFails(updateDoc(doc(owner, 'rooms', ROOM_ID, 'messages', 'm1'), { text: 'Hijacked', editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'm1'), {
      text: 'Edited', mentions: [], editedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'm1'), {
      text: '此訊息已刪除', mentions: [], deletedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice, 'rooms', ROOM_ID, 'messages', 'm1'), {
      text: 'Undeleted', mentions: [], editedAt: serverTimestamp(),
    }));
  });

  it('scopes read states and reactions to the authenticated member', async () => {
    await seedFirestore();
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const readState = { lastReadAt: serverTimestamp(), lastReadMessageId: 'm1', updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice, 'rooms', ROOM_ID, 'readStates', 'alice'), readState));
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'readStates', 'owner'), readState));
    await assertSucceeds(setDoc(doc(alice, 'rooms', ROOM_ID, 'reactions', 'm1_alice'), {
      messageId: 'm1', userId: 'alice', emoji: '👍', updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(alice, 'rooms', ROOM_ID, 'reactions', 'm1_owner'), {
      messageId: 'm1', userId: 'owner', emoji: '👍', updatedAt: serverTimestamp(),
    }));
  });
});

describe('Realtime Database room ACL', () => {
  it('denies room state when the membership mirror is missing', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertFails(get(ref(alice, `realtime/rooms/${ROOM_KEY}/presence`)));
    await assertFails(set(ref(alice, `realtime/rooms/${ROOM_KEY}/presence/alice/connections/tab-1`), {
      displayName: 'Alice', connectedAt: Date.now(),
    }));
  });

  it('allows a mirrored member to read the room and write only their own connection', async () => {
    await seedMirror();
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(get(ref(alice, `realtime/rooms/${ROOM_KEY}/presence`)));
    await assertSucceeds(set(ref(alice, `realtime/rooms/${ROOM_KEY}/presence/alice/connections/tab-1`), {
      displayName: 'Alice', connectedAt: Date.now(),
    }));
    await assertFails(set(ref(alice, `realtime/rooms/${ROOM_KEY}/presence/bob/connections/tab-1`), {
      displayName: 'Alice', connectedAt: Date.now(),
    }));
  });

  it('isolates rooms even when the user has a mirror elsewhere', async () => {
    await seedMirror();
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertFails(get(ref(alice, 'realtime/rooms/b3RoZXI/presence')));
  });

  it('fails closed immediately after a mirror is revoked', async () => {
    await seedMirror();
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(set(ref(alice, `realtime/rooms/${ROOM_KEY}/typing/alice/tab-1`), {
      displayName: 'Alice', updatedAt: Date.now(),
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(testDatabase(context), `realtime/rooms/${ROOM_KEY}/members/alice`), null);
      await set(ref(testDatabase(context), `realtime/rooms/${ROOM_KEY}/typing/alice`), null);
    });
    await assertFails(get(ref(alice, `realtime/rooms/${ROOM_KEY}/typing`)));
    await assertFails(set(ref(alice, `realtime/rooms/${ROOM_KEY}/typing/alice/tab-2`), {
      displayName: 'Alice', updatedAt: Date.now(),
    }));
  });

  it('supports multiple tabs owned by the same active member', async () => {
    await seedMirror();
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(set(ref(alice, `realtime/rooms/${ROOM_KEY}/presence/alice/connections/tab-1`), {
      displayName: 'Alice', connectedAt: Date.now(),
    }));
    await assertSucceeds(set(ref(alice, `realtime/rooms/${ROOM_KEY}/presence/alice/connections/tab-2`), {
      displayName: 'Alice', connectedAt: Date.now(),
    }));
  });
});

describe('Global presence ACL', () => {
  it('allows multi-tab self connections without exposing a readable global directory', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    const bob = testDatabase(environment.authenticatedContext('bob'));
    const anonymous = testDatabase(environment.unauthenticatedContext());
    const first = { state: 'online', connectedAt: Date.now(), updatedAt: Date.now() };
    const second = { state: 'online', connectedAt: Date.now(), updatedAt: Date.now() };

    await assertSucceeds(set(ref(alice, 'realtime/presence/alice/connections/tab-1'), first));
    await assertSucceeds(set(ref(alice, 'realtime/presence/alice/connections/tab-2'), second));
    await assertSucceeds(set(ref(alice, 'realtime/presence/alice/connections/tab-1'), null));
    await assertSucceeds(get(ref(bob, 'realtime/presence/alice')));
    await assertFails(get(ref(alice, 'realtime/presence')));
    await assertFails(get(ref(anonymous, 'realtime/presence/alice')));
  });

  it('rejects cross-user writes and malformed connection state', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertFails(set(ref(alice, 'realtime/presence/bob/connections/tab-1'), {
      state: 'online', connectedAt: Date.now(), updatedAt: Date.now(),
    }));
    await assertFails(set(ref(alice, 'realtime/presence/alice/connections/tab-1'), {
      state: 'online', connectedAt: Date.now(), updatedAt: Date.now(), displayName: 'Alice',
    }));
  });
});

describe('Incoming call signal ACL', () => {
  it('lets only the recipient read a server-written signal', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(testFirestore(context), 'users', 'alice', 'incomingCalls', 'call-1'), {
        callId: 'call-1', roomId: ROOM_ID, kind: 'voice', status: 'ringing', startedBy: 'owner',
      });
    });
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const bob = testFirestore(environment.authenticatedContext('bob'));
    await assertSucceeds(getDoc(doc(alice, 'users', 'alice', 'incomingCalls', 'call-1')));
    await assertFails(getDoc(doc(bob, 'users', 'alice', 'incomingCalls', 'call-1')));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'incomingCalls', 'call-2'), {
      callId: 'call-2', roomId: ROOM_ID, status: 'ringing',
    }));
  });
});

describe('Call lifecycle ACL', () => {
  it('allows active members to read server state but never mutate it', async () => {
    await seedFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(testFirestore(context), 'rooms', ROOM_ID, 'calls', 'call-1'), {
        callId: 'call-1', roomId: ROOM_ID, kind: 'voice', status: 'ringing', startedBy: 'owner',
      });
    });
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const bob = testFirestore(environment.authenticatedContext('bob'));
    await assertSucceeds(getDoc(doc(alice, 'rooms', ROOM_ID, 'calls', 'call-1')));
    await assertFails(getDoc(doc(bob, 'rooms', ROOM_ID, 'calls', 'call-1')));
    await assertFails(updateDoc(doc(alice, 'rooms', ROOM_ID, 'calls', 'call-1'), { status: 'active' }));
  });
});
