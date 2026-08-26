import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Turns the motion rules in `docs/motion.md` into something that fails.
 *
 * Same idea as `scripts/index-contract.mjs`: a rule that lives only in prose
 * gets broken by the next person who has a good reason, and nothing notices.
 * Both rules here were broken in the shipped stylesheet before UI M2 -- a
 * `filter` on every room row and a `clip-path` on the member panel -- and every
 * gate was green the whole time.
 */

const STYLE_DIR = resolve('src/styles');

function stylesheets(): Array<{ name: string; text: string }> {
  return readdirSync(STYLE_DIR)
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({ name: file, text: readFileSync(join(STYLE_DIR, file), 'utf8') }));
}

/** Properties the compositor can animate without layout or paint. */
const COMPOSITED = new Set(['transform', 'opacity']);

interface Keyframes {
  name: string;
  file: string;
  properties: string[];
}

function keyframeBlocks(): Keyframes[] {
  const blocks: Keyframes[] = [];
  for (const { name: file, text } of stylesheets()) {
    // `@keyframes name{ ...{...} ...{...} }` -- two nesting levels, so match to
    // the closing brace that balances the at-rule rather than the first one.
    const pattern = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
    for (const match of text.matchAll(pattern)) {
      let depth = 1;
      let index = match.index + match[0].length;
      const start = index;
      while (index < text.length && depth > 0) {
        if (text[index] === '{') depth += 1;
        else if (text[index] === '}') depth -= 1;
        index += 1;
      }
      const body = text.slice(start, index - 1);
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)]
        .map((property) => property[1]!)
        .filter((property) => property !== 'from' && property !== 'to');
      blocks.push({ name: match[1]!, file, properties: [...new Set(properties)] });
    }
  }
  return blocks;
}

describe('keyframes stay on the compositor', () => {
  const blocks = keyframeBlocks();

  it('finds the keyframes at all, so an empty pass cannot look green', () => {
    expect(blocks.length).toBeGreaterThan(4);
    expect(blocks.map((block) => block.name)).toContain('message-enter');
  });

  it.each(keyframeBlocks().map((block) => [block.name, block] as const))(
    '%s animates only transform and opacity',
    (_name, block) => {
      const offenders = block.properties.filter((property) => !COMPOSITED.has(property));
      // `filter`, `clip-path`, `box-shadow`, `background-position`, `width` and
      // `height` all force the main thread to paint or lay out every frame,
      // which is the budget that also has to answer the user's next input.
      expect(offenders, `${block.file} @keyframes ${block.name}`).toEqual([]);
    },
  );
});

describe('reduced motion', () => {
  const text = stylesheets().map((sheet) => sheet.text).join('\n');
  const block = text.match(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/);

  it('has a global override', () => {
    // WCAG 2.2 SC 2.3.3 asks that motion from interactions can be turned off.
    // Technique C39 is this media query. Deleting it is silent otherwise.
    expect(block, 'no prefers-reduced-motion:reduce block found in src/styles').not.toBeNull();
  });

  it('reaches pseudo-elements, where several of the animations actually live', () => {
    // status-ring and pending-sheen are both on ::after. A rule that only
    // selects `*` leaves them running.
    expect(block?.[1]).toContain('*::before');
    expect(block?.[1]).toContain('*::after');
  });

  it('stops animations and transitions, not just one of them', () => {
    expect(block?.[1]).toMatch(/animation-duration\s*:\s*\.?0*1ms/);
    expect(block?.[1]).toMatch(/transition-duration\s*:\s*\.?0*1ms/);
    expect(block?.[1]).toMatch(/animation-iteration-count\s*:\s*1/);
  });

  it('cannot be overridden by a more specific rule', () => {
    // Without !important any later selector beats `*`, and the override becomes
    // decorative.
    const declarations = (block?.[1] ?? '').split(';').filter((part) => part.includes(':'));
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration, declaration.trim()).toContain('!important');
    }
  });
});

describe('the room list stagger', () => {
  const components = readFileSync(join(STYLE_DIR, 'components.css'), 'utf8');

  it('does not stop part-way through the list', () => {
    // The ladder is enumerated with nth-child. Before UI M3 it ended at the
    // eighth row, so a ninth room animated in step with the first.
    expect(components).toMatch(/\.room-item:nth-child\(n\+\d+\)\{animation-delay:\d+ms\}/);
  });
});
