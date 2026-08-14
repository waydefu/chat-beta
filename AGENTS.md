# AGENTS.md — Chat Lite 3.0

Canonical agent context for this repository, written for Hermes Agent + Gemini 3.x; the rules apply to any coding agent. Nested `AGENTS.md` files load progressively as an agent enters a subtree. There is deliberately no `HERMES.md` or `CLAUDE.md` — one location, so the same rule cannot drift in three places.

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
9. Legacy paths are scheduled removals, not patterns: `realtime/rooms/{roomKey}/presence`, legacy push-token documents, `PRESENCE_LEGACY_TRUST_MS`, V1 RTC callables. Never copy them, never add a second parallel implementation of an existing subsystem.
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

## Engineering Principles & Agent Operating Guidelines

1. **企業級與模組化架構**：偏好企業級、可維護、可擴充、模組化的程式架構；寧可多花一些時間建立正確架構，也不採用短期 hack。重視實際可維護性勝過理論上的過度抽象。
2. **Strict TypeScript & 清楚邊界**：全專案維持嚴格 TypeScript（開啟 `noUncheckedIndexedAccess`），保持清楚的型別與模組邊界，嚴禁 `any`、隱性耦合與不必要的 workaround。
3. **理解現況後再動手**：大型修改前，先理解現有架構、資料流、生命週期與 production 狀態，不得在未查核現況前貿然重寫。
4. **計畫與執行分級**：複雜任務先提出完整實作計畫、風險、影響範圍與驗證方式再執行；小型且低風險的修改直接落地，避免過度規劃。
5. **最小安全變更（Smallest Safe Change）**：只修改任務真正需要的檔案，嚴禁 unrelated refactor、順手重寫與無關 diff。
6. **重視實際可維護性**：不為了「架構漂亮」過度抽象；每個抽象層都必須有明確的職責與消費者。
7. **主動清理死碼與技術債**：確認無動態引用或 production 依賴後，主動清除死碼、重複邏輯、過期相容層與 stale documentation；路過發現的債登記至 `docs/TECH-DEBT.md`。
8. **明確的 Ownership 與 Lifecycle**：狀態、listener、timer、subscription、abort signal 等必須有明確 owner 與 cleanup，切換房間或組件銷毀時不得遺留未清理資源。
9. **後端與安全原則**：後端與安全相關設計一律 server-authoritative、fail-closed、idempotent、race-safe、可重試、可稽核。
10. **保守的安全邊界**：涉及資料、權限、認證、Secret、Firebase Rules 或 production mutation 時，採取最保守策略；嚴禁為了開發方便放寬安全邊界。
11. **唯讀檢查、Rollback 與 Checkpoint**：修改前優先執行唯讀檢查確認現況；高風險操作必須具備 rollback 路徑，破壞性操作前保留 checkpoint / backup snapshot。
12. **多層級完整驗證**：每個有意義的變更均依影響範圍執行 lint、typecheck、unit test、rules test、build、E2E 或 browser smoke test。
13. **嚴格區分生產狀態**：不把「build 成功」或「deploy 成功」視為「功能驗證成功」；精確標註 `CODE-ONLY`、`DEPLOYED`、`SMOKE-VERIFIED`、`MANUAL-VERIFICATION-REQUIRED`。
14. **Git / GitHub 紀律**：保留乾淨歷史、不 force-push；較大變更拆成聚焦且容易 review 的 commit / PR，CI 維持綠燈。
15. **知行合一的 AI 執行**：任務確認後直接「實作 → 測試 → 修正 → 驗證 → 回報結果」，不流於只給計畫而不動手。
16. **高效率 Context 導航**：AI Agent 嚴禁每次全域掃描 repo；優先讀取 `AGENTS.md`、架構文件與 Task Routing 指定檔案，按需展開。
17. **沿用專案地圖降低 Token 成本**：理解過的專案沿用既有 context 與 project map，避免每次新任務從零重新考古。
18. **求真求實、查證代替猜測**：清楚區分已驗證事實、合理推論與未確認資訊；不知道就執行指令或讀檔查證，嚴禁臆測。
19. **模型分工策略**：複雜架構、全專案稽核與重大決策使用高推理能力模型；方向明確後的大量 coding、測試與重複施工由執行效率較高的模型接手。
20. **專業 UI/UX 標準**：兼顧桌面與手機端（含 320px 響應）、資訊層級、一致性、無障礙（WCAG 2.1 AA）與長期維護性；避免 AI template 感與無意義的大圓角卡片堆疊。
21. **文件與程式碼同步**：架構、重要決策、部署流程與特殊限制保有明確的 Single Source of Truth，避免跨文件重複複製造成漂移。

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
