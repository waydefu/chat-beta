import { getActiveMembership } from '../shared/membership.js';
import { acquireAIConcurrency, consumeAIRateLimits, releaseAIConcurrency } from './rate-limit.js';

export { BotRegistry, BotRouter, type BotDefinition } from './bot-registry.js';

export class BotPermissionService {
  async requireInvocation(roomId: string, uid: string): Promise<void> {
    await getActiveMembership(roomId, uid);
  }
}

export class BotRateLimiter {
  async acquire(runId: string, uid: string, roomId: string): Promise<void> {
    await consumeAIRateLimits(uid, roomId);
    await acquireAIConcurrency(runId, uid, roomId);
  }

  release(runId: string, uid: string, roomId: string): Promise<void> {
    return releaseAIConcurrency(runId, uid, roomId);
  }
}
