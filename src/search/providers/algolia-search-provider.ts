import { callFunction } from '../../firebase/callables';
import type { SearchPage, SearchProvider } from './search-provider';

interface SearchResponse {
  hits: Array<{
    messageId: string;
    roomId: string;
    senderDisplayName: string;
    senderType: 'user' | 'bot' | 'system';
    text: string;
    createdAt: number;
  }>;
  page: number;
  pages: number;
}

export class AlgoliaSearchProvider implements SearchProvider {
  search(roomId: string, query: string, cursor?: string): Promise<SearchPage> {
    return callFunction<{ roomId: string; query: string; page: number }, SearchResponse>(
      'searchMessages',
      { roomId, query, page: Number(cursor || 0) },
    ).then((response) => ({
      messages: response.hits.map((hit) => ({
        id: hit.messageId,
        roomId: hit.roomId,
        senderId: '',
        senderType: hit.senderType,
        senderDisplayName: hit.senderDisplayName,
        kind: 'text' as const,
        text: hit.text,
        clientCreatedAt: hit.createdAt,
      })),
      cursor: response.page + 1 < response.pages ? String(response.page + 1) : undefined,
    }));
  }
}
