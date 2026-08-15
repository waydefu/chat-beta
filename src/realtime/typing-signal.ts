import { TYPING_IDLE_CLEAR_MS } from './typing-state';

export interface TypingTarget {
  setTyping(active: boolean): Promise<void>;
}

export interface TypingSignalTimers {
  setTimeout(handler: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

const browserTimers: TypingSignalTimers = {
  setTimeout: (handler, delay) => window.setTimeout(handler, delay),
  clearTimeout: (handle) => { window.clearTimeout(handle); },
};

/**
 * Owns the "stopped typing" timer for exactly one room session.
 *
 * The room session is captured at construction and never re-read, which is the
 * whole point: the timer used to fire {@link TYPING_IDLE_CLEAR_MS} later and
 * only then look up whichever room was current, so leaving a room inside that
 * window sent the departing room's cleanup write into the room just entered.
 * An instance can only ever write to the session it was built for, and disposal
 * makes it write nothing at all.
 */
export class TypingSignal {
  private timer: number | undefined;
  private disposed = false;

  constructor(
    private readonly target: TypingTarget,
    private readonly onError: (error: unknown) => void,
    private readonly timers: TypingSignalTimers = browserTimers,
  ) {}

  update(active: boolean): void {
    if (this.disposed) return;
    void this.target.setTyping(active).catch((error: unknown) => this.onError(error));
    this.cancel();
    // Clearing needs no follow-up: the node is already gone.
    if (!active) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.disposed) return;
      void this.target.setTyping(false).catch(() => undefined);
    }, TYPING_IDLE_CLEAR_MS);
  }

  /** Called by the owning `RoomScope`; after this the instance is inert. */
  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
