import { HttpsError } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';

export type RoomRole = 'owner' | 'admin' | 'member';

export interface ActiveMembership {
  role: RoomRole;
  displayName: string;
  version: number;
}

/**
 * Membership carries a denormalised display name, and anything the server writes
 * on a member's behalf - call lifecycle messages, system events - copies it
 * straight into the message list. Falling back to the uid puts an opaque id in
 * front of users, so read the profile the client wrote at sign-in instead.
 */
export async function profileDisplayName(uid: string): Promise<string> {
  const name = (await firestore.doc(`users/${uid}`).get()).data()?.displayName;
  return typeof name === 'string' && name.trim() ? name : '使用者';
}

export async function getActiveMembership(roomId: string, uid: string): Promise<ActiveMembership> {
  const snapshot = await firestore.doc(`rooms/${roomId}/members/${uid}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.status !== 'active') {
    throw new HttpsError('permission-denied', '你不是此聊天室的有效成員。');
  }
  return {
    role: data.role as RoomRole,
    displayName: String(data.displayName || '使用者'),
    version: Number(data.version || 0),
  };
}

export async function requireRoomManager(roomId: string, uid: string): Promise<ActiveMembership> {
  const membership = await getActiveMembership(roomId, uid);
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', '只有管理員可以執行此操作。');
  }
  return membership;
}
