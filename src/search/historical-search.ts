import type { ChatMessage } from '../types';
import { truncate } from '../utils';
import { AlgoliaSearchProvider } from './providers/algolia-search-provider';

function textOf(message: ChatMessage): string {
  if (message.kind === 'text') return message.text;
  if (message.kind === 'system') return message.text || message.event;
  if (message.kind === 'sticker') return '貼圖';
  if (message.kind === 'call') return message.event === 'started' ? '開始了一通電話' : '通話已結束';
  return message.text || '附件';
}

export async function historicalSearchSummary(roomId: string, query: string): Promise<{
  count: number;
  copy: string;
}> {
  const page = await new AlgoliaSearchProvider().search(roomId, query);
  return {
    count: page.messages.length,
    copy: page.messages.slice(0, 5)
      .map((message) => `${message.senderDisplayName}：${truncate(textOf(message), 54)}`)
      .join('\n'),
  };
}
