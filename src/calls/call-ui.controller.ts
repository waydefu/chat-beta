import type { CallMessage } from '../types';

interface ActiveCall {
  roomId: string;
  callId: string;
  ownsLifecycle: boolean;
  screenSharing: boolean;
  leave(): Promise<void>;
  setScreenShare(enabled: boolean): Promise<void>;
}

export interface CallUIElements {
  voice: HTMLButtonElement;
  video: HTMLButtonElement;
}

export class CallUIController {
  private call: ActiveCall | null = null;
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
    const [{ LiveKitCallProvider }, { startCall }] = await Promise.all([
      import('./providers/livekit-call-provider'),
      import('./call.service'),
    ]);
    const started = await startCall(new LiveKitCallProvider(), roomId, kind, this.signal);
    this.call = {
      roomId,
      callId: started.callId,
      ownsLifecycle: true,
      screenSharing: false,
      leave: () => started.session.leave(),
      setScreenShare: (enabled) => started.session.setScreenShare(enabled),
    };
    this.setActiveUI();
    this.notify(`${kind === 'video' ? '視訊' : '語音'}通話已開始；按下 ■ 可結束。`);
  }

  async join(message: CallMessage): Promise<void> {
    if (this.call) return;
    const { LiveKitCallProvider } = await import('./providers/livekit-call-provider');
    const session = await new LiveKitCallProvider().join({
      roomId: message.roomId,
      callId: message.callId,
      audio: true,
      video: false,
    }, this.signal);
    this.call = {
      roomId: message.roomId,
      callId: message.callId,
      ownsLifecycle: false,
      screenSharing: false,
      leave: () => session.leave(),
      setScreenShare: (enabled) => session.setScreenShare(enabled),
    };
    this.setActiveUI();
    this.changed();
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.call) return;
    this.call.screenSharing = !this.call.screenSharing;
    try {
      await this.call.setScreenShare(this.call.screenSharing);
      this.ui.video.classList.toggle('recording', this.call.screenSharing);
    } catch (error) {
      this.call.screenSharing = false;
      throw error;
    }
  }

  async finish(): Promise<void> {
    const call = this.call;
    if (!call) return;
    this.call = null;
    try {
      await call.leave();
      if (call.ownsLifecycle) {
        const { endCall } = await import('./call.service');
        await endCall(call.roomId, call.callId);
      }
    } finally {
      this.ui.voice.textContent = '☎';
      this.ui.video.textContent = '▣';
      this.ui.video.classList.remove('recording');
      this.ui.video.disabled = this.disposed;
      if (!this.disposed) this.changed();
    }
  }

  dispose(): void {
    this.disposed = true;
    void this.finish().catch((error) => this.notify(error instanceof Error ? error.message : String(error), true));
    this.ui.voice.disabled = true;
    this.ui.video.disabled = true;
  }

  private setActiveUI(): void {
    if (this.disposed) return;
    this.ui.voice.textContent = '■';
    this.ui.video.textContent = '▰';
    this.ui.video.disabled = false;
  }
}
