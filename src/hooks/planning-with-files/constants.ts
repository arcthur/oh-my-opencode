/**
 * Planning with Files Hook Constants
 */

/** Tools that trigger task plan re-read before execution */
export const REREAD_TRIGGER_TOOLS = [
  "Write",
  "Edit",
  "Bash",
  "NotebookEdit",
  "MultiEdit",
]

/** Tools that count toward the 2-action rule */
export const ACTION_COUNT_TOOLS = [
  "Read",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "Task",
]

/** Minimum time between re-reads (ms) to avoid spam */
export const MIN_REREAD_INTERVAL = 30000 // 30 seconds

/** Action threshold for the 2-action rule */
export const ACTION_THRESHOLD = 2

/** Hook event names */
export const HOOK_EVENTS = {
  PRE_TOOL_USE: "PreToolUse",
  POST_TOOL_USE: "PostToolUse",
  STOP: "Stop",
} as const

/** Planning file names */
export const PLANNING_FILES = {
  TASK_PLAN: "task_plan.md",
  FINDINGS: "findings.md",
  PROGRESS: "progress.md",
} as const
