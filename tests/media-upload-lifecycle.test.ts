import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadAttachment = vi.hoisted(() => vi.fn());

vi.mock('../src/media/r2-media.service', () => ({ uploadAttachment }));

import { MediaUploadController, type MediaUploadElements } from '../src/media/media-upload.controller';

const IDLE = 'Enter 送出 · Shift + Enter 換行';

function elements(): MediaUploadElements & { status: { textContent: string } } {
  return {
    attachmentInput: { value: 'C:\\fakepath\\a.png' } as HTMLInputElement,
    customStickerInput: { value: '' } as HTMLInputElement,
    customStickerPicker: { hidden: false } as HTMLElement,
    cancel: { hidden: true } as HTMLButtonElement,
    status: { textContent: '' } as HTMLElement,
  } as MediaUploadElements & { status: { textContent: string } };
}

const file = { name: 'a.png' } as File;

beforeEach(() => {
  vi.useFakeTimers();
  uploadAttachment.mockReset();
  vi.stubGlobal('window', {
    setTimeout: (handler: () => void, delay: number) => setTimeout(handler, delay) as unknown as number,
    clearTimeout: (handle: number) => clearTimeout(handle),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('media upload status lifecycle', () => {
  it('resets the status line after a completed upload', async () => {
    uploadAttachment.mockResolvedValue(undefined);
    const ui = elements();
    const controller = new MediaUploadController('room-a', ui);

    await controller.upload(file);
    expect(ui.status.textContent).toBe('上傳完成');

    await vi.advanceTimersByTimeAsync(2_600);
    expect(ui.status.textContent).toBe(IDLE);
  });

  it('does not write into the next room after the controller is disposed', async () => {
    uploadAttachment.mockResolvedValue(undefined);
    const ui = elements();
    const controller = new MediaUploadController('room-a', ui);

    await controller.upload(file);
    // Room switch: closeRoom() disposes this controller, but `status` is a
    // single element shared by every room, so a pending reset would land in
    // whichever room the user is looking at 2.5s later.
    controller.dispose();
    expect(ui.status.textContent).toBe(IDLE);

    ui.status.textContent = '正在上傳 b.png · 40%';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ui.status.textContent).toBe('正在上傳 b.png · 40%');
  });

  it('does not reschedule the reset when an aborted upload unwinds after disposal', async () => {
    uploadAttachment.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const ui = elements();
    const controller = new MediaUploadController('room-a', ui);

    const pending = controller.upload(file).catch(() => undefined);
    controller.dispose();
    await pending;

    ui.status.textContent = '新房間的狀態';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ui.status.textContent).toBe('新房間的狀態');
  });

  it('refuses to start a new upload once disposed', async () => {
    const ui = elements();
    const controller = new MediaUploadController('room-a', ui);
    controller.dispose();

    await controller.upload(file);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('lets a fresh upload cancel the previous reset instead of being wiped by it', async () => {
    uploadAttachment.mockResolvedValue(undefined);
    const ui = elements();
    const controller = new MediaUploadController('room-a', ui);

    await controller.upload(file);
    await vi.advanceTimersByTimeAsync(1_000);

    uploadAttachment.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 10_000)); });
    const second = controller.upload(file);
    await vi.advanceTimersByTimeAsync(2_000);
    // The first upload's pending reset must not blank the second one's progress.
    expect(ui.status.textContent).toBe('正在上傳 a.png…');

    await vi.advanceTimersByTimeAsync(10_000);
    await second;
  });
});
