import type { BuiltinSkill } from "../types"

export const specComplianceReviewSkill: BuiltinSkill = {
  name: "spec-compliance-review",
  description:
    "Post-implementation spec compliance verification. Use when you need a strict PASS/FAIL check against acceptance criteria, with file:line evidence and scope-creep detection. Triggers: verify spec, acceptance criteria, done check, ready to merge, pre-PR review, compliance.",
  template: `# Spec Compliance Review Skill

Perform a strict, evidence-based verification that the implementation matches the specification (acceptance criteria) and that no critical gaps are hidden behind vague “should work” claims.

## Non-Negotiable Rules

1. **No spec = no PASS.** If you cannot identify acceptance criteria, you MUST ask for them or derive them explicitly from the user’s request and label them as “derived”.
2. **No evidence = FAIL/UNKNOWN.** Every criterion MUST have evidence (file path + line, and/or command output, and/or deterministic reasoning).
3. **Do not infer.** If a criterion depends on runtime behavior you cannot observe, mark it as **UNKNOWN** and request the missing verification step.
4. **Scope creep is a finding.** Add a section listing changes not justified by the spec.

## Inputs You Need (Gather First)

- **Spec source**: ticket text, PR description, design doc, plan, or the user’s request.
- **Acceptance criteria**: explicit list (if not present, you must construct and label a derived list).
- **Changed files**: use git diff if available; otherwise list files touched during the task.
- **Verification commands** (if applicable): build/test/lint commands for the repo.

## Procedure (State Machine)

### Phase 1 — Establish the Spec (BLOCKING)

1. Identify the spec source (link/file/quoted text).
2. Extract acceptance criteria into an ordered list.
3. If criteria are ambiguous, ask the minimum questions needed to make them testable.

**Stop condition**: Do not proceed until you have a numbered list of criteria.

### Phase 2 — Map Evidence (SYSTEMATIC)

1. Enumerate changed files (preferred: \`git diff --name-only\` and \`git diff\`).
2. For each criterion:
   - Locate the implementation (file path + line number).
   - Explain how the code satisfies the criterion.
   - If verification requires execution, list the exact command(s) that MUST be run.

### Phase 3 — Run Verification (WHEN POSSIBLE)

If the repo has known commands, run them:

- Diagnostics / typecheck / lint (language-specific)
- Unit/integration tests
- Build (if relevant)

If you cannot run them, state that explicitly and downgrade relevant criteria to **UNKNOWN**.

### Phase 4 — Scope Creep and Regression Risk

- List changes that are not clearly tied to a criterion.
- Identify any behavior that may have changed unintentionally (APIs, config, defaults, performance).

### Phase 5 — Verdict (STRICT)

- **PASS** only if all criteria are **PASS** and verification is complete (or not required).
- Otherwise **FAIL** (or **PASS with remaining tasks** only when the remaining items are explicitly non-blocking and accepted by the user).

## Output Format (MUST FOLLOW)

### Spec Source

- Source: <link/file/quote>
- Criteria type: explicit | derived

### Acceptance Criteria Checklist

| # | Criterion | Status (PASS/FAIL/UNKNOWN) | Evidence (file:line / command output) | Notes |
|---|----------|-----------------------------|----------------------------------------|-------|
| 1 | ...      | ...                         | ...                                    | ...   |

### Scope Creep

- <change> — why it is out-of-scope / why it is justified

### Verification Summary

- Commands run: <list> (or “not run”)
- Results: <pass/fail/unknown>

### Final Verdict

PASS | FAIL | UNKNOWN
`,
}
