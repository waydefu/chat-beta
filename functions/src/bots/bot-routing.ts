export function hasBotMention(data: Record<string, unknown>, botId: string): boolean {
  return Array.isArray(data.mentions)
    && data.mentions.some((mention: unknown) => {
      if (!mention || typeof mention !== 'object') return false;
      const record = mention as Record<string, unknown>;
      return record.type === 'bot' && record.id === botId;
    });
}
