import { HttpsError } from 'firebase-functions/v2/https';

import { firestore } from '../admin.js';

interface WindowPolicy {
  key: string;
  durationMs: number;
  maximum: number;
}

const POLICIES = {
  userMinute: { key: 'user-minute', durationMs: 60_000, maximum: 5 },
  userHour: { key: 'user-hour', durationMs: 3_600_000, maximum: 20 },
  roomMinute: { key: 'room-minute', durationMs: 60_000, maximum: 10 },
  roomHour: { key: 'room-hour', durationMs: 3_600_000, maximum: 60 },
} satisfies Record<string, WindowPolicy>;

function limitId(policy: WindowPolicy, identity: string, now: number): string {
  const window = Math.floor(now / policy.durationMs);
  return `${policy.key}_${identity}_${window}`;
}

export async function consumeAIRateLimits(uid: string, roomId: string, now = Date.now()): Promise<void> {
  const checks: Array<[WindowPolicy, string]> = [
    [POLICIES.userMinute, uid],
    [POLICIES.userHour, uid],
    [POLICIES.roomMinute, roomId],
    [POLICIES.roomHour, roomId],
  ];
  await firestore.runTransaction(async (transaction) => {
    const refs = checks.map(([policy, identity]) => firestore.doc(`rateLimits/${limitId(policy, identity, now)}`));
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const policy = checks[index]?.[0];
      if (!policy) return;
      if (Number(snapshot.data()?.count || 0) >= policy.maximum) {
        throw new HttpsError('resource-exhausted', 'AI 使用次數已達目前限制，請稍後再試。');
      }
    });
    refs.forEach((ref, index) => {
      const policy = checks[index]?.[0];
      const count = Number(snapshots[index]?.data()?.count || 0) + 1;
      transaction.set(ref, {
        count,
        expiresAt: new Date(now + (policy?.durationMs ?? 60_000) * 2),
      });
    });
  });
}

interface ConcurrencyPolicy {
  id: string;
  maximum: number;
}

export async function acquireAIConcurrency(runId: string, uid: string, roomId: string, now = Date.now()): Promise<void> {
  const policies: ConcurrencyPolicy[] = [
    { id: 'global', maximum: 5 },
    { id: `user_${uid}`, maximum: 1 },
    { id: `room_${roomId}`, maximum: 2 },
  ];
  await firestore.runTransaction(async (transaction) => {
    const refs = policies.map((policy) => firestore.doc(`aiConcurrency/${policy.id}`));
    const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
    snapshots.forEach((snapshot, index) => {
      const active = (Array.isArray(snapshot.data()?.leases) ? snapshot.data()!.leases : [])
        .filter((lease: unknown) => lease && typeof lease === 'object' && Number((lease as { expiresAt?: unknown }).expiresAt) > now);
      const policy = policies[index];
      if (!policy) return;
      if (active.some((lease: { runId?: unknown }) => lease.runId === runId)) return;
      if (active.length >= policy.maximum) {
        throw new HttpsError('resource-exhausted', '目前同時進行的 AI 回覆已達限制，請稍後重試。');
      }
      transaction.set(refs[index]!, {
        leases: [...active, { runId, expiresAt: now + 120_000 }],
        updatedAt: new Date(now),
      });
    });
  });
}

export async function releaseAIConcurrency(runId: string, uid: string, roomId: string): Promise<void> {
  const ids = ['global', `user_${uid}`, `room_${roomId}`];
  await firestore.runTransaction(async (transaction) => {
    const refs = ids.map((id) => firestore.doc(`aiConcurrency/${id}`));
    const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
    snapshots.forEach((snapshot, index) => {
      const leases = (Array.isArray(snapshot.data()?.leases) ? snapshot.data()!.leases : [])
        .filter((lease: unknown) => lease && typeof lease === 'object' && (lease as { runId?: unknown }).runId !== runId);
      transaction.set(refs[index]!, { leases, updatedAt: new Date() }, { merge: true });
    });
  });
}
