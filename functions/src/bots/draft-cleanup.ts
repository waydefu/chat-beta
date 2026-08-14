import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { database } from '../admin.js';
import { REGION } from '../config.js';
import { expiredDraftIds, type AiDraft } from './draft-policy.js';

const PAGE_SIZE = 100;
// One invocation stays bounded no matter how many rooms exist; the remainder is
// picked up by the next run rather than by a scheduler timeout. The previous
// implementation read the whole realtime/rooms subtree in a single get().
const MAX_PAGES = 20;
const WRITE_BATCH_SIZE = 400;

interface RoomNode {
  aiDrafts?: Record<string, AiDraft>;
}

async function removeInChunks(paths: string[]): Promise<void> {
  for (let index = 0; index < paths.length; index += WRITE_BATCH_SIZE) {
    const update: Record<string, null> = {};
    for (const path of paths.slice(index, index + WRITE_BATCH_SIZE)) update[path] = null;
    await database.ref().update(update);
  }
}

export const cleanupExpiredAIDrafts = onSchedule(
  { region: REGION, schedule: 'every 5 minutes', retryCount: 3 },
  async () => {
    const startedAt = Date.now();
    let cursor: string | undefined;
    let scannedRooms = 0;
    let scannedDrafts = 0;
    const removals: string[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let query = database.ref('realtime/rooms').orderByKey().limitToFirst(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const rooms = (snapshot.val() ?? {}) as Record<string, RoomNode>;
      const keys = Object.keys(rooms);
      if (!keys.length) break;

      const now = Date.now();
      for (const roomKey of keys) {
        scannedRooms += 1;
        const drafts = rooms[roomKey]?.aiDrafts ?? {};
        scannedDrafts += Object.keys(drafts).length;
        for (const runId of expiredDraftIds(drafts, now)) {
          removals.push(`realtime/rooms/${roomKey}/aiDrafts/${runId}`);
        }
      }

      cursor = keys.at(-1);
      if (keys.length < PAGE_SIZE) break;
    }

    await removeInChunks(removals);
    logger.info('Expired AI draft cleanup complete', {
      operation: 'ai.draft.cleanup',
      result: 'complete',
      scannedRooms,
      scannedDrafts,
      removed: removals.length,
      durationMs: Date.now() - startedAt,
    });
  },
);
