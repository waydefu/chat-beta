export interface MediaUploadElements {
  attachmentInput: HTMLInputElement;
  customStickerInput: HTMLInputElement;
  customStickerPicker: HTMLElement;
  cancel: HTMLButtonElement;
  status: HTMLElement;
}

export class MediaUploadController {
  private abortController: AbortController | null = null;

  constructor(
    private readonly roomId: string,
    private readonly ui: MediaUploadElements,
  ) {}

  async upload(file: File, metadata?: { duration?: number }): Promise<void> {
    if (this.abortController) return;
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
    if (this.abortController) return;
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

  dispose(): void {
    this.cancel();
    this.abortController = null;
    this.ui.cancel.hidden = true;
  }

  private finish(input: HTMLInputElement): void {
    this.abortController = null;
    this.ui.cancel.hidden = true;
    input.value = '';
    window.setTimeout(() => {
      if (!this.abortController) this.ui.status.textContent = 'Enter 送出 · Shift + Enter 換行';
    }, 2500);
  }
}
