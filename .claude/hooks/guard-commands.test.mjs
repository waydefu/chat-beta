#!/usr/bin/env node
/**
 * Behaviour test for the PreToolUse guard. Plain Node, no framework, so it
 * runs anywhere `pnpm check:harness` runs.
 *
 * The guard is a safety control, so both halves matter: the commands it must
 * block, and the ordinary ones it must never block.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const guard = join(dirname(fileURLToPath(import.meta.url)), 'guard-commands.mjs');

function run(command, toolName = 'Bash') {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { command },
  });
  const stdout = execFileSync('node', [guard], { input: payload, encoding: 'utf8' });
  if (!stdout.trim()) return null;
  return JSON.parse(stdout);
}

const BLOCKED = [
  'firebase deploy --only functions',
  'pnpm exec firebase deploy --project f-chat-wayde-fu --only hosting',
  'node node_modules/firebase-tools/lib/bin/firebase.js deploy',
  'pnpm deploy',
  'pnpm run deploy',
  'gcloud functions deploy generateGeminiReply',
  'firebase functions:secrets:set GEMINI_API_KEY',
  'firebase remoteconfig:versions:rollback',
  'gcloud secrets versions add livekit-api-key --data-file=-',
  'firebase firestore:delete --all-collections --project f-chat-wayde-fu',
  'gcloud firestore indexes composite delete projects/p/databases/(default)/collectionGroups/calls/indexes/x',
  'gcloud firestore export gs://bucket --project f-chat-wayde-fu',
  'gcloud firestore databases delete --database=(default)',
  'git push --force origin agent/thing',
  'git push --force-with-lease',
  'git push origin main',
  'git reset --hard origin/main',
  'git checkout -- src/app/chat.controller.ts',
  'git checkout HEAD -- firestore.indexes.json',
  'git checkout origin/main -- docs/TECH-DEBT.md',
  'git checkout .',
  'git restore src/utils.ts',
  'git clean -fd',
  'git branch -D agent/other-work',
  'rm -rf src',
  'rm -rf ./functions',
  'pnpm lint && firebase deploy',
  'echo hi; git reset --hard',
];

const ALLOWED = [
  'pnpm lint',
  'pnpm check',
  'pnpm test:rules',
  'pnpm emulators',
  'firebase functions:list --project f-chat-wayde-fu',
  'gcloud logging read "severity>=ERROR" --project f-chat-wayde-fu --freshness=1d',
  'gcloud firestore indexes fields list --project f-chat-wayde-fu',
  'gcloud firestore indexes fields describe expiresAt --collection-group=incomingCalls',
  'gcloud scheduler jobs list --location=asia-east1',
  'firebase emulators:exec --project demo-chat-lite "pnpm test:unit"',
  'git status --short',
  'git diff --name-only main...HEAD',
  'git push origin agent/claude-code-harness',
  'git checkout -b agent/thing',
  'git checkout main',
  'git restore --staged src/utils.ts',
  'git branch -d agent/merged',
  // A commit message or a log query may quote a blocked command. Neither can
  // touch the working tree, the remote or history, and a guard that blocks
  // writing about itself teaches people to reword their way past it.
  'git commit -m "block git checkout HEAD -- <path> as well"',
  'git commit -m "explain why git reset --hard is denied"',
  'git log --grep="git push --force"',
  'rm -rf node_modules',
  'rm dist/index.js',
  'gh pr create --fill',
  'grep -rn "firebase deploy" docs/',
  'cat .github/workflows/deploy-hosting.yml',
  'rg "git reset --hard" .claude',
  'node .claude/validate-harness.mjs',
];

const failures = [];

for (const command of BLOCKED) {
  const result = run(command);
  const decision = result?.hookSpecificOutput?.permissionDecision;
  if (decision !== 'deny') failures.push(`should be blocked but was not: ${command}`);
}

for (const command of ALLOWED) {
  const result = run(command);
  const decision = result?.hookSpecificOutput?.permissionDecision;
  if (decision === 'deny') {
    failures.push(`should be allowed but was blocked: ${command}\n           reason: ${result.hookSpecificOutput.permissionDecisionReason}`);
  }
}

// The guard must cover the PowerShell tool too, not only Bash.
const psResult = run('Remove-Item -Recurse -Force .\\src', 'PowerShell');
if (psResult?.hookSpecificOutput?.permissionDecision !== 'deny') {
  failures.push('should be blocked but was not (PowerShell): Remove-Item -Recurse -Force .\\src');
}

// A payload the guard cannot understand must not wedge the session.
for (const payload of ['', 'not json', '{}']) {
  const stdout = execFileSync('node', [guard], { input: payload, encoding: 'utf8' });
  if (stdout.includes('"permissionDecision":"deny"')) {
    failures.push(`unparsable payload produced a deny: ${JSON.stringify(payload)}`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`  FAIL   ${failure}\n`);
  process.stderr.write(`\nguard-commands: ${failures.length} failure(s)\n`);
  process.exit(1);
}

process.stdout.write(
  `guard-commands: ${BLOCKED.length} blocked, ${ALLOWED.length} allowed, 4 edge cases - all pass\n`,
);
