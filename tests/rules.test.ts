import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { get, ref, set, type Database } from 'firebase/database';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let environment: RulesTestEnvironment;

function testFirestore(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

function testDatabase(context: RulesTestContext): Database {
  return context.database() as unknown as Database;
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

describe('Firestore rules', () => {
  it('requires authentication to read rooms', async () => {
    const anonymous = testFirestore(environment.unauthenticatedContext());
    await assertFails(getDoc(doc(anonymous, 'rooms', 'general')));
  });

  it('allows an authenticated user to create a room and authored message', async () => {
    const database = testFirestore(environment.authenticatedContext('alice'));
    await assertSucceeds(setDoc(doc(database, 'rooms', 'general'), {
      createdAt: serverTimestamp(), createdBy: 'alice', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(database, 'rooms', 'general', 'messages', 'm1'), {
      uid: 'alice', user: 'Alice', text: 'Hello', timestamp: serverTimestamp(), clientCreatedAt: Date.now(),
    }));
  });

  it('allows only the author to edit a message', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(testFirestore(context), 'rooms', 'general', 'messages', 'm1'), {
        uid: 'alice', user: 'Alice', text: 'Original', timestamp: new Date(),
      });
    });
    const bob = testFirestore(environment.authenticatedContext('bob'));
    await assertFails(updateDoc(doc(bob, 'rooms', 'general', 'messages', 'm1'), { text: 'Hijacked', editedAt: serverTimestamp() }));
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertSucceeds(updateDoc(doc(alice, 'rooms', 'general', 'messages', 'm1'), { text: 'Edited', editedAt: serverTimestamp() }));
  });

  it('keeps a message timestamp immutable when edited', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(testFirestore(context), 'rooms', 'general', 'messages', 'm1'), {
        uid: 'alice', user: 'Alice', text: 'Original', timestamp: new Date(),
      });
    });
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertFails(updateDoc(doc(alice, 'rooms', 'general', 'messages', 'm1'), {
      text: 'Edited', timestamp: serverTimestamp(), editedAt: serverTimestamp(),
    }));
  });

  it('accepts a Google-hosted profile photo for the matching user', async () => {
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), {
      displayName: 'Alice',
      photoURL: 'https://lh3.googleusercontent.com/a/ACg8ocKexample=s96-c',
    }));
  });

  it('rejects a profile photo hosted anywhere but Google', async () => {
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertFails(setDoc(doc(alice, 'users', 'alice'), {
      displayName: 'Alice',
      photoURL: 'https://tracker.example.com/pixel.png',
    }));
  });

  it('rejects a photo URL that only embeds the Google host elsewhere in the string', async () => {
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertFails(setDoc(doc(alice, 'users', 'alice'), {
      displayName: 'Alice',
      photoURL: 'https://tracker.example.com/?u=https://lh3.googleusercontent.com/a/x',
    }));
  });

  it('restricts profile writes to the matching user', async () => {
    const alice = testFirestore(environment.authenticatedContext('alice'));
    await assertFails(setDoc(doc(alice, 'users', 'bob'), { displayName: 'Bob' }));
  });

  it('restricts read-state writes to the matching user', async () => {
    const alice = testFirestore(environment.authenticatedContext('alice'));
    const value = { lastReadAt: serverTimestamp(), lastReadMessageId: 'm1', updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice, 'rooms', 'general', 'readStates', 'alice'), value));
    await assertFails(setDoc(doc(alice, 'rooms', 'general', 'readStates', 'bob'), value));
  });
});

describe('Realtime Database rules', () => {
  it('allows a user to write only their own V2 connection', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(set(ref(alice, 'presenceV2/alice/connections/tab-1'), { connectedAt: Date.now() }));
    await assertFails(set(ref(alice, 'presenceV2/bob/connections/tab-1'), { connectedAt: Date.now() }));
  });

  it('keeps legacy and V2 presence isolated', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(set(ref(alice, 'presenceV2/alice/connections/tab-1'), { connectedAt: Date.now() }));
    await assertSucceeds(set(ref(alice, 'presence/alice'), { state: 'online', displayName: 'Alice', last_changed: Date.now() }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await assertSucceeds(get(ref(testDatabase(context), 'presenceV2/alice/connections/tab-1')));
    });
  });

  it('isolates typing V2 by authenticated user', async () => {
    const alice = testDatabase(environment.authenticatedContext('alice'));
    await assertSucceeds(set(ref(alice, 'typingV2/cm9vbQ/alice/tab-1'), { displayName: 'Alice', updatedAt: Date.now() }));
    await assertFails(set(ref(alice, 'typingV2/cm9vbQ/bob/tab-1'), { displayName: 'Alice', updatedAt: Date.now() }));
  });
});
