#!/usr/bin/env node
/**
 * Deterministic contract check for the agent eval scenarios.
 *
 * Layer 1 of the eval harness: it proves the suite is well formed, not that any
 * model passes it. A validator that only ever says yes is worse than no
 * validator, so `validate-evals.test.mjs` feeds it deliberately broken fixtures
 * and fails if any of them is accepted.
 *
 * Reads the field list from `schema.json` rather than restating it, so the
 * schema stays the single place a scenario's shape is defined.
 *
 * Run from the repository root: `pnpm eval:harness`.
 * Exits non-zero on any error. No dependencies, no network.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');

/** Backticked tokens that look like a repository path rather than prose. */
const PATH_LIKE = /^(?!https?:)[\w@.-]+(\/[\w@.*{}-]+)*\.(md|ts|tsx|js|mjs|cjs|json|css|html|yml|yaml)$/;

export function loadSchema(schemaPath = join(here, 'schema.json')) {
  return JSON.parse(readFileSync(schemaPath, 'utf8'));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates one already-parsed scenario.
 *
 * @param scenario parsed JSON, or `null` when the file did not parse
 * @returns {string[]} one message per problem; empty means valid
 */
export function validateScenario(scenario, { fileName, schema, pathExists = (p) => existsSync(join(repositoryRoot, p)) }) {
  const problems = [];
  const report = (message) => problems.push(`${fileName}: ${message}`);

  if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)) {
    report('is not a JSON object');
    return problems;
  }

  const known = new Set([
    ...schema.requiredStringFields,
    ...schema.requiredArrayFields,
    ...schema.optionalStringFields,
  ]);
  for (const key of Object.keys(scenario)) {
    if (!known.has(key)) report(`has unknown field "${key}"`);
  }

  for (const field of schema.requiredStringFields) {
    if (!isNonEmptyString(scenario[field])) report(`"${field}" must be a non-empty string`);
  }
  for (const field of schema.optionalStringFields) {
    if (field in scenario && !isNonEmptyString(scenario[field])) {
      report(`"${field}" is present but not a non-empty string`);
    }
  }

  for (const field of schema.requiredArrayFields) {
    const value = scenario[field];
    if (!Array.isArray(value)) {
      report(`"${field}" must be an array`);
      continue;
    }
    const minimum = schema.minItems[field] ?? 1;
    // An empty rubric is the failure mode that matters: a scenario with no
    // expected behaviour and no pass criteria scores everything as a pass.
    if (value.length < minimum) report(`"${field}" needs at least ${minimum} entr${minimum === 1 ? 'y' : 'ies'}`);
    if (value.some((entry) => !isNonEmptyString(entry))) report(`"${field}" contains a non-string or empty entry`);
    if (new Set(value).size !== value.length) report(`"${field}" contains duplicate entries`);
  }

  if (isNonEmptyString(scenario.id)) {
    if (!new RegExp(schema.idPattern).test(scenario.id)) {
      report(`id "${scenario.id}" does not match ${schema.idPattern}`);
    }
    // The filename is how a human finds a scenario named in a report.
    if (fileName !== `${scenario.id}.json`) report(`id "${scenario.id}" does not match its filename`);
  }

  if (isNonEmptyString(scenario.task_class) && !schema.taskClasses.includes(scenario.task_class)) {
    report(`task_class "${scenario.task_class}" is not one of: ${schema.taskClasses.join(', ')}`);
  }

  if (Array.isArray(scenario.applicable_agents)) {
    for (const agent of scenario.applicable_agents) {
      if (!schema.agents.includes(agent)) {
        report(`applicable_agents contains "${agent}", which is not one of: ${schema.agents.join(', ')}`);
      }
    }
  }

  // A scenario that points at a skill or rule which has been renamed away is
  // no longer testing what it says it tests.
  for (const field of schema.pathFields) {
    for (const target of Array.isArray(scenario[field]) ? scenario[field] : []) {
      if (typeof target === 'string' && !pathExists(target)) {
        report(`${field} references "${target}", which does not exist`);
      }
    }
  }

  // Same check for paths quoted inside the prose fields.
  const prose = [
    ...schema.requiredStringFields.map((field) => scenario[field]),
    ...schema.optionalStringFields.map((field) => scenario[field]),
    ...schema.requiredArrayFields.flatMap((field) => (Array.isArray(scenario[field]) ? scenario[field] : [])),
  ].filter(isNonEmptyString).join('\n');
  for (const [, token] of prose.matchAll(/`([^`\n]+)`/g)) {
    const candidate = token.trim();
    if (!PATH_LIKE.test(candidate) || candidate.includes('*')) continue;
    if (!pathExists(candidate)) report(`references \`${candidate}\`, which does not exist`);
  }

  return problems;
}

/** @returns {{errors: string[], scenarios: object[]}} */
export function validateDirectory(directory, schema) {
  const errors = [];
  const scenarios = [];
  const seen = new Map();

  const files = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) errors.push(`${directory}: contains no scenarios`);

  for (const fileName of files) {
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(join(directory, fileName), 'utf8'));
    } catch (error) {
      errors.push(`${fileName}: is not valid JSON (${error.message})`);
      continue;
    }
    errors.push(...validateScenario(parsed, { fileName, schema }));
    scenarios.push(parsed);

    const id = parsed?.id;
    if (typeof id !== 'string') continue;
    if (seen.has(id)) errors.push(`${fileName}: duplicate id "${id}", already declared by ${seen.get(id)}`);
    else seen.set(id, fileName);
  }

  return { errors, scenarios };
}

function main() {
  const schema = loadSchema();
  const directory = join(here, 'scenarios');
  const { errors, scenarios } = validateDirectory(directory, schema);

  for (const message of errors) process.stderr.write(`error    ${message}\n`);
  if (errors.length) {
    process.stderr.write(`\nAgent eval validation failed: ${scenarios.length} scenario(s), ${errors.length} error(s)\n`);
    process.exit(1);
  }

  const classes = [...new Set(scenarios.map((scenario) => scenario.task_class))].sort();
  process.stdout.write(
    `Agent eval validation passed: ${scenarios.length} scenario(s) across ${classes.length} task class(es) `
    + `(${classes.join(', ')}). This is EVAL-HARNESS-VALID, not a model result.\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
