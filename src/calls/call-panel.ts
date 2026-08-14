import type { CallParticipant } from './providers/call-provider';
import { callPhaseLabel, type ClientCallPhase } from './call-state';

export interface CallPanelHandlers {
  microphone(enabled: boolean): Promise<void>;
  camera(enabled: boolean): Promise<void>;
  screenShare(enabled: boolean): Promise<void>;
  hangUp(): void;
  failed(message: string): void;
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

/**
 * The on-screen call surface: who is connected, how long it has run, and the
 * controls. It owns everything except the video elements themselves, which the
 * provider attaches into {@link CallPanel.stage}.
 *
 * The panel is deliberately a labelled window rather than glyphs in the chat
 * header. A call is a mode the whole app is in, and the control to leave it has
 * to be findable without hunting.
 */
export class CallPanel {
  readonly stage: HTMLElement;
  private readonly root: HTMLElement;
  private readonly stateLine: HTMLElement;
  private readonly participantLine: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly micButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly screenButton: HTMLButtonElement;
  private startedAt: number | null = null;
  private tick: number | null = null;
  private microphoneOn = true;
  private cameraOn: boolean;
  private screenShareOn = false;
  private offset: { x: number; y: number } | null = null;
  private dragCleanup: (() => void) | null = null;

  constructor(kind: 'voice' | 'video', private readonly handlers: CallPanelHandlers) {
    this.cameraOn = kind === 'video';
    this.root = document.createElement('aside');
    this.root.className = 'call-panel';
    this.root.dataset.chatLiteCallStage = 'true';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', kind === 'video' ? '視訊通話' : '語音通話');

    const head = document.createElement('header');
    head.className = 'call-panel-head';
    const title = document.createElement('div');
    title.className = 'call-panel-title';
    const heading = document.createElement('strong');
    heading.textContent = kind === 'video' ? '視訊通話' : '語音通話';
    this.timer = document.createElement('span');
    this.timer.className = 'call-timer';
    this.timer.textContent = '00:00';
    title.append(heading, this.timer);
    this.stateLine = document.createElement('p');
    this.stateLine.className = 'call-state';
    this.stateLine.setAttribute('aria-live', 'polite');
    this.stateLine.textContent = callPhaseLabel('creating');
    this.participantLine = document.createElement('p');
    this.participantLine.className = 'call-participants';
    this.participantLine.textContent = '等待對方加入…';
    const minimize = button('縮小', 'call-minimize');
    minimize.setAttribute('aria-label', '縮小通話畫面');
    minimize.addEventListener('click', () => {
      const minimized = this.root.classList.toggle('minimized');
      minimize.textContent = minimized ? '展開' : '縮小';
      minimize.setAttribute('aria-label', minimized ? '展開通話畫面' : '縮小通話畫面');
    });
    head.append(title, this.stateLine, this.participantLine, minimize);

    this.stage = document.createElement('div');
    this.stage.className = 'call-videos';

    const controls = document.createElement('div');
    controls.className = 'call-controls';
    this.micButton = button('靜音', 'call-control');
    this.cameraButton = button(this.cameraOn ? '關閉鏡頭' : '開啟鏡頭', 'call-control');
    this.cameraButton.hidden = kind === 'voice';
    this.screenButton = button('分享畫面', 'call-control');
    this.screenButton.hidden = typeof navigator.mediaDevices?.getDisplayMedia !== 'function';
    const hangUp = button('掛斷', 'call-control call-hangup');
    controls.append(this.micButton, this.cameraButton, this.screenButton, hangUp);

    this.micButton.addEventListener('click', () => void this.toggle('microphone'));
    this.cameraButton.addEventListener('click', () => void this.toggle('camera'));
    this.screenButton.addEventListener('click', () => void this.toggle('screenShare'));
    hangUp.addEventListener('click', () => handlers.hangUp());
    head.addEventListener('pointerdown', (event) => this.startDrag(event));

    this.root.append(head, this.stage, controls);
    document.body.append(this.root);
  }

  setState(phase: ClientCallPhase): void {
    this.root.dataset.callPhase = phase;
    this.stateLine.textContent = callPhaseLabel(phase);
  }

  setConnectedAt(connectedAtMs: number): void {
    if (this.startedAt !== null) return;
    this.startedAt = connectedAtMs;
    this.renderElapsed();
    this.tick = window.setInterval(() => this.renderElapsed(), 1000);
  }

  setParticipants(participants: CallParticipant[]): void {
    this.participantLine.textContent = participants.length
      ? `通話中：你、${participants.map((participant) => participant.name).join('、')}`
      : '等待對方加入…';
  }

  destroy(): void {
    if (this.tick !== null) window.clearInterval(this.tick);
    this.tick = null;
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.root.remove();
  }

  private renderElapsed(): void {
    if (this.startedAt === null) return;
    const seconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    this.timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private async toggle(control: 'microphone' | 'camera' | 'screenShare'): Promise<void> {
    const state = { microphone: !this.microphoneOn, camera: !this.cameraOn, screenShare: !this.screenShareOn }[control];
    try {
      await this.handlers[control](state);
    } catch (error) {
      this.handlers.failed(error instanceof Error ? error.message : String(error));
      return;
    }
    if (control === 'microphone') {
      this.microphoneOn = state;
      this.micButton.textContent = state ? '靜音' : '取消靜音';
      this.micButton.classList.toggle('off', !state);
    } else if (control === 'camera') {
      this.cameraOn = state;
      this.cameraButton.textContent = state ? '關閉鏡頭' : '開啟鏡頭';
      this.cameraButton.classList.toggle('off', !state);
    } else {
      this.screenShareOn = state;
      this.screenButton.textContent = state ? '停止分享' : '分享畫面';
      this.screenButton.classList.toggle('on', state);
    }
  }

  /**
   * Positioning starts from the CSS corner offsets. The first drag switches the
   * panel to explicit left/top so both axes are driven by one source, otherwise
   * the right/bottom anchors keep fighting the values being written here.
   */
  private startDrag(event: PointerEvent): void {
    if (event.button !== 0 || window.matchMedia('(max-width: 720px)').matches) return;
    this.dragCleanup?.();
    const bounds = this.root.getBoundingClientRect();
    this.offset = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.root.style.left = `${bounds.left}px`;
    this.root.style.top = `${bounds.top}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this.root.classList.add('dragging');
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();

    const move = (moved: PointerEvent): void => {
      if (!this.offset) return;
      const maxLeft = window.innerWidth - this.root.offsetWidth;
      const maxTop = window.innerHeight - this.root.offsetHeight;
      this.root.style.left = `${Math.min(Math.max(0, moved.clientX - this.offset.x), Math.max(0, maxLeft))}px`;
      this.root.style.top = `${Math.min(Math.max(0, moved.clientY - this.offset.y), Math.max(0, maxTop))}px`;
    };
    const stop = (): void => {
      this.offset = null;
      this.root.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      this.dragCleanup = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    this.dragCleanup = stop;
  }
}
