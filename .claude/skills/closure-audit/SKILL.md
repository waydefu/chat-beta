---
name: closure-audit
description: Run a bounded closeout — release preflight, production correctness closure, or "find everything related before implementing". Use when the task is to close a set rather than fix a symptom, when a phase gate has to be declared ready or blocked, or when a previous session left siblings of a fixed bug unresolved.
---

# Closure audit

A closeout owns a **set**, not a symptom. Fixing the first defect does not complete a closeout task, and neither does merging the first PR.

The failure this exists to prevent has a shape: one symptom is found, the smallest fix ships, the sibling occurrence is registered as debt, the session ends — and the next session discovers the root-cause analysis was incomplete and the registered debt was the same bug all along. Each step was defensible. The sequence was not.

## Entry conditions

Use this when at least one holds:

- a phase or release gate has to be declared **READY** or **BLOCKED**;
- more than one known defect shares a surface, an owner or a failure class;
- a previous session's fix left a registered sibling;
- the task says "close out", "preflight", "audit", "finish", or names several items at once.

Do **not** use it for a single scoped bug. That is `/debug-symptom`.

## 1. Establish the baseline before reading any code

Remote and production are authoritative; the last session's notes are not. Collect, and write down, the actual values:

remote HEAD · working-tree state · open PRs · latest CI on the default branch · latest production deployment and the commit it shipped · commits between that commit and HEAD.

If the branch advanced, read every intervening change before continuing. A closeout that starts from a stale baseline re-fixes what is already fixed and misses what changed.

## 2. Discovery freeze

Do not edit product or config code yet. Build the closure matrix first, one row per candidate item:

| Column | Holds |
| --- | --- |
| ID | the debt row, or a new local id |
| Symptom | what is observably wrong |
| Evidence + class | see below |
| Earliest incorrect state | one sentence, or blank if not yet known |
| Failure class | the *category* of defect, not its location |
| Affected surfaces | files, functions, stores |
| Siblings checked | result of step 4 |
| Fix / test / deploy / production-evidence / docs required | yes or no |
| Status | one of the values below |

Status is one of: `CONFIRMED`, `NOT_REPRODUCED`, `NOT_APP_DEFECT`, `EXTERNAL`, `FIXED_LOCAL`, `DEPLOYED`, `VERIFIED_PRODUCTION`, `CLOSED`.

Declare **DISCOVERY_FREEZE** only once every row exists. New evidence still gets added later — a freeze is not a blindfold — but the task stops being redesigned around each new log line.

## 3. Report everything first, filter second

During discovery, collect every credible related finding **before** judging any of it. Suppressing a minor-looking signal early is how the second occurrence gets missed. Only once the list is complete, classify each by severity, scope, confidence, fixability and whether it blocks the gate.

Label the evidence behind every claim, and never present the weaker as the stronger:

| Class | Means |
| --- | --- |
| OBSERVED | it is in a log, a console, a UI |
| MEASURED | a number came from an instrument |
| CODE-PROVEN | the source and the config say so, read together |
| PROVIDER-DOCUMENTED | the vendor requires it |
| INFERRED | it follows from the above, but was not itself seen |
| UNKNOWN | say so |

Two measured boundaries with a gap between them do not measure the gap. That is INFERRED until something instruments it.

Never write a definitive production root cause into a canonical document before the evidence supporting it exists.

## 4. Same-failure-class audit

Every confirmed defect earns exactly one bounded sibling search, **before** implementing its fix:

> Where else can this exact failure class occur?

Search the same failure class, the same architectural boundary, the same ownership mechanism — not the whole repository. Record the result on the row, including "searched, none found".

**Do not knowingly fix one occurrence and leave an equivalent sibling broken.** If the search finds a pattern that a machine could check, that is a signal the check belongs in the repository — see step 8.

## 5. Scope freeze

Write down what is in and what is out. Then hold it.

An unrelated improvement discovered in passing is recorded and out-scoped with its severity and why it is unrelated; it does not become part of the closeout. A *related* defect inside the audited surface is the opposite case — see step 7.

## 6. Implement in batches, gate each batch immediately

After each batch, run the smallest deterministic gate that actually covers it. Not the full suite; not nothing. If that gate fails, fix it before stacking anything else on top — discovering at the end that an early change was broken costs the whole tail of the work.

## 7. No register-only escape

If a newly found defect is inside the audited scope, safely fixable, and not blocked by an external migration or safety prerequisite, **fix it in this closeout**.

Appending a new debt row and stopping is allowed only when the item is genuinely external, genuinely out of scope, or blocked by a stronger safety boundary. "It was not in the original list" is not a reason when it belongs to the same surface being audited.

## 8. Prefer a machine check to a written lesson

A lesson that a test, a hook or a validator could enforce belongs there instead of in prose. Every validator or guard added this way ships with both positive and negative cases, or a validator that has quietly become permissive will still pass.

## 9. Evidence freshness, not repetition

Keep a ledger: command, surface, commit, result, fresh or stale. Evidence goes stale only when a later change touches a surface that could invalidate it.

Run the full canonical validation matrix **once**, against the final implementation commit. Afterwards re-run only what later changes invalidated. A documentation-only change does not invalidate a product gate.

Do not run: verify → verify again unchanged → second review → another full suite → one more check. Redundant re-verification is not rigour; it is the absence of a freshness model.

## 10. Do not spawn a verifier

Never create a subagent whose job is to review, double-check, challenge or re-run what you already did. It cannot see what you saw, it re-derives the context you already hold, and its agreement is not evidence. Subagents are for genuinely independent, sizeable exploration — and they return findings, never conclusions.

## 11. Production evidence where the claim needs it

Local gates cannot prove multi-user, provider, reconnect, permission-prompt or deployed-config behaviour. Where a row's acceptance condition names production, the row stays open until production says so. Where the evidence needs a human — a second account, a device, a physical disconnect — collect **all** such needs into a single handover, once, at the end of autonomous work. Do not interrupt at the first one.

While waiting on an index build, a scheduler cycle or a long-running observation, do the rest of the closeout. Do not idle.

## 12. Multi-PR continuity

A closeout may span several pull requests. Split them on rollback boundaries — what would have to be reverted together — not on where the conversation paused.

**A merge is not a stop.** After each merge, return to the closure matrix.

## 13. Synchronize the canonical documents

When runtime truth changed, update the documents that assert it, and search for the same fact stated elsewhere. Record resolved items with root cause, fix, verification and production evidence; record disproven hypotheses as disproven rather than deleting them. Never leave two documents making opposite claims.

## Stop condition

Stop only when **all** of these hold:

- every row in the closure matrix reached a terminal status;
- required production evidence exists, or its absence is named as a blocker;
- the canonical documents agree with the code;
- the full validation matrix is green against the final commit.

Then declare exactly one outcome — **READY** or **BLOCKED** — and for BLOCKED name the blocker, why it blocks, what remains, and what human or external action would unblock it.

"Mostly ready", "probably fine" and "should work" are not outcomes.

## Completion evidence

Report: the closure matrix with final statuses, the evidence class behind each conclusion, the sibling-search results, the PRs and their merge state, the deployment and its rollout phase, the production evidence, the documents changed, and the single outcome.
