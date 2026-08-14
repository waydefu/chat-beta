export interface AISource {
  title: string;
  url: string;
}

export interface AIGrounding {
  usedSearch: boolean;
  sources: AISource[];
}

const MAX_SOURCES = 5;
const MAX_TITLE_LENGTH = 120;

export function normalizeSourceUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function normalizeSourceTitle(rawTitle: unknown, url: string): string {
  let title = '';
  if (typeof rawTitle === 'string') {
    title = Array.from(rawTitle)
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }
  if (!title) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      title = hostname || '來源網頁';
    } catch {
      title = '來源網頁';
    }
  }
  return title;
}

export interface RawGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
    domain?: string;
  };
  retrievedContext?: {
    uri?: string;
    title?: string;
  };
}

export function normalizeGroundingChunk(chunk: unknown): AISource | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const candidate = chunk as RawGroundingChunk;
  const rawUrl = candidate.web?.uri ?? candidate.retrievedContext?.uri;
  const url = normalizeSourceUrl(rawUrl);
  if (!url) return null;

  const rawTitle = candidate.web?.title ?? candidate.retrievedContext?.title;
  const title = normalizeSourceTitle(rawTitle, url);
  return { title, url };
}

export interface RawGroundingMetadata {
  groundingChunks?: unknown[];
  webSearchQueries?: unknown[];
  searchEntryPoint?: unknown;
}

export function extractSourcesFromGroundingMetadata(metadata: unknown): AISource[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const meta = metadata as RawGroundingMetadata;
  if (!Array.isArray(meta.groundingChunks)) return [];

  const sources: AISource[] = [];
  const seenUrls = new Set<string>();

  for (const chunk of meta.groundingChunks) {
    const source = normalizeGroundingChunk(chunk);
    if (!source) continue;
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    sources.push(source);
    if (sources.length >= MAX_SOURCES) break;
  }

  return sources;
}

export function mergeGroundingSources(existing: readonly AISource[], metadata: unknown): AISource[] {
  const merged: AISource[] = [...existing];
  const seenUrls = new Set<string>(existing.map((s) => s.url));

  const incoming = extractSourcesFromGroundingMetadata(metadata);
  for (const source of incoming) {
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    merged.push(source);
    if (merged.length >= MAX_SOURCES) break;
  }

  return merged.slice(0, MAX_SOURCES);
}

export function determineGroundingUsed(sources: readonly AISource[], metadataOrSearchFlag: unknown): boolean {
  if (sources.length > 0) return true;
  if (typeof metadataOrSearchFlag === 'boolean') return metadataOrSearchFlag;
  if (!metadataOrSearchFlag || typeof metadataOrSearchFlag !== 'object') return false;
  const meta = metadataOrSearchFlag as RawGroundingMetadata;
  if (Array.isArray(meta.webSearchQueries) && meta.webSearchQueries.length > 0) return true;
  if (Array.isArray(meta.groundingChunks) && meta.groundingChunks.length > 0) return true;
  return false;
}
