@AGENTS.md

# Claude Code operating contract

`AGENTS.md`, imported above, is the canonical answer to **what this repository is**: invariants, architecture, task routing, commands, validation matrix. It is shared with every agent. This file answers **how Claude Code works here**, and nothing else. On a fact, `AGENTS.md` wins; on a process, this file wins.

## Where the harness lives

| Surface | Holds | Loads |
| --- | --- | --- |
| `AGENTS.md`, plus nested copies in `src/`, `functions/`, `functions/src/bots/` | Architecture and invariants | root is imported at launch; nested ones you read on demand |
| `.claude/rules/*.md` | Per-area operating rules, each scoped by `paths:` | automatically, when you touch a matching file |
| `.claude/skills/*/SKILL.md` | Repeatable workflows: `/closure-audit`, `/verify-change`, `/debug-symptom`, `/ui-review` | on demand |
| `.claude/settings.json`, `.claude/hooks/` | Deterministic blocks: production deploy, credential mutation, history rewrite | every session started from the repository root |
| `.claude/evals/` | Agent-behaviour regression scenarios and their validator — process, not product | `pnpm eval:harness` |

Start Claude Code **in the repository root**. Project settings and hooks load only from the directory the session started in, so a session started from a parent directory runs with no guard hook and no permission rules. If you notice the working directory is above this file, say so before running anything destructive.

## Classify the task first

The class decides how much process the task earns. Getting this wrong in either direction is a defect.

| Class | Looks like | Process |
| --- | --- | --- |
| **Trivial** | typo, comment, copy string, doc wording | edit, run the narrowest gate, done — no plan, no exploration |
| **Scoped** | one module, one callable, one Rules case, one UI surface | read only the files Task Routing names, edit, `/verify-change` |
| **Cross-layer** | client + Functions + Rules together, lifecycle or ownership change, new subsystem | plan first, name the invariants at risk, then implement |
| **Audit / harness** | repository-wide review, changes under `.claude/` | repository-wide reading is allowed here, and only here |
| **Closeout / release-preflight** | close a *set*, declare a gate ready or blocked | `/closure-audit` — enumerate the set before implementing, and keep going after the first fix |

Re-classify when the task turns out to be bigger than it looked. Never open at Cross-layer for a one-line fix.

"One PR per concern" is a rollback boundary, not a session boundary. A closeout owns as many PRs as it has independently revertible concerns, and it continues until its closure set is exhausted — a merge is not a stop.

## Operating behaviour

- **Finish the task you were given.** A locally completed fix is not a completed task when the task named a set. Do not narrow scope because an item is hard, and do not widen it because an unrelated improvement was in view.
- **Routine engineering decisions are yours.** Ask only for what genuinely needs a human — a second account, a device, a credential, an irreversible choice. Batch those into one handover at the end of autonomous work rather than interrupting at the first one.
- **Evidence precedes the causal sentence.** Do not write a strong root cause before the evidence for it exists, and never report an inference in the language of measurement.
- **Do not verify yourself twice.** No subagent whose job is to review or repeat your work, no re-run of an unchanged green gate, no final double-check pass. `/verify-change` decides what is fresh, missing or stale — run only the last two.
- **Subagents are for independent, sizeable exploration only,** and they return findings, never conclusions. Zero is a normal number of them.
- **If a better approach exists, say so in a sentence and proceed** with the outcome that was asked for.

## Verification and how to claim it

A green gate proves the gate ran. It does not prove production is correct. Finish with `/verify-change` and exactly one claim:

- **VERIFIED** — you ran the gate and pasted its output.
- **CODE-ONLY** — typecheck and unit gates pass; no runtime evidence exists for the behaviour that changed.
- **MANUAL-VERIFICATION-REQUIRED** — a real provider, second account, device or production config is needed; list the exact steps.
- **BLOCKED** — name what stopped you.

Never write "should work", "looks correct", or derive production correctness from `pnpm check`.

## Debugging

For anything touching presence, typing, calls, push, offline state or perceived latency, a symptom is not a location: these read as UI bugs and are usually state, lifecycle or timing bugs. Use `/debug-symptom` — classify, reproduce, find the earliest incorrect state, then make the smallest fix and add the regression test. Do not patch the render path to hide a wrong state.

## Working alongside other agents

Codex, Gemini and Hermes branches also run in this repository.

- Dirty files you did not create are someone else's work in progress. Stop and report. Never `git reset --hard`, `git checkout -- <path>`, `git restore`, or `git clean` to get a clean tree — the guard hook blocks all four.
- Branch as `agent/<slug>`, one PR per concern. Never push to `main`, never force-push; the guard hook blocks both. Do not route around it.
- Check `gh pr list` before refactoring a file — two agents restructuring `chat.controller.ts` at once cannot be merged.
- Re-sync with `main` before merging, and resolve conflicts by reading both sides.

## Documentation conflicts

`AGENTS.md` sets the precedence: code wins. This is where the record goes — report it as `DOCUMENT-CONFLICT` in your summary and log it in the `DOCUMENT-CONFLICT` table at the end of `docs/TECH-DEBT.md`.

## Changing this harness

Before making any lesson permanent, route it — most lessons belong nowhere.

| The lesson is | Home |
| --- | --- |
| a one-off slip | nowhere |
| an architectural fact | `AGENTS.md`, root or nested |
| how to work anywhere in this repository | this file |
| true only inside one area | `.claude/rules/` with `paths:` |
| a procedure with steps and a completion condition | a skill |
| checkable by a machine | a hook, a test, or CI |

Every rule carries a one-line **why** so a later reader can retire it safely. Prefer the machine: a lesson a test, hook or validator could enforce belongs there rather than in prose, and every guard added ships with negative cases so it cannot pass by becoming permissive.

After editing anything under `.claude/`, run:

```bash
pnpm check:harness
```

That includes the agent evals in `.claude/evals/`, which check that an agent follows this repository's process — a different question from whether Chat Lite works. A valid eval suite is `EVAL-HARNESS-VALID`; it is not a model result, and no live model runner exists here.
