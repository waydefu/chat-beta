import type { ChatMessage } from '../types';
import { compareMessages } from '../utils';

export interface MessageMergeResult {
  addedIds: ReadonlySet<string>;
  changedIds: ReadonlySet<string>;
}

/**
 * Normalized room message state. The live query is only a moving window; items
 * that leave that window are deliberately retained after they have been loaded.
 */
export class PaginatedMessageStore {
  readonly byId = new Map<string, ChatMessage>();

  mergeLive(page: readonly ChatMessage[], snapshotChangedIds: readonly string[]): MessageMergeResult {
    return this.merge(page, new Set(snapshotChangedIds));
  }

  mergeHistorical(page: readonly ChatMessage[]): MessageMergeResult {
    return this.merge(page, new Set(page.map((message) => message.id)));
  }

  ordered(): ChatMessage[] {
    return [...this.byId.values()].sort(compareMessages);
  }

  clear(): void {
    this.byId.clear();
  }

  private merge(page: readonly ChatMessage[], reportedChanges: ReadonlySet<string>): MessageMergeResult {
    const addedIds = new Set<string>();
    const changedIds = new Set<string>();
    for (const message of page) {
      if (!this.byId.has(message.id)) addedIds.add(message.id);
      if (reportedChanges.has(message.id) || !this.byId.has(message.id)) changedIds.add(message.id);
      this.byId.set(message.id, message);
    }
    return { addedIds, changedIds };
  }
}
