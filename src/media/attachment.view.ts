import { getAttachment } from '../messages/message.repository';
import type { AttachmentMessage } from '../types';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export async function renderAttachmentContent(target: HTMLElement, message: AttachmentMessage): Promise<void> {
  target.textContent = '載入附件…';
  const attachmentId = message.attachmentIds[0];
  if (!attachmentId) {
    target.textContent = '附件無法使用';
    return;
  }
  try {
    const attachment = await getAttachment(message.roomId, attachmentId);
    if (!target.isConnected) return;
    target.replaceChildren();
    if (!attachment || attachment.status !== 'ready') {
      target.textContent = '附件尚未完成或已移除';
      return;
    }
    const label = document.createElement('span');
    label.className = 'attachment-label';
    label.textContent = `${attachment.fileName} · ${formatBytes(attachment.size)}`;
    target.append(label);
    const { attachmentDownloadUrl } = await import('./r2-media.service');
    const url = await attachmentDownloadUrl(message.roomId, attachment.id, attachment.type !== 'file');
    if (!target.isConnected) return;
    if (attachment.type === 'image') {
      const image = document.createElement('img');
      image.className = 'attachment-image';
      image.alt = attachment.fileName;
      image.loading = 'lazy';
      image.decoding = 'async';
      if (attachment.width) image.width = attachment.width;
      if (attachment.height) image.height = attachment.height;
      image.src = url;
      target.prepend(image);
    } else if (attachment.type === 'video' || attachment.type === 'audio') {
      const media = document.createElement(attachment.type);
      media.className = 'attachment-media';
      media.controls = true;
      media.preload = 'metadata';
      media.src = url;
      target.prepend(media);
    } else {
      const link = document.createElement('a');
      link.className = 'attachment-card';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `下載 ${attachment.fileName}`;
      target.prepend(link);
    }
  } catch {
    target.textContent = '附件載入失敗或連結已失效，請重試。';
  }
}
