import { describe, expect, it } from 'vitest';

import {
  determineGroundingUsed,
  extractSourcesFromGroundingMetadata,
  mergeGroundingSources,
  normalizeGroundingChunk,
  normalizeSourceTitle,
  normalizeSourceUrl,
} from '../src/bots/grounding-policy.js';

describe('grounding source normalization', () => {
  it('normalizes valid http and https URLs and rejects invalid ones', () => {
    expect(normalizeSourceUrl('https://example.com/weather?loc=tamsui')).toBe('https://example.com/weather?loc=tamsui');
    expect(normalizeSourceUrl('http://cwa.gov.tw/')).toBe('http://cwa.gov.tw/');
    expect(normalizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSourceUrl('ftp://example.com/file')).toBeNull();
    expect(normalizeSourceUrl('not-a-url')).toBeNull();
    expect(normalizeSourceUrl('')).toBeNull();
    expect(normalizeSourceUrl(null)).toBeNull();
    expect(normalizeSourceUrl(undefined)).toBeNull();
  });

  it('normalizes and bounds source titles with hostname fallback', () => {
    expect(normalizeSourceTitle('  中央氣象署 氣象預報 \n\t ', 'https://cwa.gov.tw/forecast')).toBe('中央氣象署 氣象預報');
    expect(normalizeSourceTitle('', 'https://www.accuweather.com/en/tw/tamsui')).toBe('accuweather.com');
    expect(normalizeSourceTitle('   ', 'https://weather.com/news')).toBe('weather.com');
    expect(normalizeSourceTitle('a'.repeat(200), 'https://example.com')).toBe('a'.repeat(120));
  });

  it('extracts sources from web and retrievedContext chunks', () => {
    expect(normalizeGroundingChunk({
      web: { uri: 'https://cwa.gov.tw/today', title: '中央氣象署' },
    })).toEqual({
      title: '中央氣象署',
      url: 'https://cwa.gov.tw/today',
    });

    expect(normalizeGroundingChunk({
      retrievedContext: { uri: 'https://news.google.com/ai', title: 'AI News' },
    })).toEqual({
      title: 'AI News',
      url: 'https://news.google.com/ai',
    });

    expect(normalizeGroundingChunk({
      web: { uri: 'javascript:evil()', title: 'Evil' },
    })).toBeNull();

    expect(normalizeGroundingChunk(null)).toBeNull();
    expect(normalizeGroundingChunk({})).toBeNull();
  });

  it('extracts, dedupes, and bounds sources from metadata up to 5', () => {
    const rawMetadata = {
      groundingChunks: [
        { web: { uri: 'https://cwa.gov.tw/today', title: '氣象署 1' } },
        { web: { uri: 'https://cwa.gov.tw/today', title: '氣象署 重複' } },
        { web: { uri: 'https://news.google.com/item1', title: '新聞 1' } },
        { web: { uri: 'https://news.google.com/item2', title: '新聞 2' } },
        { web: { uri: 'https://news.google.com/item3', title: '新聞 3' } },
        { web: { uri: 'https://news.google.com/item4', title: '新聞 4' } },
        { web: { uri: 'https://news.google.com/item5', title: '新聞 5' } },
      ],
    };

    const sources = extractSourcesFromGroundingMetadata(rawMetadata);
    expect(sources).toHaveLength(5);
    expect(sources[0].url).toBe('https://cwa.gov.tw/today');
    expect(sources[1].url).toBe('https://news.google.com/item1');
    expect(sources[4].url).toBe('https://news.google.com/item4');
  });

  it('safely handles empty or malformed metadata without throwing', () => {
    expect(extractSourcesFromGroundingMetadata(null)).toEqual([]);
    expect(extractSourcesFromGroundingMetadata(undefined)).toEqual([]);
    expect(extractSourcesFromGroundingMetadata('invalid string')).toEqual([]);
    expect(extractSourcesFromGroundingMetadata({})).toEqual([]);
    expect(extractSourcesFromGroundingMetadata({ groundingChunks: 'not an array' })).toEqual([]);
  });
});

describe('streaming grounding merge', () => {
  it('merges sources across streaming chunks idempotently and dedupes them', () => {
    // chunk 1: text only, no metadata
    let sources = mergeGroundingSources([], null);
    expect(sources).toEqual([]);

    // chunk 2: text + source A
    sources = mergeGroundingSources(sources, {
      groundingChunks: [{ web: { uri: 'https://source-a.com', title: 'Source A' } }],
    });
    expect(sources).toEqual([{ title: 'Source A', url: 'https://source-a.com/' }]);

    // chunk 3: source A + source B
    sources = mergeGroundingSources(sources, {
      groundingChunks: [
        { web: { uri: 'https://source-a.com', title: 'Source A Duplicate' } },
        { web: { uri: 'https://source-b.com', title: 'Source B' } },
      ],
    });
    expect(sources).toEqual([
      { title: 'Source A', url: 'https://source-a.com/' },
      { title: 'Source B', url: 'https://source-b.com/' },
    ]);
  });
});

describe('grounding usage determination', () => {
  it('identifies ungrounded vs grounded responses', () => {
    expect(determineGroundingUsed([], null)).toBe(false);
    expect(determineGroundingUsed([], {})).toBe(false);
    expect(determineGroundingUsed([], { webSearchQueries: [] })).toBe(false);

    expect(determineGroundingUsed([{ title: 'A', url: 'https://a.com' }], null)).toBe(true);
    expect(determineGroundingUsed([], { webSearchQueries: ['淡水 天氣'] })).toBe(true);
    expect(determineGroundingUsed([], { groundingChunks: [{ web: { uri: 'https://a.com' } }] })).toBe(true);
    expect(determineGroundingUsed([], true)).toBe(true);
    expect(determineGroundingUsed([], false)).toBe(false);
  });
});

describe('privacy and metadata invariants', () => {
  it('does not leak search queries or raw grounding into normalized metadata', () => {
    const rawMetadataWithQuery = {
      webSearchQueries: ['淡水天氣 即時氣溫', 'private user query'],
      groundingChunks: [
        { web: { uri: 'https://cwa.gov.tw/today', title: '中央氣象署' } },
      ],
      searchEntryPoint: { renderedContent: '<search-widget>' },
    };

    const sources = extractSourcesFromGroundingMetadata(rawMetadataWithQuery);
    expect(sources).toEqual([{ title: '中央氣象署', url: 'https://cwa.gov.tw/today' }]);

    // Confirm that normalized source contains only title and url
    for (const source of sources) {
      expect(Object.keys(source).sort()).toEqual(['title', 'url']);
      expect((source as unknown as Record<string, unknown>).webSearchQueries).toBeUndefined();
      expect((source as unknown as Record<string, unknown>).query).toBeUndefined();
    }
  });
});
