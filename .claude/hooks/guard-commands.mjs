#!/usr/bin/env node
/**
 * PreToolUse guard for Bash and PowerShell.
 *
 * Blocks the four classes of command this repository cannot recover from
 * cheaply: production deployment, production credential and data mutation,
 * Git history or working-tree destruction, and recursive deletion of a
 * tracked directory. Prompt instructions are advisory; this is not.
 *
 * Contract: read the hook payload on stdin, print a PreToolUse decision on
 * stdout, exit 0. No dependencies, no network, no writes, so it behaves the
 * same on Windows, macOS and Linux.
 *
 * This file is the canonical list. `.claude/settings.json` repeats a small
 * core of it as `permissions.deny` rules on purpose: if this script is missing
 * or throws, the failure is non-blocking and the command would otherwise run.
 *
 * The matching is textual and per line, because a command is split on newlines
 * the way a shell would run it. A heredoc body is therefore judged line by line
 * as well, so a commit message or a PR description that *quotes* a blocked
 * command is denied. That is deliberate and is not going to be fixed by
 * teaching the guard to skip heredoc bodies: `bash <<EOF … EOF` executes its
 * body, so ignoring heredocs would be a real bypass. Put long prose in a file
 * and pass it with `-F` or `--body-file`.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** Leading commands that only read; skip the segment entirely. */
const READ_ONLY_LEADERS = new Set([
  'grep', 'rg', 'cat', 'head', 'tail', 'sed', 'awk', 'less', 'echo', 'printf',
  'ls', 'wc', 'jq', 'diff', 'sort', 'uniq', 'select-string', 'get-content',
]);

/** Tokens that wrap the real command rather than being it. */
const WRAPPERS = new Set([
  'timeout', 'time', 'nice', 'nohup', 'stdbuf', 'command', 'builtin', 'xargs',
  'sudo', 'env', 'pnpm', 'npm', 'npx', 'yarn', 'exec', 'run', 'bash', 'sh',
  'powershell', 'pwsh',
]);

const DEPLOY_ALTERNATIVE = 'Production deploys run only through the "Deploy Firebase production" '
  + 'GitHub workflow, one rollout_phase at a time with its attestation inputs. '
  + 'See functions/AGENTS.md, "Deploy guardrails".';

const DIRTY_STATE_ALTERNATIVE = 'Unexplained dirty files are another working session in progress, '
  + 'not garbage. Inspect them and report instead.';

/**
 * Each rule tests one lower-cased command segment. `family` scopes the rule:
 * git rules run only for git segments, the rest run for everything else.
 */
const RULES = [
  {
    family: 'deploy',
    test: (t) => /\bfirebase(-tools)?\b[^\n]*\bdeploy\b/.test(t)
      || /\bfirebase[^\s]*\.js\b[^\n]*\bdeploy\b/.test(t)
      || /\b(pnpm|npm|yarn)\s+(run\s+)?deploy\b/.test(t),
    reason: `Firebase deployment from a local session is blocked. ${DEPLOY_ALTERNATIVE}`,
  },
  {
    family: 'deploy',
    test: (t) => /\bgcloud\b[^\n]*\b(functions|run|app)\s+deploy\b/.test(t),
    reason: `gcloud deployment from a local session is blocked. ${DEPLOY_ALTERNATIVE}`,
  },
  {
    family: 'credentials',
    test: (t) => /\bfirebase\b[^\n]*\bfunctions:secrets:(set|destroy|prune)\b/.test(t)
      || /\bfirebase\b[^\n]*\bremoteconfig\b/.test(t)
      || /\bgcloud\b[^\n]*\bsecrets\b/.test(t)
      || /\bgcloud\b[^\n]*\b(set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding)\b/.test(t),
    reason: 'Provider credentials, Remote Config and IAM are production state that the operator '
      + 'changes, not an agent. Write down what needs changing and hand it over.',
  },
  {
    family: 'production-data',
    test: (t) => /\bfirebase\b[^\n]*\b(firestore:delete|firestore:import|database:remove|database:set|database:update|database:push)\b/.test(t),
    reason: 'Direct writes to production Firestore or RTDB are blocked. Data changes go through a '
      + 'reviewed migration with a backup recorded in docs/HANDOFF.md.',
  },
  {
    family: 'production-data',
    // The same destruction, reached through the other CLI. `gcloud firestore`
    // has its own import, export, bulk-delete and database-delete verbs, and
    // dropping an index is a production outage for whatever queries it served.
    // Read-only verbs - list, describe - are deliberately not matched.
    test: (t) => /\bgcloud\b[^\n]*\bfirestore\b[^\n]*\b(import|export|bulk-delete|delete|update)\b/.test(t)
      || /\bgcloud\b[^\n]*\b(datastore)\b[^\n]*\b(import|export)\b/.test(t),
    reason: 'Destructive gcloud Firestore operations are blocked: an index or database dropped here '
      + 'is a production outage for every query that used it. Index changes ship through '
      + 'firestore.indexes.json and the deploy workflow.',
  },
  {
    family: 'git',
    test: (t) => /\bpush\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b|\s\+)/.test(t),
    reason: 'Force-push is blocked. Other branches in this repository are based on the pushed '
      + 'history; rewriting it destroys their base. Add a new commit instead.',
  },
  {
    family: 'git',
    test: (t) => /\bpush\b[^\n]*\bmain\b/.test(t),
    reason: 'Pushing to main is blocked. Open a pull request from an agent/<slug> branch.',
  },
  {
    family: 'git',
    test: (t) => /\breset\s+(--hard|--merge|--keep)\b/.test(t),
    reason: `git reset --hard discards work. ${DIRTY_STATE_ALTERNATIVE}`,
  },
  {
    family: 'git',
    // `git checkout <ref> -- <path>` discards working-tree changes exactly as
    // `git checkout -- <path>` does, and it is the spelling people reach for
    // when they want a file "back the way it was". Matching only the bare form
    // left the more explicit one open. `-b`, a plain branch name and `switch`
    // carry no pathspec, so they are unaffected.
    test: (t) => /\bcheckout\b[^\n]*\s--(\s|$)/.test(t)
      || /\bcheckout\s+\.\s*$/.test(t)
      || (/\brestore\b/.test(t) && !/--staged/.test(t))
      || /\bclean\b[^\n]*\s-[a-z]*[fdx]/.test(t),
    reason: `Discarding working-tree changes is blocked. ${DIRTY_STATE_ALTERNATIVE}`,
  },
  {
    family: 'git',
    // Case matters here: -D force-deletes, -d refuses on unmerged work.
    test: (t, raw) => /\bbranch\s+-D\b/.test(raw),
    reason: 'Force-deleting a branch is blocked; it may hold unmerged work. Use -d, which refuses '
      + 'when the branch is unmerged.',
  },
  {
    family: 'delete',
    test: (t) => {
      const recursive = /\brm\s+-[a-z]*r[a-z]*f/.test(t)
        || /\brm\s+-[a-z]*f[a-z]*r/.test(t)
        || /\bremove-item\b[^\n]*-recurse/.test(t);
      if (!recursive) return false;
      return /(^|\s)(\/|~|\.|\.\.|\*)(\s|$)/.test(t)
        || /(^|[\s"'])(\.[\\/])?(src|functions|docs|tests|scripts|public|\.git|\.github|\.claude)([/\\]|\s|$)/.test(t);
    },
    reason: 'Recursive deletion of a tracked directory is blocked. Delete specific files, or let '
      + 'Git do it.',
  },
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Split a command line into the segments a shell would run separately. */
function segments(command) {
  return command
    .split(/&&|\|\||;|\||&|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** First token that is neither an env assignment, a flag, nor a known wrapper. */
function leader(segment) {
  for (const raw of segment.split(/\s+/)) {
    const token = raw.replace(/^["']+|["']+$/g, '');
    if (!token) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (token.startsWith('-')) continue;
    const base = token.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (WRAPPERS.has(base)) continue;
    return base;
  }
  return '';
}

/**
 * The git subcommand: the first token after `git` that is not a flag or a
 * `-c key=value` pair.
 */
function gitSubcommand(segment) {
  const tokens = segment.split(/\s+/).map((token) => token.replace(/^["']+|["']+$/g, '')).filter(Boolean);
  const start = tokens.findIndex((token) => token.split(/[\\/]/).pop()?.toLowerCase() === 'git');
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-c') { index += 1; continue; }
    if (token.startsWith('-')) continue;
    return token.toLowerCase();
  }
  return '';
}

/**
 * Subcommands that carry arbitrary prose and cannot touch the working tree,
 * the remote or history. The rules below are textual, so a commit message or a
 * log query that merely *mentions* `git checkout -- path` used to be denied —
 * which made the guard block writing about the guard, and taught the reflex of
 * rewording a message to get past a safety control.
 */
const PROSE_SUBCOMMANDS = new Set(['commit', 'log']);

function onMainBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim() === 'main';
  } catch {
    return false;
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return;

  for (const segment of segments(command)) {
    const text = segment.toLowerCase();
    const lead = leader(segment);
    if (READ_ONLY_LEADERS.has(lead)) continue;

    const isGit = lead === 'git';
    if (isGit && PROSE_SUBCOMMANDS.has(gitSubcommand(segment))) continue;
    for (const rule of RULES) {
      if (isGit !== (rule.family === 'git')) continue;
      if (rule.test(text, segment)) deny(rule.reason);
    }

    // `git push` with no refspec, run while HEAD is main.
    if (isGit && /\bgit\s+push\s*$/.test(text) && onMainBranch()) {
      deny('Pushing to main is blocked. Open a pull request from an agent/<slug> branch.');
    }
  }
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : 'unknown error';
  process.stdout.write(JSON.stringify({
    systemMessage: `guard-commands hook could not evaluate the command (${detail}). `
      + 'The permissions.deny rules in .claude/settings.json are still in force.',
  }));
}
process.exit(0);
