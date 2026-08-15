import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The Hosting CSP is the one security surface with no local feedback at all: it
 * is a static header, so nothing in the build, the typechecker or the app can
 * tell you it is wrong. It fails only in a production browser console, which is
 * exactly how the RTDB long-polling outage reached users.
 */

interface HostingHeader { key: string; value: string }
interface HostingRule { source: string; headers: HostingHeader[] }

const hosting = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
  hosting: { headers: HostingRule[] };
};

function policy(): Map<string, string[]> {
  const header = hosting.hosting.headers
    .flatMap((rule) => rule.headers)
    .find((entry) => entry.key === 'Content-Security-Policy');
  if (!header) throw new Error('firebase.json declares no Content-Security-Policy');
  return new Map(header.value.split(';').map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    return [name ?? '', sources];
  }));
}

const csp = policy();
const sourcesFor = (directive: string): string[] => csp.get(directive) ?? [];

describe('Content-Security-Policy transport allowances', () => {
  it('lets the Realtime Database long-polling transport load its script', () => {
    // Firebase's BrowserPollConnection is JSONP: it appends
    // <script src="https://<host>/.lp?..."> to the document. Without an entry in
    // script-src the browser blocks it, and because the SDK picks long-polling
    // as its *initial* transport whenever WebSocketConnection.previouslyFailed()
    // is true - which it sets before every single WebSocket open, and clears
    // only once a connection proves healthy - that is a routine path, not an
    // exotic fallback. connect-src alone does not cover a script element.
    expect(sourcesFor('script-src')).toContain('https://*.firebaseio.com');
  });

  it('keeps both Realtime Database transports reachable', () => {
    // WebSocket and its long-polling fallback have to both work; forcing one is
    // not a fix, it just moves the failure to whichever network breaks it.
    expect(sourcesFor('connect-src')).toEqual(expect.arrayContaining([
      'https://*.firebaseio.com',
      'wss://*.firebaseio.com',
    ]));
  });

  it('allows the database wildcard rather than the project origin alone', () => {
    // Deliberately a wildcard. The SDK caches a server-issued redirect host in
    // `internalHost` (RepoInfo.isCacheableHost accepts anything starting "s-")
    // and builds every later .lp/.ws URL from it, so a session that begins on
    // f-chat-wayde-fu-default-rtdb.firebaseio.com continues on a host like
    // s-usc1c-nss-2077.firebaseio.com. Pinning the project origin passes this
    // file's first load and then blocks every one after the redirect. CSP host
    // sources cannot express "s-*", so the whole vendor domain is the tightest
    // expression that actually holds - the same reason connect-src uses it.
    for (const directive of ['script-src', 'connect-src']) {
      const pinned = sourcesFor(directive).filter((source) => (
        source.includes('firebaseio.com') && !source.includes('*.')
      ));
      expect(pinned).toEqual([]);
    }
  });
});

describe('Content-Security-Policy is not widened elsewhere', () => {
  it('never allows inline or eval script', () => {
    const scripts = sourcesFor('script-src');
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain('*');
    expect(scripts).not.toContain('data:');
  });

  it('keeps every script source on an explicit https origin', () => {
    for (const source of sourcesFor('script-src')) {
      if (source === "'self'") continue;
      expect(source.startsWith('https://')).toBe(true);
    }
  });

  it('does not let a provider reach a directive it has no business in', () => {
    // Each of these is allowed to be talked to, never to be executed from or
    // framed. A provider drifting into script-src is how one compromised vendor
    // becomes arbitrary script on this origin.
    for (const provider of ['livekit.cloud', 'algolia.net', 'algolianet.com', 'r2.cloudflarestorage.com']) {
      expect(sourcesFor('script-src').some((source) => source.includes(provider))).toBe(false);
      expect(sourcesFor('frame-src').some((source) => source.includes(provider))).toBe(false);
    }
  });

  it('holds the directives that stop this origin being reframed or rebased', () => {
    expect(sourcesFor('object-src')).toEqual(["'none'"]);
    expect(sourcesFor('frame-ancestors')).toEqual(["'none'"]);
    expect(sourcesFor('base-uri')).toEqual(["'self'"]);
    expect(sourcesFor('form-action')).toEqual(["'self'"]);
    expect(sourcesFor('default-src')).toEqual(["'self'"]);
  });

  it('serves HTML no-cache so a header fix is not hidden behind a stale document', () => {
    // The CSP travels as a header on the document. A cached document replays the
    // old policy, which once made a correct fix look like a failed one.
    const htmlRules = hosting.hosting.headers.filter((rule) => (
      rule.source === '/' || rule.source === '**/*.html'
    ));
    expect(htmlRules).toHaveLength(2);
    for (const rule of htmlRules) {
      expect(rule.headers.find((entry) => entry.key === 'Cache-Control')?.value).toBe('no-cache');
    }
  });
});
