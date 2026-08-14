# Repository audit findings

Audit date: 2026-08-14 (Asia/Taipei)

Baseline: `origin/main` at `fbe768d`
Working branch: `agent/rtc-presence-correctness`

## Scope and method

The audit covered every tracked file under `src/`, `functions/`, `tests/`, `public/`, `docs/`, `.github/`, plus Firebase Rules/indexes/configuration, TypeScript, ESLint, Vitest, Playwright, Vite, package manifests and rollout scripts. It combined source tracing, callable/export/path inventory, lifecycle and query scans, DOM/CSS cross-checks, documentation comparison, production build output and the existing quality gates.

No product code was changed before this report was written.

Baseline results:

| Gate | Result | Important limitation |
| --- | --- | --- |
| ESLint | pass | Type-aware lint takes about 111 seconds locally. |
| strict TypeScript | pass | Local Node is 24; CI's declared runtime is Node 22. |
| client unit + coverage | 6 tests pass | Coverage includes only `src/utils.ts`; reported 79.16% is not repository coverage. |
| Functions tests | 9 tests pass | Only bot routing/registry, room keys and membership policy pure functions are covered. |
| Firestore/RTDB Rules | 12 tests pass | Existing tests cover room-scoped presence, not the required global model. |
| Playwright | 1 test pass | Signed-out desktop only; no authenticated/mobile/RTC/media paths. |
| production build | pass | Core signed-in JS is 200.07 kB gzip; provider chunks remain lazy. |
| production dependency audit | pass at `high` threshold | One moderate advisory remains. |

## Root-cause map

1. **Server state is declared from an intent, not a confirmed external state.** Calls become `active` before LiveKit connect/media succeeds; uploads and stickers have stronger quarantine/finalize semantics that RTC lacks.
2. **Ephemeral identity is owned by a room instead of an authenticated session.** Presence is created and destroyed by `connectRealtimeRoom`, so room navigation changes global online state.
3. **The main controller owns storage, domain state, rendering and lifecycle together.** This makes snapshots replace normalized state and causes unrelated updates to rebuild message DOM.
4. **Security invariants are duplicated or sequenced client-side.** Read mirrors are two sequential writes; push token ownership is inferred from one in-memory token; App Check options differ per call site.
5. **Background work was written for today's dataset.** Several scheduled jobs scan whole RTDB branches, collection groups or R2 prefixes without durable checkpoints.
6. **Repository-delivered was treated as equivalent to tested/operational.** Documentation describes capabilities more strongly than the tests and production gates support.

## Prioritized findings

### P0 Critical

No confirmed P0 was found in the audited source. Provider credentials remain server-side, Firestore/RTDB default deny is present, and no direct client write path can create trusted call/system/media/sticker records. P1 items below can still cause production correctness, privacy or availability incidents and must be fixed before enabling the affected backend.

### P1 High

| ID | Finding and evidence | Root cause / impact | Planned owner |
| --- | --- | --- | --- |
| P1-01 | `startLiveKitCall` writes `status: active` before token issuance, LiveKit connect, microphone or camera acquisition (`functions/src/calls/livekit.ts`). | Failed media/provider setup leaves phantom active calls indefinitely. | PR 1 |
| P1-02 | Call creation has no room-level lock/pointer and always allocates a random call ID. | Concurrent starts, double-clicks and retries can create multiple effective calls in one room. | PR 1 |
| P1-03 | There is no `confirm connected` transition, client operation ID, lease, stale-creating cleanup or stale-active recovery. | Start is not idempotent or crash-safe; Firestore cannot distinguish intent from a real media session. | PR 1 |
| P1-04 | Initial participant reporting occurs inside provider `join()` before `CallUIController.adopt()`. | A remote participant already in LiveKit is reported while controller state is null, so the state is lost. | PR 1 |
| P1-05 | `endLiveKitCall` consumes App Check tokens when enforcement is enabled, while client `endCall` omits `limitedUseAppCheckTokens`. | Enforced RTC can start/join but fail to end, producing stale calls. | PR 1 |
| P1-06 | Only the starter/admin can end server lifecycle; a joining member's hangup is local only. There is no participant acknowledgement or disconnected recovery. | Call state can remain live after the last real participant leaves. | PR 1 |
| P1-07 | Call message is the only invitation, notification trigger drops all `senderType=system`, and call records only expose started/ended. | No authoritative ringing/accepted/rejected/missed/cancelled signaling; background and other-room incoming calls are absent. | PR 1 |
| P1-08 | Presence lives at `realtime/rooms/{room}/presence` and is created/removed with every room session. | Switching rooms makes a user offline; multi-room/member intersections are semantically wrong. | PR 1 |
| P1-09 | Presence UI renders the raw presence set and includes the current user. | "other users online" counts are wrong; room membership is not intersected with global connections. | PR 1 |
| P1-10 | A recent-message snapshot replaces the entire `messages` map after `loadOlder` merges history (`chat.controller.ts:307-310`). | The next metadata/edit/reaction-related recent snapshot discards loaded history. | PR 2 |
| P1-11 | `renderMessages()` always calls `messageList.replaceChildren`; read states and active calls invoke it. | Playback, signed URLs, focus, screen-reader position and scroll stability are destroyed by unrelated state. | PR 2 |
| P1-12 | `markRoomRead` performs two sequential writes to room and user mirrors. | Partial failure creates permanent read-state drift. | PR 2 |
| P1-13 | Public room listener and user room-state listener are unbounded; private rooms are fetched N+1. | Cost and memory grow with all rooms and memberships. | PR 2 |
| P1-14 | Logout calls `stopForegroundPush`, which clears the in-memory token without deleting the prior UID's Firestore token document. | A browser token can remain attached to an old account and receive its notifications after account switch. | PR 2 |
| P1-15 | Disabling trusted offline mode only selects memory cache on a future load; it never clears existing IndexedDB. | UI implies revocation while private cached data remains on disk. | PR 2 |
| P1-16 | Custom sticker deletion has a backend callable but no management UI/client path; deletion removes pack metadata used to resolve historical messages. | Users cannot manage stickers and future deletion breaks historical rendering semantics. | PR 3 |
| P1-17 | Media and sticker R2 clients, MIME/magic-byte logic, quota constants and lifecycle primitives are duplicated. Cleanup suppresses object-delete failures. | Policy drift, quota/object drift and unobservable orphan cleanup are likely. | PR 3 |
| P1-18 | No backup manifest, archive serializer, verification state machine, retention checkpoint, dry-run, attachment reference cleanup or restore runbook exists. | Safe retention cannot be enabled; a naive future scheduler could delete unrecoverable data. | PR 5 |
| P1-19 | RTC, presence, pagination, push ownership, offline cleanup, media/sticker lifecycle and retention have no meaningful automated tests. | Existing green CI cannot detect the failures this program is intended to prevent. | All PRs |

### P2 Medium

| ID | Finding and evidence | Impact | Planned owner |
| --- | --- | --- | --- |
| P2-01 | `chat.controller.ts` is 1,035 lines and owns room orchestration, stores, rendering, search, composer, presence, media and calls. | Change amplification and lifecycle coupling are returning toward the former monolith. | PR 1-4 incrementally |
| P2-02 | Call timer starts in `CallPanel` constructor, camera control is shown for voice calls, and mobile only changes panel width. | Misleading duration/controls and incomplete mobile call UX. | PR 1 |
| P2-03 | LiveKit provider uses document-global audio cleanup and relies on disconnect for event cleanup. | Multiple/failed sessions can remove the wrong elements or retain listeners/tracks. | PR 1 |
| P2-04 | Room membership reconciliation reads every member and entire RTDB room tree; AI draft cleanup reads all `realtime/rooms`. | Scheduled cost/timeout risk without bounded pages/checkpoints. | PR 1 / PR 5 |
| P2-05 | Push notification fanout performs per-recipient token and room-state reads. | N+1 cost and latency under larger rooms. | PR 2 |
| P2-06 | Push contains message text by default and has no explicit privacy mode/foreground-room/active-call separation. | Avoidable lock-screen content exposure and notification noise. | PR 2 |
| P2-07 | Attachment renderer has no retry control, viewer/zoom, poster, URL-expiry recovery or stable keyed ownership. | Broken/expired media is a dead end and rerenders interrupt playback. | PR 3 |
| P2-08 | Upload controller has cancel/progress but no retry state, reconnect strategy or owned status-reset timer cleanup. | Stale timer/status races and weak failure recovery. | PR 3 |
| P2-09 | Sticker metadata is a single map document capped at 100 items and updated concurrently. | Hot document/document-size ceiling; migration is needed before expansion. | PR 3 |
| P2-10 | `src/style.css` contains initial, 2026 refinement and 3.0 override layers, repeated media queries and duplicate `.call-video` definitions. | Specificity debt and regressions from append-only styling. | PR 4 |
| P2-11 | Header uses platform glyphs and exposes six actions on mobile; message actions are always structurally present. | Inconsistent icons, crowded 320px UI and touch/accessibility problems. | PR 4 |
| P2-12 | Drawers toggle classes only; no inert, focus trap/restore, Escape handling or shared dialog semantics. | Keyboard and screen-reader users can interact behind open drawers. | PR 4 |
| P2-13 | System-theme watching is registered in bootstrap and chat controller; watcher returns no cleanup. | Duplicate state/listener ownership. | PR 4 |
| P2-14 | Functions have ad-hoc human-readable errors/logs rather than a shared error taxonomy and operation fields. | Client mapping and incident correlation are inconsistent. | All PRs |
| P2-15 | Documentation claims tested/complete behavior that is absent (notably RTC recovery, Functions idempotency, authenticated E2E and service-worker scope). | Operators can enable unverified functionality based on stale docs. | All PRs |
| P2-16 | CI has no dead-code check and no authenticated/mobile projects; unit coverage deliberately includes only one utility file. | Dead paths and high-risk regressions pass quality gates. | PR 4 plus phased tests |
| P2-17 | Several cleanup jobs use whole collection-group/R2 prefix scans or have no durable checkpoint (`stickers/messages.ts`, `media/uploads.ts`). | Runtime/cost grows without bound and partial work restarts from zero. | PR 3 / PR 5 |
| P2-18 | One moderate production dependency advisory is present. | Not a high-threshold release blocker, but must be identified and resolved or accepted with evidence. | PR 4 |

### PR 2 closure status

P1-10 through P1-15 and P2-05/P2-06 are resolved on the PR 2 implementation branch: the normalized store retains historical pages when the live query window advances; keyed rows isolate message/read/reaction/call updates; read mirrors use one batch; room queries are bounded and private metadata is fetched in `in` chunks; Push ownership is a server transaction keyed by a SHA-256 token hash; notification copy is redacted; and offline revocation waits for pending writes before terminating Firestore and clearing IndexedDB. The Rules and rollout are intentionally incompatible with the old client write path, so production must follow the additive callable → Hosting adoption → sender/Rules sequence in `docs/MIGRATION.md`.

### P3 Low

| ID | Finding | Planned owner |
| --- | --- | --- |
| P3-01 | PWA manifest lacks 192px/maskable icons; Android doc already records the gap. | PR 4 / Android follow-up |
| P3-02 | Asset download/cache status uses generic text with no per-item accessible retry/error state. | PR 3 |
| P3-03 | Build emits large source maps locally even though Hosting ignores them; operational intent is split between Vite and Hosting config. | PR 4 |

### TECH-DEBT

| ID | Finding | Resolution rule |
| --- | --- | --- |
| TD-01 | `textOf(message)` is duplicated in controller and historical search; backend has a separate security-boundary variant. | Share the two client variants; document why backend normalization remains separate. |
| TD-02 | Built-in sticker definitions exist in HTML, client service, client view and Functions. | Create one client catalog; keep server allow-list independently validated and document the boundary. |
| TD-03 | Callable App Check options are repeated and inconsistent. | Introduce typed callable wrappers/policy for replay-sensitive operations. |
| TD-04 | Raw Firestore casts are spread through repositories with no runtime decoder. | Add narrow mappers/guards at repository boundaries as each domain changes. |
| TD-05 | Timers/listeners/object URLs/media tracks are owned ad hoc instead of through consistent scopes. | Give every new lifecycle an explicit owner and cleanup test. |
| TD-06 | Migration and scheduled maintenance read whole collections; acceptable one-off migration behavior is not separated from recurring production behavior. | Keep one-off tools explicit; production schedulers must page/checkpoint. |
| TD-07 | Error-to-toast mapping is controller-local and provider errors leak inconsistent strings. | Centralize domain error codes and Traditional Chinese presentation mapping. |

### DEAD-CODE / ORPHAN FEATURE

| ID | Finding and evidence | Disposition |
| --- | --- | --- |
| DC-01 | `#chat-heads` exists in HTML and about 60 lines of CSS implement dragging/badges/animations, but no controller references it. | Remove in PR 4 unless a reviewed roadmap requires full implementation. |
| DC-02 | `.typing-chip`, `.typing-dots` and keyframes exist, but controller only assigns text to `.typing-indicator`. | Implement the accessible chip in PR 4 or delete all dead styles. |
| DC-03 | `public/image/background.jpg` and `public/image/logo.png` have no repository references. | Remove after visual/build verification in PR 4. |
| DC-04 | `removeRoomMember` client service is exported but has no caller/UI. | Connect to an authorized member-management flow or remove in the owning PR. |
| DC-05 | `createDirectRoom` is deployed but has no client call path; direct-room UI is absent. | Mark as intentionally backend-only with a concrete consumer or defer deployment/remove orphan feature. |
| DC-06 | `deleteCustomSticker` is deployed but has no client consumer. | Complete management UI in PR 3; do not delete the backend that the requested feature needs. |

## Data/index/rules observations

- Firestore and RTDB both default deny. Trusted call/media/sticker documents are server-write-only.
- Current call documents allow member reads and deny client writes, which is a sound boundary; server lifecycle semantics are the defect.
- The existing room index supports the current unbounded public query but not pagination cursors by itself at the controller layer.
- Global presence requires an additive RTDB path/rule first. Room ACL mirror paths must remain for typing/activity/AI drafts.
- Call state expansion and room-level active-call pointer are additive Firestore fields. Old `active`/`ended` readers need a bounded compatibility window, not permanent dual-write.
- Backup/retention collections and indexes do not exist and must remain inert until explicit production flags and infrastructure are configured.

## PR boundaries

1. **PR 1 — RTC + Presence correctness:** call state machine/invariant/idempotency/recovery/signaling, consistent App Check, global presence, RTDB Rules/tests, focused call/mobile UX and docs/migration notes.
2. **PR 2 — Messages + Push + Offline correctness:** normalized paginated store, incremental rows, atomic read state, bounded room queries, push ownership/privacy, cache revocation.
3. **PR 3 — Media + Custom Stickers:** shared storage primitives, stable viewers/URL refresh, resilient uploads, management UI, sticker metadata/history migration and cleanup.
4. **PR 4 — UI/UX + CSS + dead code:** mobile header/actions/drawers/a11y, SVG icons, stylesheet architecture, dead assets/exports, dead-code CI and documentation consolidation.
5. **PR 5 — Backup + Retention:** GCS archive/manifest/checkpoint/dry-run, reference-aware media/call cleanup, restore tooling and runbooks. Deletion stays disabled by default.

Every PR must be independently deployable and reversible, keep strict TypeScript and default-deny rules, and include explicit migration/rollback notes. Manual provider, App Check, scheduler, GCS, R2 or deployment work must be labelled **MANUAL PRODUCTION STEP** rather than represented as complete.
