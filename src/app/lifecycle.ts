import type { Unsubscribe } from '../types';

export class LifecycleScope {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private cleanups: Unsubscribe[] = [];

  constructor() {
    this.signal = this.controller.signal;
  }

  add(cleanup: Unsubscribe | undefined | null): void {
    if (!cleanup) return;
    if (this.signal.aborted) cleanup();
    else this.cleanups.push(cleanup);
  }

  timeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(callback, delay);
    this.add(() => clearTimeout(timer));
    return timer;
  }

  dispose(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

export class SessionScope extends LifecycleScope {}
export class RoomScope extends LifecycleScope {}
