import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

function argument(name) {
  const prefix = `${name}=`;
  const inline = args.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^['"]|['"]$/gu, '')]));
}

function configured(name, envFile) {
  return Boolean(process.env[name] || envFile[name]);
}

function runFirebase(commandArgs) {
  const cli = resolve('node_modules/firebase-tools/lib/bin/firebase.js');
  const result = spawnSync(process.execPath, [cli, ...commandArgs, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const raw = result.stderr || result.stdout || '';
    let message = 'Firebase CLI command failed.';
    try {
      const parsed = JSON.parse(raw);
      message = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message || parsed.message || message;
    } catch {
      message = raw.split(/\r?\n/u).find((line) => line.trim()) ?? message;
    }
    return { ok: false, message: message.replace(ansiPattern, '') };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout).result };
  } catch {
    return { ok: false, message: 'Firebase CLI returned non-JSON output.' };
  }
}

function itemCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  for (const key of ['functions', 'sites', 'instances', 'indexes']) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return Object.keys(value).length;
}

const projectId = argument('--project');
const online = args.includes('--online');
const output = argument('--output');
const envFile = { ...readEnvFile('.env'), ...readEnvFile('.env.local') };
const requiredFiles = [
  '.firebaserc',
  'firebase.json',
  'firestore.rules',
  'firestore.indexes.json',
  'database.rules.json',
  'docs/MIGRATION.md',
  'functions/src/migrations/migrate-v3.ts',
];
const requiredHostingVariables = ['VITE_FCM_VAPID_KEY', 'VITE_APP_CHECK_SITE_KEY'];
const optionalPublicVariables = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_REGION',
];
const checks = [];

checks.push({
  name: 'explicit-project',
  status: projectId ? 'pass' : 'fail',
  detail: projectId || 'Pass --project=<firebase-project-id>.',
});
for (const file of requiredFiles) {
  checks.push({ name: `file:${file}`, status: existsSync(file) ? 'pass' : 'fail' });
}
for (const name of requiredHostingVariables) {
  checks.push({
    name: `hosting-variable:${name}`,
    status: configured(name, envFile) ? 'pass' : 'fail',
    detail: configured(name, envFile) ? 'configured' : 'Set locally or as a GitHub environment variable before Hosting rollout.',
  });
}
for (const name of optionalPublicVariables) {
  checks.push({
    name: `public-variable:${name}`,
    status: configured(name, envFile) ? 'pass' : 'warning',
    detail: configured(name, envFile) ? 'configured' : 'Application fallback is used; configure the production GitHub environment for an explicit build.',
  });
}

const firebaseProject = existsSync('.firebaserc')
  ? JSON.parse(readFileSync('.firebaserc', 'utf8')).projects?.default
  : undefined;
checks.push({
  name: 'firebase-project-match',
  status: projectId && firebaseProject === projectId ? 'pass' : 'fail',
  detail: `requested=${projectId || 'missing'}, configured=${firebaseProject || 'missing'}`,
});

if (online && projectId) {
  const projects = runFirebase(['projects:list']);
  const projectAccessible = projects.ok
    && Array.isArray(projects.value)
    && projects.value.some((project) => project?.projectId === projectId);
  checks.push({
    name: 'online:projects',
    status: projects.ok && projectAccessible ? 'pass' : 'fail',
    detail: projects.ok
      ? projectAccessible ? `items=${itemCount(projects.value)}` : `Project ${projectId} is not accessible.`
      : projects.message,
  });
  const inventories = [
    ['functions', ['functions:list', '--project', projectId]],
    ['hosting-sites', ['hosting:sites:list', '--project', projectId]],
    ['rtdb-instances', ['database:instances:list', '--project', projectId]],
    ['firestore-indexes', ['firestore:indexes', '--project', projectId]],
  ];
  if (projects.ok && projectAccessible) {
    for (const [name, command] of inventories) {
      const result = runFirebase(command);
      checks.push({
        name: `online:${name}`,
        status: result.ok ? 'pass' : 'fail',
        detail: result.ok ? `items=${itemCount(result.value)}` : result.message,
      });
    }
  } else {
    for (const [name] of inventories) {
      checks.push({
        name: `online:${name}`,
        status: 'warning',
        detail: 'Skipped because the project access check failed.',
      });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  projectId: projectId || null,
  mode: online ? 'online' : 'local',
  summary: {
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  },
  checks,
  manualGates: [
    'Firestore managed export and RTDB export references recorded',
    'Billing, budgets, regions and production data volume inventoried',
    'App Check metrics reviewed before enforcement',
    'Gemini, R2, LiveKit and Algolia secrets/configuration verified in staging',
    'Three-user authenticated E2E and rollback rehearsal completed',
  ],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (output) writeFileSync(output, serialized, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(serialized);
if (report.summary.fail > 0) process.exitCode = 1;
