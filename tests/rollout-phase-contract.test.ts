import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rollout phases are a closed set: the `rollout_phase` choice input in
 * `deploy-hosting.yml`. Naming one that does not exist sends an operator to a
 * dropdown entry that is not there, which is discovered at the worst moment.
 *
 * This exists because it happened. `database_rules` was written into four
 * places across HANDOFF and MIGRATION on 2026-08-26 and merged; the phase had
 * never existed. Prose is not checked by anything else here.
 */

// The working tree is checked out CRLF here, so every pattern below would miss
// on a bare `\n`. Normalise once rather than escaping line endings everywhere.
const read = (path: string): string => readFileSync(resolve(path), 'utf8').replace(/\r\n/g, '\n');

const workflow = read('.github/workflows/deploy-hosting.yml');

function declaredPhases(): string[] {
  const block = workflow.match(/rollout_phase:[\s\S]*?options:\n([\s\S]*?)\n {6}[a-z_]+:/);
  if (!block) return [];
  return [...block[1]!.matchAll(/^\s*-\s*([a-z0-9_]+)\s*$/gm)].map((match) => match[1]!);
}

interface Mention { file: string; phase: string; }

function mentionedPhases(): Mention[] {
  const found: Mention[] = [];
  const roots = ['docs', '.'];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of readdirSync(resolve(root))) {
      if (!file.endsWith('.md')) continue;
      const path = root === '.' ? file : join(root, file);
      if (seen.has(path)) continue;
      seen.add(path);
      const text = read(path);
      // "`name` phase" and "phase `name`", the two shapes the documents use.
      for (const pattern of [/`([a-z][a-z0-9_]*)`\s*phase/g, /phase\s*`([a-z][a-z0-9_]*)`/g]) {
        for (const match of text.matchAll(pattern)) found.push({ file: path, phase: match[1]! });
      }
    }
  }
  return found;
}

describe('rollout phase names', () => {
  const phases = declaredPhases();

  it('reads the choice list out of the workflow', () => {
    // If the parse breaks, every assertion below would pass vacuously.
    expect(phases.length).toBeGreaterThan(6);
    expect(phases).toContain('hosting_client');
    expect(phases).toContain('additive_rules');
  });

  it('is every phase a document names', () => {
    const invented = mentionedPhases().filter((mention) => !phases.includes(mention.phase));
    const detail = invented.map((mention) => `${mention.file}: \`${mention.phase}\``);
    expect(detail, 'documents name rollout phases that do not exist in deploy-hosting.yml').toEqual([]);
  });
});
