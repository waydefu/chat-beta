# AGENTS.md — `functions/` (trusted server)

The only trusted execution context. TypeScript, Node 22, Firebase Functions gen2, region `asia-east1` (`REGION` in `src/config.ts`). Separate pnpm workspace package `chat-lite-functions`; it shares no code with `src/`. Root `/AGENTS.md` invariants apply here too.

`src/index.ts` is the deploy surface — a Function that is not exported there does not exist in production.

## Callable contract

Every privileged callable, in this order:

1. `requireAuth(request)` — from `src/shared/validation.ts`.
2. `requireRecord` / `requireString` on every input. Never index into `request.data` directly.
3. `getActiveMembership(roomId, uid)` or `requireRoomManager(...)` — from `src/shared/membership.ts`. Membership is re-read from Firestore per request; never accept a role, membership or display name from the client.
4. The privileged work.

Options pattern: `{ region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: ENFORCE_APP_CHECK, secrets: [...] }`.

- `ENFORCE_APP_CHECK` comes from `appCheckEnforced('<feature>')` in `src/config.ts`, driven by the `APP_CHECK_ENFORCED_FEATURES` environment variable. Features: `membership`, `ai`, `media`, `notifications`, `rtc`, `search`, `stickers`.
- All callables in one feature MUST use the same gate. Never enforce on a subset — the client sends limited-use tokens for every replay-sensitive call in the group.
- `consumeAppCheckToken` is set only where the token is limited-use; match the existing calls in the same file.

## Secrets

- Declared once in `src/config.ts` with `defineSecret`, bound per-Function via `secrets: [...]`.
- To learn which secret a Function needs, read its `secrets:` option — never infer from the feature name.
- Never read a secret at module scope; call `secretName.value()` inside the handler.
- Never log, echo or return a secret value, and never add one to `.env`, `.env.example` or any `VITE_` variable.

## Durable state patterns

- **Idempotency by deterministic ID.** AI: `${sourceMessageId}_${botId}`. Membership: `operationId(roomId, uid)`. Push: `sha256(token)`. A retry must land on the same document, not a new one.
- **Leases, not locks.** Live work stamps `leaseExpiresAt`; a scheduled bounded cleanup reclaims expired ones. Any new long-running server state needs both halves.
- **Transactions for cross-document invariants.** Room call lock + call document; membership + user room index + operation journal; push claim removal + reassignment; AI final message + ledger + room `lastMessage`. Never write these sequentially.
- **Version guards.** Membership mirror writes go through `mirrorTransitionAllowed` / `shouldHaveRealtimeMirror` (`src/rooms/membership-policy.ts`). A stale event must never resurrect access a newer revocation removed.
- **Bounded work.** Scheduled functions page with an explicit page/batch ceiling and leave the remainder to the next run. Never write an unbounded scan.
- **Triggers must be replay-safe.** `onDocumentWritten` / `onDocumentCreated` can fire more than once; `syncCallSignals` creates signal documents if-missing so a retry cannot overwrite `accepted`/`rejected`.

## Admin SDK boundary

- `src/admin.ts` is the only place that initializes the app; import `firestore` / `database` from it.
- The Admin SDK bypasses Security Rules. Rules are not a safety net here — every read and write must be justified by an explicit membership or ownership check in code.
- RTDB paths use `roomKey(roomId)` (base64url) from `src/shared/validation.ts`. Never build the key inline.

## Errors and logs

- Throw `HttpsError` with a stable domain code in `details.code` and a user-facing zh-TW message. Map provider/internal errors to that taxonomy; never re-throw a provider error, whose message can quote user content.
- Structured logs only: `{ operation, phase, result, errorCategory, counts, durationMs }`.
- NEVER log chat text, prompts, search queries, tokens, JWTs, signed URLs, secrets, or full user records. Display names in a log line are PII — leave them out.

## Tests and local run

```bash
pnpm test:functions                                            # from repo root
node node_modules/typescript/bin/tsc -p functions/tsconfig.json
pnpm emulators                                                 # project demo-chat-lite
```

`functions/tests/*.test.ts` cover pure policy modules (membership version, model policy, grounding policy, draft policy, push policy, presence policy, call state, bot routing, AI errors, request config, room key). Keep new logic extractable: put decision logic in a policy module with a test, and keep the callable a thin composition. Callable-level coverage for `generateGeminiReply` is an open gap tracked as TD-A2/TD-A3 in `docs/TECH-DEBT.md`.

## Deploy guardrails

- Never deploy from a local machine. `.github/workflows/deploy-hosting.yml` deploys one `rollout_phase` at a time, each `--only`-scoped and gated by explicit attestation inputs (`migration_verified`, `providers_verified`, `push_adoption_verified`).
- A new Function must be added to the correct phase's function list in that workflow, or it will never deploy.
- Ship a new query's composite index in `firestore.indexes.json` with the phase that deploys the Function using it.
- `docs/HANDOFF.md` records the last verified deployment; the live inventory is `firebase functions:list --project f-chat-wayde-fu`. `docs/FEATURE-ENABLEMENT.md` §0 lags behind HANDOFF — do not treat it as the deployment inventory.
- Functions declaring `retry: true` require `--force` in a non-interactive deploy; that is why the workflow passes it on function phases.

## Read next

`docs/SECURITY.md` (Firestore↔RTDB consistency protocol), `docs/RTC.md` (call state machine and callable table), `docs/MEDIA.md` (upload grant/finalize), `src/bots/AGENTS.md` (Gemini execution path), `docs/MIGRATION.md` (rollout order).
