/**
 * Repairs room memberships whose displayName is the member's uid.
 *
 * The v3 migration wrote `displayName: uid` when it inferred memberships from
 * message senders, and createDirectRoom did the same for the invited side. Any
 * message the server writes on a member's behalf - the call lifecycle messages
 * are the visible ones - copies membership.displayName into the message list,
 * so those rooms show a raw uid where a name belongs.
 *
 * The name comes from `users/{uid}.displayName`, which the client writes at
 * sign-in. A member whose owner has never signed in since that profile write
 * has nothing to recover, and is reported as skipped rather than overwritten.
 *
 * Dry run by default. Pass --apply to write. Requires application default
 * credentials:
 *
 *   gcloud auth application-default login
 *   node scripts/backfill-member-display-names.mjs --project=f-chat-wayde-fu
 *   node scripts/backfill-member-display-names.mjs --project=f-chat-wayde-fu --apply
 *
 * Never commit this script's output: it contains user ids and display names.
 */
import process from 'node:process';

import { cert, initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const projectArg = args.find((value) => value.startsWith('--project='));
const projectId = projectArg ? projectArg.slice('--project='.length) : process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId) {
  process.stderr.write('Missing project. Pass --project=<id> or set GOOGLE_CLOUD_PROJECT.\n');
  process.exit(1);
}

function report(line) {
  process.stdout.write(`${line}\n`);
}

initializeApp({ credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) : applicationDefault(), projectId });
const firestore = getFirestore();

/** Profiles are read once each: a member of several rooms is one document. */
const profiles = new Map();

async function profileDisplayName(uid) {
  if (!profiles.has(uid)) {
    const name = (await firestore.doc(`users/${uid}`).get()).data()?.displayName;
    profiles.set(uid, typeof name === 'string' && name.trim() ? name : null);
  }
  return profiles.get(uid);
}

const summary = { rooms: 0, members: 0, broken: 0, repaired: 0, skipped: 0 };
const rooms = await firestore.collection('rooms').get();

for (const room of rooms.docs) {
  summary.rooms += 1;
  const members = await room.ref.collection('members').get();
  for (const member of members.docs) {
    summary.members += 1;
    const uid = member.id;
    // Only a displayName equal to the uid is broken. A member who legitimately
    // never had a profile carries '使用者', and overwriting that gains nothing.
    if (member.data().displayName !== uid) continue;
    summary.broken += 1;
    const name = await profileDisplayName(uid);
    if (!name) {
      summary.skipped += 1;
      report(`skip    ${room.id}/${uid}  no profile displayName to recover`);
      continue;
    }
    summary.repaired += 1;
    report(`${apply ? 'repair ' : 'would  '} ${room.id}/${uid}  -> ${name}`);
    if (apply) {
      await member.ref.update({ displayName: name, updatedAt: FieldValue.serverTimestamp() });
    }
  }
}

report(`\n${apply ? 'Applied' : 'Dry run'}: ${summary.rooms} rooms, ${summary.members} memberships, ${summary.broken} broken, ${summary.repaired} ${apply ? 'repaired' : 'repairable'}, ${summary.skipped} skipped.`);
if (!apply && summary.repaired) report('Re-run with --apply to write these changes.');
