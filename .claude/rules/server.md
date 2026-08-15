---
paths:
  - "functions/**"
---

# Trusted server

Read `functions/AGENTS.md` before your first edit in this subtree. It owns the callable contract, the secrets rules, the durable-state patterns and the deploy guardrails.

- Order is fixed: `requireAuth` → validate every input → re-read membership from Firestore → privileged work. A role, membership or display name from the client is input, not a fact.
- The Admin SDK bypasses Security Rules, so Rules are not a safety net here. Every read and write needs its own justification in code.
- Retries are guaranteed, so identity must be deterministic: same operation, same document ID. Leases expire and a bounded sweeper reclaims them. Triggers fire more than once.
- A Function that is not exported from `functions/src/index.ts` does not exist, and one that is not listed in a phase of `.github/workflows/deploy-hosting.yml` will never deploy.
- Logs carry `{ operation, phase, result, errorCategory, counts, durationMs }`. Chat text, prompts, tokens, signed URLs, secrets and display names never appear in a log line.

Why: every one of these is a correctness or disclosure invariant that unit tests alone do not catch — the compiler will not tell you that a retry created a second document or that a log line leaked a display name.
