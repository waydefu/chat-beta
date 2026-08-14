import type { AISource } from '../types';

export interface FormattedSource {
  title: string;
  url: string;
  domain: string | null;
}

export function extractSourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function formatAiSources(sources: readonly AISource[]): FormattedSource[] {
  return sources.slice(0, 5).map((source) => ({
    title: source.title,
    url: source.url,
    domain: extractSourceDomain(source.url),
  }));
}

export interface MinimalDocument {
  createElement(tagName: string): HTMLElement;
}

export function renderAiSources(
  sources: readonly AISource[],
  doc: MinimalDocument = typeof document !== 'undefined' ? document : (undefined as unknown as MinimalDocument),
): HTMLElement {
  const details = doc.createElement('details');
  details.className = 'ai-sources';
  const summary = doc.createElement('summary');
  summary.className = 'ai-sources-summary';
  summary.textContent = `來源 · ${sources.length}`;
  const list = doc.createElement('ul');
  list.className = 'ai-sources-list';
  for (const formatted of formatAiSources(sources)) {
    const item = doc.createElement('li');
    const link = doc.createElement('a') as HTMLAnchorElement;
    link.className = 'ai-source-link';
    link.href = formatted.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = formatted.title;

    if (formatted.domain) {
      const domain = doc.createElement('span');
      domain.className = 'ai-source-domain';
      domain.textContent = ` (${formatted.domain})`;
      link.append(domain);
    }

    item.append(link);
    list.append(item);
  }
  details.append(summary, list);
  return details;
}
