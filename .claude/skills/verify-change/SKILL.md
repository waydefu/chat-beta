---
name: verify-change
description: Choose and run the minimum verification gate for a change in this repository, then state an explicit claim level. Use before calling any change done, and whenever you are about to report that something works.
---

# Verify a change

Purpose: turn "I think this is done" into evidence plus one honest claim. A green gate proves the gate ran, not that production is correct.

## 1. Enumerate what actually changed

```bash
git status --short
git diff --name-only main...HEAD
```

Verify the change you made, not the change you intended. If a file you did not mean to touch appears, resolve that first — it may belong to another agent's branch.

## 2. Pick the gate

Use the Validation Matrix in `AGENTS.md` (already in context) and take the row for the highest-consequence surface you touched. Do not run the whole suite for a one-line change, and do not run only the narrow gate for a cross-layer one.

Two things the matrix cannot tell you:

- **Run it from the repository root.** Every script invokes tools as `node node_modules/...` on purpose. Keep that form.
- **`pnpm test:rules` needs Java 21 and the emulators.** If it cannot run here, the change is not verified — say so, do not substitute a different gate.

## 3. Run it and keep the output

Paste the real output: the command, the pass/fail counts, the exit status. A summary you wrote from memory is not evidence. If a gate fails, fix the cause; never weaken a Rule, a lease, a transaction or an assertion to make a gate pass.

## 4. Know what your evidence cannot prove

| Layer | Proves | Does not prove |
| --- | --- | --- |
| `typecheck` / `lint` | shapes and style | any runtime behaviour |
| unit tests | pure policy and projection logic | anything crossing a process boundary |
| Functions tests | server decision logic | the callable's lease, replay or cancellation wiring |
| Rules tests | what a client may read and write | what the Admin SDK does |
| Playwright | signed-out surface, focus order, axe | signed-in, multi-user, media, or real providers |
| `build` | bundle budget and chunk boundaries | that the shipped bundle behaves |

Real providers (LiveKit, FCM, R2, Gemini, Algolia), multi-user races, reconnects, permission prompts, background tabs and production config are provable only in a protected staging or production smoke — see `docs/RTC.md`, `docs/TESTING.md` and `docs/FEATURE-ENABLEMENT.md`.

## 5. Add the regression test

Any deterministic bug you fixed gets a test that fails before the fix and passes after. If the logic is not reachable by a test, extract it into a policy or projection module until it is. If you genuinely cannot, say which invariant is now held by review alone.

## 6. Close with exactly one claim

- **VERIFIED** — gate run here, output pasted, and it covers the behaviour that changed.
- **CODE-ONLY** — it compiles and the unit gates pass, but nothing exercised the changed behaviour.
- **MANUAL-VERIFICATION-REQUIRED** — list the exact steps, accounts, devices and viewports someone must run.
- **BLOCKED** — name what stopped you and what you need.

## Completion evidence

The task is not done until your report contains: the command you ran, its output, the claim level, and — where the claim is not VERIFIED — the specific gap that keeps it from being VERIFIED.
