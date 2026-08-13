import { readFileSync } from 'node:fs';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entries = Object.entries(manifest);

function keyForSource(source, filePattern) {
  const match = entries.find(([, value]) => value.src === source || filePattern?.test(value.file));
  if (!match) throw new Error(`Bundle manifest is missing ${source}`);
  return match[0];
}

const included = new Set();
function includeStatic(key) {
  if (included.has(key)) return;
  included.add(key);
  for (const dependency of manifest[key]?.imports ?? []) includeStatic(dependency);
}

includeStatic(keyForSource('index.html'));
includeStatic(keyForSource('src/app/chat.controller.ts', /chat[.]controller-/u));

const files = [...included].map((key) => manifest[key].file);
const gzipBytes = files.reduce((sum, file) => sum + gzipSync(readFileSync(`dist/${file}`)).length, 0);
const forbidden = files.filter((file) => /firebase-realtime|rtc-livekit|gemini|media|search|messaging/u.test(file));
if (forbidden.length) throw new Error(`Deferred provider chunk entered the core path: ${forbidden.join(', ')}`);
// The Firebase SDK alone is ~187 kB of this, so the budget is really "Firebase
// plus room for the app". At 200 kB that room was 12 kB and already 99.9% spent,
// which stopped catching bloat and started blocking bug fixes. The forbidden
// chunk check above is the guard that actually earns its keep.
const BUDGET_BYTES = 210_000;
if (gzipBytes >= BUDGET_BYTES) throw new Error(`Core signed-in JavaScript is ${(gzipBytes / 1000).toFixed(2)} kB gzip; budget is <${BUDGET_BYTES / 1000} kB.`);
process.stdout.write(`Core signed-in JavaScript: ${(gzipBytes / 1000).toFixed(2)} kB gzip (${files.join(', ')})\n`);
