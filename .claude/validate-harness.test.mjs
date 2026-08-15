#!/usr/bin/env node
/**
 * Tests the harness validator against the file shapes this repository actually
 * checks out, rather than the ones it is convenient to write in a fixture.
 *
 * The validator is the only automated check over `.claude/`, and CI does not run
 * it - `pnpm check` stops at lint/typecheck/tests/build - so when it produced a
 * wrong answer nothing else caught it. It had reported "missing description" for
 * skills whose description was plainly present, because slicing the frontmatter
 * block out of CRLF text leaves a stray \r on the block's final line and neither
 * `.` nor `$` crosses one in JavaScript. Every block's last key disappeared.
 *
 * Run from the repository root: `pnpm check:harness`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const failures = [];
const root = process.cwd();

/** Runs the real validator over a throwaway repository. */
function validate(files) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-'));
  try {
    mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    cpSync(join(root, '.claude', 'validate-harness.mjs'), join(dir, '.claude', 'validate-harness.mjs'));
    writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    try {
      const stdout = execFileSync('node', [join(dir, '.claude', 'validate-harness.mjs')], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, output: stdout };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SKILL = [
  '---',
  'name: demo',
  'description: A skill whose description is the final frontmatter key.',
  '---',
  '',
  '# Demo',
].join('\n');

const RULE = [
  '---',
  'paths:',
  '  - "CLAUDE.md"',
  '---',
  '',
  '# Demo rule',
  '',
  'Why: because the validator needs one.',
].join('\n');

// The whole point: identical content, only the line endings differ. A Windows
// checkout of this repository produces the CRLF form.
for (const [label, ending] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  const rewrite = (text) => text.split('\n').join(ending);
  const result = validate({
    '.claude/skills/demo/SKILL.md': rewrite(SKILL),
    '.claude/rules/demo.md': rewrite(RULE),
  });
  if (!result.ok) {
    failures.push(`${label} frontmatter was rejected:\n${result.output.trim()}`);
    // Anchored: the summary line always contains the word "warning(s)".
  } else if (/^warning\s/m.test(result.output)) {
    failures.push(`${label} frontmatter produced a warning:\n${result.output.trim()}`);
  }
}

// The checks still have to fire when something is genuinely wrong, or a parser
// that swallows everything would look just as green.
const missingDescription = validate({
  '.claude/skills/demo/SKILL.md': '---\r\nname: demo\r\n---\r\n\r\n# Demo\r\n',
});
if (missingDescription.ok || !/missing description/.test(missingDescription.output)) {
  failures.push('a skill with no description should fail, but did not');
}

const mismatchedName = validate({
  '.claude/skills/demo/SKILL.md': '---\r\nname: other\r\ndescription: x\r\n---\r\n',
});
if (mismatchedName.ok || !/does not match its directory/.test(mismatchedName.output)) {
  failures.push('a skill whose name does not match its directory should fail, but did not');
}

const deadGlob = validate({
  '.claude/rules/demo.md': '---\r\npaths:\r\n  - "no/such/path/**"\r\n---\r\n\r\nWhy: x\r\n',
});
if (deadGlob.ok || !/matches no file/.test(deadGlob.output)) {
  failures.push('a paths glob matching nothing should fail, but did not');
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`  FAIL   ${failure}\n`);
  process.stderr.write(`\nvalidate-harness: ${failures.length} failure(s)\n`);
  process.exit(1);
}

process.stdout.write('validate-harness: LF and CRLF frontmatter parse, 3 negative cases still fail\n');
