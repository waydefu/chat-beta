import { callFunction } from '../firebase/callables';
import { uploadToR2, type UploadProgress } from '../media/r2-media.service';
import type { StickerMessage } from '../types';

export const BUILT_IN_STICKERS = new Map([
  ['wave', '👋'],
  ['heart', '💙'],
  ['laugh', '😂'],
  ['party', '🎉'],
  ['thumbs-up', '👍'],
  ['coffee', '☕'],
]);

export async function sendBuiltInSticker(roomId: string, stickerId: string): Promise<void> {
  await callFunction('sendStickerMessage', { roomId, stickerPackId: 'built-in-v1', stickerId });
}

export async function uploadAndSendCustomSticker(
  roomId: string,
  file: File,
  signal: AbortSignal,
  progress: (value: UploadProgress) => void,
): Promise<void> {
  const grant = await callFunction<{
    roomId: string;
    fileName: string;
    mimeType: string;
    size: number;
  }, { packId: string; stickerId: string; uploadUrl: string }>('requestCustomStickerUpload', {
    roomId, fileName: file.name, mimeType: file.type, size: file.size,
  }, { limitedUseAppCheckTokens: true });
  signal.throwIfAborted();
  await uploadToR2(file, grant.uploadUrl, signal, progress);
  await callFunction('finalizeCustomStickerUpload', { roomId, stickerId: grant.stickerId }, {
    limitedUseAppCheckTokens: true,
  });
  await callFunction('sendStickerMessage', {
    roomId, stickerPackId: grant.packId, stickerId: grant.stickerId,
  });
}

const customStickerUrls = new Map<string, { url: string; expiresAt: number }>();

export async function customStickerUrl(message: StickerMessage): Promise<string> {
  const cached = customStickerUrls.get(message.id);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const response = await callFunction<{
    roomId: string;
    messageId: string;
  }, { url: string; expiresIn: number }>('getCustomStickerDownloadUrl', {
    roomId: message.roomId, messageId: message.id,
  });
  customStickerUrls.set(message.id, {
    url: response.url,
    expiresAt: Date.now() + Math.max(1, response.expiresIn - 30) * 1000,
  });
  return response.url;
}
