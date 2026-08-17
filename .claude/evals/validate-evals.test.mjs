#!/usr/bin/env node
/**
 * Negative tests for the eval validator.
 *
 * A validator is only worth what its failures are worth. Every fixture here is
 * a scenario broken in one specific way, and the test fails if the validator
 * accepts it — so the validator cannot quietly become permissive and keep
 * reporting a green suite.
 *
 * Run from the repository root: `pnpm check:harness`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { loadSchema, validateDirectory, validateScenario } from './validate-evals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schema = loadSchema();
const failures = [];

function check(name, condition, detail = '') {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

const valid = JSON.parse(readFileSync(join(here, 'scenarios', 'EVAL-01.json'), 'utf8'));

/** A scenario is valid except for the one mutation applied to it. */
function mutated(changes) {
  // Plain JSON in, plain JSON out - and no global that the repository's lint
  // config would have to be widened for.
  const copy = JSON.parse(JSON.stringify(valid));
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
  }
  return copy;
}

function problemsFor(scenario, fileName = 'EVAL-01.json') {
  return validateScenario(scenario, { fileName, schema });
}

// ------------------------------------------------- the positive control

check(
  'an unmodified scenario validates',
  problemsFor(valid).length === 0,
  problemsFor(valid).join('; '),
);

// ------------------------------------------------- one break at a time

const negatives = [
  ['missing required string', mutated({ purpose: undefined }), /purpose/],
  ['empty required string', mutated({ title: '   ' }), /title/],
  ['missing required array', mutated({ pass_criteria: undefined }), /pass_criteria/],
  ['empty expected behaviours', mutated({ expected_behaviors: [] }), /expected_behaviors/],
  ['empty pass criteria', mutated({ pass_criteria: [] }), /pass_criteria/],
  ['empty forbidden behaviours', mutated({ forbidden_behaviors: [] }), /forbidden_behaviors/],
  ['array holding a non-string', mutated({ pass_criteria: [42] }), /pass_criteria/],
  ['array holding a duplicate', mutated({ pass_criteria: ['same', 'same'] }), /duplicate/],
  ['invalid task class', mutated({ task_class: 'vibes' }), /task_class/],
  ['invalid agent name', mutated({ applicable_agents: ['claude', 'skynet'] }), /applicable_agents/],
  ['id not matching the pattern', mutated({ id: 'EVAL-ONE' }), /does not match/],
  ['id not matching the filename', mutated({ id: 'EVAL-99' }), /filename/],
  ['dead required_context path', mutated({ required_context: ['.claude/skills/gone/SKILL.md'] }), /does not exist/],
  ['dead path quoted in prose', mutated({ notes: 'See `docs/NOT-A-REAL-DOC.md` for context.' }), /does not exist/],
  ['unknown field', mutated({ severity: 'high' }), /unknown field/],
  ['not an object', [], /not a JSON object/],
  ['null instead of a scenario', null, /not a JSON object/],
];

for (const [name, scenario, expected] of negatives) {
  const problems = problemsFor(scenario);
  check(`rejects: ${name}`, problems.length > 0, 'validator accepted it');
  check(
    `rejects: ${name} — with a message naming the problem`,
    problems.some((problem) => expected.test(problem)),
    `messages were: ${problems.join('; ') || '(none)'}`,
  );
}

// -------------------------------------- fixtures on disk, parsed for real

const fixtures = join(here, 'fixtures', 'invalid');
for (const fileName of readdirSync(fixtures).filter((name) => name.endsWith('.json'))) {
  let scenario = null;
  let parsed = true;
  try {
    scenario = JSON.parse(readFileSync(join(fixtures, fileName), 'utf8'));
  } catch {
    parsed = false;
  }
  // A fixture that does not parse is still a rejection, just an earlier one.
  const problems = parsed ? validateScenario(scenario, { fileName, schema }) : ['unparseable'];
  check(`fixture ${fileName} is rejected`, problems.length > 0, 'validator accepted it');
}

// ------------------------------------------------ duplicate id detection

const duplicates = validateDirectory(join(here, 'fixtures', 'duplicate-ids'), schema);
check(
  'rejects two scenarios sharing one id',
  duplicates.errors.some((error) => /duplicate id/.test(error)),
  `errors were: ${duplicates.errors.join('; ') || '(none)'}`,
);

// ------------------------------------------------------- the real suite

const real = validateDirectory(join(here, 'scenarios'), schema);
check('the shipped scenarios all validate', real.errors.length === 0, real.errors.join('; '));
check('the shipped suite is not empty', real.scenarios.length >= 10, `found ${real.scenarios.length}`);

// ------------------------------------------------------------- report

for (const failure of failures) process.stderr.write(`error    ${failure}\n`);
if (failures.length) {
  process.stderr.write(`\nEval validator tests failed: ${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(
  `Eval validator tests passed: ${negatives.length} mutations and every fixture rejected, `
  + `${real.scenarios.length} shipped scenario(s) accepted\n`,
);
