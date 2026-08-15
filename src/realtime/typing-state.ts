/**
 * Typing is the one realtime signal with no heartbeat of its own: the composer
 * refreshes it while keys are being pressed and clears it when they stop. That
 * makes the write path complete but the read path fragile — if `onDisconnect`
 * never fires (killed tab, reaped socket, revoked write) the node simply stays,
 * and every other member sees "正在輸入…" for that user forever.
 *
 * So the reader applies the same rule presence does: liveness is a timestamp
 * judgement, not the existence of a node.
 */

export interface TypingConnectionState {
  displayName?: unknown;
  updatedAt?: unknown;
}

/**
 * How long the composer waits after the last keystroke before clearing its own
 * typing node. The controller schedules its timer from this, so the value has
 * exactly one home.
 */
export const TYPING_IDLE_CLEAR_MS = 1_800;

/**
 * A live typist rewrites `updatedAt` on every keystroke, and a typist who stops
 * removes the node within {@link TYPING_IDLE_CLEAR_MS}. Anything older than this
 * is therefore an orphan, not a slow typist. The margin over the idle clear
 * covers write latency and the client/server clock gap.
 */
export const TYPING_STALE_AFTER_MS = 6_000;

/**
 * An orphaned node stops changing, so `onValue` never fires again for it. The
 * reader has to re-evaluate on its own or the stale entry is never dropped.
 */
export const TYPING_SWEEP_MS = 2_000;

export function isTypingEntryFresh(entry: TypingConnectionState, serverNow: number): boolean {
  const { updatedAt } = entry;
  // The rules require the stamp, so this is unreachable in production. If it
  // ever happens, drop the entry: a missing timestamp is exactly the shape an
  // orphan left by an older client has, and holding it forever is the bug.
  if (typeof updatedAt !== 'number') return false;
  // A stamp in the future is clock skew, not staleness.
  return serverNow - updatedAt < TYPING_STALE_AFTER_MS;
}

/**
 * Projects the room's whole typing subtree into the names to display: fresh
 * connections only, self excluded, one entry per user.
 */
export function typingNames(
  value: Record<string, Record<string, TypingConnectionState>>,
  selfUid: string,
  serverNow: number,
): string[] {
  return Object.entries(value).flatMap(([candidateUid, connections]) => {
    if (candidateUid === selfUid) return [];
    const live = Object.values(connections ?? {}).find((entry) => (
      entry && isTypingEntryFresh(entry, serverNow)
    ));
    if (!live) return [];
    return [typeof live.displayName === 'string' && live.displayName ? live.displayName : '有人'];
  });
}
