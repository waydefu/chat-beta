import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `AGENTS.md` opens by saying to read it and then only the files Task Routing
 * names, and its Documentation Routing table is what makes that instruction
 * safe. A document missing from the table is not merely undocumented: it is
 * unreachable by an agent following the rule.
 *
 * Seven had drifted out before this check existed, two of them written the same
 * week. Nothing noticed, because nothing was looking.
 */

const agents = readFileSync(resolve('AGENTS.md'), 'utf8');
const docs = readdirSync(resolve('docs')).filter((file) => file.endsWith('.md'));

describe('documentation routing', () => {
  it('finds documents to check, so an empty pass cannot look green', () => {
    expect(docs.length).toBeGreaterThan(10);
  });

  it.each(docs)('%s is routed in AGENTS.md', (file) => {
    expect(agents, `docs/${file} is not in the Documentation Routing table`).toContain(`docs/${file}`);
  });

  it('does not route a document that no longer exists', () => {
    const routed = [...agents.matchAll(/`docs\/([A-Za-z0-9._-]+\.md)`/g)].map((match) => match[1]!);
    const missing = [...new Set(routed)].filter((file) => !docs.includes(file));
    expect(missing, 'AGENTS.md routes documents that are not in docs/').toEqual([]);
  });

  it('keeps the ADR directory routed', () => {
    // Not a single file, so the per-file check above cannot cover it.
    expect(agents).toContain('`docs/adr/`');
  });
});
