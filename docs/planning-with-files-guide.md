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
.sisyphus/{directory}/{plan-name}/
├── task_plan.md           # Phases, goals, decisions, errors, blockers
├── findings.md            # Research results (2-action rule)
├── progress.md            # Session logs, phase transitions
└── .planning-state.json   # Persisted state (action count, error strikes)
```

### task_plan.md - Working Memory

Your primary planning document containing:
- **Goal**: North-star statement to prevent drift
- **Phases**: Status-tracked stages (pending → in_progress → complete → blocked)
- **Decisions**: Documented choices with rationale
- **Errors**: 3-strike protocol tracking (forced recording on Strike 2+)
- **Blockers**: Issues requiring external intervention

### findings.md - Knowledge Base

Persistent research storage containing:
- **Research**: Source-attributed discoveries
- **Resources**: URLs and references

### progress.md - Session History

Execution log for context continuity containing:
- **Session Log**: Actions and files modified
- **Phase Transitions**: Tracks when phases started/completed/revisited
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
| `two_action_rule` | `true` | Remind to update findings after 2 research ops |
| `three_strike_protocol` | `true` | Structured error handling with escalation |
| `auto_reread` | `true` | Re-read task_plan before Write/Edit/Bash/NotebookEdit |
| `stop_verification` | `true` | Block stopping if phases are incomplete |
| `auto_from_multi_plan` | `true` | Auto-create planning files from multi-plan results |
| `reread_trigger_tools` | `["Write", "Edit", "Bash", "NotebookEdit"]` | Tools that trigger task_plan.md injection |
| `action_count_tools` | `["Read", "WebFetch", "WebSearch", "Glob", "Grep", "Task"]` | Tools counted for 2-action rule |

## Core Mechanisms

### 1. PreToolUse Hook - Full task_plan.md Injection

Before Write/Edit/Bash/NotebookEdit operations, the **full** task_plan.md content is injected:

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

**OpenCode Implementation Note**: Injection is performed via ContextCollector + `experimental.chat.messages.transform`, so the plan appears as a stable prefix without mutating stored conversation history.

**KV-Cache Optimization**: By keeping the prefix stable across tool calls, we maximize KV-cache hits, reducing latency and cost.

### 2. Two-Action Rule - Auto-Reset Detection

After every 2 research operations (Read/WebFetch/WebSearch/Glob/Grep/Task), reminds to update findings.md (2, 4, 6, ...). The counter auto-resets when you modify findings.md (mtime-based).

```xml
<two-action-rule>
## Update findings.md NOW

2 research operations completed.

Update `.sisyphus/{directory}/{plan}/findings.md` with:
- Key discoveries
- Technical decisions
- Resources found

Counter auto-resets when you modify findings.md.
</two-action-rule>
```

**Auto-Detection**: Uses file mtime to detect findings.md modifications. No need to say "updated findings" - the counter resets automatically when the file is modified.

### 3. Three-Strike Error Protocol

Structured error handling with forced recording and escalation:

| Strike | Action | Guidance |
|--------|--------|----------|
| 1 | Diagnose | Read error carefully, check context |
| 2 | Pivot | Try alternative approach + **MUST record in task_plan.md** |
| 3 | Reassess | Review assumptions + **MUST record in task_plan.md** |
| 4+ | Escalate | Add to Blockers section, ask for help |

**Forced Error Recording (Strike 2+)**

On the second occurrence of an error, the agent is required to document it:

```xml
<error-recording-required>
## Record Error Before Continuing

This error has occurred 2 times. You MUST record it in task_plan.md before retrying.

**Add to ## Errors section:**

| # | Error | Phase | Attempts | Root Cause | Resolution |
|---|-------|-------|----------|------------|------------|
| N | Bash:npm install failed | Phase 2 | 2 | [ANALYZE] | [PLAN] |

**Required fields:**
- **Root Cause**: Why is this happening? (not just "it failed")
- **Resolution**: What different approach will you try?
</error-recording-required>
```

This prevents blind retries and forces the agent to analyze before trying again.

### 4. Blockers vs Errors

**Errors** are issues that can potentially be resolved by the agent:
- Command failures
- Syntax errors
- Missing dependencies

**Blockers** require external intervention:
- Missing credentials or permissions
- External service unavailable
- Design decisions needing human input
- Multiple approaches exhausted

The Blockers section in task_plan.md:

```markdown
## Blockers (Require Escalation)

| # | Blocker | Phase | Impact | Status | Escalation |
|---|---------|-------|--------|--------|------------|
| 1 | Missing API key | 2 | Cannot test auth | open | Need user to provide key |
```

### 5. Phase Reflection

When a phase transitions to `complete`, the agent receives a reflection prompt encouraging non-linear planning adjustments:

```xml
<phase-reflection>
## Phase 2 Complete: Implementation

**Before proceeding, reflect on:**

1. **Discoveries**: Did you learn anything that affects the remaining plan?
2. **Assumptions**: Were any assumptions proven wrong?
3. **Remaining Phases**: Do they still make sense?

**Remaining:**
  - Phase 3: Verification (pending)

**Actions you can take:**
- Add new phases if needed
- Remove phases that are no longer relevant
- Reorder phases based on new understanding
- Update phase descriptions with new context

**Update task_plan.md if any changes are needed, then continue.**
</phase-reflection>
```

This enables graph-like navigation instead of linear Phase 1 → Phase 2 → Phase 3 execution.

### 6. Stop Verification

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

**Operational Notes**:
- Stop verification is advisory (prompt-based) and throttled per session to avoid repeated injections.
- If `todo-continuation-enforcer` is enabled and pending TODOs exist, stop verification defers to it to avoid duplicate continuation prompts.

### 7. State Persistence

State is persisted to `.planning-state.json`:

```json
{
  "planName": "add-auth",
  "actionCount": 1,
  "lastFindingsMtime": 1767225600000,
  "errorStrikes": {
    "Bash:npm install failed": 2
  },
  "activatedAt": "2026-01-01T00:00:00.000Z",
  "lastActivityAt": "2026-01-01T01:30:00.000Z"
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
    "search_max_lines": 20,
    "preview_max_chars": 200
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
| `preview_max_chars` | `200` | Max characters for content preview |

### Before/After Comparison

| Tool | Before | After | Reduction |
|------|--------|-------|-----------|
| **Write** | `Successfully wrote:\n<200 lines>` | `✓ file.ts written (5000 bytes, 200 lines)` | ~95% |
| **Edit** | `Modified:\n<full content>` | `✓ file.ts updated` | ~95% |
| **Read** (planning) | `<full content>` | `✓ task_plan.md loaded (50 lines) - content available in <task-plan-context>` | ~90% |
| **Grep** | `<100 matches>` | `<20 matches>\n... and 80 more results (use Read tool to view specific files)` | ~80% |

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
Initialization is idempotent: existing planning files are not overwritten; re-running the directive simply (re)activates the plan.

### During Work

1. **Before Write/Edit/Bash**: task_plan.md auto-injected as context
2. **After every 2 research operations**: Reminded to update findings.md (until findings.md is updated)
3. **When findings.md modified**: Action counter auto-resets
4. **On errors**: 3-strike protocol guidance provided (best-effort, based on tool output markers)
5. **On session idle**: If phases are incomplete, a continuation prompt is injected unless you force-stop

### Completing Work

Ensure all phases are `complete` or `blocked` before stopping.

## Integration with Multi-Plan

When `auto_from_multi_plan: true`, after a successful `multi_plan` tool run completes:

1. Planning files are initialized at `.sisyphus/{directory}/{planName}/` (if missing)
2. `task_plan.md` starts from the default template (edit freely)
3. The unified plan remains the source of truth for detailed TODOs; planning-with-files focuses on persistence, error tracking, and lightweight phase gating

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

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| - | (none yet) | - | - |

## Errors (Must Record on Strike 2+)

| # | Error | Phase | Attempts | Root Cause | Resolution |
|---|-------|-------|----------|------------|------------|
| - | (none yet) | - | - | - | - |

## Blockers (Require Escalation)

| # | Blocker | Phase | Impact | Status | Escalation |
|---|---------|-------|--------|--------|------------|
| - | (none yet) | - | - | - | - |

---
*Created: 2026-01-01*
*Last Reflection: (none yet)*
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
*Last updated: 2026-01-01*
```

### progress.md

```markdown
# Progress: {name}

## Session Log

| Time | Action | Files |
|------|--------|-------|
| 10:30 | Session started | - |

## Phase Transitions

| Phase | Started | Completed | Revisited |
|-------|---------|-----------|-----------|
| - | - | - | - |

## 5-Question Reboot

1. **Where am I?** -
2. **Where am I going?** -
3. **What is my goal?** -
4. **What have I learned?** -
5. **What have I completed?** -
```

## Performance Summary

| Metric | Effect |
|--------|--------|
| KV-cache utilization | Improved via a stable, repeatable prefix |
| State recovery | Survives restarts via disk state (`.planning-state.json`) |
| Findings reset signal | mtime-based (no keyword parsing) |
| Context reduction (with `silent-tool-output`) | Reduces redundant Write/Edit echoes |
| Error retry prevention | Forced recording on Strike 2+ |
| Plan adaptability | Reflection prompts on phase completion |

## Design Trade-offs

### What This Optimizes For

- **Context stability**: A stable task plan prefix to reduce drift across long sessions.
- **Persistence**: Critical state lives on disk and survives restarts.
- **Low redundancy**: Hooks inject the minimum needed context; the filesystem remains the source of truth.

### What This Trades Off

- **Active plan selection**: Session-scoped when possible; otherwise falls back to a heuristic (most recently active plan by state mtime).
- **3-strike detection**: Best-effort (based on output markers), so signatures may be imperfect across tools/providers.
- **Stop verification**: Advisory (prompt-based). It cannot hard-block `/stop` in OpenCode today; it encourages explicit `complete`/`blocked` states or a conscious `/stop --force`.

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
6. **Distinguish errors from blockers**: Errors can be retried; blockers need external help
7. **Embrace reflection prompts**: Use phase completion as opportunity to adapt the plan
8. **Record root causes**: On Strike 2+, analyze why before trying again

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
