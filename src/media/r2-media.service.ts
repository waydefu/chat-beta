import { callFunction } from '../firebase/callables';

interface UploadGrant {
  attachmentId: string;
  uploadUrl: string;
  expiresIn: number;
}

interface FinalizedUpload {
  attachmentId: string;
  messageId: string;
  status: 'ready';
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export function uploadToR2(file: File, url: string, signal: AbortSignal, progress: (value: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('上傳已取消。', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = (): void => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type);
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      progress({ loaded: event.loaded, total: event.total, percentage: Math.round((event.loaded / event.total) * 100) });
    });
    request.addEventListener('load', () => {
      signal.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`R2 upload failed (${request.status})`));
    });
    request.addEventListener('error', () => reject(new Error('網路錯誤，上傳失敗。')));
    request.addEventListener('abort', () => reject(new DOMException('上傳已取消。', 'AbortError')));
    request.send(file);
  });
}

export async function uploadAttachment(
  roomId: string,
  file: File,
  signal: AbortSignal,
  progress: (value: UploadProgress) => void,
  metadata?: { duration?: number },
): Promise<FinalizedUpload> {
  const grant = await callFunction<{
    roomId: string;
    fileName: string;
    mimeType: string;
    size: number;
    duration?: number;
  }, UploadGrant>('requestUpload', {
    roomId,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    ...(metadata?.duration !== undefined ? { duration: metadata.duration } : {}),
  }, { limitedUseAppCheckTokens: true });
  signal.throwIfAborted();
  await uploadToR2(file, grant.uploadUrl, signal, progress);
  return callFunction<{ roomId: string; attachmentId: string }, FinalizedUpload>('finalizeUpload', {
    roomId,
    attachmentId: grant.attachmentId,
  }, { limitedUseAppCheckTokens: true });
}

export async function attachmentDownloadUrl(roomId: string, attachmentId: string, inline = false): Promise<string> {
  const response = await callFunction<{ roomId: string; attachmentId: string; disposition?: string }, { url: string }>(
    'getAttachmentDownloadUrl',
    { roomId, attachmentId, ...(inline ? { disposition: 'inline' } : {}) },
  );
  return response.url;
}
