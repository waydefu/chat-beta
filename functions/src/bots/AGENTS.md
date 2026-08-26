# AGENTS.md — `functions/src/bots/` (Gemini execution path)

The only AI execution path in the product. `functions/AGENTS.md` server rules apply here too.

## Canonical files

| File | Owns |
| --- | --- |
| `gemini.ts` | The `generateGeminiReply` callable: lease, context, streaming, drafts, final transaction, error mapping — the whole execution path |
| `context-builder.ts` | What context is sent; verifies the source message and its bot mention |
| `model-config.ts` / `model-policy.ts` | Model resolution: Remote Config `gemini_model` filtered through a closed allowlist, with a pinned fallback |
| `gemini-request-config.ts` | `countTokens` and `generateContentStream` config, including the `googleSearch` tool |
| `grounding-policy.ts` | Normalizes and caps grounding sources; decides `usedSearch` |
| `rate-limit.ts` | Per-user/per-room windows and concurrency leases |
| `framework.ts` / `bot-registry.ts` / `bot-routing.ts` | Bot identity, permission and mention matching |
| `ai-errors.ts` | Provider-error classification and the user-facing message table |
| `draft-policy.ts` / `draft-cleanup.ts` | Draft expiry and the scheduled sweep |

Client side: `src/bots/providers/gemini-provider.ts` (streaming callable) and `src/bots/grounding.view.ts` (source rendering).

## Invocation contract

- A bot runs only when the source message carries a structured mention `{ type: 'bot', id: 'gemini' }` — checked by `hasBotMention`. The client builds that array in `src/messages/message.service.ts`; both sides must stay consistent.
- Only the message's own sender may request a reply for it (`context-builder.ts` enforces `senderId === requesterUid` and `senderType === 'user'`).
- `runId` is `${sourceMessageId}_gemini`. The final message ID is `ai_${runId}`. Both are deterministic — that is what makes retries idempotent. Never generate a random ID here.
- The ledger is `rooms/{roomId}/aiRequests/{runId}`: status, attempt, lease, model, usage, latency, `finalMessageId`, `failureCategory`. Client-readable, server-only writable.

## Lease, replay and cancellation

- Acquire the lease in a Firestore transaction before any provider work. `status: 'complete'` → return the replayed result without calling the provider. `status: 'running'` with an unexpired `leaseExpiresAt` → `AI_ALREADY_RUNNING`. An expired lease is re-acquirable with an incremented attempt.
- Cancellation: the client's `AbortSignal` reaches `response.signal`, which aborts the provider `AbortController`. On cancel, mark the draft and ledger `cancelled` and write NO final message. A cancelled run must never leave a permanent message.
- The completion transaction re-checks `status !== 'complete'` and writes final message + ledger + room `lastMessage` together. Never split it.
- Release concurrency in `finally`. A leaked concurrency lease blocks the user until it expires.

## Data ownership

- Streaming chunks go to the requester via `sendChunk`, and to the room as an RTDB draft at `realtime/rooms/{roomKey}/aiDrafts/{runId}` (throttled: ≥1s or ≥256 new characters). Drafts are ephemeral, carry `expiresAt`, and are client-read-only.
- Firestore stores the final message only — never chunks, never drafts.
- Prompts and full context are never written to the ledger, to logs, or to any durable store.

## Model selection

Read `model-policy.ts` for the current pinned model and allowlist; do not hard-code a model name anywhere else, and do not assume the value in this file or in any document is current. Remote Config `gemini_model` overrides the pin only when the value is on the allowlist; an off-list value falls back and logs a warning. Adding a model means editing the allowlist — not bypassing it.

## Context and token budget

- Default context is the most recent 20 non-deleted user/bot text messages; a reply pulls in its target plus nearby messages; prompts matching the "summarize/today" heuristic widen to 200.
- Context never crosses room boundaries. Every query is scoped to `rooms/{roomId}/messages`.
- Before generating, `countTokens` runs and the oldest context is trimmed until the request fits the input-token budget defined in `gemini.ts`. Still over budget → `AI_CONTEXT_TOO_LARGE`. Never send an untrimmed request.

## Grounding and privacy

- Google Search grounding is enabled as a tool; the model decides when to use it.
- `mergeGroundingSources` is a pure function: dedupe, require http/https, cap the title length, cap the source count. Persist grounding only when search was actually used and at least one valid source survived.
- Persisted shape: `metadata.grounding = { usedSearch: true, sources: [{ title, url }] }` on the final message.
- MUST NOT log or persist the search query, visited URLs, page titles beyond the stored source list, or conversation text. Logs carry `groundingUsed` and `groundingSourceCount` only.

## Rate limiting

`rate-limit.ts` holds transactional per-user and per-room windows plus concurrency leases in `rateLimits/*` and `aiConcurrency/*`. Both are server-only collections. Read the file for current values; changing a limit means changing it there, with a test. Exhaustion is `resource-exhausted` with a zh-TW message — never a silent drop.

## Errors

Classify with `classifyProviderError` and return the `AI_*` domain code in `HttpsError.details.code` plus the fixed message from `aiErrorMessage`. Never re-throw the provider error: its message and details quote the user's chat content.

## Validation

```bash
pnpm test:functions
node node_modules/typescript/bin/tsc -p functions/tsconfig.json
```

Policy modules have unit coverage (`model-policy`, `grounding-policy`, `draft-policy`, `bot-routing`, `ai-errors`, `gemini-request-config`, `bot-framework`). `context-builder.ts` and `rate-limit.ts` gained theirs in TD-A3, on top of `functions/tests/helpers/firestore-fake.ts` — an in-memory Firestore that buffers transaction writes until commit and drops documents missing the ordered field, because both behaviours change what the code under test sees. Extend that fake rather than mocking Firestore a second way.

The `generateGeminiReply` callable itself still has none — tracked as TD-A2 in `docs/TECH-DEBT.md`. Changing it means reasoning about lease, replay, cancellation and concurrency release by hand, and a real-room smoke test (streaming, cancel, usage metadata, rate limit, provider error) before production.

## Read next

`docs/AI-BOT-FRAMEWORK.md` (contract and grounding overview), `docs/SECURITY.md` §AI privacy, `docs/FEATURE-ENABLEMENT.md` §7 (enablement gates).
