# Planning with Files Guide

> Manus-style persistent planning: "Context Window = RAM (volatile); Filesystem = Disk (persistent)"

## Overview

Planning with Files implements a persistent markdown-based planning system inspired by [Manus](https://github.com/OthmanAdi/planning-with-files). It uses three files as "working memory on disk" to overcome AI context window limitations.

### The Core Problem

AI agents suffer from:
- **Volatile memory**: Information lost during context resets
- **Goal drift**: Original objectives fade after many operations
- **Context bloat**: Everything crammed into limited active memory
- **Hidden errors**: Failures not tracked, causing repetition

### The Solution

Treat the filesystem as persistent storage and context windows as temporary RAM:

```
┌─────────────────────────────────────────────────────────┐
│  Context Window (RAM)          Filesystem (Disk)        │
│  ──────────────────           ─────────────────         │
│  • Volatile                   • Persistent              │
│  • Limited (~200K tokens)     • Unlimited               │
│  • Expensive                  • Free                    │
│  • Lost on reset              • Survives restarts       │
└─────────────────────────────────────────────────────────┘
```

## The 3-File Pattern

Every complex task creates three markdown files:

```
.sisyphus/plans/{plan-name}/
├── task_plan.md           # Phases, goals, decisions, errors
├── findings.md            # Research results (2-action rule)
├── progress.md            # Session logs, 5-Question Reboot
└── .planning-state.json   # Persisted state (action count, error strikes)
```

### task_plan.md - Working Memory

Your primary planning document containing:
- **Goal**: North-star statement to prevent drift
- **Phases**: Status-tracked stages (pending → in_progress → complete → blocked)
- **Decisions**: Documented choices with rationale
- **Errors**: 3-strike protocol tracking

### findings.md - Knowledge Base

Persistent research storage containing:
- **Research**: Source-attributed discoveries
- **Resources**: URLs and references
- **Technical Decisions**: Architecture choices

### progress.md - Session History

Execution log for context continuity containing:
- **Session Log**: Actions and files modified
- **5-Question Reboot Check**: Context recovery helper

## Configuration

Enable in `.opencode/oh-my-opencode.json`:

```json
{
  "planning_with_files": {
    "enabled": true,
    "directory": "plans",
    "two_action_rule": true,
    "three_strike_protocol": true,
    "auto_reread": true,
    "stop_verification": true,
    "auto_from_multi_plan": true
  }
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable the planning-with-files pattern |
| `directory` | `"plans"` | Directory for planning files (relative to .sisyphus/) |
| `two_action_rule` | `true` | Remind to update findings after 2 view/search ops |
| `three_strike_protocol` | `true` | Structured error handling with escalation |
| `auto_reread` | `true` | Re-read task_plan before Write/Edit/Bash |
| `stop_verification` | `true` | Block stopping if phases are incomplete |
| `auto_from_multi_plan` | `true` | Auto-create planning files from multi-plan results |

## Core Mechanisms

### 1. PreToolUse Hook - Full task_plan.md Injection

Before Write/Edit/Bash operations, the **full** task_plan.md content is injected:

```xml
<task-plan-context>
# Task Plan: feature-name

> **Goal**: Implement user authentication

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Discovery | complete |
| 2 | Implementation | in_progress |
...
</task-plan-context>

<reminder>
Stay focused on the current phase. Do not deviate from the goal.
</reminder>
```

**KV-Cache Optimization**: By keeping the prefix stable across tool calls, we maximize KV-cache hits, reducing latency and cost.

### 2. Two-Action Rule - Auto-Reset Detection

After 2 Read/WebFetch/Grep operations, reminds to update findings.md:

```xml
<two-action-rule>
## Update findings.md NOW

2 research operations completed.

Update `.sisyphus/plans/{plan}/findings.md` with:
- Key discoveries
- Technical decisions
- Resources found

Counter auto-resets when you modify findings.md.
</two-action-rule>
```

**Auto-Detection**: Uses file mtime to detect findings.md modifications. No need to say "updated findings" - the counter resets automatically when the file is modified.

### 3. Three-Strike Error Protocol

Structured error handling with escalation:

| Strike | Action | Guidance |
|--------|--------|----------|
| 1 | Diagnose | Read error carefully, check context |
| 2 | Pivot | Try alternative approach |
| 3 | Reassess | Review assumptions, consider blocking phase |
| 4+ | Escalate | Mark phase as BLOCKED, ask for help |

Example injection:

```xml
<three-strike-protocol strike="2">
**Strike 2/3**: Pivot - Try alternative approach

Error: Command failed with exit code 1...
</three-strike-protocol>
```

### 4. Stop Verification

Supports both `complete` and `blocked` as terminal states:

```markdown
## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Discovery | complete |    ← Allows stop
| 2 | Implementation | blocked | ← Allows stop (with reason)
| 3 | Testing | pending |        ← Blocks stop
```

If incomplete phases exist, provides options:

```
Incomplete phases:
- Phase 3: Testing (pending)

**Options**:
1. Complete remaining phases
2. Mark phases as `blocked` in task_plan.md
3. Use `/stop --force` to override
```

### 5. State Persistence

State is persisted to `.planning-state.json`:

```json
{
  "planName": "add-auth",
  "actionCount": 1,
  "lastFindingsMtime": 1704067200000,
  "errorStrikes": {
    "Bash:npm install failed": 2
  },
  "activatedAt": "2024-01-01T00:00:00.000Z",
  "lastActivityAt": "2024-01-01T01:30:00.000Z"
}
```

This enables:
- **Session recovery**: State survives process restarts
- **Cross-session continuity**: Resume where you left off
- **Accurate mtime detection**: No keyword matching needed

## Silent Tool Output

To further reduce context consumption, use the `silent-tool-output` hook in conjunction with planning-with-files.

### The Problem

Even when content is written to persistent files, the tool output returns full content back into context:

```
Agent: Write("task_plan.md", <200 lines>)
    ↓
Tool Output: "Successfully wrote:\n<200 lines>"  ← Full content in context!
    ↓
Context: Contains 200 lines (defeats the purpose of persistent storage)
```

### The Solution

Silent Tool Output replaces verbose outputs with minimal metadata:

```
Agent: Write("task_plan.md", <200 lines>)
    ↓
Tool Output: "✓ task_plan.md updated"  ← Only metadata
    ↓
Context: Just the confirmation (trust the filesystem)
```

### Configuration

```json
{
  "silent_tool_output": {
    "silent_write": true,
    "optimize_planning_reads": true,
    "optimize_search": true,
    "search_max_lines": 20
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `silent_write` | `true` | Replace write outputs with metadata only |
| `optimize_planning_reads` | `true` | Minimize read output for planning files |
| `optimize_search` | `true` | Truncate long search results |
| `search_max_lines` | `20` | Max lines before truncation |

### Before/After Comparison

| Tool | Before | After | Reduction |
|------|--------|-------|-----------|
| **Write** | `Successfully wrote:\n<200 lines>` | `✓ file.ts written (5KB, 200 lines)` | ~95% |
| **Edit** | `Modified:\n<full content>` | `✓ file.ts updated` | ~95% |
| **Read** (planning) | `<full content>` | `✓ task_plan.md loaded - in <task-plan-context>` | ~90% |
| **Grep** | `<100 matches>` | `<20 matches>\n... and 80 more` | ~80% |

### Core Principle

**"Trust the filesystem, not the context"**

- Write tools only need to confirm success, not echo content
- Planning files are already injected via PreToolUse, Read output is redundant
- Search results provide location references; use Read for detailed content

## Usage

### Starting a Planning Session

Use keywords to initialize:

```
start planning for "feature-name"
init plan "bug-fix"
create plan for "refactoring"
```

The system creates the 3-file structure and activates hooks.

### During Work

1. **Before Write/Edit/Bash**: task_plan.md auto-injected as context
2. **After 2 research operations**: Reminded to update findings.md
3. **When findings.md modified**: Action counter auto-resets
4. **On errors**: 3-strike protocol guidance provided
5. **On stop attempt**: Incomplete phases block termination

### Completing Work

Ensure all phases are `complete` or `blocked` before stopping.

## Integration with Multi-Plan

When `auto_from_multi_plan: true`, after a multi-plan session completes:

1. Goal extracted from unified plan
2. Phases extracted from TODOs or headers
3. Research findings collected from all model plans
4. 3-file structure created automatically

This enables seamless transition from planning to execution with full tracking.

## File Templates

### task_plan.md

```markdown
# Task Plan: {name}

> **Goal**: {goal}

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | pending | Understand requirements |
| 2 | Implementation | pending | Build the solution |
| 3 | Verification | pending | Test and validate |

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| - | (none yet) | - |

## Errors (3-Strike Protocol)

| # | Error | Strikes | Resolution |
|---|-------|---------|------------|
| - | (none yet) | - | - |

---
*Created: 2024-01-01*
```

### findings.md

```markdown
# Findings: {name}

## Research

| Source | Finding |
|--------|---------|
| - | (update after 2 actions) |

## Resources

| Name | URL |
|------|-----|
| - | - |

---
*Last updated: 2024-01-01*
```

### progress.md

```markdown
# Progress: {name}

## Session Log

| Time | Action | Files |
|------|--------|-------|
| 10:30 | Session started | - |

## 5-Question Reboot

Use when resuming after a break:

1. **Where am I?** - Current phase and file
2. **Where am I going?** - Next steps
3. **What is my goal?** - The north star
4. **What have I learned?** - Key findings
5. **What have I completed?** - Achievements
```

## Performance Summary

| Metric | Effect |
|--------|--------|
| KV-Cache utilization | ~80% (stable prefix) |
| State recovery | 100% (persisted to disk) |
| Findings detection accuracy | 100% (mtime-based) |
| Write context reduction | ~95% (metadata only) |
| Template size | Minimal (50 lines) |

## Best Practices

### When to Use

Apply planning-with-files for:
- Multi-step tasks (3+ steps)
- Research-heavy projects
- Tasks with many tool calls (5+)
- Complex feature implementations
- Debugging sessions

### When to Skip

Skip for:
- Simple questions
- Single-file edits
- Quick lookups
- Trivial fixes

### Tips

1. **Update findings immediately**: Capture discoveries as you find them
2. **Log errors promptly**: Prevents repeating failed approaches
3. **Use blocked status**: Don't leave phases stuck in_progress indefinitely
4. **Trust the filesystem**: Don't manually re-read files that are auto-injected
5. **Review task_plan regularly**: Keep the goal visible

## Troubleshooting

### Files not created

Ensure planning-with-files hook is not disabled:

```json
{
  "disabled_hooks": []  // Should not include "planning-with-files"
}
```

### State not persisting

Check that `.planning-state.json` exists in the plan directory and is writable.

### Stop not blocked

Verify `stop_verification: true` and that an active plan exists for the session.

### Auto-reset not working

Ensure you're modifying the actual `findings.md` file, not a different file. The mtime detection only works on the exact planning file paths.
