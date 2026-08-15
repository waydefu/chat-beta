---
paths:
  - "functions/src/bots/**"
  - "src/bots/**"
---

# Gemini execution path

Read `functions/src/bots/AGENTS.md` first — it owns the lease, replay, cancellation and grounding contracts in detail.

- Acquire the lease in a transaction before any provider call, and release concurrency in `finally`. A leaked lease locks the user out until it expires.
- IDs are deterministic (`${sourceMessageId}_gemini`). That is what makes a retry idempotent; never generate a random ID here.
- A cancelled run writes no final message, ever.
- The model name lives in `model-policy.ts` behind an allowlist. Do not hard-code it anywhere else, and do not trust a model name written in any document.
- Prompts, context, search queries, visited URLs and conversation text are never logged, never persisted, never returned in an error. Provider errors are classified into `AI_*` codes — the raw message quotes the user's chat.

Why: the callable itself has no test coverage (TD-A2/TD-A3), so these five invariants are held by review alone. Changing this path means reasoning through lease, replay and cancellation by hand and running a real-room smoke test before production.
