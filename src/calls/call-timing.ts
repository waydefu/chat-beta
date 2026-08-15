/**
 * Call startup crosses a dynamic import, three callables, a provider handshake
 * and a media permission prompt. "The call feels slow" does not say which, and
 * every one of them has a different fix — so the stages are measured separately
 * and nothing here is optimised without a number attached.
 *
 * This is permanent rather than development-only on purpose. The stages that
 * actually dominate — Cloud Function cold start, App Check, token issuance,
 * LiveKit's own connect — only exist in production against real providers, so a
 * helper compiled out of the production bundle could never measure the thing it
 * was written for. It stays silent unless an operator opts in on their own
 * session, and it lives in the lazily imported call chunk, so a user who never
 * places a call never downloads it.
 *
 * It records elapsed milliseconds and nothing else: no room, call or user id, no
 * display name, no token, no provider payload, no error message. See the logging
 * rules in `AGENTS.md` — a timing helper is not an exemption from them.
 */

export type CallTimingStage =
  /** Button press, taken in the controller before any await. */
  | 'uiClicked'
  /** First pixel the user can see change. */
  | 'uiAcknowledged'
  /** The call chunk's own modules resolved. */
  | 'modulesReady'
  /** `startLiveKitCallV2` returned. */
  | 'callCreated'
  /** `getLiveKitTokenV2` returned. */
  | 'tokenReceived'
  /** `livekit-client` finished downloading and parsing. */
  | 'sdkReady'
  /** The provider's transport reported connected. */
  | 'providerConnected'
  /** Microphone and camera were acquired. */
  | 'mediaReady'
  /** `confirmLiveKitCall` returned. */
  | 'serverConfirmed';

const ENABLE_KEY = 'chat-lite:call-timing';

export interface CallTimingRecorder {
  /**
   * @param at optional `performance.now()` reading, for a stage that already
   * happened — the click acknowledgement is recorded before the module holding
   * this helper has even loaded.
   */
  mark(stage: CallTimingStage, at?: number): void;
}

/** Taken in the click handler, before the first await. */
export interface CallStartTiming {
  clickedAt: number;
  acknowledgedAt: number;
}

export interface CallTimeline extends CallTimingRecorder {
  report(outcome: 'connected' | 'failed' | 'aborted'): void;
}

const NO_OP: CallTimeline = { mark: () => undefined, report: () => undefined };

function enabled(): boolean {
  try {
    return localStorage.getItem(ENABLE_KEY) === '1';
  } catch {
    // Storage can be blocked outright; that is a "not enabled", not an error.
    return false;
  }
}

/**
 * @param startedAt `performance.now()` taken in the click handler, before the
 * first await, so the measurement includes the chunk load the controller itself
 * needed.
 */
export function startCallTimeline(startedAt: number): CallTimeline {
  if (!enabled()) return NO_OP;
  const marks: Array<[CallTimingStage, number]> = [['uiClicked', 0]];
  return {
    mark(stage, at) {
      marks.push([stage, Math.round((at ?? performance.now()) - startedAt)]);
    },
    report(outcome) {
      const total = Math.round(performance.now() - startedAt);
      let previous = 0;
      const split = marks.map(([stage, at]) => {
        const step = at - previous;
        previous = at;
        return `${stage} +${step}ms @${at}ms`;
      });
      // Opt-in diagnostics: stage names and elapsed milliseconds, nothing else.
      console.info(`[call-timing] ${outcome} in ${total}ms\n  ${split.join('\n  ')}`);
    },
  };
}
