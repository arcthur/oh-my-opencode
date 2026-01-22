# Delegation Validator Strategy

## TL;DR

| Problem | Solution |
|---------|----------|
| Sisyphus delegation decisions are opaque | Require structured JSON output before every `delegate_task` |
| Cannot verify if agent choice is optimal | Validate decisions against rules matrix, inject warnings |
| No traceability for debugging | Log all decisions with agent, taskType, complexity, domain |

**Core Principle**: Let LLM do semantic analysis (what it's good at), program does validation (what it's good at).

---

## 1. Background

### The Problem

Sisyphus orchestrates work by delegating to specialized agents (explore, oracle, frontend-ui-ux-engineer, etc.). The existing mechanism uses:

```typescript
// Agent metadata with triggers
{
  triggers: [{ domain: "Hard debugging", trigger: "After 2+ failed fix attempts" }],
  useWhen: ["2+ failed fix attempts", "Unfamiliar code patterns"],
  avoidWhen: ["First attempt at any fix"],
}
```

This is compiled into a delegation table in the Sisyphus prompt. The problem: **LLM decision-making is a black box**.

| Issue | Impact |
|-------|--------|
| No traceability | Cannot debug why agent X was chosen |
| No validation | Cannot detect suboptimal choices before execution |
| No quantification | "Both agents seem viable" has no tiebreaker |

### Design Alternatives Considered

| Approach | Code | Pros | Cons |
|----------|------|------|------|
| **A. Programmatic Intent Analysis** | ~1000 lines | Deterministic, testable | Regex semantic limits, dual system maintenance |
| **B. Prompt-only Enhancement** | 0 lines | Simple | Still relies on LLM compliance |
| **C. Structured Output + Post-Validation** | ~300 lines | LLM does semantics, program validates | Depends on LLM outputting JSON |

**Chosen: Option C** - Minimal code, maximum leverage of LLM capabilities.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Sisyphus outputs <delegation-decision> JSON                     │
│ { agent, taskType, complexity, domain, reason, signals }        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Hook: tool.execute.before (delegate_task only)                  │
│ 1. Fetch last assistant message                                 │
│ 2. Extract <delegation-decision> JSON                           │
│ 3. Validate against VALIDATION_RULES                            │
│ 4. Inject warnings if suboptimal (does NOT block execution)     │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Warnings, not blocks**: Validation issues inject warnings but don't prevent execution. LLM retains final decision authority.

2. **Independent frontend check**: Frontend implementation/refactoring always recommends `frontend-ui-ux-engineer`, regardless of whether the chosen agent "supports" frontend domain.

3. **No programmatic intent analysis**: LLM performs semantic understanding; program only validates the structured output.

4. **Graceful degradation**: If JSON extraction fails, a reminder is injected but execution continues.

---

## 3. The Delegation Decision Format

Sisyphus must output this JSON **before** every `delegate_task` call:

```xml
<delegation-decision>
{
  "agent": "explore" | "librarian" | "oracle" | "frontend-ui-ux-engineer" | "document-writer" | "Metis" | "Momus",
  "taskType": "exploration" | "implementation" | "debugging" | "refactoring" | "documentation" | "architecture" | "research",
  "complexity": "trivial" | "simple" | "moderate" | "complex",
  "domain": "frontend" | "backend" | "external" | "general",
  "reason": "1-2 sentences explaining WHY this agent is the best choice",
  "signals": ["signal1", "signal2"]
}
</delegation-decision>
```

### Field Definitions

| Field | Purpose | Example |
|-------|---------|---------|
| `agent` | Target agent for delegation | `"oracle"` |
| `taskType` | Classification of work | `"debugging"` |
| `complexity` | Estimated effort level | `"complex"` |
| `domain` | Primary area of concern | `"backend"` |
| `reason` | Justification for choice | `"After 2+ failed attempts at fixing the auth bug"` |
| `signals` | Detected indicators | `["error mentioned", "multiple failures"]` |

---

## 4. Validation Rules Matrix

```typescript
const VALIDATION_RULES = {
  explore: {
    validTaskTypes: ["exploration", "debugging"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["frontend", "backend", "general"],
  },
  librarian: {
    validTaskTypes: ["exploration", "research"],
    validComplexity: ["trivial", "simple", "moderate", "complex"],
    validDomains: ["external", "general"],
  },
  oracle: {
    validTaskTypes: ["debugging", "architecture"],
    validComplexity: ["moderate", "complex"],
    minComplexity: "moderate",  // Overkill warning if below
  },
  "frontend-ui-ux-engineer": {
    validTaskTypes: ["implementation", "refactoring"],
    validDomains: ["frontend"],
  },
  "document-writer": {
    validTaskTypes: ["documentation"],
  },
  "Metis": {
    validTaskTypes: ["architecture", "research"],
    minComplexity: "moderate",
  },
  "Momus": {
    validTaskTypes: ["architecture"],
    minComplexity: "moderate",
  },
}
```

### Validation Checks

| Check | Condition | Warning Type |
|-------|-----------|--------------|
| Task type mismatch | `taskType not in agent.validTaskTypes` | `task_type_mismatch` |
| Overkill | `complexity < agent.minComplexity` | `overkill` |
| Frontend domain | `domain=frontend && taskType in [implementation, refactoring] && agent != frontend-ui-ux-engineer` | `domain_mismatch` |

### Warning Examples

```
- task_type_mismatch: explore is not typically used for "implementation" tasks
  (Consider using frontend-ui-ux-engineer (for frontend) or direct implementation)

- overkill: oracle is expensive and typically used for moderate+ tasks, but this is "trivial"
  (Consider using direct tools or cheaper agents first)

- domain_mismatch: Frontend implementation/refactoring should typically use frontend-ui-ux-engineer
  (Delegate visual changes to frontend-ui-ux-engineer)
```

---

## 5. Decision Guide

### When to Use Each Agent

| Domain | Task Type | Recommended Agent |
|--------|-----------|-------------------|
| frontend | implementation, refactoring | `frontend-ui-ux-engineer` |
| any | exploration (internal code) | `explore` |
| external | exploration (docs/APIs) | `librarian` |
| any | debugging (after 2+ failures) | `oracle` |
| any | architecture decisions | `oracle` or `Metis` |
| any | documentation | `document-writer` |
| external | research | `librarian` |

### Signal Detection Examples

| Signal in Request | Recommended Agent |
|-------------------|-------------------|
| "external library mentioned" | `librarian` |
| "visual styling keywords" | `frontend-ui-ux-engineer` |
| "error/bug + 2+ failed attempts" | `oracle` |
| "multi-module scope" | `explore` |
| "documentation request" | `document-writer` |

---

## 6. Implementation Files

| File | Purpose |
|------|---------|
| `src/delegation/types.ts` | Type definitions (DelegationDecision, ValidationResult) |
| `src/delegation/validator.ts` | Validation logic and VALIDATION_RULES matrix |
| `src/hooks/delegation-validator/index.ts` | Hook implementation |
| `src/agents/sisyphus.ts` | Prompt modification (SISYPHUS_PRE_DELEGATION_PLANNING) |

---

## 7. Enabling/Disabling

The hook can be disabled via `opencode.json`:

```json
{
  "disabled_hooks": ["delegation-validator"]
}
```

When disabled:
- No JSON extraction or validation occurs
- Sisyphus still sees the prompt guidance but no programmatic enforcement
- Useful for debugging or when validation overhead is undesired

---

## 8. Traceability

All decisions are logged with structured data:

```typescript
// Successful validation
log("[delegation-validator] Delegation decision validated successfully", {
  sessionID,
  agent: "oracle",
  taskType: "debugging",
  complexity: "complex",
  domain: "backend",
})

// Validation with warnings
log("[delegation-validator] Delegation decision has warnings", {
  sessionID,
  agent: "oracle",
  taskType: "debugging",
  warnings: 1,
})

// Missing decision block
log("[delegation-validator] No delegation-decision block found", {
  sessionID,
  tool: "delegate_task",
})
```

---

## 9. Future Enhancements

| Enhancement | Description | Priority |
|-------------|-------------|----------|
| Decision analytics | Aggregate decisions to identify patterns | Low |
| Learning from outcomes | Track if warned decisions led to poor results | Medium |
| Dynamic rule updates | Allow per-project validation rules | Low |

---

## 10. Summary

The Delegation Validator implements **structured output + post-validation**:

1. **LLM responsibility**: Semantic understanding, signal detection, agent selection
2. **Program responsibility**: JSON extraction, rule validation, warning injection
3. **User benefit**: Traceability, quality guardrails, no execution blocking

This approach achieves the optimal balance between LLM flexibility and programmatic verification with minimal code (~300 lines core).
