import type { IncomingCallSignal } from '../types';
import { callPhaseLabel, transitionCallPhase, type ClientCallPhase } from './call-state';
import { IncomingCallPanel } from './incoming-call-panel';
import type { CallPanel } from './call-panel';
import type { CallParticipant, CallSession, CallTransportState } from './providers/call-provider';

interface ActiveCall {
  roomId: string;
  callId: string;
  kind: 'voice' | 'video';
  ownsLifecycle: boolean;
  sawParticipant: boolean;
  session: CallSession | null;
  connectedAtMs: number | null;
}

export interface CallUIElements {
  voice: HTMLButtonElement;
  video: HTMLButtonElement;
}

export interface JoinCallRequest {
  roomId: string;
  callId: string;
  kind: 'voice' | 'video';
}

export class CallUIController {
  private call: ActiveCall | null = null;
  private panel: CallPanel | null = null;
  private incomingPanel: IncomingCallPanel | null = null;
  private phase: ClientCallPhase = 'idle';
  private callAbort: AbortController | null = null;
  private heartbeatTimer: number | null = null;
  private callStateUnsubscribe: (() => void) | null = null;
  private incomingSignals: IncomingCallSignal[] = [];
  private finishing: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly ui: CallUIElements,
    signal: AbortSignal,
    private readonly canStart: () => boolean,
    private readonly changed: () => void,
    private readonly notify: (message: string, error?: boolean) => void,
  ) {
    window.addEventListener('pagehide', () => { void this.finish(); }, { signal });
    signal.addEventListener('abort', () => this.callAbort?.abort(), { once: true });
  }

  get active(): boolean {
    return this.phase !== 'idle' && this.phase !== 'ended' && this.phase !== 'failed';
  }

  async begin(roomId: string, kind: 'voice' | 'video'): Promise<void> {
    if (this.active || this.disposed) return;
    const callAbort = new AbortController();
    this.callAbort = callAbort;
    this.setPhase('creating');
    this.setHeaderEnabled(false);
    this.changed();
    try {
      const [{ CallPanel: Panel }, { LiveKitCallProvider }, { startCall }] = await Promise.all([
        import('./call-panel'),
        import('./providers/livekit-call-provider'),
        import('./call.service'),
      ]);
      callAbort.signal.throwIfAborted();
      const panel = this.openPanel(Panel, kind);
      const started = await startCall(new LiveKitCallProvider(), {
        roomId,
        kind,
        stage: panel.stage,
        onCreated: (callId) => {
          this.call = {
            roomId,
            callId,
            kind,
            ownsLifecycle: true,
            sawParticipant: false,
            session: null,
            connectedAtMs: null,
          };
          this.watchServerCall(roomId, callId);
          this.setPhase('connecting');
          this.changed();
        },
        onParticipants: (participants) => this.onParticipants(participants),
        onTransportState: (state) => this.onTransportState(state),
      }, callAbort.signal);
      const call = this.call;
      if (!call || call.callId !== started.callId) {
        await started.session.leave();
        return;
      }
      call.session = started.session;
      call.connectedAtMs = started.connectedAtMs;
      this.setPhase(started.status);
      if (started.status === 'active') panel.setConnectedAt(started.connectedAtMs);
      this.startHeartbeat();
      this.changed();
      this.notify(`${kind === 'video' ? '視訊' : '語音'}通話已建立，正在等待對方加入。`);
    } catch (error) {
      if (this.callAbort === callAbort) this.callAbort = null;
      if (callAbort.signal.aborted && this.phase === 'idle') return;
      this.failLocalCall();
      throw error;
    }
  }

  async join(request: JoinCallRequest): Promise<void> {
    if (this.active || this.disposed) return;
    const callAbort = new AbortController();
    this.callAbort = callAbort;
    this.call = {
      roomId: request.roomId,
      callId: request.callId,
      kind: request.kind,
      ownsLifecycle: false,
      sawParticipant: false,
      session: null,
      connectedAtMs: null,
    };
    this.setPhase('connecting');
    this.setHeaderEnabled(false);
    this.changed();
    this.watchServerCall(request.roomId, request.callId);
    try {
      const [{ CallPanel: Panel }, { LiveKitCallProvider }, { joinCall }] = await Promise.all([
        import('./call-panel'),
        import('./providers/livekit-call-provider'),
        import('./call.service'),
      ]);
      callAbort.signal.throwIfAborted();
      const panel = this.openPanel(Panel, request.kind);
      const joined = await joinCall(new LiveKitCallProvider(), {
        ...request,
        stage: panel.stage,
        onParticipants: (participants) => this.onParticipants(participants),
        onTransportState: (state) => this.onTransportState(state),
      }, callAbort.signal);
      const call = this.call;
      if (!call || call.callId !== joined.callId) {
        await joined.session.leave();
        return;
      }
      call.session = joined.session;
      call.connectedAtMs = joined.connectedAtMs;
      this.setPhase(joined.status);
      if (joined.status === 'active') panel.setConnectedAt(joined.connectedAtMs);
      this.incomingPanel?.hide();
      this.changed();
    } catch (error) {
      if (this.callAbort === callAbort) this.callAbort = null;
      if (callAbort.signal.aborted && this.phase === 'idle') return;
      this.failLocalCall();
      throw error;
    }
  }

  updateIncoming(signals: IncomingCallSignal[]): void {
    if (this.disposed) return;
    this.incomingSignals = signals;
    const incoming = signals.find((signal) => signal.status === 'ringing');
    if (!incoming || this.active) {
      this.incomingPanel?.hide();
      return;
    }
    this.incomingPanel ??= new IncomingCallPanel({
      accept: (signal) => void this.acceptIncoming(signal),
      reject: (signal) => void this.rejectIncoming(signal),
    });
    this.incomingPanel.show(incoming);
  }

  finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = this.finishOnce().finally(() => { this.finishing = null; });
    return this.finishing;
  }

  dispose(): void {
    this.disposed = true;
    this.incomingPanel?.destroy();
    this.incomingPanel = null;
    void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
    this.setHeaderEnabled(false);
  }

  private async acceptIncoming(signal: IncomingCallSignal): Promise<void> {
    this.incomingPanel?.setBusy(true);
    try {
      await this.join({ roomId: signal.roomId, callId: signal.callId, kind: signal.kind });
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      this.incomingPanel?.setBusy(false);
      this.incomingPanel?.hide();
    }
  }

  private async rejectIncoming(signal: IncomingCallSignal): Promise<void> {
    this.incomingPanel?.setBusy(true);
    try {
      const { rejectCall } = await import('./call.service');
      await rejectCall(signal.roomId, signal.callId);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      this.incomingPanel?.setBusy(false);
      this.incomingPanel?.hide();
    }
  }

  private async finishOnce(): Promise<void> {
    const call = this.call;
    if (!call && this.phase === 'idle') return;
    if (this.phase !== 'ending' && this.phase !== 'ended' && this.phase !== 'failed') this.setPhase('ending');
    this.callAbort?.abort();
    this.callAbort = null;
    this.stopHeartbeat();
    this.stopCallWatch();
    this.call = null;
    this.closePanel();
    const operations: Promise<unknown>[] = [];
    if (call?.session) operations.push(call.session.leave());
    if (call?.ownsLifecycle) {
      const { endCall } = await import('./call.service');
      operations.push(endCall(call.roomId, call.callId));
    }
    const results = await Promise.allSettled(operations);
    if (this.phase === 'ending') this.setPhase('ended');
    this.setPhase('idle');
    if (!this.disposed) this.setHeaderEnabled(true);
    this.changed();
    this.updateIncoming(this.incomingSignals);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  private openPanel(Panel: typeof CallPanel, kind: 'voice' | 'video'): CallPanel {
    const panel = new Panel(kind, {
      microphone: (enabled) => this.withSession((session) => session.setMicrophone(enabled)),
      camera: (enabled) => this.withSession((session) => session.setCamera(enabled)),
      screenShare: (enabled) => this.withSession((session) => session.setScreenShare(enabled)),
      hangUp: () => void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true)),
      failed: (message) => this.notify(message, true),
    });
    this.panel = panel;
    panel.setState(this.phase);
    this.setHeaderEnabled(false);
    return panel;
  }

  private closePanel(): void {
    this.panel?.destroy();
    this.panel = null;
  }

  private setPhase(next: ClientCallPhase): void {
    this.phase = transitionCallPhase(this.phase, next);
    this.panel?.setState(this.phase);
  }

  private failLocalCall(): void {
    this.callAbort?.abort();
    this.callAbort = null;
    this.stopHeartbeat();
    this.stopCallWatch();
    this.call = null;
    if (this.phase !== 'failed') this.setPhase('failed');
    this.closePanel();
    this.setPhase('idle');
    if (!this.disposed) this.setHeaderEnabled(true);
    this.changed();
  }

  private async withSession(action: (session: CallSession) => Promise<void>): Promise<void> {
    const session = this.call?.session;
    if (!session) throw new Error(`${callPhaseLabel(this.phase)}，控制項尚未可用。`);
    await action(session);
  }

  private onParticipants(participants: CallParticipant[]): void {
    const call = this.call;
    this.panel?.setParticipants(participants);
    if (!call) return;
    if (participants.length) {
      call.sawParticipant = true;
      if (this.phase === 'connecting' || this.phase === 'ringing' || this.phase === 'reconnecting') {
        this.setPhase('active');
        this.panel?.setConnectedAt(call.connectedAtMs ?? Date.now());
        this.changed();
      }
      return;
    }
    if (!call.sawParticipant) return;
    this.notify('對方已離開，通話結束。');
    void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
  }

  private onTransportState(state: CallTransportState): void {
    if (!this.call || this.phase === 'ending' || this.phase === 'ended' || this.phase === 'failed') return;
    if (state === 'reconnecting') {
      if (this.phase !== 'reconnecting') this.setPhase('reconnecting');
      return;
    }
    if (state === 'connected' && this.phase === 'reconnecting') {
      this.setPhase(this.call.sawParticipant ? 'active' : this.call.ownsLifecycle ? 'ringing' : 'active');
      return;
    }
    if (state === 'disconnected') {
      this.notify('通話連線已中斷，正在結束通話。', true);
      void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.call?.ownsLifecycle) return;
    this.heartbeatTimer = window.setInterval(() => {
      const call = this.call;
      if (!call) return;
      void import('./call.service').then(({ heartbeatCall }) => heartbeatCall(call.roomId, call.callId))
        .then((status) => {
          if (['ended', 'failed', 'rejected', 'missed', 'cancelled'].includes(status)) void this.finish();
          else if (this.phase === 'reconnecting') {
            this.setPhase(this.call?.sawParticipant ? 'active' : 'ringing');
          }
        })
        .catch(() => {
          if (this.phase === 'active' || this.phase === 'ringing') this.setPhase('reconnecting');
        });
    }, 45_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private watchServerCall(roomId: string, callId: string): void {
    this.stopCallWatch();
    void import('./call.repository').then(({ watchCallState }) => {
      if (this.call?.callId !== callId || this.disposed) return;
      this.callStateUnsubscribe = watchCallState(roomId, callId, (call) => {
        if (!call || this.call?.callId !== callId) return;
        if (call.status === 'active' && (this.phase === 'connecting' || this.phase === 'ringing' || this.phase === 'reconnecting')) {
          this.setPhase('active');
          const activeAt = call.activeAt?.toMillis() ?? Date.now();
          this.panel?.setConnectedAt(activeAt);
          this.changed();
          return;
        }
        if (call.status === 'ending' || ['ended', 'failed', 'rejected', 'missed', 'cancelled'].includes(call.status)) {
          if (call.status === 'rejected') this.notify('對方已拒絕通話。');
          else if (call.status === 'missed') this.notify('對方未接聽。');
          void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
        }
      }, () => {
        if (this.phase === 'active' || this.phase === 'ringing') this.setPhase('reconnecting');
      });
    }).catch(() => {
      if (this.phase === 'active' || this.phase === 'ringing') this.setPhase('reconnecting');
    });
  }

  private stopCallWatch(): void {
    this.callStateUnsubscribe?.();
    this.callStateUnsubscribe = null;
  }

  private setHeaderEnabled(enabled: boolean): void {
    const available = enabled && this.canStart();
    this.ui.voice.disabled = !available;
    this.ui.video.disabled = !available;
  }
}
