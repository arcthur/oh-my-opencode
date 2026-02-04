import type { BuiltinSkill } from "../types"

export const codeQualityReviewSkill: BuiltinSkill = {
  name: "code-quality-review",
  description:
    "Post-implementation code quality review. Use after spec compliance passes to check type-safety, error handling, tests, maintainability, and risk. Produces prioritized findings with file:line evidence and a merge-readiness verdict. Triggers: code review, quality gate, refactor suggestions, harden, cleanup.",
  template: `# Code Quality Review Skill

Perform a strict, engineering-grade quality review of the implementation after spec compliance has passed.

## Prerequisite

This skill assumes \`spec-compliance-review\` has already produced **PASS**. If not, stop and request spec compliance verification first.

## Review Principles

- Prefer **correctness and maintainability** over micro-optimizations.
- Findings MUST be tied to concrete evidence: file path + line number (or clearly identified code region).
- Avoid “style nits” unless they materially affect readability, safety, or consistency.

## Procedure

### Phase 1 — Context Collection (FAST)

1. List changed files and the intent of each change.
2. Identify boundaries touched: public APIs, config schema, persistence formats, tool surfaces, hooks.
3. Determine the highest-risk paths (user input, filesystem, network, concurrency).

### Phase 2 — Checklist Review (SYSTEMATIC)

Evaluate each dimension and record evidence:

1. **Type Safety**
   - No unsafe casts, \`any\`, \`@ts-ignore\`, \`ts-expect-error\` without justification.
   - Boundary types are explicit and narrow.
2. **Error Handling**
   - Errors include context and are not silently swallowed.
   - Retries/backoff are bounded and observable.
3. **Tests**
   - Behavioral changes have tests.
   - Tests are deterministic and minimal.
4. **Performance**
   - Avoid unnecessary O(n^2), heavy IO in hot paths, unbounded caches.
5. **Security / Safety**
   - No command injection, path traversal, unsafe filesystem writes.
   - Destructive operations are gated and reversible where possible.
6. **Maintainability**
   - Clear naming, minimal coupling, no duplicated logic, no hidden global state.
   - Public surfaces are documented where needed.

### Phase 3 — Verdict

Produce one of:

- **PASS (merge-ready)**: no blocking issues.
- **PASS with nits**: only non-blocking cleanup suggestions.
- **FAIL**: at least one blocking issue (correctness/safety/test coverage).

## Output Format (MUST FOLLOW)

### Summary

- Verdict: PASS | PASS_WITH_NITS | FAIL
- Blocking issues: <count>
- Non-blocking issues: <count>

### Findings (Prioritized)

For each finding:

- Severity: P0 (blocking) | P1 (important) | P2 (nit)
- Location: \`path/to/file.ts:line\`
- Issue: <1 sentence>
- Why it matters: <1 paragraph>
- Suggested fix: <concrete action>

### Follow-ups (Optional)

- Refactor candidates:
- Observability improvements:
- Test additions:
`,
}

