#!/usr/bin/env node
/**
 * Validates the Claude Code harness: CLAUDE.md, .claude/rules, .claude/skills,
 * .claude/settings.json and .claude/hooks.
 *
 * It answers the questions a reviewer cannot answer by reading: does every
 * configuration file parse, does every `paths:` glob still match something,
 * does every path these files name still exist, and did a secret leak in.
 *
 * Run from the repository root: `pnpm check:harness`.
 * Exits non-zero on any error. No dependencies, no network.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const warnings = [];

const fail = (file, message) => errors.push(`${file}: ${message}`);
const warn = (file, message) => warnings.push(`${file}: ${message}`);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'test-results', 'artifacts',
  '.firebase', 'playwright-report', 'lib', '.install-partials',
]);

/** Every tracked-ish file in the repository, as forward-slash relative paths. */
function listFiles(dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.github') continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

const files = listFiles();

/** Minimal glob to RegExp: supports **, *, ? and {a,b}. */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') out += '[^/]';
    else if (char === '{') out += '(';
    else if (char === '}') out += ')';
    else if (char === ',') out += '|';
    else out += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const globMatches = (pattern) => {
  const re = globToRegExp(pattern);
  return files.some((file) => re.test(file));
};

/** Frontmatter reader for the subset these files use: scalars and string lists. */
function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const data = {};
  let key = null;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && key) {
      data[key] = Array.isArray(data[key]) ? data[key] : [];
      data[key].push(listItem[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    key = pair[1];
    const value = pair[2].trim();
    data[key] = value === '' ? [] : value.replace(/^["']|["']$/g, '');
  }
  return data;
}

// ---------------------------------------------------------------- CLAUDE.md

const claudeMdPath = 'CLAUDE.md';
if (!existsSync(join(root, claudeMdPath))) {
  fail(claudeMdPath, 'missing; Claude Code reads CLAUDE.md, not AGENTS.md');
} else {
  const text = readFileSync(join(root, claudeMdPath), 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (lines > 200) fail(claudeMdPath, `${lines} lines; keep it under 200 or adherence drops`);
  else if (lines > 150) warn(claudeMdPath, `${lines} lines; the useful ceiling is 200`);

  // Imports outside code spans and fenced blocks.
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const imports = [...withoutCode.matchAll(/(?:^|\s)@([\w./-]+)/g)].map((m) => m[1]);
  if (!imports.includes('AGENTS.md')) {
    fail(claudeMdPath, 'does not import @AGENTS.md; the canonical context would not load');
  }
  for (const target of imports) {
    if (!existsSync(join(root, target))) fail(claudeMdPath, `imports @${target}, which does not exist`);
  }
}

// ------------------------------------------------------------------- rules

const rulesDir = join(root, '.claude', 'rules');
if (existsSync(rulesDir)) {
  for (const name of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
    const id = `.claude/rules/${name}`;
    const text = readFileSync(join(rulesDir, name), 'utf8');
    const data = frontmatter(text);
    if (!data) {
      warn(id, 'no frontmatter, so it loads unconditionally in every session');
    } else if (!data.paths || !Array.isArray(data.paths) || data.paths.length === 0) {
      warn(id, 'no paths: frontmatter, so it loads unconditionally in every session');
    } else {
      for (const pattern of data.paths) {
        if (!globMatches(pattern)) fail(id, `paths pattern "${pattern}" matches no file in the repository`);
      }
    }
    if (!/\bWhy\b/i.test(text)) warn(id, 'no "why" line; a rule without a rationale cannot be retired safely');
  }
}

// ------------------------------------------------------------------ skills

const skillsDir = join(root, '.claude', 'skills');
if (existsSync(skillsDir)) {
  for (const dirName of readdirSync(skillsDir)) {
    const skillPath = join(skillsDir, dirName, 'SKILL.md');
    const id = `.claude/skills/${dirName}/SKILL.md`;
    if (!statSync(join(skillsDir, dirName)).isDirectory()) continue;
    if (!existsSync(skillPath)) {
      fail(id, 'skill directory has no SKILL.md');
      continue;
    }
    const text = readFileSync(skillPath, 'utf8');
    const data = frontmatter(text);
    if (!data) {
      fail(id, 'missing YAML frontmatter');
      continue;
    }
    if (data.name && data.name !== dirName) {
      fail(id, `name "${data.name}" does not match its directory "${dirName}"; the command comes from the directory`);
    }
    if (!data.description || typeof data.description !== 'string') {
      fail(id, 'missing description; Claude uses it to decide when to load the skill');
    } else if (data.description.length > 1024) {
      warn(id, `description is ${data.description.length} chars; it is truncated at 1536 with when_to_use`);
    }
    if (Array.isArray(data.paths)) {
      for (const pattern of data.paths) {
        if (!globMatches(pattern)) fail(id, `paths pattern "${pattern}" matches no file in the repository`);
      }
    }
  }
}

// ---------------------------------------------------------------- settings

const settingsPath = join(root, '.claude', 'settings.json');
if (existsSync(settingsPath)) {
  const id = '.claude/settings.json';
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    fail(id, `invalid JSON: ${error.message}`);
  }
  if (settings) {
    const events = Object.values(settings.hooks ?? {}).flat();
    for (const group of events) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== 'command' || typeof hook.command !== 'string') continue;
        const match = hook.command.match(/\$\{CLAUDE_PROJECT_DIR\}\/([\w./-]+)/);
        if (match && !existsSync(join(root, match[1]))) {
          fail(id, `hook command references ${match[1]}, which does not exist`);
        }
      }
    }
    for (const rule of settings.permissions?.deny ?? []) {
      if (!/^[A-Za-z]+\(.*\)$/.test(rule)) fail(id, `deny rule "${rule}" is not in Tool(pattern) form`);
    }
    for (const rule of settings.permissions?.allow ?? []) {
      if (!/^[A-Za-z]+\(.*\)$/.test(rule)) fail(id, `allow rule "${rule}" is not in Tool(pattern) form`);
    }
  }
}

// ------------------------------------------- referenced paths and secrets

const harnessFiles = [
  'CLAUDE.md',
  ...files.filter((file) => file.startsWith('.claude/') && (file.endsWith('.md') || file.endsWith('.mjs'))),
];

const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bghp_[0-9A-Za-z]{30,}/, 'a GitHub token'],
  [/\bsk-[0-9A-Za-z]{20,}/, 'a provider secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'a JWT'],
];

/** Backticked tokens that look like a repository path rather than a data path. */
const PATH_LIKE = /^(?!https?:)[\w@.-]+(\/[\w@.*{}-]+)*\.(md|ts|tsx|js|mjs|cjs|json|css|html|yml|yaml)$/;

for (const file of harnessFiles) {
  if (!existsSync(join(root, file))) continue;
  const text = readFileSync(join(root, file), 'utf8');

  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text)) fail(file, `looks like it contains ${label}`);
  }

  if (!file.endsWith('.md')) continue;
  const tokens = new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()));
  for (const token of tokens) {
    if (!PATH_LIKE.test(token)) continue;
    if (token.includes('*') || token.includes('{')) {
      if (!globMatches(token)) fail(file, `references \`${token}\`, which matches no file`);
      continue;
    }
    if (existsSync(join(root, token))) continue;
    // A bare filename in prose is fine as long as exactly that file exists somewhere.
    if (!token.includes('/') && files.some((candidate) => basename(candidate) === token)) continue;
    fail(file, `references \`${token}\`, which does not exist`);
  }
}

// ------------------------------------------------------------------ report

for (const message of warnings) process.stderr.write(`warning  ${message}
`);
for (const message of errors) process.stderr.write(`error    ${message}
`);

const counted = `${files.length} files scanned, ${errors.length} error(s), ${warnings.length} warning(s)`;
if (errors.length) {
  process.stderr.write(`\nHarness validation failed: ${counted}\n`);
  process.exit(1);
}
process.stdout.write(`Harness validation passed: ${counted}
`);
