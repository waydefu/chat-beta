---
name: debug-symptom
description: Systematic debugging for this repository — classify the symptom, reproduce it, find the earliest incorrect state, then fix the smallest thing. Use for any reported misbehaviour in presence, typing, calls, push, offline state, message rendering or perceived latency.
---

# Debug a symptom

A symptom names a place a user noticed something, not the place that is wrong. In this repository most reported "UI bugs" are state, lifecycle or timing bugs, and patching the render path makes the real defect permanent and invisible.

## 1. Classify before reading code

Decide which of these you are looking at, and write it down. If two seem to fit, you do not understand the symptom yet.

| Class | Signature | Look at |
| --- | --- | --- |
| Presentation | state is right, pixels are wrong | renderer, CSS, the row update path |
| State model | the stored shape cannot express the truth | the projection or store, and its inputs |
| Lifecycle / ownership | correct at first, wrong after switching room, reconnecting, or backgrounding | which scope owns the subscription or timer |
| Staleness | correct once, never updated again | is there a heartbeat, an expiry, a sweep? |
| Latency — perceived | correct eventually, feels slow | what the UI waits for before acknowledging |
| Latency — actual | a stage genuinely takes long | per-stage timings, provider vs. own code |
| Authorization | works for one account, not another | canonical membership, Rules, App Check gate |
| Config / rollout | works locally, not in production | deployed function list, secrets, enforcement flags, CSP, cache headers |

## 2. Reproduce deterministically

Name the exact preconditions: which account, which room, which tab, online or offline, cold or warm start, which viewport. A bug you cannot trigger on demand cannot be verified as fixed. If it needs two accounts or a real provider, say so now — that decides the claim level later.

## 3. Find the earliest incorrect state

Walk backwards from the symptom to the first observation that is already wrong. Prefer reading the state itself over reading the render: the store contents, the RTDB node, the Firestore document, the ledger, the call document. Stop at the first place where the value is wrong rather than the first place it is visible.

State it explicitly before proposing a fix: *the earliest incorrect state is X, at time Y, caused by Z.* If you cannot fill that sentence in, keep going — you have a correlation.

## 4. Fix the smallest thing that makes the earliest state correct

- Fix the cause, not the display of the cause.
- Do not add a second implementation next to the broken one, do not add a defensive branch that hides the state, and do not widen a Rule or drop a lease to make it pass.
- Touch one subsystem. If the fix wants to span client, Functions and Rules, stop and re-plan as a cross-layer change.

## 5. Prove it

Add a regression test at the layer where the state was wrong, not at the layer where it was visible — a projection bug gets a projection test, a Rules bug gets a Rules test. Then run `/verify-change`.

## 6. If this bug is part of a closeout, hand the result back

"Smallest fix" scopes the **diff**, not the task. When `/debug-symptom` is running inside a `/closure-audit`, finishing here means:

- record the outcome on the closure matrix row — root cause, fix, regression test, claim level;
- run the sibling search for this defect's failure class if the closeout has not already done it, because a single fix is exactly where an equivalent second occurrence hides;
- return to the closure matrix and continue.

Do not treat the fix, the PR, or the merge as the end of the task. The closeout ends at its own stop condition, not at this one.

## 7. Route the lesson, do not hoard it

Bug-specific knowledge does not belong in `CLAUDE.md`. Route it: an architectural fact to `AGENTS.md`, an area invariant to `.claude/rules/`, unfinished work to `docs/TECH-DEBT.md` with an acceptance condition, and anything a machine can check to a test or a hook. Most single bugs need no permanent rule at all.

## Completion evidence

Report: the class, the reproduction steps, the earliest incorrect state in one sentence, the diff's scope, the regression test, and the claim level from `/verify-change`.
