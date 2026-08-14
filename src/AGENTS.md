# AGENTS.md — `src/` (browser client)

Untrusted code. Anything privileged goes through a Functions callable. Root `/AGENTS.md` invariants apply here too.

## Layering

`main.ts` → `app/bootstrap.ts` → (lazy) `app/chat.controller.ts` → services → repositories → Firebase SDK.

| Layer | Files | Rule |
| --- | --- | --- |
| Bootstrap | `app/bootstrap.ts` | Auth state, view toggling, service worker registration. Holds no room state. |
| Controller | `app/chat.controller.ts`, `calls/call-ui.controller.ts`, `media/*.controller.ts`, `firebase/offline-settings.controller.ts` | Owns DOM, lifecycle scopes and orchestration. |
| Service | `messages/message.service.ts`, `rooms/room.service.ts`, `calls/call.service.ts`, `media/*.service.ts`, `stickers/sticker.service.ts`, `search/historical-search.ts` | Pure domain logic and callable orchestration. No DOM. |
| Repository | `auth/*.repository.ts`, `messages/message.repository.ts`, `rooms/room.repository.ts`, `realtime/realtime.repository.ts`, `calls/call.repository.ts` | The only place that touches Firestore/RTDB SDK APIs. |
| Provider | `bots/providers/`, `calls/providers/`, `search/providers/` | Interface + one implementation. Domain code depends on the interface only. |

Rules:
- Never call the Firebase SDK from a controller or view. Add a repository function.
- Never import a concrete provider (`GeminiProvider`, `LiveKitCallProvider`, `AlgoliaSearchProvider`) from domain code — depend on `AIProvider` / `CallProvider` / `SearchProvider`.
- Callables go through `firebase/callables.ts` (`callFunction`), which initializes App Check first. Streaming AI is the exception and uses `httpsCallable(...).stream` in `bots/providers/gemini-provider.ts`.
- Throw `DomainError` (`shared/errors/domain-error.ts`) for user-visible failures. Never surface a raw Firebase error string.

## Lifecycle ownership

`app/lifecycle.ts` defines `LifecycleScope` with `add()`, `timeout()`, `dispose()` and an `AbortSignal`.

- `SessionScope` (created in `beginSession`) owns: global presence connection, incoming-call watcher, active call, push foreground listener, session timers.
- `RoomScope` (created in `openRoom`) owns: message/member/reaction/read-state subscriptions, typing and activity, AI draft subscription.
- Register every subscription, timer and listener on the owning scope at creation. Do not keep module-level cleanup variables for new work.
- `closeRoom()` must not touch session-owned state. `cleanupSession()` disposes both.

MUST NOT: end a call, drop global presence, or release the push token when switching rooms.

## Rendering

- `PaginatedMessageStore` (`messages/message-store.ts`) is the normalized message state. The live query is a moving 50-item window; historical pages already merged stay merged. Never rebuild state from a snapshot alone.
- The message list is keyed by `data-message-id`. Update only the changed rows. Never replace the whole list — it unmounts images, audio and video, and drops scroll position.
- Reactions, read receipts and active-call chrome update their own subtree only.
- Read-state advancement writes both mirrors (`rooms/{roomId}/readStates/{uid}` and `users/{uid}/roomStates/{roomId}`) in a single `writeBatch`. Rules reject a batch where either half is invalid; never split it into two writes.
- The controller binds elements by ID from `index.html` via `byId()`, which throws when missing. Renaming or removing an element ID breaks startup — update both sides together.

## Client trust boundary

- The client may write only: its own user text message, its own reaction, its own read state, `rooms/{roomId}` `updatedAt`/`lastMessage`, its own profile fields, and its own RTDB presence/typing/activity nodes. Everything else is a callable.
- `structuredMentions()` produces the `mentions` array that triggers the bot server-side. Its token-boundary check is deliberate: `@GeminiTest` must not trigger. Do not loosen it.
- Presence staleness constants in `realtime/presence-state.ts` are duplicated in `functions/src/presence/presence-policy.ts` on purpose (no shared code between workspaces). Change both together or presence flickers.
- Offline persistence is explicit opt-in (`firebase/offline-policy.ts`). Revocation waits for pending writes, then terminates and clears IndexedDB; when another tab holds the database it stays pending and fails closed. Never silently clear or silently keep the cache.

## Validation

```bash
pnpm typecheck
pnpm test:unit          # add --coverage to match CI
pnpm lint
pnpm test:e2e           # only when markup, focus order or accessibility changed
pnpm build              # only when imports in the signed-in path changed
```

`vitest.config.ts` scopes coverage to the pure modules (`utils`, `call-state`, `call.service`, `offline-policy`, `message-store`, `message.service`, `grounding.view`, `presence-state`, `realtime.repository`, `rtc-callable-options`). New pure logic belongs in one of those modules with a test, not inside `chat.controller.ts`.

Adding a new static import to the signed-in path can trip `scripts/check-bundle-budget.mjs`. Provider SDKs (LiveKit, messaging, RTDB, functions) must stay lazily imported — the forbidden-chunk check fails the build if they enter the core chunk.

## Known local debt

`chat.controller.ts` (~1300 lines) and `style.css` are layered and are scheduled for a split in `docs/TECH-DEBT.md` (TD-U1..TD-U4, TD-T1, TD-P1, TD-P2). Do not start that split as a side effect of another task, and do not treat their current structure as the target pattern.

## Read next

`docs/ARCHITECTURE.md` for scope ownership, `docs/DATA-MODEL.md` for document shapes, `docs/RTC.md` for call UI lifecycle, `firestore.rules` for what a client write must satisfy.
