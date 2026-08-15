const IDLE_STATUS = 'Enter 送出 · Shift + Enter 換行';

export interface MediaUploadElements {
  attachmentInput: HTMLInputElement;
  customStickerInput: HTMLInputElement;
  customStickerPicker: HTMLElement;
  cancel: HTMLButtonElement;
  status: HTMLElement;
}

export class MediaUploadController {
  private abortController: AbortController | null = null;
  private resetTimer: number | null = null;
  private disposed = false;

  constructor(
    private readonly roomId: string,
    private readonly ui: MediaUploadElements,
  ) {}

  async upload(file: File, metadata?: { duration?: number }): Promise<void> {
    if (this.abortController || this.disposed) return;
    this.clearReset();
    this.abortController = new AbortController();
    this.ui.cancel.hidden = false;
    this.ui.status.textContent = `正在上傳 ${file.name}…`;
    try {
      const { uploadAttachment } = await import('./r2-media.service');
      await uploadAttachment(this.roomId, file, this.abortController.signal, (progress) => {
        this.ui.status.textContent = `正在上傳 ${file.name} · ${progress.percentage}%`;
      }, metadata);
      this.ui.status.textContent = '上傳完成';
    } finally {
      this.finish(this.ui.attachmentInput);
    }
  }

  async uploadCustomSticker(file: File): Promise<void> {
    if (this.abortController || this.disposed) return;
    this.clearReset();
    this.abortController = new AbortController();
    this.ui.cancel.hidden = false;
    this.ui.customStickerPicker.hidden = true;
    this.ui.status.textContent = `正在上傳自訂貼圖 ${file.name}…`;
    try {
      const { uploadAndSendCustomSticker } = await import('../stickers/sticker.service');
      await uploadAndSendCustomSticker(this.roomId, file, this.abortController.signal, (progress) => {
        this.ui.status.textContent = `正在上傳自訂貼圖 · ${progress.percentage}%`;
      });
      this.ui.status.textContent = '自訂貼圖已傳送';
    } finally {
      this.finish(this.ui.customStickerInput);
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * The controller is per-room, but `ui.status` is a single element that outlives
   * every room. Anything still pending here would land in whichever room the
   * user switched to, so disposal has to take the status line back rather than
   * only dropping the upload.
   */
  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.abortController = null;
    this.clearReset();
    this.ui.cancel.hidden = true;
    this.ui.status.textContent = IDLE_STATUS;
  }

  private clearReset(): void {
    if (this.resetTimer !== null) window.clearTimeout(this.resetTimer);
    this.resetTimer = null;
  }

  private finish(input: HTMLInputElement): void {
    this.abortController = null;
    this.ui.cancel.hidden = true;
    input.value = '';
    this.clearReset();
    // An aborted upload resolves through here too, after dispose() has already
    // handed the status line back. Scheduling then would undo that 2.5s later.
    if (this.disposed) return;
    this.resetTimer = window.setTimeout(() => {
      this.resetTimer = null;
      if (this.disposed || this.abortController) return;
      this.ui.status.textContent = IDLE_STATUS;
    }, 2500);
  }
}
