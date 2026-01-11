# Context Management Strategy

A comprehensive guide to context window management in oh-my-opencode. This document details how the system efficiently manages LLM context windows to maintain information integrity and system stability during extended sessions.

## Table of Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Architecture](#architecture)
- [Compaction Strategies](#compaction-strategies)
- [Memory Systems](#memory-systems)
- [Configuration Guide](#configuration-guide)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [References](#references)

---

## Overview

### The Context Window Problem

Large Language Models operate within fixed context window limits. As conversations progress, the context gradually fills, leading to several critical challenges:

1. **Performance Degradation**: Model performance significantly deteriorates when approaching context limits, a phenomenon known as "context rot"
2. **Information Loss**: Naive truncation discards important historical information
3. **Continuity Disruption**: Poor compression can lose task context, interrupting workflow

### Design Philosophy

oh-my-opencode employs a **multi-layered context distillation** strategy, guided by the principle:

> "Treat context the way operating systems treat memory: as finite resources to be budgeted, compacted, and intelligently paged."

The system implements a hierarchical approach to context management:

```
┌─────────────────────────────────────────────────┐
│           Raw Context (Original)                │  ← Highest Priority
├─────────────────────────────────────────────────┤
│      Compaction (Reversible Pruning)            │  ← Preferred Method
├─────────────────────────────────────────────────┤
│      Summarization (Lossy Compression)          │  ← Last Resort
└─────────────────────────────────────────────────┘
```

**The Golden Rule**: `Raw > Compaction > Summarization`

---

## Core Principles

### 1. Proactive vs Reactive Management

| Strategy | Trigger | Advantages |
|----------|---------|------------|
| **Proactive** | Threshold-based (before limits) | Smooth transitions, no interruptions |
| **Reactive** | Error-based (after API failure) | Maximum context utilization |

oh-my-opencode supports both strategies, with proactive mode recommended for production use.

### 2. Preserve Momentum

During compaction, the system always preserves the most recent 3-5 conversation turns in their original form. This ensures the model maintains:

- Consistent formatting style
- Task execution "rhythm"
- Tool invocation patterns

Research indicates that keeping recent turns raw significantly improves post-compaction coherence.

### 3. Structure Forces Preservation

The system employs structured summary templates where each section acts as a checklist, preventing silent information loss:

```markdown
## 1. User Requests (As-Is)
## 2. Final Goal
## 3. Files Modified (with details)
## 4. Key Decisions & Rationale
## 5. Current Working State
## 6. Environment & Tool Outputs Still Needed
## 7. Remaining Tasks
## 8. MUST NOT Do (Critical Constraints)
## 9. Important Context
```

This structured approach ensures that critical information categories cannot be inadvertently omitted during summarization.

### 4. Layered Recovery

The system implements a three-phase progressive recovery strategy, escalating from lightweight to heavyweight interventions:

```
PHASE 1: Dynamic Context Pruning (DCP)
    ↓ If still over limit
PHASE 2: Aggressive Truncation
    ↓ If still over limit
PHASE 3: Session Summarization
```

This approach minimizes information loss by applying the least destructive method first.

---

## Architecture

### Component Overview

```
oh-my-opencode Context Management
├── Preemptive Compaction              # Proactive compression
│   └── preemptive-compaction/
├── Error Recovery                     # Reactive recovery
│   └── anthropic-context-window-limit-recovery/
│       ├── pruning-deduplication.ts   # Remove duplicate calls
│       ├── pruning-supersede.ts       # Remove superseded writes
│       ├── pruning-purge-errors.ts    # Remove old errors
│       ├── pruning-clear-results.ts   # Clear old tool results
│       └── storage.ts                 # Tool output management
├── Context Injection                  # Context bootstrapping
│   ├── compaction-context-injector/   # Preserve context during compaction
│   ├── repo-overview-injector/        # Project context injection
│   └── directory-agents-injector/     # Directory-level context
├── Memory Systems                     # Persistent memory
│   └── user-memory/                   # Cross-session memory
├── Monitoring                         # Runtime monitoring
│   ├── context-window-monitor.ts      # Usage tracking
│   └── runtime-tracker/               # Tool performance tracking
└── Output Optimization                # Output size management
    ├── tool-output-truncator.ts       # Tool output truncation
    └── dynamic-truncator.ts           # Dynamic size adjustment
```

### Data Flow

```
                    ┌──────────────┐
                    │   Session    │
                    │    Start     │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │   Bootstrap Injection   │
              │  • Repository Overview  │
              │  • User Memory          │
              │  • AGENTS.md Context    │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    Normal Operation     │◄────────────┐
              │  • Tool Invocations     │             │
              │  • Runtime Tracking     │             │
              │  • Output Optimization  │             │
              └────────────┬────────────┘             │
                           │                          │
              ┌────────────▼────────────┐             │
              │   Context Monitoring    │             │
              │  • 70% Warning          │             │
              │  • 85% Compaction       │             │
              └────────────┬────────────┘             │
                           │                          │
            ┌──────────────┴──────────────┐           │
            │                             │           │
   ┌────────▼────────┐         ┌──────────▼─────────┐ │
   │  Below Threshold │         │  Above Threshold   │ │
   │  Continue Normal │         │  or Token Error    │ │
   └────────┬────────┘         └──────────┬─────────┘ │
            │                             │           │
            │              ┌──────────────▼──────────┐│
            │              │   Compaction Pipeline   ││
            │              │  1. DCP Pruning         ││
            │              │  2. Truncation          ││
            │              │  3. Summarization       ││
            │              └──────────────┬──────────┘│
            │                             │           │
            └─────────────────────────────┴───────────┘
```

---

## Compaction Strategies

### 1. Dynamic Context Pruning (DCP)

DCP comprises a set of reversible pruning strategies that remove redundant information without semantic loss. These operations target content that either duplicates existing information or can be reconstructed from the environment.

#### 1.1 Deduplication

Removes identical tool invocations (same tool name + identical arguments).

```typescript
// Example: Consecutive reads of the same file
Read("src/index.ts")  // Preserved (first occurrence)
Read("src/index.ts")  // Pruned (duplicate)
Read("src/utils.ts")  // Preserved (different file)
Read("src/index.ts")  // Pruned (duplicate)
```

**Rationale**: Duplicate tool calls provide no additional information. The agent can rely on the most recent result.

**Configuration**:
```json
{
  "strategies": {
    "deduplication": { "enabled": true }
  }
}
```

#### 1.2 Supersede Writes

Removes write operation inputs when the file is subsequently read, as the content has been superseded by the current file state.

```typescript
// Example: Write followed by read
Write("config.json", content)  // Input pruned (superseded by read)
Edit("config.json", ...)       // Input pruned (superseded by read)
Read("config.json")            // Preserved (proves writes completed)
```

**Rationale**: Once a file has been read after modifications, the write inputs are redundant—the read output contains the current state.

**Configuration**:
```json
{
  "strategies": {
    "supersede_writes": {
      "enabled": true,
      "aggressive": false  // true: prune any write followed by ANY read
    }
  }
}
```

#### 1.3 Purge Errors

Removes errored tool invocations after N conversation turns, as error context becomes stale.

```typescript
// 5 turns ago
Bash("invalid-cmd")  // Error → Pruned after threshold
// Current turn
Bash("valid-cmd")    // Success → Preserved
```

**Rationale**: Error messages from many turns ago rarely provide actionable information and consume valuable context space.

**Configuration**:
```json
{
  "strategies": {
    "purge_errors": {
      "enabled": true,
      "turns": 5  // Prune errors older than N turns
    }
  }
}
```

#### 1.4 Clear Tool Results

**The safest form of compaction**—clears tool outputs from older turns while preserving the most recent N turns.

```typescript
// Turn 1 (old) - output cleared
Read("file.ts") → output: "[Content pruned by Dynamic Context Pruning]"

// Turn 5 (recent) - output preserved
Read("file.ts") → output: "actual file content..."
```

**Rationale**: Tool results deep in conversation history are rarely referenced. If needed, the agent can re-invoke the tool to retrieve current information.

**Configuration**:
```json
{
  "strategies": {
    "clear_tool_results": {
      "enabled": true,
      "keep_recent_turns": 5
    }
  }
}
```

### 2. Aggressive Truncation

When DCP fails to release sufficient context space, the system applies aggressive truncation to the largest tool outputs.

**Algorithm**:
1. Identify the largest tool output in the current session
2. Truncate proportionally to reach target token count
3. Repeat up to 20 iterations if necessary

**Target**: Reduce token count to `maxTokens * 0.5`

This phase preserves tool invocation records while removing verbose output content.

### 3. Session Summarization

The final fallback strategy employs the LLM to generate a structured session summary.

#### Compaction Template

The system injects a structured template to guide summarization:

```markdown
## 1. User Requests (As-Is)
- Original user requests with exact wording preserved
- User intent and clarifications

## 2. Final Goal
- Ultimate objective
- Success criteria if specified

## 3. Files Modified (with details)
- Each file path with specific changes
- Line ranges for significant modifications
- Creation/modification/deletion indicators
- Example: "src/utils/helper.ts: Added validateInput function (lines 45-78)"

## 4. Key Decisions & Rationale
- Technical decisions made and WHY
- Alternatives considered and rejection reasons
- Trade-offs acknowledged
- Prevents re-exploration of rejected approaches

## 5. Current Working State
- What is currently working/passing
- Test status if tests were run
- Build status if relevant
- Partial implementations in progress

## 6. Environment & Tool Outputs Still Needed
- Tool results that may require re-fetching
- File contents that might need re-reading
- External state dependencies

## 7. Remaining Tasks
- Specific outstanding items
- Pending items from original request
- Follow-up tasks identified during work
- Blockers or dependencies

## 8. MUST NOT Do (Critical Constraints)
- Explicitly forbidden operations
- Approaches that FAILED (do not retry)
- User restrictions and preferences
- Anti-patterns identified during session
- Commands that caused errors

## 9. Important Context
- Domain-specific knowledge acquired
- Component relationships discovered
- Quirks or gotchas encountered
- User preferences learned
```

This structured approach ensures comprehensive information preservation during lossy compression.

---

## Memory Systems

### 1. Repository Overview

Automatically injects project context at session start, reducing redundant exploration.

**Injected Content**:
- Project name and description
- Technology stack (TypeScript, React, Python, etc.)
- Frameworks (Next.js, Express, Django, etc.)
- Package manager (npm, yarn, pnpm, bun)
- Common commands (build, dev, test, lint)
- Core file listing
- Directory structure tree

**Caching**: 1 hour default (configurable)

**Configuration**:
```json
{
  "repo_overview": {
    "enabled": true,
    "auto_generate": true,
    "max_tree_depth": 50,
    "cache_duration_ms": 3600000
  }
}
```

### 2. User Memory

Cross-session persistent memory stored at `~/.opencode/memory/user.json`.

**Stored Information**:

| Category | Description | Example |
|----------|-------------|---------|
| `preferences` | User preferences | `{ "style": "concise", "language": "en" }` |
| `environment` | Development environment | `{ "os": "macOS", "shell": "zsh", "editor": "vscode" }` |
| `workHistory` | Recent work sessions | Last 50 session summaries |
| `customRules` | Persistent instructions | `["Always use TypeScript", "Prefer functional style"]` |
| `explicitMemories` | User-requested memories | Content from "remember that..." requests |

**Memory Triggers**:
```
User: Remember that our API uses snake_case for all endpoints
→ Automatically saved to explicitMemories
```

The system detects patterns like "remember that", "note that", "keep in mind" and persists the associated content.

**Configuration**:
```json
{
  "user_memory": {
    "enabled": true,
    "persist_preferences": true,
    "persist_work_history": true,
    "max_history_entries": 50,
    "auto_inject": true
  }
}
```

### 3. AGENTS.md Injection

Automatically injects directory-level AGENTS.md files to provide localized context.

**Discovery Algorithm**:
1. Start from the directory of the current file operation
2. Traverse upward to project root
3. Inject all discovered AGENTS.md files in hierarchical order

This enables project-specific and directory-specific context to be automatically provided without explicit configuration.

### 4. Runtime Tracker

Monitors tool execution times to help the agent avoid repeating slow operations.

**Tracked Metrics**:
- Average duration (rolling window)
- Last duration
- Total call count
- Recent durations for trend analysis

**Runtime Hints**:
```
[Runtime: 5.2s - Tool "grep" averaged 4.8s over 3 calls.
 Consider narrower queries or caching results.]
```

**Configuration**:
```json
{
  "runtime_tracker": {
    "enabled": true,
    "threshold_ms": 3000,
    "max_recent": 10,
    "inject_hints": true
  }
}
```

---

## Configuration Guide

### Complete Configuration Example

```json
{
  "experimental": {
    "preemptive_compaction": true,
    "preemptive_compaction_threshold": 0.80,
    "dcp_for_compaction": true,
    "dynamic_context_pruning": {
      "enabled": true,
      "notification": "detailed",
      "turn_protection": {
        "enabled": true,
        "turns": 3
      },
      "protected_tools": [
        "task", "todowrite", "todoread",
        "lsp_rename", "lsp_code_action_resolve",
        "session_read", "session_write", "session_search"
      ],
      "strategies": {
        "deduplication": { "enabled": true },
        "supersede_writes": { "enabled": true, "aggressive": false },
        "purge_errors": { "enabled": true, "turns": 5 },
        "clear_tool_results": { "enabled": true, "keep_recent_turns": 5 }
      }
    }
  },
  "repo_overview": {
    "enabled": true,
    "auto_generate": true,
    "max_tree_depth": 50,
    "cache_duration_ms": 3600000
  },
  "user_memory": {
    "enabled": true,
    "persist_preferences": true,
    "persist_work_history": true,
    "max_history_entries": 50,
    "auto_inject": true
  },
  "runtime_tracker": {
    "enabled": true,
    "threshold_ms": 3000,
    "max_recent": 10,
    "inject_hints": true
  }
}
```

### Threshold Recommendations

| Model | Context Window | Recommended Threshold | Notes |
|-------|---------------|----------------------|-------|
| Claude 3.5 Sonnet | 200K | 0.80 (160K) | Standard configuration |
| Claude 3 Opus | 200K | 0.75 (150K) | More conservative |
| Claude 3.5 Sonnet (Extended) | 1M | 0.25 (256K) | Avoid context rot zone |
| GPT-4 Turbo | 128K | 0.80 (102K) | Standard configuration |
| GPT-4o | 128K | 0.80 (102K) | Standard configuration |

**Key Insight**: For 1M context models, do not wait until 800K+ tokens. Performance degradation begins well before the absolute limit.

### Protected Tools

Certain tools should never be pruned as they maintain critical state:

```json
{
  "protected_tools": [
    "task",                      // Subtask state
    "todowrite",                 // Task list management
    "todoread",                  // Task list retrieval
    "lsp_rename",                // LSP rename operations
    "lsp_code_action_resolve",   // LSP code actions
    "session_read",              // Session state
    "session_write",             // Session state
    "session_search"             // Session search
  ]
}
```

### Notification Levels

| Level | Output |
|-------|--------|
| `"off"` | No notifications |
| `"minimal"` | `Pruned 12 tool outputs (~8k tokens)` |
| `"detailed"` | `Pruned 12 tool outputs (~8k tokens). Dedup: 3, Supersede: 5, Purge: 2, ClearResults: 2` |

---

## Best Practices

### 1. Threshold Configuration

```
✅ Recommended: 0.75 - 0.85
❌ Avoid: > 0.90 (too late) or < 0.60 (too aggressive)
```

Setting the threshold too high risks API errors; setting it too low wastes available context.

### 2. Protect Critical Tools

Always protect tools that maintain important state:
- Task management tools (task, todo*)
- LSP tools (rename, refactor, code actions)
- Session management tools (session_*)

### 3. Enable Structured Summarization

Always use the compaction context injector to ensure critical information preservation:
- Original user requests
- File modification records
- Decision rationale
- Remaining tasks
- Failure constraints

### 4. Monitor Context Usage

Enable context-window-monitor for early warnings at 70%:

```
[Context Status: 72% used, 28% remaining]
[SYSTEM REMINDER: You have plenty of context remaining - do NOT rush tasks]
```

### 5. Leverage Runtime Tracking

Enable runtime tracking to identify and optimize slow operations:

```
[Runtime: 5.2s - Tool "grep" averaged 4.8s over 3 calls]
[Consider narrower queries or caching results]
```

### 6. Use Repository Overview

Enable repository overview injection to eliminate redundant project exploration at session start. The cached overview provides immediate context about:
- Project structure
- Technology stack
- Build commands
- Entry points

---

## Troubleshooting

### Issue: Information Loss After Compaction

**Symptoms**: Agent forgets previous decisions or file modifications after compaction

**Solutions**:
1. Enable the enhanced compaction context template
2. Increase `keep_recent_turns` value
3. Add critical tools to `protected_tools`
4. Review if `aggressive` mode is appropriate for your use case

### Issue: Excessive Compaction Frequency

**Symptoms**: Frequent compaction notifications disrupting workflow

**Solutions**:
1. Increase `preemptive_compaction_threshold`
2. Enable `clear_tool_results` strategy to reduce tool output accumulation
3. Enable `tool-output-truncator` hook for proactive output management
4. Consider using more concise tool invocations

### Issue: Token Limit Exceeded Errors

**Symptoms**: API returns token limit exceeded errors despite compaction

**Solutions**:
1. Verify `anthropic-context-window-limit-recovery` hook is enabled
2. Enable `dcp_for_compaction: true`
3. Lower `preemptive_compaction_threshold`
4. Check for unusually large tool outputs

### Issue: Oversized Tool Outputs

**Symptoms**: Single tool invocations consuming excessive tokens

**Solutions**:
1. Enable `tool-output-truncator` hook
2. Configure `experimental.truncate_all_tool_outputs: true`
3. Use more precise queries (narrower grep patterns, specific file paths)
4. Enable runtime tracking to identify problematic tools

### Issue: Slow Tool Operations

**Symptoms**: Long wait times for tool execution

**Solutions**:
1. Enable `runtime_tracker` to identify slow tools
2. Use more targeted queries
3. Consider caching frequently accessed information
4. Break large operations into smaller, focused invocations

---

## References

### Industry Research

- [Factory.ai - The Context Window Problem: Scaling Agents Beyond Token Limits](https://factory.ai/news/context-window-problem)
- [Anthropic - Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Google ADK - Context Compaction](https://google.github.io/adk-docs/context/compaction/)
- [JetBrains Research - Cutting Through the Noise: Smarter Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Jason Liu - Two Experiments on Context Compaction](https://jxnl.co/writing/2025/08/30/context-engineering-compaction/)

### Related Documentation

- [oh-my-opencode Configuration Schema](../src/config/schema.ts)
- [DCP Implementation](../src/hooks/anthropic-context-window-limit-recovery/)
- [Preemptive Compaction](../src/hooks/preemptive-compaction/)

---

## Appendix: Glossary

| Term | Definition |
|------|------------|
| **Context Window** | The maximum number of tokens an LLM can process in a single request |
| **Context Rot** | Performance degradation as context approaches capacity limits |
| **Compaction** | Reversible removal of redundant information from context |
| **Summarization** | Lossy compression using LLM to generate condensed representation |
| **DCP** | Dynamic Context Pruning - a set of reversible pruning strategies |
| **Turn** | A single request-response cycle in the conversation |
| **Protected Tools** | Tools exempt from pruning due to critical state maintenance |
| **Bootstrap Injection** | Initial context provided at session start |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 3.0.0 | 2026-01 | Added clear_tool_results strategy, enhanced compaction template, Repository Overview, User Memory, Runtime Tracker |
| 2.9.0 | - | Initial DCP implementation with deduplication, supersede_writes, purge_errors |
| 2.8.0 | - | Preemptive compaction hook |
| 2.7.0 | - | Context window monitoring |
