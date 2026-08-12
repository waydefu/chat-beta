export type DomainErrorCode =
  | 'auth'
  | 'permission'
  | 'network'
  | 'validation'
  | 'upload'
  | 'ai'
  | 'call'
  | 'rate-limit'
  | 'unknown';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function toDomainError(error: unknown, fallback = '操作失敗，請稍後再試。'): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof Error) return new DomainError('unknown', fallback, error);
  return new DomainError('unknown', fallback, error);
}
