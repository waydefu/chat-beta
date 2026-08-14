import { createHash } from 'node:crypto';

export function pushTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function legacyPushTokenDocumentId(token: string): string {
  return token.replaceAll('/', '_');
}

export function isPushTokenHash(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

export function canReleasePushClaim(claimUid: unknown, requesterUid: string): boolean {
  return typeof claimUid === 'string' && claimUid === requesterUid;
}

export function pushClaimAction(priorUid: unknown, requesterUid: string): 'create' | 'refresh' | 'replace' {
  if (typeof priorUid !== 'string') return 'create';
  return priorUid === requesterUid ? 'refresh' : 'replace';
}

export function chatNotificationBody(kind: unknown): string {
  if (kind === 'image') return '傳送了一張圖片';
  if (kind === 'video') return '傳送了一段影片';
  if (kind === 'audio') return '傳送了一段語音';
  if (kind === 'file') return '傳送了一個檔案';
  if (kind === 'sticker') return '傳送了一張貼圖';
  return '傳送了一則新訊息';
}
