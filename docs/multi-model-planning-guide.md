# Multi-Model Planning Guide

This document describes the **Multi-Model Planning** feature, which enables parallel plan generation using multiple AI models followed by intelligent synthesis and conflict resolution.

## 1. Overview

Traditional single-model planning has inherent blind spots - each model has its own biases, strengths, and weaknesses. Multi-Model Planning solves this by:

1. **Parallel Generation**: Multiple AI models generate plans simultaneously, each bringing a unique perspective
2. **Conflict Detection**: Identifies where models disagree on approach
3. **Momus-Style Synthesis**: A Plan Synthesizer ruthlessly critiques all plans and produces a unified, actionable result

---

## 2. Architecture

```mermaid
graph TD
    User[User: "Generate the plan"] --> Prometheus

    subgraph Multi-Model Planning
        Prometheus --> MultiPlanTool[multi_plan tool]
        MultiPlanTool --> Orchestrator[MultiPlanOrchestrator]

        subgraph Parallel Generation
            Orchestrator --> ModelA[Model A<br>e.g., Claude]
            Orchestrator --> ModelB[Model B<br>e.g., GPT]
            Orchestrator --> ModelC[Model C<br>e.g., Gemini]
        end

        ModelA --> PlanA[plan-modelA.md]
        ModelB --> PlanB[plan-modelB.md]
        ModelC --> PlanC[plan-modelC.md]

        PlanA --> Synthesizer[Plan Synthesizer<br>Momus-style]
        PlanB --> Synthesizer
        PlanC --> Synthesizer
    end

    Synthesizer --> Comparison[comparison.md]
    Synthesizer --> FinalPlan[final-plan.md]
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

```
multi_plan({
  planName: "feature-name",
  context: "Complete interview context, decisions, research..."
})
```

### Step 2: Parallel Plan Generation

The `MultiPlanOrchestrator` launches N background tasks, one per configured model. Each model receives:
- The same base planning prompt
- Role-specific guidance based on its name (e.g., "strategist" focuses on architecture)
- The full interview context

Each model writes its plan to:
```
.sisyphus/plans/{name}-{model}.md
```

### Step 3: Plan Synthesis

Once all plans are generated, the **Plan Synthesizer** (a Momus-style agent) is invoked. It:

1. **Reads all plans** using the Read tool
2. **Critiques each plan** - finds weaknesses, AI slop, vague sections
3. **Detects conflicts** section by section
4. **Resolves conflicts** with harsh verdicts
5. **Synthesizes** the final unified plan

### Step 4: Output

Two files are generated:
- **Comparison Report**: `.sisyphus/plan-reviews/{name}-comparison.md`
- **Final Unified Plan**: `.sisyphus/plans/{name}.md`

---

## 5. Plan Synthesizer (Momus-Style)

The Plan Synthesizer is named after Momus, the Greek god of satire and criticism. Its philosophy:

> "One approach must WIN each conflict. No 'both are good' cop-outs."

### Conflict Resolution Format

For each conflict point, the synthesizer outputs:

```markdown
### CONFLICT: [Brief description]

**Plan A says**: [Summary]
**Plan B says**: [Summary]

---

**Why Plan A is WRONG**: [Harsh critique]
**Why Plan B is WRONG**: [Harsh critique]

---

**VERDICT**: ACCEPT Plan A | MERGE | REJECT ALL | BOTH_VALID
**RECOMMENDATION**: [Specific action]
**RATIONALE**: [2-3 sentences]
```

### Verdict Types

| Verdict | When to Use |
|---------|-------------|
| `ACCEPT Plan X` | One approach is clearly superior |
| `MERGE` | Best elements from multiple plans can be combined |
| `REJECT ALL` | All approaches are flawed, needs rethinking |
| `BOTH_VALID` | Approaches are **complementary**, not conflicting (rare) |

### BOTH_VALID vs MERGE

- **MERGE**: Mutually exclusive approaches that can be hybridized (e.g., "use JWT for API, sessions for web")
- **BOTH_VALID**: Genuinely complementary approaches (e.g., "add caching" AND "add indexes" - both should be done)

---

## 6. Output Files

### Individual Plans

```
.sisyphus/plans/{name}-claude.md
.sisyphus/plans/{name}-gpt.md
```

Each follows the standard plan format with Context, Work Objectives, TODOs, and Verification Strategy.

### Comparison Report

```
.sisyphus/plan-reviews/{name}-comparison.md
```

Contains:
- Per-model critique with scores (X/10)
- All conflict resolutions
- Synthesis decision table
- Final verdict on best overall approach

### Final Unified Plan

```
.sisyphus/plans/{name}.md
```

The synthesized plan combining the best elements from all models, ready for execution with `/start-work`.

---

## 7. Error Handling

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

## 8. Best Practices

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

Multi-model planning is **N+1 times** the cost of single-model:
- N model calls for plan generation
- 1 Plan Synthesizer call (using capable model)

For a 3-model setup with opus-class models, expect 4x the typical planning cost.

---

## 9. Troubleshooting

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

## 10. Example Workflow

```bash
# 1. Configure multi-model planning
cat > .opencode/oh-my-opencode.json << 'EOF'
{
  "multi_plan": {
    "enabled": true,
    "models": [
      { "name": "architect", "model": "anthropic/claude-opus-4-5" },
      { "name": "pragmatist", "model": "openai/gpt-5.2" }
    ]
  }
}
EOF

# 2. Start Prometheus interview
# User: "I want to add user authentication to my app"
# ... interview proceeds ...

# 3. Trigger plan generation
# User: "Generate the plan"

# 4. Prometheus calls multi_plan tool
# -> Parallel generation: architect + pragmatist
# -> Plan Synthesizer reviews and merges

# 5. Output files created:
# .sisyphus/plans/auth-architect.md
# .sisyphus/plans/auth-pragmatist.md
# .sisyphus/plan-reviews/auth-comparison.md
# .sisyphus/plans/auth.md (final)

# 6. Execute the plan
# User: /start-work
```

---

## 11. Related Documentation

- [Orchestration Guide](./orchestration-guide.md) - Overall planning/execution architecture
- [Category & Skill Guide](./category-skill-guide.md) - Model categories and skills
- [CLI Guide](./cli-guide.md) - Command-line interface usage
