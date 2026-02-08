/**
 * Deep Verification Module
 *
 * Migrated from src/agents/momus.ts - provides deep file verification,
 * implementation simulation, and ADHD-omission detection for the
 * Plan Synthesizer.
 *
 * This enables the Synthesizer to perform Momus-level verification
 * as Phase 3 of the synthesis process.
 */

/**
 * Build the deep verification prompt fragment for Plan Synthesizer.
 * This is Momus's core verification capability embedded in synthesis.
 */
export function buildDeepVerificationPrompt(): string {
  return `### Phase 3: Deep Verification (MANDATORY - Do NOT Skip)

**This phase catches what surface-level review misses.**

After Phase 2 (Per-Plan Evaluation) and before conflict detection, perform deep verification.

---

#### Step 1: File Reference Audit

For **EACH plan**, extract ALL file references and verify them:

\`\`\`
For each file reference in the plan:
  1. Use the Read tool to load the file
  2. Verify the file exists at the stated path
  3. If line numbers are mentioned, verify they contain relevant code
  4. If a pattern/function/type is described, verify it actually exists
  5. Note any broken or outdated references
\`\`\`

**Verification Checklist per Reference:**
- [ ] File exists at stated path
- [ ] Line numbers (if mentioned) contain relevant code
- [ ] Described pattern/code actually exists in the file
- [ ] No stale references to deleted/moved code

**If verification fails:**
- Flag as **CRITICAL gap** in plan evaluation
- Deduct 2 points from C1 (Clarity) score
- Note in the comparison report which references failed

---

#### Step 2: Implementation Simulation

For **2-3 representative tasks** from EACH plan, mentally simulate execution:

**The Developer Test:**
\`\`\`
"I am the developer. I read this task. Can I start work NOW?"

Ask yourself:
1. Do I know exactly which file to open first?
2. Do I know what code pattern to follow?
3. Do I know how to verify I'm done?
4. Are there any unstated assumptions I need to make?

If ANY answer is "No" or "I'd have to guess" → Plan has a context gap.
\`\`\`

**Red Flags to Look For:**
| Red Flag | Example | Action |
|----------|---------|--------|
| Vague action verbs | "Improve the handling" | Flag as C1 gap |
| Missing file paths | "Update the config" (which config?) | Flag as C3 gap |
| Subjective criteria | "Make it cleaner" | Flag as C2 gap |
| Unstated assumptions | "Use the standard approach" | Flag as C3 gap |

---

#### Step 3: ADHD-Omission Scan

**Context**: Plans may be written by someone whose working memory fills gaps automatically.
What seems "obvious" to the author may be completely missing from the written plan.

**Common ADHD Omissions to Check:**

| Omission Type | What the Plan Says | What's Missing |
|---------------|-------------------|----------------|
| Reference gap | "Follow the pattern in X" | Doesn't specify which file X is |
| Business logic gap | "Handle errors appropriately" | Doesn't specify which errors or how |
| Architecture gap | "Add to the state" | Doesn't specify which state management |
| Convention gap | "Use standard approach" | Doesn't define what's standard here |
| Context gap | "Similar to how we did Y" | Y isn't documented anywhere |

**For each task, verify:**
- [ ] Can I execute this WITHOUT making assumptions?
- [ ] Are all "obvious" details actually written down?
- [ ] Would someone unfamiliar with the project understand this?

**If ADHD-omissions detected:**
- Flag as **context gap** in evaluation
- Deduct 2 points from C3 (Context) score
- List specific omissions in the comparison report

---

#### Step 4: Update Scores Based on Verification

After deep verification, adjust your C1-C4 scores:

**Score Adjustments:**
- **C1 (Clarity)**: -2 per failed file verification
- **C2 (Verification)**: -2 per missing/vague acceptance criteria
- **C3 (Context)**: -2 per ADHD-omission detected
- **C4 (Big Picture)**: -1 if simulation revealed unclear task flow

**Report Format:**
\`\`\`markdown
### Deep Verification Results: {model-name}

**File References**: X verified, Y failed
- Failed: \`path/to/file.ts:45\` - file exists but line 45 is unrelated
- Failed: \`src/old/module.ts\` - file does not exist

**Implementation Simulation**: {PASS|PARTIAL|FAIL}
- Task 3: Blocked - missing which API endpoint to call
- Task 7: Partial - unclear error handling strategy

**ADHD-Omissions Detected**: N
- "Follow existing pattern" - pattern location not specified
- "Handle edge cases" - edge cases not listed

**Score Adjustments**: C1: -2, C3: -4
\`\`\`
`
}

/**
 * Build the enhanced criterion evaluation checklist.
 * Adds verification-based criteria to the standard C1-C4 scoring.
 */
export function buildCriterionEvaluationChecklist(): string {
  return `### Enhanced Criterion Evaluation (Post Deep Verification)

After deep verification (Phase 3), enhance your C1-C4 scoring with these additional checks:

---

#### C1: Clarity of Work Content (Enhanced)

**Standard Checks:**
- [ ] Tasks specify WHERE to find implementation details
- [ ] References point to specific files/sections
- [ ] Developer can reach 90%+ confidence from references

**Verification-Based Additions:**
- [ ] All file references verified as existing and accurate
- [ ] Line numbers (if mentioned) point to relevant code
- [ ] Claimed patterns/functions actually exist in referenced files

**Scoring:**
- 10/10: All references verified, high specificity
- 7-9/10: Minor reference issues, generally specific
- 4-6/10: Some failed verifications, moderate vagueness
- 1-3/10: Multiple failed references, vague throughout

---

#### C2: Verification & Acceptance Criteria (Enhanced)

**Standard Checks:**
- [ ] Concrete verification commands provided
- [ ] Acceptance criteria are measurable/observable
- [ ] No subjective terms ("clean code", "good UX")

**Simulation-Based Additions:**
- [ ] Acceptance criteria are actually executable
- [ ] Test commands specified with expected output
- [ ] "Done" state is unambiguous

**Scoring:**
- 10/10: All criteria executable with clear expected results
- 7-9/10: Most criteria executable, minor ambiguities
- 4-6/10: Some criteria vague or unmeasurable
- 1-3/10: Missing criteria or highly subjective

---

#### C3: Context Completeness (Enhanced)

**Standard Checks:**
- [ ] <10% guesswork required for execution
- [ ] Implicit assumptions stated explicitly
- [ ] No unstated business logic decisions

**ADHD-Omission Additions:**
- [ ] No "obvious" details left unwritten
- [ ] All "follow pattern X" include where X is
- [ ] All "handle Y appropriately" define what Y means

**Scoring:**
- 10/10: Zero ADHD-omissions, fully explicit
- 7-9/10: 1-2 minor omissions, mostly explicit
- 4-6/10: 3-5 omissions, requires assumptions
- 1-3/10: Many omissions, significant guesswork needed

---

#### C4: Big Picture & Workflow (Enhanced)

**Standard Checks:**
- [ ] Clear WHY (purpose statement)
- [ ] Clear WHAT (deliverables)
- [ ] Clear HOW (task flow and dependencies)
- [ ] Success vision defined

**Simulation-Based Additions:**
- [ ] Task dependencies explicitly stated
- [ ] Order of execution is clear
- [ ] Handoff points between tasks defined

**Scoring:**
- 10/10: Complete workflow, clear dependencies
- 7-9/10: Good flow, minor dependency gaps
- 4-6/10: Partial flow, some confusion
- 1-3/10: Unclear flow, missing big picture
`
}

/**
 * Build the ADHD-omission detection prompt.
 * This is a focused section for catching common planning gaps.
 */
export function buildADHDDetectionPrompt(): string {
  return `### ADHD-Omission Detection Guide

**Why This Matters:**
Plans are often written by intelligent people with ADHD whose working memory automatically fills in gaps.
The author's mind makes rapid connections that never make it onto the page.

**Example of ADHD-driven omission:**
- Author thinks: "Add auth → obviously use JWT → obviously store in httpOnly cookie → obviously follow auth/login.ts"
- Author writes: "Add authentication following auth/login.ts pattern"
- Everything after the first arrow is missing.

**Common Patterns to Catch:**

1. **The Implicit Reference**
   - Writes: "Follow the existing pattern"
   - Missing: Which file? Which function? What makes it the "existing" pattern?

2. **The Assumed Convention**
   - Writes: "Use standard error handling"
   - Missing: What's standard here? Return error? Throw? Log and continue?

3. **The Obvious Edge Case**
   - Writes: "Handle edge cases appropriately"
   - Missing: What are the edge cases? What's appropriate?

4. **The Hidden Dependency**
   - Writes: "After setting up X, implement Y"
   - Missing: What exactly does "setting up X" entail?

5. **The Implicit Business Logic**
   - Writes: "Validate the input"
   - Missing: What rules? What's valid/invalid? What happens on failure?

**Detection Strategy:**
For each task item, ask: "If I had ZERO context about this project, could I execute this?"
If no → ADHD-omission detected.
`
}

/**
 * Build file verification instructions for the Synthesizer
 */
export function buildFileVerificationInstructions(): string {
  return `### File Reference Verification Protocol

When verifying file references in plans:

**Step 1: Extract All References**
Scan each plan for:
- Explicit file paths: \`src/components/Button.tsx\`
- Line number references: \`line 45-67\`
- Symbol references: \`function handleSubmit\`, \`class UserService\`
- Pattern references: \`follow pattern in X\`

**Step 2: Verify Each Reference**
For each reference:
\`\`\`
1. Read the file using Read tool
2. Check if the file exists
3. If line numbers mentioned:
   - Navigate to those lines
   - Verify content matches description
4. If function/class mentioned:
   - Search for that symbol
   - Verify it exists and matches description
\`\`\`

**Step 3: Record Results**
For each reference:
- ✅ VERIFIED: File exists, content matches
- ⚠️ PARTIAL: File exists, but content doesn't fully match
- ❌ FAILED: File doesn't exist or content is completely different

**Failure Examples:**
- Plan says \`src/utils/format.ts:42\` but line 42 is a comment
- Plan says "follow auth pattern in login.ts" but no login.ts exists
- Plan says "use UserService.validate()" but UserService has no validate method
`
}
