import type { ChatMessage } from '../../types';

export interface SearchPage {
  messages: ChatMessage[];
  cursor?: string;
}

export interface SearchProvider {
  search(roomId: string, query: string, cursor?: string): Promise<SearchPage>;
}
