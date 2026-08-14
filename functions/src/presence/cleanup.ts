import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { database } from '../admin.js';
import { REGION } from '../config.js';
import { isStalePresenceConnection, type PresenceConnection } from './presence-policy.js';

const PAGE_SIZE = 200;
// A hard ceiling keeps one invocation bounded no matter how the user table
// grows; whatever is left is picked up by the next run rather than by a
// scheduler timeout.
const MAX_PAGES = 25;
const WRITE_BATCH_SIZE = 400;

interface PresenceUser {
  connections?: Record<string, PresenceConnection>;
}

async function removeInChunks(paths: string[]): Promise<void> {
  for (let index = 0; index < paths.length; index += WRITE_BATCH_SIZE) {
    const update: Record<string, null> = {};
    for (const path of paths.slice(index, index + WRITE_BATCH_SIZE)) update[path] = null;
    await database.ref().update(update);
  }
}

export const cleanupStalePresence = onSchedule(
  { region: REGION, schedule: 'every 30 minutes', retryCount: 3 },
  async () => {
    const startedAt = Date.now();
    let cursor: string | undefined;
    let scannedUsers = 0;
    let scannedConnections = 0;
    const removals: string[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let query = database.ref('realtime/presence').orderByKey().limitToFirst(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const users = (snapshot.val() ?? {}) as Record<string, PresenceUser>;
      const uids = Object.keys(users);
      if (!uids.length) break;

      const now = Date.now();
      for (const uid of uids) {
        scannedUsers += 1;
        for (const [id, connection] of Object.entries(users[uid]?.connections ?? {})) {
          scannedConnections += 1;
          if (isStalePresenceConnection(connection, now)) {
            removals.push(`realtime/presence/${uid}/connections/${id}`);
          }
        }
      }

      cursor = uids.at(-1);
      if (uids.length < PAGE_SIZE) break;
    }

    await removeInChunks(removals);
    logger.info('Presence stale-connection cleanup complete', {
      operation: 'presence.cleanup',
      result: 'complete',
      scannedUsers,
      scannedConnections,
      removed: removals.length,
      durationMs: Date.now() - startedAt,
    });
  },
);
