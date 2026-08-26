# AGENTS.md — Chat Lite 3.0

Canonical agent context for this repository, written for Hermes Agent + Gemini 3.x; the rules apply to any coding agent. Nested `AGENTS.md` files load progressively as an agent enters a subtree. Architecture, invariants and routing live here and only here, so the same rule cannot drift across agents.

Claude Code does not read `AGENTS.md`, so the repository also carries a `CLAUDE.md`. It imports this file rather than restating it, and adds only Claude-specific operating behaviour — task classification, verification claims, parallel-agent safety, and the map of `.claude/rules`, `.claude/skills` and the guard hook. Anything factual about the repository belongs here, not there.

Production real-time chat web app. Vanilla TypeScript + Vite client on Firebase Hosting; Firebase Functions (TypeScript, Node 22, gen2, region `asia-east1`) is the only trusted server. Firebase project `f-chat-wayde-fu`. UI language is Traditional Chinese — user-facing strings stay zh-TW.

Read this file, then read only the files Task Routing names for your task. Do not scan the repository.

## Non-Negotiable Invariants

1. Firestore `rooms/{roomId}/members/{uid}.status == 'active'` is the only canonical authorization. RTDB `realtime/rooms/{roomKey}/members` is an eventually consistent mirror — never authorize from it, never query membership from it.
2. Clients may create only `senderType: 'user'`, `kind: 'text'` messages. Bot, system, call, attachment and sticker messages, membership, call state, push claims and operation journals are server-written. NEVER relax `firestore.rules` or `database.rules.json` to make a client write succeed.
3. Provider credentials (Gemini, R2, LiveKit, Algolia) exist only in Secret Manager and are read only inside Functions. NEVER place a credential in a `VITE_` variable, in `src/`, or in Git.
4. NEVER log JWTs, LiveKit tokens, signed URLs, secret values, chat text, prompts, or Google Search queries. Logs carry operation, phase, result, error category and counts only.
5. One active call per room. The lock is `rooms/{roomId}.activeCallId` plus a Firestore transaction, a caller-generated operation ID and `leaseExpiresAt`. Disabled buttons and client queries are not the invariant.
6. `SessionScope` owns global presence, the incoming-call watcher, the LiveKit session and push listeners. `RoomScope` owns only room subscriptions. Switching rooms MUST NOT end a call or mark the user offline.
7. Membership revocation is fail-closed and version-guarded: Firestore `revoking` → atomic RTDB mirror delete → Firestore finalize. A partial failure stays `revoking` for reconciliation. Never make it best-effort.
8. Firestore and RTDB have no distributed transaction. The cross-store state machine is in `docs/SECURITY.md`; do not invent a second one.
9. Legacy paths are scheduled removals, not patterns: `realtime/rooms/{roomKey}/presence`, legacy push-token documents, V1 RTC callables. Never copy them, never add a second parallel implementation of an existing subsystem. `PRESENCE_LEGACY_TRUST_MS` was removed on 2026-08-26 (TD-P3); presence now reads one window.
10. Never commit production data: room names, user IDs, message content, migration artifacts, secret values.

## Architecture at a Glance

| Store / service | Owns | Notes |
| --- | --- | --- |
| Firestore | Permanent messages, canonical membership/ACL, call lifecycle, AI request ledger, push ownership, rate limits | The authorization source of truth |
| RTDB (`realtime/…`) | Global presence, room typing/activity, AI drafts, membership mirror + versions | Ephemeral only; never permanent, never authoritative |
| Cloudflare R2 | Media and custom-sticker objects | Server-signed short-TTL URLs; client holds no R2 credential |
| LiveKit Cloud | Live participant and track state | Firestore holds the call lifecycle; LiveKit holds media only |
| Algolia | Rebuildable, room-bound text index | Membership checked before every search |
| Secret Manager | All provider credentials | Declared in `functions/src/config.ts` |
| Browser env (`VITE_*`) | Public Firebase / App Check / FCM config only | `.env.example`; fallbacks in `src/firebase/app.ts` |

Trust boundary: the browser is untrusted. Anything privileged happens in a Functions callable that re-verifies auth, App Check and active membership.

## Repository Map

| Area | Responsibility | Read when |
| --- | --- | --- |
| `src/` | Browser client (see `src/AGENTS.md`) | Any client change |
| `functions/src/` | Trusted server (see `functions/AGENTS.md`) | Any server change |
| `functions/src/bots/` | Gemini execution path (see `functions/src/bots/AGENTS.md`) | Any AI change |
| `firestore.rules`, `database.rules.json` | Client authorization | Any change to what a client may read/write |
| `firestore.indexes.json` | Composite indexes | Adding or changing a server/client query |
| `firebase.json` | Hosting headers/CSP, rules wiring, emulator ports | CSP, caching, new external origin, emulator config |
| `.github/workflows/` | `ci.yml` is the authoritative quality gate; `deploy-hosting.yml` is the phased production deploy and its attestation gates | Changing commands, or any deployment question |
| `tests/` | Client unit tests + `rules.test.ts` (emulator) | Client or Rules change |
| `functions/tests/` | Server policy unit tests | Server change |
| `scripts/` | Rollout preflight, bundle budget, membership display-name backfill | Rollout checks, budget failures, membership repair |
| `docs/` | Architecture, security, runbooks, ADRs | See Documentation Routing |
| `index.html` | DOM contract the controller binds by element ID | Adding or renaming UI elements |
| `public/firebase-messaging-sw.js` | Background push and notification routing | Push payload or notification behaviour |

## Source of Truth

| Question | Authority |
| --- | --- |
| Who may read/write what as a client | `firestore.rules`, `database.rules.json` (not the docs) |
| Collection/path shapes | `src/types.ts` + `docs/DATA-MODEL.md` |
| Which Functions exist | `functions/src/index.ts` |
| Which Functions are deployed | `firebase functions:list --project f-chat-wayde-fu`, then `docs/HANDOFF.md` |
| Which secret a Function needs | its `secrets:` option in `functions/src/*.ts` |
| Gemini model + allowlist | `functions/src/bots/model-policy.ts` |
| Call state machine | `functions/src/calls/livekit.ts` + `docs/RTC.md` |
| Presence staleness windows | `src/realtime/presence-state.ts` and `functions/src/presence/presence-policy.ts` (kept in sync by hand) |
| Commands and gates | root `package.json` scripts + `.github/workflows/ci.yml` |
| Known debt and its acceptance criteria | `docs/TECH-DEBT.md`, `AUDIT_FINDINGS.md` |

When executable code, Rules or config disagree with a document, the code wins. Record the conflict; do not silently "fix" the doc as part of an unrelated change.

## Task Routing

Read the listed files first; expand only if they do not answer the question.

- **Auth / ACL / membership** → `firestore.rules`, `functions/src/rooms/membership.ts`, `functions/src/rooms/membership-policy.ts`, `functions/src/shared/membership.ts`, `docs/SECURITY.md`.
- **Messages (send, edit, delete, pagination, reactions, read state)** → `src/messages/`, `src/rooms/room.repository.ts`, `firestore.rules` message rules, `docs/DATA-MODEL.md`.
- **Presence / typing / RTDB** → `src/realtime/`, `functions/src/presence/`, `database.rules.json`.
- **Gemini / AI** → `functions/src/bots/AGENTS.md` first, then `functions/src/bots/gemini.ts`.
- **Calls / RTC** → `docs/RTC.md`, `functions/src/calls/livekit.ts`, `functions/src/calls/signaling.ts`, `src/calls/`.
- **Media / attachments / voice / stickers** → `docs/MEDIA.md`, `functions/src/media/uploads.ts`, `functions/src/stickers/messages.ts`, `src/media/`.
- **Search** → `functions/src/search/algolia.ts`, `src/search/`, `docs/adr/0006-algolia.md`.
- **Push notifications** → `functions/src/notifications/`, `src/notifications/push.ts`, `public/firebase-messaging-sw.js`.
- **Offline / IndexedDB** → `src/firebase/offline-policy.ts`, `src/firebase/offline-settings.controller.ts`.
- **App Check** → `functions/src/config.ts`, `src/firebase/app-check.ts`, `src/calls/rtc-callable-options.ts`.
- **Deployment / rollout** → `.github/workflows/deploy-hosting.yml`, `docs/MIGRATION.md`, `docs/FEATURE-ENABLEMENT.md`, `docs/HANDOFF.md`.
- **CSP, headers, caching** → `firebase.json`. **Bundle budget failure** → `scripts/check-bundle-budget.mjs`, `vite.config.ts`.

## Commands

Run from the repository root. Scripts deliberately invoke tools as `node node_modules/...`; keep that form when adding scripts.

```bash
pnpm install --frozen-lockfile
pnpm dev                      # Vite dev server
pnpm emulators                # Firebase emulators, project demo-chat-lite
pnpm lint
pnpm typecheck                # client tsc --noEmit
pnpm test:unit                # client unit tests (add --coverage for the CI form)
pnpm test:functions           # Functions policy tests
pnpm test:rules               # Firestore + RTDB Rules against emulators; needs Java 21
pnpm test:e2e                 # Playwright; builds first via pretest:e2e
pnpm build                    # client tsc + functions tsc + vite build + bundle budget
pnpm check                    # lint + typecheck + unit + functions + functions tsc + build
pnpm preflight:rollout        # offline rollout preflight
```

Requires Node 22, pnpm 11, Java 21 (Rules emulator).

Deployment: NEVER run `pnpm deploy` or `firebase deploy` for production. Production deploys run through the `Deploy Firebase production` GitHub workflow with an explicit `rollout_phase` and its attestation inputs.

## Validation Matrix

| Change | Minimum validation |
| --- | --- |
| Client logic in a coverage-scoped module | `pnpm test:unit` + `pnpm typecheck` |
| Client rendering / DOM / CSS only | `pnpm typecheck` + `pnpm lint`; `pnpm test:e2e` if markup or focus order changed |
| Functions policy or pure logic | `pnpm test:functions` + `node node_modules/typescript/bin/tsc -p functions/tsconfig.json` |
| `firestore.rules` or `database.rules.json` | `pnpm test:rules` (required, no exceptions) + tests for the new case |
| Cross-layer (client + Functions + Rules) | `pnpm check` + `pnpm test:rules` |
| New/changed Firestore query | update `firestore.indexes.json`, and ship the index with the Function that queries it |
| Bundle-affecting change (new import in the signed-in path) | `pnpm build` — the budget gate and the forbidden-chunk check must pass |
| Anything touching RTC, media, push delivery or a real provider | Unit/Rules tests are necessary but not sufficient; a protected-staging smoke gate is required before production |

Do not run the whole suite for a one-line change. Do run the whole suite before anything that reaches production.

## Security and Secrets

- Every privileged callable re-verifies `requireAuth`, App Check (per feature), then active membership. Never trust client-supplied identity, membership or display names.
- App Check enforcement is per-feature via `APP_CHECK_ENFORCED_FEATURES`, read in `functions/src/config.ts`. Replay-sensitive RTC and push-ownership callables always send limited-use tokens from the client.
- Never return a provider error verbatim — its message can quote user content. Map it to a domain code and a fixed message.
- Public Firebase/App Check/FCM configuration is not secret, but do not paste its values into Markdown. Full model: `docs/SECURITY.md`.

## Change Discipline

- Read the domain's authoritative code/docs before modifying it. Match the surrounding style; strict TypeScript with `noUncheckedIndexedAccess` is enabled everywhere.
- Do not refactor unrelated code, rename unrelated symbols, touch files outside the task, or add scripts and wrappers the task did not require.
- Do not create a second implementation of an existing subsystem, and do not leave a feature reachable through both an old and a new path.
- Do not weaken Rules, remove a lease or transaction, or convert a fail-closed path to best-effort to make something pass.
- Do not hard-code production identifiers, credentials, or a value that already has a canonical source.
- Debt found in passing goes to `docs/TECH-DEBT.md` with an acceptance condition — not into the current change.

## Closeout and Release-Preflight Tasks

Some tasks are not "fix this" but "close this out": a release preflight, a correctness closure before a phase gate, an audit that has to end in ready or blocked. They obey the rules above plus these, because the way they fail is different — not a wrong fix, but a fix that was only part of the job.

- **A closeout owns a bounded set, not a symptom.** Enumerate the whole set — every open item, every related production error — *before* implementing anything. The enumeration is the deliverable that makes the rest reviewable.
- **One confirmed defect earns one bounded sibling search.** Ask where else this exact failure class can occur, and search the same class, boundary and ownership mechanism — not the whole repository. Record the result, including "searched, none found".
- **Never knowingly fix one occurrence and leave an equivalent one broken.** An in-scope defect that is safely fixable gets fixed in the same closeout. Registering it in `docs/TECH-DEBT.md` and stopping is for items that are genuinely external, out of scope, or blocked by a safety or migration prerequisite — and the row says which.
- **Code, config and runtime beat a document that disagrees.** That already holds everywhere; in a closeout it also means the last session's notes are not the baseline. Read the actual remote, CI and production state first.
- **A closeout may span several pull requests.** Split them on rollback boundaries — what would have to be reverted together — not on where the work paused. Merging one does not end the task; go back to the set.
- **Finish by synchronizing the canonical documents,** then declare exactly one outcome: ready, or blocked with the blocker named. "Mostly ready" is not an outcome.

## Documentation Routing

| Document | Answers |
| --- | --- |
| `docs/ARCHITECTURE.md` | Layering, scope ownership, store responsibilities |
| `docs/DATA-MODEL.md` | Exact Firestore/RTDB paths and document shapes |
| `docs/SECURITY.md` | ACL, Firestore↔RTDB consistency protocol, App Check, AI privacy |
| `docs/RTC.md` | Call state machine, server invariants, callable table, staging gate |
| `docs/AI-BOT-FRAMEWORK.md` | Bot trigger contract, streaming/draft model, grounding |
| `docs/MEDIA.md` | Upload grant/finalize, size and MIME limits, sticker objects |
| `docs/TESTING.md` | What each test layer covers — and what it cannot cover |
| `docs/MIGRATION.md` / `docs/FEATURE-ENABLEMENT.md` | Ordered rollout and rollback; how to enable a not-yet-live feature |
| `docs/HANDOFF.md` | Production state, deployed functions, provider/secret status |
| `docs/TECH-DEBT.md` / `AUDIT_FINDINGS.md` | Known debt with acceptance criteria; canonical audit registry |
| `docs/adr/` | Why a boundary exists (membership, message model, R2, AI, LiveKit, Algolia, Hosting) |

## Context Efficiency

For a routine task: read this file, the nested `AGENTS.md` for the subtree you are editing, and the files Task Routing names. Nothing else. Never re-derive the architecture by reading `src/` or `functions/` end to end.

Expand the search only when ownership is still unclear after the routed files, the change is cross-cutting (client + Functions + Rules), a document contradicts the code, or a referenced path is missing. For live production inventory, use the Firebase CLI, not a document.
