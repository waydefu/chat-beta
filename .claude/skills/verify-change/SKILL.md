---
name: verify-change
description: Establish the strongest honest claim about a change from the freshest evidence available, running only the gates that are missing or stale. Use before calling any change done, and whenever you are about to report that something works.
---

# Verify a change

This is an **evidence claim procedure**, not a second test phase. Its output is one honest sentence about what is now known, backed by evidence that already exists or that this run produces because it did not.

A green gate proves the gate ran. It does not prove production is correct.

## 1. Enumerate what actually changed

```bash
git status --short
git diff --name-only main...HEAD
```

Verify the change you made, not the change you intended. A file you did not mean to touch is resolved first — it may belong to another agent's branch.

## 2. Name the evidence each surface requires

Take the Validation Matrix in `AGENTS.md` (already in context) and read off the row for the highest-consequence surface you touched. That gives the required gates. Two things the matrix cannot tell you:

- **Run from the repository root.** Every script invokes tools as `node node_modules/...` on purpose. Keep that form.
- **`pnpm test:rules` needs Java 21 and the emulators.** If it cannot run here, the change is not verified — say so; do not substitute a different gate.

## 3. Classify each required gate before running anything

| Class | Means | Do |
| --- | --- | --- |
| **FRESH** | it ran, on this code, on a surface nothing has touched since | reuse it — cite the run |
| **MISSING** | no evidence exists | run it |
| **STALE** | it ran, but a later change touched a surface it covers | run it |

Then run **only** the MISSING and STALE ones.

Freshness is a property of the surface, not of the clock. Editing Markdown does not make a unit run stale. Editing a module the run covered does. When you cannot tell whether a change invalidated a gate, it is STALE.

This step is what replaces "run everything again at the end". Re-running an unchanged green gate produces no new information — it only makes the report longer and the loop slower.

## 4. Run what is missing, and keep the output

Paste the real output: the command, the pass/fail counts, the exit status. A summary written from memory is not evidence. If a gate fails, fix the cause; never weaken a Rule, a lease, a transaction or an assertion to make a gate pass.

## 5. Add the regression test

Any deterministic bug you fixed gets a test that **fails before the fix and passes after** — check that, do not assume it. If the logic is not reachable by a test, extract it into a policy or projection module until it is. If you genuinely cannot, say which invariant is now held by review alone.

## 6. Know what your evidence cannot prove

| Layer | Proves | Does not prove |
| --- | --- | --- |
| `typecheck` / `lint` | shapes and style | any runtime behaviour |
| unit tests | pure policy and projection logic | anything crossing a process boundary |
| Functions tests | server decision logic | the callable's lease, replay or cancellation wiring |
| Rules tests | what a client may read and write | what the Admin SDK does |
| Playwright | signed-out surface, focus order, axe | signed-in, multi-user, media, or real providers |
| `build` | bundle budget and chunk boundaries | that the shipped bundle behaves |
| a green deploy workflow | the command exited 0 | that an index finished building, or a scheduler recovered |

Real providers (LiveKit, FCM, R2, Gemini, Algolia), multi-user races, reconnects, permission prompts, background tabs and production config are provable only in a protected staging or production smoke — see `docs/RTC.md`, `docs/TESTING.md` and `docs/FEATURE-ENABLEMENT.md`.

**Never infer production correctness from local tests.** No number of green unit tests raises a claim above CODE-ONLY for behaviour that only exists against a real provider or a second account.

## 7. Close with exactly one claim

- **VERIFIED** — the gate ran, its output is pasted, and it covers the behaviour that changed.
- **CODE-ONLY** — it compiles and the unit gates pass, but nothing exercised the changed behaviour.
- **MANUAL-VERIFICATION-REQUIRED** — list the exact steps, accounts, devices and viewports someone must run.
- **BLOCKED** — name what stopped you and what you need.

## What this skill forbids

- **No verifier subagent.** Never spawn an agent to review, double-check or independently repeat what you just did. It re-derives context you already hold, and its agreement is not evidence.
- **No unchanged full-suite re-run.** If the suite was green and nothing it covers has changed, it is FRESH. Cite it.
- **No "one more check" loop.** If a gate would tell you something new, it was MISSING or STALE and step 3 already scheduled it. If it would not, do not run it.

Rigour is knowing which evidence is stale. Repetition is what gets done instead when you do not.

## Completion evidence

The task is not done until your report contains: which gates were FRESH (and where they ran), which were MISSING or STALE, the output of the ones you ran, the claim level, and — where the claim is not VERIFIED — the specific gap that keeps it from being VERIFIED.
