# Multi-Model Planning Guide

This document describes the **Multi-Model Planning** feature, which enables parallel plan generation using multiple AI models followed by intelligent synthesis and conflict resolution.

## 1. Overview

Traditional single-model planning has inherent blind spots - each model has its own biases, strengths, and weaknesses. Multi-Model Planning solves this by:

1. **Parallel Generation**: Multiple AI models generate plans simultaneously, each bringing a unique perspective
2. **Structured Evaluation**: Each plan is scored on 4 criteria (Clarity, Verification, Context, Big Picture)
3. **Assumption & Risk Analysis**: Detects conflicting assumptions, preserves unshared risks
4. **Conflict Detection**: Identifies where models disagree on approach
5. **Momus-Style Synthesis**: A Plan Synthesizer ruthlessly critiques all plans and produces a unified, actionable result
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
            Orchestrator --> ModelA[Model A<br>e.g., strategist]
            Orchestrator --> ModelB[Model B<br>e.g., creative]
            Orchestrator --> ModelC[Model C<br>e.g., practical]
        end

        ModelA --> PlanA[plan-strategist.md]
        ModelB --> PlanB[plan-creative.md]
        ModelC --> PlanC[plan-practical.md]

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

Enable multi-model planning in your `oh-my-opencode.json`:

```jsonc
{
  "multi_plan": {
    "enabled": true,
    "models": [
      {
        "name": "claude",
        "model": "anthropic/claude-opus-4-5"
      },
      {
        "name": "gpt",
        "model": "openai/gpt-5.2"
      }
    ]
  }
}
```

### Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable/disable multi-model planning |
| `models` | array | List of 2-5 models to use (minimum 2 required) |
| `models[].name` | string | Display name for this model perspective |
| `models[].model` | string | Model identifier (e.g., `anthropic/claude-opus-4-5`) |
| `models[].category` | string | Alternative: use predefined category (e.g., `ultrabrain`) |

### Predefined Categories

Instead of specifying a model directly, you can use categories:

| Category | Model | Use Case |
|----------|-------|----------|
| `ultrabrain` | openai/gpt-5.2 | Strategic, high-reasoning tasks |
| `most-capable` | anthropic/claude-opus-4-5 | Complex analysis |
| `general` | anthropic/claude-sonnet-4-5 | Balanced, practical approach |
| `quick` | anthropic/claude-haiku-4-5 | Fast, simple tasks |
| `artistry` | google/gemini-3-pro-preview | Creative solutions |

---

## 4. How It Works

### Step 1: Trigger

When multi-model planning is enabled, Prometheus sees a capability context informing it about the `multi_plan` tool. When the user requests plan generation, Prometheus calls:

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
- Role-specific guidance based on its name (e.g., "strategist" focuses on architecture)
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
| **Phase 3** | **Assumption & Risk Analysis** - Detect conflicts, preserve unshared risks |
| **Phase 4** | Section-by-section conflict detection |
| **Phase 5** | Conflict resolution with harsh verdicts |
| **Phase 6** | Synthesize final unified plan |

### Step 4: Debate Round (Optional)

If `debate: true` was passed, rejected models get a chance to rebut:

1. **Parse rejections**: Identify models that lost conflicts
2. **Generate rebuttals**: Each rejected model argues why it should be reconsidered
3. **Final review (Phase 7)**: Synthesizer reviews rebuttals
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

## 5. Plan Synthesizer (Momus-Style)

The Plan Synthesizer is named after Momus, the Greek god of satire and criticism. Its philosophy:

> "One approach must WIN each conflict. No 'both are good' cop-outs."

### 5.1 Structured Evaluation (Phase 2)

Each plan is scored on **4 criteria** (adapted from Momus review standards):

| Criterion | What It Measures | Score |
|-----------|------------------|-------|
| **C1: Clarity** | Do tasks specify WHERE to find implementation details? | X/10 |
| **C2: Verification** | Are acceptance criteria concrete and measurable? | X/10 |
| **C3: Context** | Is <10% guesswork required? Assumptions stated? | X/10 |
| **C4: Big Picture** | Clear WHY/WHAT/HOW? Task flow understood? | X/10 |

**Overall Score** = (C1+C2+C3+C4)/4

These scores inform conflict resolution - higher-scoring plans generally win.

### 5.2 Assumption & Risk Analysis (Phase 3)

**Assumption Conflicts**: When models assume different things:
```markdown
### ASSUMPTION CONFLICT: Authentication method

**strategist assumes**: JWT tokens (High confidence)
**creative assumes**: Session cookies (Medium confidence)

**VERDICT**: Accept strategist's assumption
**REASON**: Higher confidence, verified via code exploration
**ACTION**: Validate in first TODO if needed
```

**Unshared Risks**: Risks only one model identified are PRESERVED:
```markdown
### UNSHARED RISK: Rate limiting not considered

**Only creative identified this risk**
- Probability: Medium
- Impact: High
- Mitigation: Add rate limiter middleware

**VERDICT**: PRESERVE - add to final plan's risk section
```

### 5.3 Conflict Resolution Format (Phase 5)

For each conflict point, the synthesizer outputs (using **actual model names**, not "Plan A/B"):

```markdown
### CONFLICT: [Brief description]

**{strategist} says**: [Summary]
**{creative} says**: [Summary]
**{practical} says**: [Summary]

---

**Why {strategist} is WRONG**: [Harsh critique]
**Why {creative} is WRONG**: [Harsh critique]
**Why {practical} is WRONG**: [Harsh critique]

---

**VERDICT**: ACCEPT {model-name} | MERGE | REJECT ALL | BOTH_VALID
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

### 5.5 BOTH_VALID vs MERGE

- **MERGE**: Mutually exclusive approaches that can be hybridized (e.g., "use JWT for API, sessions for web")
- **BOTH_VALID**: Genuinely complementary approaches (e.g., "add caching" AND "add indexes" - both should be done)

---

## 6. Debate Mechanism

The Debate mechanism gives rejected models a chance to argue back, preventing one-sided decisions.

### 6.1 When Debate Runs

Debate is **optional** and only runs when:
1. `debate: true` is passed to `multi_plan` tool
2. At least one model was rejected in a conflict (not the winner)

### 6.2 Rebuttal Format

Each rejected model submits a rebuttal:

```markdown
## Rebuttal from {model-name}

**Conflict**: [Which conflict this addresses]
**Original Verdict**: [What Synthesizer decided]

**My Counter-Argument**:
[Why my approach should be reconsidered - SPECIFIC]

**Evidence**:
- [Specific code references]
- [Technical reasoning]
- [What Synthesizer missed]

**Proposed Revision**:
[What should change in the final plan]
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

✅ **Good use cases**:
- High-stakes architectural decisions
- When conflicts are close calls
- Complex trade-offs with no clear winner
- Maximum scrutiny needed

❌ **Skip debate for**:
- Clear-cut conflicts
- Time-sensitive planning
- Simple tasks with obvious approaches

### 6.6 Cost Consideration

Debate adds:
- N rebuttal generation calls (one per rejected model)
- 1 additional Synthesizer call for final review

For a 3-model setup where 2 were rejected, expect 3 additional model calls.

---

## 7. Output Files

### Individual Plans

```
.sisyphus/plans/{name}-{model}.md
```

Example: `.sisyphus/plans/auth-strategist.md`, `.sisyphus/plans/auth-creative.md`

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
❌ Multi-model planning failed: Plan Synthesizer completed but output files missing

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

✅ **Good use cases**:
- Complex architectural decisions
- Features with multiple valid approaches
- High-stakes implementations needing validation
- When you want to catch blind spots

❌ **Avoid for**:
- Simple, straightforward tasks
- Time-sensitive quick fixes
- Tasks with only one obvious approach

### Cost Awareness

**Without debate**: Multi-model planning is **N+1** calls:
- N model calls for plan generation
- 1 Plan Synthesizer call (using capable model)

**With debate**: Additional **M+1** calls:
- M rebuttal generation calls (one per rejected model)
- 1 final Synthesizer review call

| Setup | Without Debate | With Debate (worst case: N-1 rejected) |
|-------|----------------|----------------------------------------|
| 2 models | 3 calls | 5 calls (1 rejected) |
| 3 models | 4 calls | 7 calls (2 rejected) |
| 5 models | 6 calls | 11 calls (4 rejected) |

---

## 10. Troubleshooting

### Plans are too similar

**Problem**: Different models produce nearly identical plans.

**Solutions**:
- Use models with more diverse architectures (e.g., Claude + GPT + Gemini)
- Increase temperature for some models
- Use role-specific names that hint at different perspectives (e.g., "strategist", "pragmatist", "creative")

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
  "multi_plan": {
    "enabled": true,
    "models": [
      { "name": "strategist", "model": "anthropic/claude-opus-4-5" },
      { "name": "pragmatist", "model": "openai/gpt-5.2" },
      { "name": "creative", "model": "google/gemini-3-pro" }
    ]
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
# a) Parallel generation: strategist + pragmatist + creative
# b) Phase 2: 4-criterion evaluation (C1-C4 scores)
# c) Phase 3: Assumption/Risk analysis
# d) Phases 4-6: Conflict detection & synthesis
# e) Debate round: Rejected models rebut
# f) Phase 7: Final review, may revise

# 6. Output files created:
# .sisyphus/plans/auth-strategist.md
# .sisyphus/plans/auth-pragmatist.md
# .sisyphus/plans/auth-creative.md
# .sisyphus/rebuttals/auth-pragmatist.md  (if rejected)
# .sisyphus/plan-reviews/auth-comparison.md
# .sisyphus/plans/auth.md (final)

# 7. Execute the plan
# User: /start-work
```

---

## 12. Related Documentation

- [Orchestration Guide](./orchestration-guide.md) - Overall planning/execution architecture
- [Category & Skill Guide](./category-skill-guide.md) - Model categories and skills
- [CLI Guide](./cli-guide.md) - Command-line interface usage
