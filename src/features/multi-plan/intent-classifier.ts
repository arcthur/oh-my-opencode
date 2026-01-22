/**
 * Intent Classifier Module
 *
 * Migrated from src/agents/metis.ts - provides intent classification
 * and AI-slop guardrails for injection into plan generator prompts.
 *
 * This enables each parallel model to self-classify intent and apply
 * appropriate guardrails, replacing the need for a separate Metis agent call.
 */

/**
 * Intent types for work classification
 */
export type IntentType =
  | "refactoring"
  | "build_from_scratch"
  | "mid_sized"
  | "collaborative"
  | "architecture"
  | "research"

/**
 * Build intent classification prompt fragment for injection into plan generator.
 * This is the core Metis capability embedded in each model's prompt.
 */
export function buildIntentClassificationPrompt(): string {
  return `## PHASE 0: INTENT CLASSIFICATION (MANDATORY FIRST STEP)

Before generating ANY plan, classify the work intent. This determines your entire strategy.

### Step 1: Identify Intent Type

| Intent | Signals | Your Primary Focus |
|--------|---------|-------------------|
| **Refactoring** | "refactor", "restructure", "clean up", changes to existing code | SAFETY: regression prevention, behavior preservation |
| **Build from Scratch** | "create new", "add feature", greenfield, new module | DISCOVERY: explore patterns first, informed design |
| **Mid-sized Task** | Scoped feature, specific deliverable, bounded work | GUARDRAILS: exact deliverables, explicit exclusions |
| **Collaborative** | "help me plan", "let's figure out", wants dialogue | INTERACTIVE: incremental clarity through dialogue |
| **Architecture** | "how should we structure", system design, infrastructure | STRATEGIC: long-term impact, trade-off analysis |
| **Research** | Investigation needed, goal exists but path unclear | INVESTIGATION: exit criteria, parallel probes |

### Step 2: Apply Intent-Specific Strategy

#### IF REFACTORING

**Your Focus**: Ensure zero regressions, behavior preservation.

**Tool Guidance**:
- \`lsp_find_references\`: Map all usages before changes
- \`lsp_rename\` / \`lsp_prepare_rename\`: Safe symbol renames
- \`ast_grep_search\`: Find structural patterns to preserve
- \`ast_grep_replace(dryRun=true)\`: Preview transformations

**Directives to Include**:
- MUST: Define pre-refactor verification (exact test commands + expected outputs)
- MUST: Verify after EACH change, not just at the end
- MUST NOT: Change behavior while restructuring
- MUST NOT: Refactor adjacent code not in scope

---

#### IF BUILD FROM SCRATCH

**Your Focus**: Discover patterns before designing, then build informed.

**Pre-Analysis Actions** (do these FIRST):
- Search for similar implementations in codebase
- Identify project patterns for this type of work
- Check external best practices if needed

**Directives to Include**:
- MUST: Follow discovered patterns from exploration
- MUST: Define "Must NOT Have" section (AI over-engineering prevention)
- MUST NOT: Invent new patterns when existing ones work
- MUST NOT: Add features not explicitly requested

---

#### IF MID-SIZED TASK

**Your Focus**: Define exact boundaries. AI slop prevention is critical.

**Directives to Include**:
- MUST: "Must Have" section with exact deliverables
- MUST: "Must NOT Have" section with explicit exclusions
- MUST: Per-task guardrails (what each task should NOT do)
- MUST NOT: Exceed defined scope

---

#### IF COLLABORATIVE

**Your Focus**: Build understanding through dialogue. No rush.

**Directives to Include**:
- MUST: Record all user decisions in "Key Decisions" section
- MUST: Flag assumptions explicitly
- MUST NOT: Proceed without user confirmation on major decisions

---

#### IF ARCHITECTURE

**Your Focus**: Strategic analysis. Long-term impact assessment.

**Directives to Include**:
- MUST: Document architectural decisions with rationale
- MUST: Define "minimum viable architecture"
- MUST NOT: Introduce complexity without justification
- MUST NOT: Over-engineer for hypothetical future requirements

---

#### IF RESEARCH

**Your Focus**: Define investigation boundaries and exit criteria.

**Directives to Include**:
- MUST: Define clear exit criteria
- MUST: Specify parallel investigation tracks
- MUST: Define synthesis format (how to present findings)
- MUST NOT: Research indefinitely without convergence

---

### Step 3: State Your Classification

At the start of your plan, include:
\`\`\`markdown
## Intent Classification
**Type**: [Your chosen intent type]
**Confidence**: [High | Medium | Low]
**Primary Focus**: [1-sentence description of your strategy]
\`\`\`
`
}

/**
 * Build AI-slop guardrails for injection into plan generator.
 * These rules prevent common over-engineering patterns.
 */
export function buildAISlopGuardrails(): string {
  return `## AI-SLOP PREVENTION RULES (MANDATORY)

**AI-Slop Patterns to GUARD AGAINST**:

| Pattern | Example | What to Do Instead |
|---------|---------|-------------------|
| **Scope inflation** | Adding tests for adjacent modules | Stay in scope exactly as requested |
| **Premature abstraction** | Extracting utility function for one use | Keep inline unless justified |
| **Over-validation** | 15 error checks for 3 inputs | Match error handling to actual risk |
| **Documentation bloat** | JSDoc on every function | Document only non-obvious logic |
| **Over-engineering** | Factory pattern for single implementation | YAGNI - simpler is better |
| **Feature creep** | "While we're at it, let's also..." | Resist - stay focused |
| **Unnecessary flexibility** | Config for everything | Hardcode until flexibility is needed |

**Before writing EACH TODO, ask yourself:**
1. Is this explicitly requested? If NO → don't include it
2. Does this add complexity without proportional value? If YES → simplify
3. Am I adding "best practices" that weren't asked for? If YES → remove
4. Is this abstraction premature? If YES → inline it
5. Would a junior developer question why this is needed? If YES → reconsider

**Forbidden Patterns:**
- ❌ Adding utility functions for one-time use
- ❌ Creating interfaces for single implementations
- ❌ Adding extensive error handling beyond requirements
- ❌ Including documentation comments for obvious code
- ❌ Suggesting "optional improvements" beyond scope
- ❌ Adding logging/telemetry not requested
- ❌ Creating configuration files for hardcoded values

**Required Self-Check at End of Plan:**
- [ ] Every TODO traces to an explicit requirement
- [ ] No "nice to have" items snuck in
- [ ] Scope matches request exactly
- [ ] No premature abstractions
- [ ] No over-engineered error handling
`
}

/**
 * Build tool guidance based on intent type
 */
export function buildToolGuidance(intent: IntentType): string {
  const guidance: Record<IntentType, string> = {
    refactoring: `**Recommended Tools for Refactoring**:
- \`lsp_find_references\`: Map impact before changes
- \`lsp_rename\`: Safe symbol renames
- \`ast_grep_search\`: Find structural patterns
- \`ast_grep_replace\`: Batch transformations (use dryRun first)`,

    build_from_scratch: `**Recommended Tools for Build from Scratch**:
- \`explore\` agent: Discover existing patterns
- \`librarian\` agent: Research external best practices
- \`glob\` / \`grep\`: Find similar implementations`,

    mid_sized: `**Recommended Tools for Mid-sized Task**:
- \`read\`: Understand affected files
- \`lsp_goto_definition\`: Navigate dependencies
- \`grep\`: Find all usages of affected code`,

    collaborative: `**Recommended Tools for Collaborative**:
- \`explore\` agent: Gather context incrementally
- \`read\`: Share relevant code with user
- Use questions to refine understanding`,

    architecture: `**Recommended Tools for Architecture**:
- \`oracle\` agent: High-IQ architectural consultation
- \`explore\` agent: Map current system structure
- \`librarian\` agent: Research architectural patterns`,

    research: `**Recommended Tools for Research**:
- \`explore\` agent: Codebase investigation
- \`librarian\` agent: External documentation
- \`grep\` / \`glob\`: Pattern discovery`,
  }

  return guidance[intent]
}

/**
 * Build per-intent directives (MUST/MUST NOT rules)
 */
export function buildIntentDirectives(intent: IntentType): string {
  const directives: Record<IntentType, string> = {
    refactoring: `**Refactoring Directives**:
- MUST: Define pre-refactor verification (exact test commands)
- MUST: Verify behavior preservation after each change
- MUST NOT: Change behavior while restructuring
- MUST NOT: Touch code outside the refactoring scope`,

    build_from_scratch: `**Build Directives**:
- MUST: Follow patterns discovered in codebase
- MUST: Define explicit "Must NOT Have" section
- MUST NOT: Invent new patterns when existing ones work
- MUST NOT: Add features beyond the request`,

    mid_sized: `**Mid-sized Task Directives**:
- MUST: List exact deliverables in "Must Have"
- MUST: List explicit exclusions in "Must NOT Have"
- MUST NOT: Exceed the defined scope
- MUST NOT: Add "improvements" not requested`,

    collaborative: `**Collaborative Directives**:
- MUST: Document all decisions with user
- MUST: Flag assumptions explicitly
- MUST NOT: Make major decisions without confirmation
- MUST NOT: Rush to implementation`,

    architecture: `**Architecture Directives**:
- MUST: Document decisions with rationale
- MUST: Define minimum viable architecture
- MUST NOT: Over-engineer for hypothetical futures
- MUST NOT: Add complexity without justification`,

    research: `**Research Directives**:
- MUST: Define clear exit criteria
- MUST: Time-box the investigation
- MUST NOT: Research indefinitely
- MUST NOT: Lose focus on the original goal`,
  }

  return directives[intent]
}
