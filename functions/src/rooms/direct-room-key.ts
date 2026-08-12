import { createHash } from 'node:crypto';

export function directRoomKey(firstUid: string, secondUid: string): string {
  return createHash('sha256').update([firstUid, secondUid].sort().join('\u0000')).digest('hex');
}
