import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { database } from '../admin.js';
import { REGION } from '../config.js';

export const cleanupExpiredAIDrafts = onSchedule(
  { region: REGION, schedule: 'every 5 minutes', retryCount: 3 },
  async () => {
    const snapshot = await database.ref('realtime/rooms').get();
    const rooms = (snapshot.val() ?? {}) as Record<string, { aiDrafts?: Record<string, { expiresAt?: unknown }> }>;
    const now = Date.now();
    const update: Record<string, null> = {};
    for (const [roomKey, room] of Object.entries(rooms)) {
      for (const [runId, draft] of Object.entries(room.aiDrafts ?? {})) {
        if (Number(draft.expiresAt || 0) <= now) update[`realtime/rooms/${roomKey}/aiDrafts/${runId}`] = null;
      }
    }
    if (Object.keys(update).length) await database.ref().update(update);
    logger.info('Expired AI draft cleanup complete', { count: Object.keys(update).length });
  },
);
