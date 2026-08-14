export interface AiDraft {
  expiresAt?: unknown;
}

/**
 * Drafts are ephemeral by contract: gemini.ts stamps every write with an
 * expiresAt. A draft without a usable one is treated as expired -- leaving it
 * would pin a half-finished AI reply in front of every member of the room.
 */
export function expiredDraftIds(drafts: Record<string, AiDraft>, now: number): string[] {
  return Object.entries(drafts).flatMap(([runId, draft]) => {
    const expiresAt = typeof draft?.expiresAt === 'number' ? draft.expiresAt : 0;
    return expiresAt <= now ? [runId] : [];
  });
}
