export const codeQualityReviewTemplate = `# Code Quality Review Skill

Perform a strict, engineering-grade quality review of the implementation after spec compliance has passed.

## Prerequisite

This skill assumes \`spec-compliance-review\` has already produced **PASS**. If not, stop and request spec compliance verification first.

## Review Contract

- Primary objective: prevent correctness, safety, and maintainability regressions from reaching merge.
- Evidence-first: every finding MUST include concrete location evidence (\`file:line\` or a clearly bounded code region).
- Risk-prioritized: focus on production-impacting issues before style or cosmetic comments.
- No speculative claims: if evidence is missing, emit a **Missing verification evidence** finding and treat it as blocking.

## Ambiguity Guardrails

1. Do not use vague wording like "looks fine" or "probably okay."
2. For each finding, state one explicit failure mode ("what can break in production").
3. Distinguish blocking vs non-blocking with explicit rules (see Severity and Blocking Rules).
4. If no issues are found, still state what was checked and what was not checked.

## Procedure

### Phase 1 — Preflight Context (BLOCKING)

1. Inspect \`git status -sb\`, \`git diff --stat\`, and \`git diff\`.
2. List changed files and the intent of each change.
3. Identify boundaries touched:
   - Public APIs
   - Config schema
   - Persistence formats
   - Tool surfaces / hooks
4. Mark high-risk paths (user input, filesystem, network, concurrency, auth, data writes).

Edge-case handling:
- **No diff handling**: if \`git diff\` is empty, report no active changes and ask whether to review staged changes or a commit range.
- **Large diff handling (>500 LOC changed)**: summarize by module first, then review in feature batches.
- **Mixed concerns handling**: group findings by concern/feature, not just file order.

### Phase 2 — Architecture & SOLID Review

Evaluate with concrete examples:

- **SRP**: unrelated responsibilities mixed in one unit
- **OCP**: new behavior requires editing core branching logic repeatedly
- **LSP**: subtype behavior breaks caller assumptions
- **ISP**: broad interfaces with unused/stubbed members
- **DIP**: high-level policy directly coupled to low-level implementation
- Additional smells: long methods, duplicated logic, speculative abstractions, dead code

For non-trivial refactor suggestions, propose incremental steps instead of a full rewrite.

### Phase 3 — Security / Safety / Reliability Review

1. **Type Safety**
   - No unsafe casts, \`any\`, \`@ts-ignore\`, \`ts-expect-error\` without justification.
   - Boundary types are explicit and narrow.
2. **Security**
   - **Security long-tail scope boundary**: limit long-tail checks to changed files and directly impacted execution paths; list others in "Scope not reviewed".
   - No injection risks (command/SQL/NoSQL/template), path traversal, unsafe shell usage.
   - AuthN/AuthZ checks are present for sensitive operations.
   - No secret leakage in code/logs/config output.
   - **JWT & token hardening**: validate algorithm/issuer/audience/expiration; reject weak or misconfigured token flows.
   - **CORS and security headers**: avoid permissive credentialed CORS; ensure security headers are not weakened.
   - **Supply-chain and dependency risk**: flag unpinned or untrusted dependencies and known vulnerable packages.
   - **Cryptography safety**: avoid weak algorithms, static IV/salt misuse, and unauthenticated encryption patterns.
   - **Data integrity and idempotency**: detect missing transaction boundaries, partial-write risks, and non-idempotent retry paths.
3. **Reliability and Concurrency**
   - **Race conditions and TOCTOU**: detect check-then-act patterns, non-atomic read-modify-write, and missing lock/transaction boundaries.
   - External calls have bounded timeout/retry behavior.
4. **Error Handling**
   - Errors include context and are not silently swallowed.
   - No broad catch that hides root cause.
   - Async errors are propagated or handled intentionally.
5. **Tests**
   - Behavioral changes have tests.
   - Tests cover error paths and boundary cases where risk exists.
   - Tests are deterministic and scoped to changed behavior.
6. **Performance / Resource Usage**
   - Avoid unnecessary O(n^2), heavy I/O in hot paths, unbounded caches/collections.
   - Flag N+1 patterns and avoid unbounded memory growth.
7. **Maintainability**
   - Clear naming, minimal coupling, no duplicated logic, no hidden global state.
   - Public surfaces are documented where needed.

### Phase 4 — Boundary Conditions Review

Explicitly check:
- Null/undefined handling
- Empty collections
- Numeric boundaries (0, negative, max range, off-by-one)
- String boundaries (empty, whitespace-only, unbounded input length)

### Phase 5 — Removal / Simplification Candidates (Optional)

Identify:
- Safe-to-remove now (unused/redundant)
- Defer-with-plan (active consumers or migration needed)

When proposing removal, include impact and rollback notes.

### Phase 6 — Severity and Blocking Rules

- **P0 (critical, always blocking)**: correctness bugs, exploitable security issues, data loss/corruption risk.
- **P1 (high, usually blocking)**: major reliability/performance/test gaps likely to cause incidents.
- **P2 (non-blocking)**: maintainability issues, medium code smells, targeted refactor opportunities.

Blocking rule:
- If any finding is P0, verdict MUST be FAIL.
- If P1 findings exist and are unresolved, verdict SHOULD be FAIL unless explicitly downgraded with rationale.
- P2-only findings can be PASS_WITH_NITS.
- Missing verification evidence for required behavior MUST be treated as blocking.
- Final verdict MUST be FAIL when any required verification remains unproven.

Blocking field consistency:
- P0 => Blocking must be yes
- P2 => Blocking must be no
- P1 => Blocking should be yes unless a documented downgrade exists

### Phase 7 — Verdict

Produce one of:

- **PASS (merge-ready)**: no blocking issues.
- **PASS with nits**: only non-blocking issues remain.
- **FAIL**: at least one blocking issue (correctness/safety/test coverage).

## Output Format (MUST FOLLOW)

### Summary

- Verdict: PASS | PASS_WITH_NITS | FAIL
- Blocking issue count: <count>
- Non-blocking issue count: <count>
- Scope reviewed: <modules/files>
- Scope not reviewed: <explicit limitations>

### Findings (Prioritized)

For each finding:

- Severity: P0 | P1 | P2
- Blocking: yes | no
- Location: \`path/to/file.ts:line\`
- Issue: <1 sentence>
- Failure mode: <what can break>
- Why it matters: <impact + likelihood>
- Suggested fix: <concrete action>

### Clean Review Requirements (If No Findings)

- Checked areas: <list>
- Not checked: <list>
- Residual risk: <short statement>

### Follow-ups (Optional)

- Refactor candidates:
- Observability improvements:
- Test additions:
`
