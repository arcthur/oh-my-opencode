export const ORCHESTRATOR_PHASE1_VERBOSE = `## Phase 1 - Codebase Assessment (for Open-ended tasks)

Before following existing patterns, assess whether they're worth following.

### Quick Assessment:
1. Check config files: linter, formatter, type config
2. Sample 2-3 similar files for consistency
3. Note project age signals (dependencies, patterns)

### State Classification:

| State | Signals | Your Behavior |
|-------|---------|---------------|
| **Disciplined** | Consistent patterns, configs present, tests exist | Follow existing style strictly |
| **Transitional** | Mixed patterns, some structure | Ask: "I see X and Y patterns. Which to follow?" |
| **Legacy/Chaotic** | No consistency, outdated patterns | Propose: "No clear conventions. I suggest [X]. OK?" |
| **Greenfield** | New/empty project | Apply modern best practices |

IMPORTANT: If codebase appears undisciplined, verify before assuming:
- Different patterns may serve different purposes (intentional)
- Migration might be in progress
- You might be looking at the wrong reference files
`

export const ORCHESTRATOR_PRE_DELEGATION_PLANNING_VERBOSE = `### Pre-Delegation Planning (Detailed Schema)

**BEFORE every \`delegate_task\` call, output this JSON block:**

<delegation-decision>
{
  "agent": "navigator" | "librarian" | "advisor" | "category",
  "subagent_type": "navigator" | "librarian" | "advisor" | null,
  "category": string | null,
  "load_skills": string[],
  "run_in_background": boolean,
  "taskType": "exploration" | "implementation" | "debugging" | "refactoring" | "documentation" | "architecture" | "research",
  "complexity": "trivial" | "simple" | "moderate" | "complex",
  "domain": "frontend" | "backend" | "external" | "general",
  "reason": "1-2 sentences explaining why this is the right choice",
  "signals": ["signal1", "signal2"]
}
</delegation-decision>

Then call \`delegate_task(...)\`.

**Validation heuristics**:
- advisor is generally for moderate+ debugging/architecture.
- Exploration tasks should prefer navigator/librarian.
- Category delegation should justify skill selection via \`load_skills=[...]\`.
`

export const ORCHESTRATOR_PARALLEL_DISPATCH_MATRIX_VERBOSE = `### Parallel Dispatch Decision Matrix (Detailed)

| Condition | Dispatch Mode | Reason |
|-----------|---------------|--------|
| Tasks touch SAME files | **SEQUENTIAL** | Avoid conflicts |
| Task B depends on Task A output | **SEQUENTIAL** | Data dependency |
| Both tasks write shared config | **SEQUENTIAL** | Race risk |
| Independent features/modules | **PARALLEL OK** | No overlap |
| Read-only exploration | **PARALLEL OK** | No side effects |
| Different test suites | **PARALLEL OK** | Isolated |

Default to **SEQUENTIAL** when uncertain.
`

export const ORCHESTRATOR_PARALLEL_EXECUTION_VERBOSE = `### Parallel Execution (Detailed)

For navigator/librarian:
- Use \`run_in_background=true\`.
- Launch independent searches in parallel.
- Continue work immediately.
- Fetch results via \`background_output(task_id="...")\` only when needed.
- Before final answer, cancel leftovers with \`background_cancel(all=true)\`.

**Session continuity**:
Reuse \`session_id\` on follow-up delegate calls to preserve context.
`

export const ORCHESTRATOR_DELEGATION_PROMPT_STRUCTURE_VERBOSE = `### Delegation Prompt Structure (Detailed)

Delegation prompt should include:
1. TASK (atomic objective)
2. EXPECTED OUTCOME (acceptance criteria)
3. REQUIRED TOOLS (explicit tool boundaries)
4. MUST DO (non-negotiable requirements)
5. MUST NOT DO (forbidden actions)
6. CONTEXT (paths, patterns, constraints, \`load_skills\`)

After delegation returns, verify behavior and constraints explicitly.
`

export const ORCHESTRATOR_GITHUB_WORKFLOW_VERBOSE = `### GitHub Workflow (Detailed)

Keywords like "look into", "create PR", and issue mentions imply a full cycle:
1. Investigate (context + root cause)
2. Implement (code + tests)
3. Verify (diagnostics/build/tests)
4. Create PR (\`gh pr create\`, reference issue, summarize changes)
`

export const ORCHESTRATOR_PHASE3_REVIEW_PROTOCOL_VERBOSE = `### Three-Stage Review Protocol (Detailed)

For non-trivial implementation:
1. \`skill("spec-compliance-review")\`
2. If pass, \`skill("code-quality-review")\`
3. Optional cleanup: \`skill("code-simplifier")\`

Do not mark completion before required reviews pass.
`

export const ORCHESTRATOR_CATEGORY_SKILLS_PROMPT_INJECTION = `

<system-reminder type="category-skills-context">
Category delegation selected. Ensure \`load_skills\` contains every relevant skill.
If omitting a potentially relevant skill, explain omission in prompt context.
</system-reminder>
`

export const ORCHESTRATOR_INJECTABLE_SECTION_IDS = {
  phase1: "phase1-verbose",
  preDelegation: "pre-delegation-verbose",
  parallelMatrix: "parallel-matrix-verbose",
  parallelExecution: "parallel-execution-verbose",
  delegationStructure: "delegation-structure-verbose",
  githubWorkflow: "github-workflow-verbose",
  phase3Review: "phase3-review-verbose",
  categorySkills: "category-skills-prompt",
} as const

