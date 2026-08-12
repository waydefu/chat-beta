import { HttpsError } from 'firebase-functions/v2/https';

export interface BotDefinition {
  id: string;
  displayName: string;
  provider: string;
}

export class BotRegistry {
  private readonly bots = new Map<string, BotDefinition>();

  constructor(definitions: BotDefinition[]) {
    for (const definition of definitions) {
      if (this.bots.has(definition.id)) throw new Error(`Duplicate bot ID: ${definition.id}`);
      this.bots.set(definition.id, Object.freeze({ ...definition }));
    }
  }

  get(botId: string): BotDefinition | undefined {
    return this.bots.get(botId);
  }
}

export class BotRouter {
  constructor(private readonly registry: BotRegistry) {}

  require(botId: string): BotDefinition {
    const bot = this.registry.get(botId);
    if (!bot) throw new HttpsError('invalid-argument', '不支援的機器人。');
    return bot;
  }
}
