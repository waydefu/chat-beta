import type { ChatMessage } from '../../src/types';

export function messageFixture(count = 5_000): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m_${String(index).padStart(5, '0')}`,
    roomId: 'fixture-room',
    senderId: `user-${index % 3}`,
    senderType: 'user' as const,
    senderDisplayName: `User ${index % 3}`,
    kind: 'text' as const,
    text: `Fixture message ${index}`,
    clientCreatedAt: index,
  }));
}
