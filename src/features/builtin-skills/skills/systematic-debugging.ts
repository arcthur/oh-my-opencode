import type { BuiltinSkill } from "../types"

export const systematicDebuggingSkill: BuiltinSkill = {
  name: "systematic-debugging",
  description:
    "Hypothesis-driven debugging workflow. Use when investigating failures, flakes, regressions, or unexpected behavior. Produces ranked hypotheses, experiments, root-cause fix, and verification. Triggers: bug, error, failing test, regression, flake, doesn't work, investigate.",
  template: `# Systematic Debugging Skill

Debug by evidence and hypotheses, not by random edits.

## Non-Negotiable Rules

1. Do not change code before you can **reproduce or isolate** the failure signal.
2. Maintain a short list of **ranked hypotheses** (1–3). Test them one by one.
3. After each experiment, record the observation and update the hypothesis ranking.
4. Prefer minimal fixes that address the root cause; avoid broad refactors during debugging.

## Procedure

### Phase 1 — Capture the Failure (BLOCKING)

- What is failing? (error message, stack trace, failing test name)
- How to reproduce? (command, environment, inputs)
- What changed recently? (files/commits/config)

If reproduction is not possible, switch to isolation:
- Reduce to the smallest failing unit (single test, minimal input, isolated module).

### Phase 2 — Hypotheses (RANKED)

List 1–3 hypotheses with evidence and expected observations.

### Phase 3 — Experiments (ONE AT A TIME)

For each hypothesis, define:

- Experiment: exact command/tool action
- Expected: what you should observe if the hypothesis is true
- Observed: what actually happened

### Phase 4 — Fix (MINIMAL)

Implement the smallest change that resolves the proven root cause.

### Phase 5 — Regression Guard

Add or update a test to prevent recurrence (when appropriate).

### Phase 6 — Verification

Run the reproduction steps + relevant test suites and summarize results.

## Output Format (MUST FOLLOW)

### Failure Signal

- Symptom:
- Repro command:
- Environment:

### Hypotheses

| Rank | Hypothesis | Evidence | Experiment | Status |
|------|------------|----------|------------|--------|
| 1    | ...        | ...      | ...        | open/ruled-out/confirmed |

### Fix

- Root cause:
- Patch summary:
- Regression test:

### Verification

- Commands:
- Results:
`,
}

