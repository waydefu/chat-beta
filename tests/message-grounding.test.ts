import { describe, expect, it } from 'vitest';

import { extractSourceDomain, formatAiSources, renderAiSources, type MinimalDocument } from '../src/bots/grounding.view';
import type { AISource } from '../src/types';

class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  href = '';
  target = '';
  rel = '';
  children: MockElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: (MockElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this.textContent += node;
      } else {
        this.children.push(node);
        this.textContent += node.textContent;
      }
    }
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this.children.find((c) => c.className.split(' ').includes(cls)) ?? null;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (el.className.split(' ').includes(cls)) results.push(el);
      }
      for (const child of el.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return results;
  }
}

const mockDocument: MinimalDocument = {
  createElement: (tagName: string) => new MockElement(tagName) as unknown as HTMLElement,
};

describe('client grounding source formatting', () => {
  it('extracts hostnames cleanly and strips leading www.', () => {
    expect(extractSourceDomain('https://www.cwa.gov.tw/V8/C/W/County/County.html?CID=65')).toBe('cwa.gov.tw');
    expect(extractSourceDomain('https://weather.com/today')).toBe('weather.com');
    expect(extractSourceDomain('http://localhost:8080/path')).toBe('localhost');
    expect(extractSourceDomain('not-a-valid-url')).toBeNull();
  });

  it('formats sources with domains and limits to 5 items', () => {
    const sources: AISource[] = [
      { title: 'S1', url: 'https://www.google.com/search' },
      { title: 'S2', url: 'https://cwa.gov.tw/' },
      { title: 'S3', url: 'https://news.ycombinator.com/' },
      { title: 'S4', url: 'https://github.com/' },
      { title: 'S5', url: 'https://developer.mozilla.org/' },
      { title: 'S6', url: 'https://wikipedia.org/' },
    ];

    const formatted = formatAiSources(sources);
    expect(formatted).toHaveLength(5);
    expect(formatted[0]).toEqual({ title: 'S1', url: 'https://www.google.com/search', domain: 'google.com' });
    expect(formatted[1]).toEqual({ title: 'S2', url: 'https://cwa.gov.tw/', domain: 'cwa.gov.tw' });
  });
});

describe('client grounding source DOM rendering', () => {
  it('renders a collapsible details element with source links and domain labels', () => {
    const sources: AISource[] = [
      { title: '中央氣象署', url: 'https://www.cwa.gov.tw/today' },
      { title: 'Google Weather', url: 'https://weather.google.com/' },
    ];

    const element = renderAiSources(sources, mockDocument) as unknown as MockElement;
    expect(element.tagName.toLowerCase()).toBe('details');
    expect(element.className).toBe('ai-sources');

    const summary = element.querySelector('.ai-sources-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toBe('來源 · 2');

    const links = element.querySelectorAll('.ai-source-link');
    expect(links).toHaveLength(2);

    const firstLink = links[0];
    const secondLink = links[1];
    expect(firstLink).toBeDefined();
    expect(secondLink).toBeDefined();

    if (firstLink && secondLink) {
      expect(firstLink.href).toBe('https://www.cwa.gov.tw/today');
      expect(firstLink.target).toBe('_blank');
      expect(firstLink.rel).toBe('noopener noreferrer');
      expect(firstLink.textContent).toContain('中央氣象署');
      expect(firstLink.textContent).toContain('(cwa.gov.tw)');

      expect(secondLink.href).toBe('https://weather.google.com/');
      expect(secondLink.target).toBe('_blank');
      expect(secondLink.rel).toBe('noopener noreferrer');
      expect(secondLink.textContent).toContain('Google Weather');
      expect(secondLink.textContent).toContain('(weather.google.com)');
    }
  });
});
