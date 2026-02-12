import type { BuiltinSkill } from "../types"

export const writingPlansSkill: BuiltinSkill = {
  name: "writing-plans",
  description:
    "Structured implementation planning. Use to produce an end-to-end plan with dependencies, risks, validation steps, and minimal clarifying questions. Triggers: plan, roadmap, steps, approach, design, architecture, how should we implement.",
  template: `# Writing Plans Skill

Write a precise implementation plan that is executable, testable, and risk-aware.

## Planning Rules

1. Ask clarifying questions ONLY when answers materially change correctness or major design choices.
2. When information is missing but not blocking, proceed with explicit assumptions.
3. Prefer a small number of strong options (1–3) with clear trade-offs.
4. Every plan step MUST have a verification action (test, command, observable behavior).
5. Every implementation step MUST include at least one \`Scenario Ref\` to map behavior intent to execution.

## Required Output Structure

### 1) Objective

State the goal in one sentence.

### 2) Constraints

List any hard constraints (language, package manager, formatting, compatibility, performance).

### 3) Key Assumptions

List assumptions you are making to proceed.

### 4) Options (1–3)

For each option:

- Summary
- Scope impact (modules/files/surfaces)
- Pros / Cons
- Risks
- Validation plan

### 5) Recommended Approach

Pick one option and justify briefly.

### 6) Execution Plan (Atomic Steps)

Provide 5–12 steps. Each step MUST include:

- What changes
- Where (file/module)
- Scenario Ref (e.g., S-001, S-002)
- How to verify
- Negative verification (one failure-path check)

### 7) Rollback / Safety

Describe how to revert safely and what to avoid (data loss, breaking changes).
`,
}
