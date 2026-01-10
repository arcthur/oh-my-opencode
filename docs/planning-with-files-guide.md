# Planning with Files Guide

> Manus-style persistent planning pattern: "Context Window = RAM (volatile); Filesystem = Disk (persistent)"

## Overview

Planning with Files implements a persistent markdown-based planning system inspired by [Manus](https://github.com/OthmanAdi/planning-with-files). It uses three files as "working memory on disk" to overcome limitations in AI agent context windows.

### Core Principles

1. **Filesystem as Persistent Memory**: Context windows are volatile and limited; files persist indefinitely
2. **2-Action Rule**: Update findings after every 2 view/search operations to prevent information loss
3. **3-Strike Protocol**: Structured error handling with escalation
4. **Auto Re-read**: Re-read task plan before critical operations to prevent goal drift
5. **Stop Verification**: Ensure all phases complete before task termination

## The 3-File Pattern

Every complex task creates three markdown files:

```
.sisyphus/planning/{plan-name}/
├── task_plan.md    # Phases, goals, decisions, errors
├── findings.md     # Research, technical decisions, resources
└── progress.md     # Session logs, test results, timestamps
```

### 1. task_plan.md - Working Memory

Your primary planning document. Contains:
- **Goal**: North-star statement to prevent drift
- **Phases**: Status-tracked stages (pending → in_progress → complete)
- **Decisions**: Documented choices with rationale
- **Errors**: 3-strike protocol tracking

### 2. findings.md - Knowledge Base

Persistent research storage. Contains:
- **Requirements**: Discovered requirements
- **Research Findings**: Source-attributed discoveries
- **Technical Decisions**: Architecture choices
- **Resources**: URLs and references
- **Visual Findings**: Text descriptions of multimodal content

### 3. progress.md - Session History

Execution log for context continuity. Contains:
- **Phase Logs**: Actions and files modified per phase
- **Test Results**: Verification outcomes
- **Error Log**: Detailed error tracking
- **5-Question Reboot Check**: Context recovery helper

## Configuration

Enable in `.opencode/oh-my-opencode.json`:

```json
{
  "planning_with_files": {
    "enabled": true,
    "directory": "planning",
    "two_action_rule": true,
    "three_strike_protocol": true,
    "auto_reread": true,
    "stop_verification": true,
    "auto_from_multi_plan": true
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable the planning-with-files pattern |
| `directory` | `"planning"` | Directory for planning files (relative to .sisyphus/) |
| `two_action_rule` | `true` | Remind to update findings after 2 view/search ops |
| `three_strike_protocol` | `true` | Structured error handling with escalation |
| `auto_reread` | `true` | Re-read task_plan before Write/Edit/Bash |
| `stop_verification` | `true` | Block stopping if phases are incomplete |
| `auto_from_multi_plan` | `true` | Auto-create planning files from multi-plan results |
| `reread_trigger_tools` | (preset) | Tools that trigger plan re-read |
| `action_count_tools` | (preset) | Tools that count toward 2-action rule |

## Usage

### Starting a Planning Session

Use keywords to initialize:

```
start planning for "feature-name"
init plan "bug-fix"
create plan for "refactoring"
```

The system will create the 3-file structure and activate the hooks.

### During Work

1. **Before Write/Edit/Bash**: Task plan is automatically re-read and context injected
2. **After 2 view/search operations**: Reminded to update findings.md
3. **On errors**: 3-strike protocol guidance provided
4. **On stop**: Incomplete phases block termination

### The 2-Action Rule

After every 2 operations from:
- Read
- WebFetch
- WebSearch
- Glob
- Grep
- Task

You'll receive a reminder:

```
<two-action-rule>
## Findings Update Reminder

Update findings.md to persist:
- Key discoveries from your research
- Technical decisions made
- Resources found
</two-action-rule>
```

After updating, the counter resets.

### The 3-Strike Protocol

When errors occur:

| Strike | Action |
|--------|--------|
| 1 | Diagnose the root cause |
| 2 | Try alternative approaches |
| 3 | Rethink assumptions |
| 4+ | ESCALATE - ask for help or block phase |

Errors are tracked per error type. Resolution clears strikes.

### Stop Verification

Before stopping, the system verifies all phases are complete:

```
Cannot stop - incomplete phases detected:
- Phase 2: Implementation (in_progress)
- Phase 3: Testing (pending)

Either complete these phases or mark them as blocked.
```

## Integration with Multi-Plan

When `auto_from_multi_plan: true`, after a multi-plan session completes:

1. Goal is extracted from the unified plan
2. Phases are extracted from TODOs or headers
3. Research findings are collected from all model plans
4. Resources are extracted from the unified plan
5. 3-file structure is created in `.sisyphus/planning/{plan-name}/`

This enables seamless transition from planning to execution with full tracking.

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

1. **Update findings immediately**: Don't wait - capture discoveries as you find them
2. **Log errors promptly**: Prevents repeating failed approaches
3. **Review task_plan regularly**: Keep the goal visible
4. **Use progress.md for breaks**: The 5-question reboot check helps resume
5. **Mark blocked phases**: Don't leave phases stuck in_progress indefinitely

## File Structure Example

```markdown
# Task Plan: add-authentication

> **Goal**: Implement JWT-based authentication with refresh tokens

---

## Phases

| # | Phase | Status | Description |
|---|-------|--------|-------------|
| 1 | Requirements & Discovery | complete | Understand auth requirements |
| 2 | Planning & Design | complete | Design token strategy |
| 3 | Implementation | in_progress | Build auth system |
| 4 | Testing | pending | Verify security |
| 5 | Delivery | pending | Document and deploy |

---

## Decisions Made

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| 1 | JWT with refresh tokens | Mobile + web support needed | 2 |
| 2 | Redis for token blacklist | Fast invalidation | 2 |

---

## Errors Encountered (3-Strike Protocol)

| # | Error | Attempt | Action Taken | Resolution |
|---|-------|---------|--------------|------------|
| 1 | Token validation failed | 1 | Check secret key | Key was not base64 encoded |
```

## Related Features

- **Multi-Plan**: Multi-model planning with synthesis
- **Plan Synthesizer**: Momus-style plan review
- **Metis**: Plan consultant for AI slop detection

## Troubleshooting

### Files not created

Ensure the planning-with-files hook is not disabled:
```json
{
  "disabled_hooks": []  // Should not include "planning-with-files"
}
```

### Re-read not triggering

Check if enough time has passed (30s minimum between re-reads) and if there's an active plan.

### Stop not blocked

Verify `stop_verification: true` and that an active plan exists for the session.
