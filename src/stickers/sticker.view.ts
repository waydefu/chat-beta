import type { StickerMessage } from '../types';
import { customStickerUrl } from './sticker.service';

const BUILT_IN_STICKERS = new Map([
  ['wave', '👋'], ['heart', '💙'], ['laugh', '😂'], ['party', '🎉'], ['thumbs-up', '👍'], ['coffee', '☕'],
]);

export async function renderSticker(content: HTMLElement, message: StickerMessage): Promise<void> {
  const builtIn = message.stickerPackId === 'built-in-v1' ? BUILT_IN_STICKERS.get(message.stickerId) : undefined;
  if (builtIn) {
    content.textContent = builtIn;
    return;
  }
  const image = document.createElement('img');
  image.alt = '自訂貼圖';
  image.loading = 'lazy';
  image.decoding = 'async';
  try {
    image.src = await customStickerUrl(message);
    content.replaceChildren(image);
  } catch {
    content.textContent = '貼圖已無法使用';
  }
}
