import { VoiceRecorderService, type VoiceRecording } from './voice-recorder.service';

export interface VoiceMessageElements {
  trigger: HTMLButtonElement;
  controls: HTMLElement;
  status: HTMLElement;
  pause: HTMLButtonElement;
  previewDialog: HTMLDialogElement;
  previewAudio: HTMLAudioElement;
  uploadStatus: HTMLElement;
}

export class VoiceMessageController {
  private readonly recorder = new VoiceRecorderService();

  constructor(
    private readonly ui: VoiceMessageElements,
    private readonly upload: (recording: VoiceRecording) => Promise<void>,
  ) {}

  async toggle(): Promise<void> {
    if (this.recorder.active) {
      await this.finish();
      return;
    }
    await this.recorder.start();
    this.ui.trigger.classList.add('recording');
    this.ui.trigger.setAttribute('aria-label', '完成語音錄製');
    this.ui.controls.hidden = false;
    this.ui.status.textContent = '錄音中';
    this.ui.pause.textContent = '暫停';
    this.ui.uploadStatus.textContent = '錄音中；可暫停、取消或完成後預覽';
  }

  togglePause(): void {
    if (!this.recorder.active) return;
    if (this.recorder.paused) {
      this.recorder.resume();
      this.ui.status.textContent = '錄音中';
      this.ui.pause.textContent = '暫停';
    } else {
      this.recorder.pause();
      this.ui.status.textContent = '錄音已暫停';
      this.ui.pause.textContent = '繼續';
    }
  }

  cancel(): void {
    this.recorder.cancel();
    this.reset();
    this.ui.uploadStatus.textContent = '語音錄製已取消';
  }

  async finish(): Promise<void> {
    if (!this.recorder.active) return;
    const recording = await this.recorder.stop();
    this.reset();
    const send = await this.preview(recording.previewUrl);
    URL.revokeObjectURL(recording.previewUrl);
    if (send) await this.upload(recording);
    else this.ui.uploadStatus.textContent = '語音訊息已取消';
  }

  dispose(): void {
    this.recorder.cancel();
    if (this.ui.previewDialog.open) this.ui.previewDialog.close('cancel');
    this.reset();
  }

  private reset(): void {
    this.ui.trigger.classList.remove('recording');
    this.ui.trigger.setAttribute('aria-label', '錄製語音訊息');
    this.ui.controls.hidden = true;
    this.ui.status.textContent = '錄音中';
    this.ui.pause.textContent = '暫停';
  }

  private preview(url: string): Promise<boolean> {
    this.ui.previewAudio.src = url;
    this.ui.previewDialog.showModal();
    return new Promise((resolve) => {
      this.ui.previewDialog.addEventListener('close', () => {
        this.ui.previewAudio.pause();
        this.ui.previewAudio.removeAttribute('src');
        this.ui.previewAudio.load();
        resolve(this.ui.previewDialog.returnValue === 'send');
      }, { once: true });
    });
  }
}
