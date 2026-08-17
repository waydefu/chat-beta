# Agent evals

Product tests answer *"does Chat Lite work?"*. These answer a different question:

> **Does an agent working in this repository follow its engineering process correctly?**

Keep them apart. A rubric about agent behaviour does not belong in `tests/`, and a projection test does not belong here.

## Two layers, and only one of them is proof

**Layer 1 — the deterministic contract.** `validate-evals.mjs` checks that every scenario is well formed: required fields present, ids unique and matching their filenames, enums valid, rubrics non-empty, and every repository path a scenario points at still exists. It runs locally and in CI, costs nothing, and needs no API key.

**Layer 2 — the behavioural scenarios themselves.** Reusable tasks that can be given to a coding agent, by hand today or by a runner later, and scored against the scenario's own rubric.

Layer 1 passing means the suite is **valid**. It does **not** mean any model passes it. Never report a schema-valid suite as a behavioural result — say `EVAL-HARNESS-VALID`, and say `LIVE-MODEL-EVAL: NOT_RUN` when no model was run.

## Commands

```bash
pnpm eval:harness      # validate every scenario
pnpm check:harness     # the whole agent harness, this included
```

## Adding a scenario

One JSON file per scenario in `scenarios/`, named for its id (`EVAL-07.json`). Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `EVAL-NN`, unique, matches the filename |
| `title` | string | what the scenario is about |
| `purpose` | string | the failure it exists to catch |
| `task_class` | string | one of the classes listed in `schema.json` |
| `input_scenario` | string | the situation put in front of the agent |
| `required_context` | string[] | repository paths the scenario depends on; validated to exist |
| `expected_behaviors` | string[] | what a passing agent does |
| `forbidden_behaviors` | string[] | what a failing agent does |
| `required_evidence` | string[] | what has to be in the transcript to score it |
| `pass_criteria` | string[] | the rubric for a pass |
| `fail_criteria` | string[] | the rubric for a fail |
| `applicable_agents` | string[] | from the agents list in `schema.json` |
| `notes` | string | optional |

Write them **generic**. A scenario naming one bug stops being a regression test the moment that bug is gone.

## Running Layer 2 by hand

Give an agent `input_scenario` in a session that has the repository's normal context, let it work, then score its transcript against `pass_criteria` and `fail_criteria`. Record: agent and model version, scenario id, the tool calls it made, the files it changed, its final claim, and the pass or fail.

## A future automated runner

There is no live runner here on purpose: the repository must stay validatable without a provider credential, and CI must not spend money on every push. A runner added later should capture agent/model/version, scenario id, the tool trace, files changed, the final claim, the rubric result, and token and wall-clock cost — and must never be allowed to write a result it did not actually observe.
