/**
 * Domain error vocabulary for the AI path. Provider errors carry request
 * bodies, prompts and occasionally credentials in their payloads, so nothing
 * raw from the SDK reaches a user or a log line.
 */
export type AiErrorCode =
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_ALREADY_RUNNING'
  | 'AI_PERMISSION_DENIED'
  | 'AI_CONFIGURATION_ERROR'
  | 'AI_UNKNOWN';

const MESSAGES: Record<AiErrorCode, string> = {
  AI_RATE_LIMITED: 'Gemini 目前請求較多，請稍後再試。',
  AI_PROVIDER_UNAVAILABLE: 'Gemini 暫時無法使用，請稍後再試。',
  AI_TIMEOUT: 'Gemini 回應逾時，請再試一次。',
  AI_CANCELLED: 'AI 回覆已取消。',
  AI_CONTEXT_TOO_LARGE: '這段對話太長，Gemini 無法一次處理，請縮短或分段詢問。',
  AI_ALREADY_RUNNING: 'Gemini 已經在處理這則訊息。',
  AI_PERMISSION_DENIED: '你沒有權限在這個聊天室使用 Gemini。',
  AI_CONFIGURATION_ERROR: 'Gemini 尚未完成設定，請聯絡管理員。',
  AI_UNKNOWN: 'Gemini 回覆失敗，請稍後再試。',
};

export function aiErrorMessage(code: AiErrorCode): string {
  return MESSAGES[code];
}

function numericStatus(error: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'code', 'statusCode'] as const) {
    const value = error[key];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function textOf(error: Record<string, unknown>): string {
  const parts = [error.status, error.code, error.name, error.message]
    .filter((part): part is string => typeof part === 'string');
  return parts.join(' ').toUpperCase();
}

/**
 * Classifies a provider failure. Reads only the shallow, non-payload fields --
 * never `response`, `request` or `details`, which is where prompts live.
 */
export function classifyProviderError(error: unknown, aborted = false): AiErrorCode {
  if (aborted) return 'AI_CANCELLED';
  if (!error || typeof error !== 'object') return 'AI_UNKNOWN';
  const record = error as Record<string, unknown>;
  if (record.name === 'AbortError') return 'AI_CANCELLED';

  const status = numericStatus(record);
  const text = textOf(record);

  if (status === 429 || text.includes('RESOURCE_EXHAUSTED') || text.includes('RATE LIMIT')) {
    return 'AI_RATE_LIMITED';
  }
  if (status === 401 || status === 403 || text.includes('PERMISSION_DENIED') || text.includes('UNAUTHENTICATED')) {
    // A rejected API key looks like an auth failure from here, and that is a
    // deployment problem rather than something the caller did wrong.
    return 'AI_CONFIGURATION_ERROR';
  }
  if (status === 400 && text.includes('API KEY')) return 'AI_CONFIGURATION_ERROR';
  if (status === 504 || text.includes('DEADLINE_EXCEEDED') || text.includes('TIMEOUT') || text.includes('ETIMEDOUT')) {
    return 'AI_TIMEOUT';
  }
  if ((typeof status === 'number' && status >= 500) || text.includes('UNAVAILABLE')
    || text.includes('ECONNRESET') || text.includes('ENOTFOUND') || text.includes('FETCH FAILED')) {
    return 'AI_PROVIDER_UNAVAILABLE';
  }
  return 'AI_UNKNOWN';
}

/**
 * The only shape an error may take in a log line. Message text is excluded on
 * purpose: provider messages quote the offending request.
 */
export function safeErrorFields(error: unknown): {
  errorName?: string;
  errorCode?: string;
  errorStatus?: number;
} {
  if (!error || typeof error !== 'object') return {};
  const record = error as Record<string, unknown>;
  const status = numericStatus(record);
  return {
    ...(typeof record.name === 'string' ? { errorName: record.name } : {}),
    ...(typeof record.code === 'string' ? { errorCode: record.code } : {}),
    ...(status === undefined ? {} : { errorStatus: status }),
  };
}
