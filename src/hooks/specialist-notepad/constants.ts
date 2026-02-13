export const HOOK_NAME = "specialist-notepad"

export const NOTEPAD_DIRECTIVE = `
<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: .orchestrator/notepads/{planId}/
- learnings.md: Record patterns, conventions, successful approaches
- issues.md: Record problems, blockers, gotchas encountered
- decisions.md: Record architectural choices and rationales
- problems.md: Record unresolved issues, technical debt

You SHOULD append findings to notepad files after completing work.
IMPORTANT: Always APPEND to notepad files - never overwrite or use Edit tool.

## Plan Location (READ ONLY)
PLAN PATH: .orchestrator/plans/{planId}/plan.md

CRITICAL RULE: NEVER MODIFY THE PLAN FILE

The plan file (.orchestrator/plans/*/plan.md) is SACRED and READ-ONLY.
- You may READ the plan to understand task intent
- Task state truth is TaskGraph under .orchestrator/tasks/plan/{planId}/task_*.json
- You MUST NOT edit, modify, or update the plan file
- You MUST NOT treat markdown checkboxes as execution state
- Only the Orchestrator manages the plan file

VIOLATION = IMMEDIATE FAILURE. The Orchestrator tracks plan state.
</Work_Context>
`
