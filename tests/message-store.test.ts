import { describe, expect, it } from 'vitest';

import { PaginatedMessageStore } from '../src/messages/message-store';
import type { ChatMessage } from '../src/types';

function message(id: string, time: number, text = id): ChatMessage {
  return {
    id,
    roomId: 'room',
    senderId: 'alice',
    senderType: 'user',
    senderDisplayName: 'Alice',
    kind: 'text',
    text,
    createdAt: { toMillis: () => time },
  };
}

describe('paginated message store', () => {
  it('retains historical pages when the live window advances', () => {
    const store = new PaginatedMessageStore();
    store.mergeLive([message('m3', 3), message('m4', 4)], ['m3', 'm4']);
    store.mergeHistorical([message('m1', 1), message('m2', 2)]);

    const result = store.mergeLive([message('m4', 4), message('m5', 5)], ['m5']);

    expect(store.ordered().map(({ id }) => id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect([...result.addedIds]).toEqual(['m5']);
    expect([...result.changedIds]).toEqual(['m5']);
  });

  it('deduplicates overlaps and reports only snapshot changes', () => {
    const store = new PaginatedMessageStore();
    store.mergeHistorical([message('m1', 1), message('m2', 2)]);

    const result = store.mergeLive([message('m2', 2, 'edited'), message('m3', 3)], ['m2', 'm3']);

    expect(store.ordered()).toHaveLength(3);
    expect(store.byId.get('m2')).toMatchObject({ text: 'edited' });
    expect([...result.changedIds]).toEqual(['m2', 'm3']);
  });

  it('orders equal timestamps by stable message id', () => {
    const store = new PaginatedMessageStore();
    store.mergeLive([message('b', 1), message('a', 1)], ['a', 'b']);
    expect(store.ordered().map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
