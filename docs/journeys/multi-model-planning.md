# Journey: Multi-Model Planning

## User Perspective

You want higher-confidence plans for complex or high-stakes work without relying on a single model’s blind spots.
Multi-model planning generates multiple independent plans in parallel and synthesizes them into one actionable plan with explicit conflict resolution and verification focus.

This document describes the **Multi-Model Planning** feature, which enables parallel plan generation using multiple AI models followed by intelligent synthesis and conflict resolution.

## 1. Overview

Traditional single-model planning has inherent blind spots - each model has its own biases, strengths, and weaknesses. Multi-Model Planning solves this by:

1. **Parallel Generation**: Multiple AI models generate plans simultaneously, each bringing a unique perspective
2. **Structured Evaluation**: Each plan is scored on 4 criteria (Clarity, Verification, Context, Big Picture)
3. **Assumption & Risk Analysis**: Detects conflicting assumptions, preserves unshared risks
4. **Conflict Detection**: Identifies where models disagree on approach
5. **Ruthless Synthesis**: A Plan Synthesizer ruthlessly critiques all plans and produces a unified, actionable result
6. **Debate Mechanism** (optional): Rejected models can rebut, Synthesizer may revise

---

## 2. Architecture

```mermaid
graph TD
    User[User: "Generate the plan"] --> Prometheus

    subgraph Multi-Model Planning
        Prometheus --> MultiPlanTool[multi_plan tool]
        MultiPlanTool --> Orchestrator[MultiPlanOrchestrator]

        subgraph Parallel Generation
            Orchestrator --> ModelA[claude-opus-4-5]
            Orchestrator --> ModelB[gpt-5.2]
            Orchestrator --> ModelC[gemini-3-pro]
        end

        ModelA --> PlanA[plan-claude-opus-4-5.md]
        ModelB --> PlanB[plan-gpt-5.2.md]
        ModelC --> PlanC[plan-gemini-3-pro.md]

        PlanA --> Synthesizer[Plan Synthesizer<br>4-Criterion Evaluation<br>+ Assumption/Risk Analysis]
        PlanB --> Synthesizer
        PlanC --> Synthesizer

        Synthesizer --> InitialVerdict[Initial Verdict]

        subgraph Debate Round - Optional
            InitialVerdict --> RejectedModels{Rejected<br>Models?}
            RejectedModels -->|Yes| Rebuttals[Generate Rebuttals]
            Rebuttals --> FinalReview[Synthesizer Reviews]
            FinalReview --> MayRevise[May Revise Plan]
        end

        RejectedModels -->|No| FinalDecision[Final Decision]
        MayRevise --> FinalDecision
    end

    FinalDecision --> Comparison[comparison.md]
    FinalDecision --> FinalPlan[final-plan.md]
```

---

## 3. Configuration

Configure multi-model planning in your `oh-my-opencode.json` under `agents.prometheus.model`:

```jsonc
{
  "agents": {
    "prometheus": {
      "model": [
        "anthropic/claude-opus-4-5",
        "openai/gpt-5.2"
      ]
    }
  }
}
```

Multi-model planning **automatically activates** when 2 or more models are configured. For single-model planning (Prometheus generates directly), use a string:

**Note**: If `agents.prometheus.model` is an array, Prometheus itself uses the **first** model as its own runtime model; the full array is used for parallel plan generation.

```jsonc
{
  "agents": {
    "prometheus": {
      "model": "anthropic/claude-opus-4-5"
    }
  }
}
```

### Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `agents.prometheus.model` | `string` | Single model - Prometheus generates plan directly |
| `agents.prometheus.model` | `string[]` | Multiple models (2-5) - parallel generation + synthesis |

### 3.1 Pipeline Configuration (Unified)

Multi-Model Planning behavior is controlled by `multi_plan_pipeline` (single source of truth for routing + synthesizer verification behavior):

```jsonc
{
  "multi_plan_pipeline": {
    "auto_complexity_detection": true,
    "smart_skip_interview": true,
    "deep_verification": true,
    "adhd_detection": true
  }
}
```

| Field | Default | Description |
|------|---------|-------------|
| `multi_plan_pipeline.auto_complexity_detection` | `true` | Enables complexity analysis and injects routing recommendation into planner context |
| `multi_plan_pipeline.smart_skip_interview` | `true` | Enables clarity analysis and injects interview recommendation (skip/brief/full) into planner context |
| `multi_plan_pipeline.deep_verification` | `true` | Controls whether Plan Synthesizer must run Phase 3 (deep verification) |
| `multi_plan_pipeline.adhd_detection` | `true` | Controls whether Plan Synthesizer runs ADHD-omission scan (part of deep verification) |

### Model Names

Model display names are **automatically derived** from model IDs:

| Model ID | Derived Name |
|----------|--------------|
| `anthropic/claude-opus-4-5` | `claude-opus-4-5` |
| `openai/gpt-5.2` | `gpt-5.2` |
| `google/gemini-3-pro` | `gemini-3-pro` |

The derivation extracts the portion after the last `/` and removes common prefixes like `antigravity-`.

---

## 4. How It Works

### Step 1: Trigger

When multi-model planning is enabled (2+ models in `agents.prometheus.model`), Prometheus sees a capability context informing it about the `multi_plan` tool.

In addition, if `multi_plan_pipeline.auto_complexity_detection` and/or `multi_plan_pipeline.smart_skip_interview` are enabled, the hook injects a lightweight **routing hint** per message:

```text
<multi-plan-routing>
Clarity: clear → interview: skip (...)
Complexity: complex → route: multi_model (...)
</multi-plan-routing>
```

When the user requests plan generation, Prometheus calls:

```typescript
multi_plan({
  planName: "feature-name",
  context: "Complete interview context, decisions, research...",
  debate: true  // Optional: enable debate mode for high-stakes plans
})
```

### Step 2: Parallel Plan Generation

The `MultiPlanOrchestrator` launches N background tasks, one per configured model. Each model receives:
- The same base planning prompt
- The full interview context

**Required plan sections** (all models must include):
1. Context
2. Work Objectives
3. **Assumptions** (with confidence levels)
4. **Risks** (with probability/impact/mitigation)
5. Verification Strategy
6. TODOs
7. Success Criteria

Each model writes its plan to:
```
.sisyphus/plans/{name}-{model}.md
```

### Step 3: Plan Synthesis (Phases 1-6)

Once all plans are generated, the **Plan Synthesizer** is invoked:

| Phase | Action |
|-------|--------|
| **Phase 1** | Read all plans |
| **Phase 2** | **Structured Evaluation** - Score each plan on 4 criteria (C1-C4) |
| **Phase 3** | **Deep Verification** (conditional) - File reference audit + implementation simulation (+ ADHD scan if enabled) |
| **Phase 4** | **Assumption & Risk Analysis** - Detect conflicts, preserve unshared risks |
| **Phase 5** | Section-by-section conflict detection |
| **Phase 6** | Conflict resolution with harsh verdicts |
| **Phase 7** | Synthesize final unified plan |

The orchestrator injects pipeline flags into the synthesizer input:

```text
<multi-plan-pipeline>
deep_verification: true|false
adhd_detection: true|false
</multi-plan-pipeline>
```

**Rule**:
- If `deep_verification: false` → Synthesizer must skip Phase 3 entirely.
- If `adhd_detection: false` → Synthesizer must skip ADHD-omission scan, even if it performs other verification.

### Step 4: Debate Round (Optional)

If `debate: true` was passed, rejected models get a chance to rebut:

1. **Parse rejections**: Identify models that lost conflicts
2. **Generate rebuttals**: Each rejected model argues why it should be reconsidered
3. **Final review (Phase 8)**: Synthesizer reviews rebuttals
4. **May revise**: If rebuttal provides NEW evidence, plan is updated

### Step 5: Output

The following files are generated:

| File | Path | Description |
|------|------|-------------|
| Individual Plans | `.sisyphus/plans/{name}-{model}.md` | Each model's original plan |
| Comparison Report | `.sisyphus/plan-reviews/{name}-comparison.md` | Evaluations, conflicts, rebuttals |
| Final Plan | `.sisyphus/plans/{name}.md` | Synthesized unified plan |
| Rebuttals (if debate) | `.sisyphus/rebuttals/{name}-{model}.md` | Rebuttal from each rejected model |

---

## 5. Plan Synthesizer (Ruthless Critique)

The Plan Synthesizer is built around ruthless critique and decisive conflict resolution. Its philosophy:

> "One approach must WIN each conflict. No 'both are good' cop-outs."

### 5.1 Structured Evaluation (Phase 2)

Each plan is scored on **4 criteria**:

| Criterion | What It Measures | Score |
|-----------|------------------|-------|
| **C1: Clarity** | Do tasks specify WHERE to find implementation details? | X/10 |
| **C2: Verification** | Are acceptance criteria concrete and measurable? | X/10 |
| **C3: Context** | Is <10% guesswork required? Assumptions stated? | X/10 |
| **C4: Big Picture** | Clear WHY/WHAT/HOW? Task flow understood? | X/10 |

**Overall Score** = (C1+C2+C3+C4)/4

These scores inform conflict resolution - higher-scoring plans generally win.

### 5.2 Assumption & Risk Analysis (Phase 4)

**Assumption Conflicts**: When models assume different things:
```markdown
### ASSUMPTION CONFLICT: Authentication method

**claude-opus-4-5 assumes**: JWT tokens (High confidence)
**gpt-5.2 assumes**: Session cookies (Medium confidence)

**VERDICT**: Accept claude-opus-4-5's assumption
**REASON**: Higher confidence, verified via code exploration
**ACTION**: Validate in first TODO if needed
```

**Unshared Risks**: Risks only one model identified are PRESERVED:
```markdown
### UNSHARED RISK: Rate limiting not considered

**Only gpt-5.2 identified this risk**
- Probability: Medium
- Impact: High
- Mitigation: Add rate limiter middleware

**VERDICT**: PRESERVE - add to final plan's risk section
```

### 5.3 Conflict Resolution Format (Phase 6)

For each conflict point, the synthesizer outputs (using **actual model names**, not "Plan A/B"):

```markdown
### CONFLICT: [Brief description]

**{claude-opus-4-5} says**: [Summary]
**{gpt-5.2} says**: [Summary]
**{gemini-3-pro} says**: [Summary]

---

**Why {claude-opus-4-5} is WRONG**: [Harsh critique]
**Why {gpt-5.2} is WRONG**: [Harsh critique]
**Why {gemini-3-pro} is WRONG**: [Harsh critique]

---

**VERDICT**: ACCEPT {model-name} | MERGE | REJECT ALL | BOTH_VALID | PARALLEL_SPIKE
**RECOMMENDATION**: [Specific action]
**RATIONALE**: [2-3 sentences]
```

### 5.4 Verdict Types

| Verdict | When to Use |
|---------|-------------|
| `ACCEPT {model}` | One model's approach is clearly superior |
| `MERGE` | Best elements from multiple models can be combined |
| `REJECT ALL` | All approaches are flawed, needs rethinking |
| `BOTH_VALID` | Approaches are **complementary**, not conflicting (rare) |
| `PARALLEL_SPIKE` | Evidence insufficient; both plausible; needs empirical validation |

### 5.5 BOTH_VALID vs MERGE vs PARALLEL_SPIKE

- **MERGE**: Mutually exclusive approaches that can be hybridized (e.g., "use JWT for API, sessions for web")
- **BOTH_VALID**: Genuinely complementary approaches (e.g., "add caching" AND "add indexes" - both should be done)
- **PARALLEL_SPIKE**: Both approaches are plausible but evidence is insufficient to decide; requires a time-boxed validation experiment

### 5.6 PARALLEL_SPIKE: Validation-First Verdict

Use `PARALLEL_SPIKE` when:
1. Both approaches are logically sound
2. The key differentiator is **empirical** (performance, UX, maintainability in practice)
3. Paper analysis cannot determine the winner
4. A time-boxed experiment would provide definitive evidence

**PARALLEL_SPIKE format**:

```markdown
### CONFLICT: [Brief description]

**{model-a} says**: [Summary]
**{model-b} says**: [Summary]

---

**Why {model-a} is WRONG**: [Critique - but acknowledge it might be right]
**Why {model-b} is WRONG**: [Critique - but acknowledge it might be right]

---

**VERDICT**: PARALLEL_SPIKE
**RATIONALE**: [Why evidence is insufficient - be SPECIFIC, not vague]

**SPIKE DESIGN**:
- **Hypothesis**: [What we're trying to determine]
- **Approach A Validation**: [Concrete steps to test model-a's approach]
- **Approach B Validation**: [Concrete steps to test model-b's approach]
- **Decision Criteria**: [Measurable metrics that will determine the winner]
- **Time-box**: [Max effort before deciding, e.g., "4 hours" or "1 day"]

**TEMPORARY DECISION**: {model-name}
[Which approach to prototype FIRST if sequential validation is needed. Include rationale.]
```

**Anti-abuse rules**:
1. **Must justify why evidence is insufficient** - "Both seem reasonable" is NOT acceptable
2. **Must define concrete spike** - Vague "we need to test this" is NOT acceptable
3. **Must have measurable decision criteria** - "See which feels better" is NOT acceptable
4. **Must have time-box** - Open-ended spikes are NOT acceptable
5. **Prefer ACCEPT when one approach has >70% confidence** - Don't use PARALLEL_SPIKE to avoid decisions

**When NOT to use PARALLEL_SPIKE**:
- One approach has clear technical advantages
- The "uncertainty" is just lack of domain expertise (research more, don't spike)
- The spike would take longer than just implementing one approach
- Debate round already provided sufficient evidence

**Example: PARALLEL_SPIKE (Data Storage Strategy)**:

```markdown
### CONFLICT: How to store user preferences

**claude-opus-4-5 says**: Use Redis for fast reads, sync to PostgreSQL periodically
**gpt-5.2 says**: Store directly in PostgreSQL with aggressive caching headers
**gemini-3-pro says**: Use localStorage with cloud sync on app start

---

**Why claude-opus-4-5 is WRONG** (maybe):
Adds Redis infrastructure complexity. Sync logic is error-prone. But for high-read workloads, might be justified.

**Why gpt-5.2 is WRONG** (maybe):
Database round-trips for every preference read. Caching headers only help browser caching. But simplest to implement.

**Why gemini-3-pro is WRONG** (maybe):
localStorage has size limits and no cross-device sync. But zero latency for reads.

---

**VERDICT**: PARALLEL_SPIKE
**RATIONALE**: The performance difference between these approaches depends heavily on actual usage patterns (read:write ratio, preference data size, concurrent users). Without profiling real workload, we're guessing.

**SPIKE DESIGN**:
- **Hypothesis**: PostgreSQL with caching can handle our expected read load (<1000 RPS) without Redis
- **Approach A Validation**: Implement Redis approach, load test with 1000 concurrent users
- **Approach B Validation**: Implement PostgreSQL approach, load test same scenario
- **Decision Criteria**: P99 latency <50ms, memory usage <500MB
- **Time-box**: 4 hours (2 hours per approach)

**TEMPORARY DECISION**: gpt-5.2
Start with PostgreSQL (simpler) since we suspect read load isn't high enough to need Redis.
```

---

## 6. Debate Mechanism

The Debate mechanism gives rejected models a chance to argue back, preventing one-sided decisions.

### 6.1 When Debate Runs

Debate is **optional** and only runs when:
1. `debate: true` is passed to `multi_plan` tool
2. At least one model was rejected in a conflict (not the winner)

**Note**: `PARALLEL_SPIKE` and `BOTH_VALID` verdicts do not produce rejections, so conflicts resolved with these verdicts will not trigger rebuttals.

### 6.2 Rebuttal Format

Each rejected model submits a single rebuttal file (one per model), which may address multiple conflicts:

Rebuttals are generated using the same configured model (or category) as that model's original plan.

```markdown
## Rebuttal from {model-name}

### Conflict: {conflict-id}
**Original Verdict**: [What Synthesizer decided]
**Synthesizer Criticism**: [What Synthesizer criticized about your approach]

**My Counter-Argument**:
[Why my approach should be reconsidered - SPECIFIC]

**Evidence**:
- [Specific code references]
- [Technical reasoning]
- [What Synthesizer missed]

**Proposed Revision**:
[What should change in the final plan]

### Conflict: {another-conflict-id}
[Repeat the same structure for each conflict addressed]
```

### 6.3 Rebuttal Rules

1. **No repetition**: Can't just repeat original argument
2. **NEW evidence required**: Must provide something Synthesizer didn't consider
3. **Address the criticism**: Must respond to specific points made against them
4. **Concede if wrong**: If Synthesizer was right, model should admit it

### 6.4 Synthesizer's Response

For each rebuttal, Synthesizer decides:

| Decision | When | Action |
|----------|------|--------|
| **MAINTAIN** | Rebuttal unconvincing, no new evidence | Keep original verdict |
| **REVISE** | Rebuttal provides valid new evidence | Update final plan |

### 6.5 When to Use Debate

**Recommended use cases**:
- High-stakes architectural decisions
- When conflicts are close calls
- Complex trade-offs with no clear winner
- Maximum scrutiny needed

**Skip debate for**:
- Clear-cut conflicts
- Time-sensitive planning
- Simple tasks with obvious approaches

### 6.6 Cost Consideration

Debate adds:
- R rebuttal generation calls (one per rejected model; R ≤ N)
- 1 additional Synthesizer call for final review

For a 3-model setup where 2 were rejected, expect 3 additional model calls (2 rebuttals + 1 Synthesizer review).

---

## 7. Output Files

### Individual Plans

```
.sisyphus/plans/{name}-{model}.md
```

Example: `.sisyphus/plans/auth-claude-opus-4-5.md`, `.sisyphus/plans/auth-gpt-5.2.md`

Each follows the standard plan format:
- Context
- Work Objectives
- **Assumptions** (with confidence levels)
- **Risks** (with probability/impact/mitigation)
- Verification Strategy
- TODOs
- Success Criteria

### Comparison Report

```
.sisyphus/plan-reviews/{name}-comparison.md
```

Contains:
- Per-model structured evaluation with C1-C4 scores
- Score comparison table (which model scored best on each criterion)
- Assumption conflicts and resolutions
- Risk coverage summary (which model was most thorough)
- All approach conflict resolutions
- Synthesis decision table
- Rebuttal reviews (if debate was enabled)

### Final Unified Plan

```
.sisyphus/plans/{name}.md
```

The synthesized plan combining the best elements from all models, ready for execution with `/start-work`.

---

## 8. Error Handling

### Partial Failure

If some models fail but at least 2 succeed, synthesis continues with available plans.

### Missing Output Files

If Plan Synthesizer completes but doesn't generate expected files, the system:
1. Detects missing files
2. Returns intermediate plan files that were successfully generated
3. Suggests manual fallback options

Example error output:
```
Multi-model planning failed: Plan Synthesizer completed but output files missing

**However, some intermediate files were generated successfully:**
- `.sisyphus/plans/feature-claude.md`
- `.sisyphus/plans/feature-gpt.md`

You can:
1. Read these files to see what each model produced
2. Use the best one as a starting point
3. Generate the final plan manually
```

---

## 9. Best Practices

### Model Selection

1. **Diverse perspectives**: Choose models with different strengths
   - Claude: Strong reasoning, follows instructions well
   - GPT: Creative problem-solving, broad knowledge
   - Gemini: Good at structured output, visual tasks

2. **Minimum 2, maximum 5**: Too few loses diversity benefit, too many increases cost and synthesis complexity

3. **Consistent temperature**: Use similar temperatures (0.2-0.4) for comparable outputs

### When to Use

**Recommended use cases**:
- Complex architectural decisions
- Features with multiple valid approaches
- High-stakes implementations needing validation
- When you want to catch blind spots

**Avoid for**:
- Simple, straightforward tasks
- Time-sensitive quick fixes
- Tasks with only one obvious approach

### Cost Awareness

**Without debate**: Multi-model planning is **N+1** calls:
- N model calls for plan generation
- 1 Plan Synthesizer call (using capable model)

**With debate**: Additional **R+1** calls:
- R rebuttal generation calls (one per rejected model; R ≤ N)
- 1 final Synthesizer review call

| Setup | Without Debate | With Debate (worst case: N rejected) |
|-------|----------------|----------------------------------------|
| 2 models | 3 calls | 6 calls (2 rejected) |
| 3 models | 4 calls | 8 calls (3 rejected) |
| 5 models | 6 calls | 12 calls (5 rejected) |

---

## 10. Troubleshooting

### Plans are too similar

**Problem**: Different models produce nearly identical plans.

**Solutions**:
- Use models with more diverse architectures (e.g., Claude + GPT + Gemini)
- Use agent overrides to increase temperature for specific models
- Ensure models come from different providers for natural diversity

### Synthesis takes too long

**Problem**: Plan Synthesizer times out (>15 minutes).

**Solutions**:
- Reduce number of models
- Ensure individual plans aren't excessively long
- Check if plans have consistent formatting

### Conflicts not detected

**Problem**: Synthesizer says "all plans agree" when they clearly differ.

**Solutions**:
- Ensure plans follow consistent section structure
- Check that models are actually producing different approaches
- Review if the task has genuine decision points

---

## 11. Example Workflow

```bash
# 1. Configure multi-model planning
cat > .opencode/oh-my-opencode.json << 'EOF'
{
  "agents": {
    "prometheus": {
      "model": [
        "anthropic/claude-opus-4-5",
        "openai/gpt-5.2",
        "google/gemini-3-pro"
      ]
    }
  }
}
EOF

# 2. Start Prometheus interview
# User: "I want to add user authentication to my app"
# ... interview proceeds ...

# 3. Trigger plan generation (with debate for high-stakes decision)
# User: "Generate the plan with debate mode"

# 4. Prometheus calls multi_plan tool
# multi_plan({
#   planName: "auth",
#   context: "...",
#   debate: true  # Enable debate for maximum scrutiny
# })

# 5. Pipeline executes:
# a) Parallel generation: claude-opus-4-5 + gpt-5.2 + gemini-3-pro
# b) Phase 2: 4-criterion evaluation (C1-C4 scores)
# c) Phase 3: Deep Verification (if enabled)
# d) Phase 4: Assumption/Risk analysis
# e) Phases 5-7: Conflict detection & synthesis
# f) Debate round: Rejected models rebut
# g) Phase 8: Final review, may revise

# 6. Output files created:
# .sisyphus/plans/auth-claude-opus-4-5.md
# .sisyphus/plans/auth-gpt-5.2.md
# .sisyphus/plans/auth-gemini-3-pro.md
# .sisyphus/rebuttals/auth-gpt-5.2.md  (if rejected)
# .sisyphus/plan-reviews/auth-comparison.md
# .sisyphus/plans/auth.md (final)

# 7. Execute the plan
# User: /start-work
```

---

## 12. Related Documentation

- [Orchestration Guide](../guide/orchestration.md) - Overall planning/execution architecture
- [Category and Skills Guide](../guide/category-and-skills.md) - Model categories and skills
- [CLI Guide](../guide/cli.md) - Command-line interface usage
