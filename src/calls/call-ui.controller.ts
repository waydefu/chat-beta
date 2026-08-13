import type { CallPanel } from './call-panel';
import type { CallParticipant, CallSession } from './providers/call-provider';

interface ActiveCall {
  roomId: string;
  callId: string;
  ownsLifecycle: boolean;
  sawParticipant: boolean;
  session: CallSession;
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
  private disposed = false;

  constructor(
    private readonly ui: CallUIElements,
    private readonly signal: AbortSignal,
    private readonly changed: () => void,
    private readonly notify: (message: string, error?: boolean) => void,
  ) {}

  get active(): boolean {
    return Boolean(this.call);
  }

  async begin(roomId: string, kind: 'voice' | 'video'): Promise<void> {
    if (this.call) return;
    const [{ CallPanel: Panel }, { LiveKitCallProvider }, { startCall }] = await Promise.all([
      import('./call-panel'),
      import('./providers/livekit-call-provider'),
      import('./call.service'),
    ]);
    const panel = this.openPanel(Panel, kind);
    try {
      const started = await startCall(new LiveKitCallProvider(), {
        roomId,
        kind,
        stage: panel.stage,
        onParticipants: (participants) => this.onParticipants(participants),
      }, this.signal);
      this.adopt({ roomId, callId: started.callId, ownsLifecycle: true, sawParticipant: false, session: started.session });
    } catch (error) {
      this.closePanel();
      throw error;
    }
    this.notify(`${kind === 'video' ? '視訊' : '語音'}通話已開始，正在等待對方加入。`);
  }

  async join(request: JoinCallRequest): Promise<void> {
    if (this.call) return;
    const [{ CallPanel: Panel }, { LiveKitCallProvider }] = await Promise.all([
      import('./call-panel'),
      import('./providers/livekit-call-provider'),
    ]);
    const panel = this.openPanel(Panel, request.kind);
    try {
      const session = await new LiveKitCallProvider().join({
        roomId: request.roomId,
        callId: request.callId,
        audio: true,
        // Joining a video call with the camera off leaves the other side looking
        // at nothing, so honour the kind the call was started with.
        video: request.kind === 'video',
        stage: panel.stage,
        onParticipants: (participants) => this.onParticipants(participants),
      }, this.signal);
      this.adopt({ roomId: request.roomId, callId: request.callId, ownsLifecycle: false, sawParticipant: false, session });
    } catch (error) {
      this.closePanel();
      throw error;
    }
  }

  /**
   * The panel goes immediately so hanging up feels instant, but the message list
   * is only redrawn once the server knows the call is over. Redrawing earlier
   * flashes a "join" button on the call this client just ended, because the
   * calls collection has not caught up yet.
   */
  async finish(): Promise<void> {
    const call = this.call;
    this.call = null;
    this.closePanel();
    if (!this.disposed) this.setHeaderEnabled(true);
    try {
      if (!call) return;
      await call.session.leave();
      if (call.ownsLifecycle) {
        const { endCall } = await import('./call.service');
        await endCall(call.roomId, call.callId);
      }
    } finally {
      if (!this.disposed) this.changed();
    }
  }

  dispose(): void {
    this.disposed = true;
    void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
    this.setHeaderEnabled(false);
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
    this.setHeaderEnabled(false);
    return panel;
  }

  private closePanel(): void {
    this.panel?.destroy();
    this.panel = null;
  }

  private adopt(call: ActiveCall): void {
    this.call = call;
    this.changed();
  }

  private async withSession(action: (session: CallSession) => Promise<void>): Promise<void> {
    if (!this.call) return;
    await action(this.call.session);
  }

  /**
   * A call with nobody left in it is over. Waiting for someone to arrive first
   * matters because the caller is alone for the seconds before the callee picks
   * up, and that is not the same as everyone having hung up.
   */
  private onParticipants(participants: CallParticipant[]): void {
    const call = this.call;
    this.panel?.setParticipants(participants);
    if (!call) return;
    if (participants.length) {
      call.sawParticipant = true;
      return;
    }
    if (!call.sawParticipant) return;
    this.notify('對方已離開，通話結束。');
    void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
  }

  private setHeaderEnabled(enabled: boolean): void {
    this.ui.voice.disabled = !enabled;
    this.ui.video.disabled = !enabled;
  }
}
