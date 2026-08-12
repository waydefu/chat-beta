export interface VoiceRecording {
  file: File;
  duration: number;
  previewUrl: string;
}

export class VoiceRecorderService {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedDuration = 0;

  get active(): boolean {
    return this.recorder?.state === 'recording' || this.recorder?.state === 'paused';
  }

  get paused(): boolean {
    return this.recorder?.state === 'paused';
  }

  async start(): Promise<void> {
    if (this.active) throw new Error('已經在錄音。');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.chunks = [];
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedDuration = 0;
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) this.chunks.push(event.data);
    });
    this.recorder.start(250);
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.pausedAt = Date.now();
      this.recorder.pause();
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused') {
      this.pausedDuration += Date.now() - this.pausedAt;
      this.pausedAt = 0;
      this.recorder.resume();
    }
  }

  stop(): Promise<VoiceRecording> {
    const recorder = this.recorder;
    if (!recorder || !this.active) return Promise.reject(new Error('目前沒有錄音。'));
    return new Promise((resolve) => {
      recorder.addEventListener('stop', () => {
        const pausedDuration = this.pausedDuration + (this.pausedAt ? Date.now() - this.pausedAt : 0);
        const duration = Math.max(1, Math.round((Date.now() - this.startedAt - pausedDuration) / 1000));
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        this.release();
        resolve({ file, duration, previewUrl: URL.createObjectURL(blob) });
      }, { once: true });
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
