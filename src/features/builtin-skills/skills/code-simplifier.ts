import type { BuiltinSkill } from "../types"

export const codeSimplifierSkill: BuiltinSkill = {
  name: "code-simplifier",
  description:
    "Behavior-preserving simplification pass. Use after correctness and quality checks to reduce complexity, improve naming, and remove redundancy while keeping diffs minimal. Triggers: simplify, cleanup, refactor lightly, reduce complexity, make readable, remove duplication.",
  template: `# Code Simplifier Skill

Simplify code for clarity while preserving behavior and keeping the diff reviewable.

## Guardrails

1. **No behavior change** unless explicitly requested.
2. **No large rewrites.** Prefer small refactors with tight blast radius.
3. Maintain existing public APIs, persistence formats, and config surfaces.
4. Reduce complexity while avoiding “architecture astronaut” abstractions.

## Simplification Heuristics (Apply Selectively)

- Extract small pure functions for repeated logic.
- Rename for intent (avoid ambiguous names, reduce mental load).
- Replace nested conditionals with early returns.
- De-duplicate error handling and validation logic.
- Prefer clear types over clever generics.
- Remove dead code and unreachable branches (only if proven).

## Procedure

### Phase 1 — Identify Hotspots

Locate:
- Long functions (too many responsibilities)
- Deep nesting
- Duplicate blocks
- Confusing state transitions

### Phase 2 — Apply Minimal Refactors

For each change:
- State the intent (“reduce nesting”, “dedupe validation”, “improve naming”).
- Keep changes mechanically safe (small, incremental).

### Phase 3 — Verify

Run the same verification suite used for the original change set (tests, typecheck, lint).

## Output Format

### Summary

- What was simplified:
- What was NOT changed (behavior, APIs):

### Key Changes (by file)

- \`path/to/file.ts\`: <1 sentence>

### Verification

- Commands:
- Results:
`,
}

