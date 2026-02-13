import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createTaskNode, listTaskNodes } from "../../features/task-system"
import { createWorkStateManager, type WorkState } from "../../features/work-state"
import { getMainSessionID, isSubagentSession, updateSessionAgent } from "../../features/claude-code-session-state"
import { appendBudgetedOutput, injectBudgetedPrompt } from "../../features/context-view"
import { DiscoveryChannel } from "../../features/discovery-channel"
import {
  VerifierGateStateStore,
  buildVerifierMissingEvidenceGuidance,
  classifyVerificationEvidence,
  isWriteMutationTool,
  type VerificationVerdict,
} from "../../features/verifier-gate"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getExecutionPolicy } from "../../features/orchestration/policy"
import { log } from "../../shared/logger"
import { createSystemDirective, SYSTEM_DIRECTIVE_PREFIX, SystemDirectiveTypes } from "../../shared/system-directive"
import { getMessageDir, resolveExecutionOwnership } from "../../shared/session-utils"
import type { BackgroundManager } from "../../features/background-agent"
import type {
  AutoHandoffRequest,
  AutoHandoffResult,
} from "../../features/session-handoff/types"
import type { ContinuationIntent } from "./continuation"
import { getGitDiffStats, type GitFileStat } from "./git-diff-stats"

export const HOOK_NAME = "work-orchestrator:execution"

/**
 * Cross-platform check if a path is inside .sisyphus/ directory.
 * Handles both forward slashes (Unix) and backslashes (Windows).
 */
function isSisyphusPath(filePath: string): boolean {
  return /\.sisyphus[/\\]/.test(filePath)
}

const WRITE_EDIT_TOOLS = ["Write", "Edit", "write", "edit"]

type DelegationNoticePhase = "before-write" | "after-write"

function buildDelegationRequiredNotice(input: {
  phase: DelegationNoticePhase
  executorName: string
  filePath: string
}): string {
  const statusLine =
    input.phase === "before-write"
      ? "You are attempting a direct source edit."
      : "You already made a direct source edit."

  return `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

**DELEGATION REQUIRED**
${statusLine}

Executor: ${input.executorName}
Path: \`${input.filePath}\` (outside \`.sisyphus/\`)

Atlas rule:
- Delegate implementation via \`delegate_task\`
- Verify results with your own tool calls
- Keep direct edits limited to \`.sisyphus/*\` artifacts or tiny verification-only fixes

Next action:
\`\`\`typescript
delegate_task(
  description="Atomic implementation task",
  category="...",
  load_skills=[],
  run_in_background=false,
  prompt="[single objective + explicit verification]"
)
\`\`\`

---
`
}

const ATLAS_WORK_CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.WORK_CONTINUATION)}

ATLAS EXECUTION CONTINUATION

You are Atlas, the execution orchestrator for this plan.
Continue deterministic execution using work state + TaskGraph SSOT.

RULES:
- Proceed without asking for permission
- Select the next ready task with \`task_list\` (scope=plan)
- Advance state with \`task_transition\` (\`open -> in_progress -> completed\`)
- Delegate implementation work and verify every result
- Do not stop until TaskGraph has no remaining tasks
- If blocked, record the blocker and continue with another ready task

Plan file: \`{PLAN_PATH}\`

TaskGraph scope: \`plan\`
TaskGraph container_id: \`{PLAN_NAME}\``

const EXECUTION_AGENT_LABEL = "Atlas"
const DEFAULT_COMPLETION_FALLBACK_AGENT = "sisyphus"

const VERIFICATION_REMINDER = `**MANDATORY: WHAT YOU MUST DO RIGHT NOW**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CRITICAL: Subagents FREQUENTLY LIE about completion.
Tests FAILING, code has ERRORS, implementation INCOMPLETE - but they say "done".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**STEP 1: VERIFY WITH YOUR OWN TOOL CALLS (DO THIS NOW)**

Run these commands YOURSELF - do NOT trust agent's claims:
1. \`lsp_diagnostics\` on changed files → Must be CLEAN
2. \`bash\` to run tests → Must PASS
3. \`bash\` to run build/typecheck → Must succeed
4. \`Read\` the actual code → Must match requirements

**STEP 2: DETERMINE IF HANDS-ON QA IS NEEDED**

| Deliverable Type | QA Method | Tool |
|------------------|-----------|------|
| **Frontend/UI** | Browser interaction | \`/playwright\` skill |
| **TUI/CLI** | Run interactively | \`interactive_bash\` (tmux) |
| **API/Backend** | Send real requests | \`bash\` with curl |

Static analysis CANNOT catch: visual bugs, animation issues, user flow breakages.

**STEP 3: IF QA IS NEEDED - ADD A TASK IMMEDIATELY**

\`\`\`
task_create({
  title: "qa-X HANDS-ON QA: [specific verification action]",
  priority: 100,
})
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**BLOCKING: DO NOT proceed to Step 4 until Steps 1-3 are VERIFIED.**`

const VERIFICATION_REMINDER_COMPACT = `**VERIFICATION LOOP (COMPACT)**

Repeat this on every delegated result:
1. Run \`lsp_diagnostics\` on changed files
2. Run targeted tests + typecheck/build commands
3. Read changed code and confirm acceptance criteria
4. Decide if hands-on QA is required (\`/playwright\`, \`interactive_bash\`, or API probes)

If ANY check fails, delegate one atomic fix immediately.`

const SINGLE_TASK_DIRECTIVE = `

${createSystemDirective(SystemDirectiveTypes.SINGLE_TASK_ONLY)}

**STOP. READ THIS BEFORE PROCEEDING.**

If you were NOT given **exactly ONE atomic task**, you MUST:
1. **IMMEDIATELY REFUSE** this request
2. **DEMAND** the orchestrator provide a single, specific task

**Your response if multiple tasks detected:**
> "I refuse to proceed. You provided multiple tasks. An orchestrator's impatience destroys work quality.
> 
> PROVIDE EXACTLY ONE TASK. One file. One change. One verification.
> 
> Your rushing will cause: incomplete work, missed edge cases, broken tests, wasted context."

**WARNING TO ORCHESTRATOR:**
- Your hasty batching RUINS deliverables
- Each task needs FULL attention and PROPER verification  
- Batch delegation = sloppy work = rework = wasted tokens

**REFUSE multi-task requests. DEMAND single-task clarity.**
`

const EXECUTION_MODE_TASK_WARNING = `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

Execution Mode policy forbids direct use of \`task\`.
Use TaskGraph tools (\`task_create\`, \`task_get\`, \`task_list\`, \`task_update\`, \`task_transition\`) or \`delegate_task\` with a single atomic objective and explicit acceptance criteria.

---
`

const EXECUTION_MODE_TASK_BLOCK_ERROR =
  "The `task` tool is forbidden in Execution Mode. Use `delegate_task` with one atomic objective."

const EXECUTION_POLICY = getExecutionPolicy()
const EXECUTION_MODE_PROMPT_MIN_NON_EMPTY_LINES = EXECUTION_POLICY.delegatePrompt.minNonEmptyLines
const EXECUTION_MODE_REQUIRED_PROMPT_SECTIONS = EXECUTION_POLICY.delegatePrompt.requiredSections

function getExecutionPromptValidationErrors(prompt: string): string[] {
  const errors: string[] = []

  const nonEmptyLines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length

  if (nonEmptyLines < EXECUTION_MODE_PROMPT_MIN_NON_EMPTY_LINES) {
    errors.push(
      `Prompt must contain at least ${EXECUTION_MODE_PROMPT_MIN_NON_EMPTY_LINES} non-empty lines (got ${nonEmptyLines}).`
    )
  }

  const missingSections = EXECUTION_MODE_REQUIRED_PROMPT_SECTIONS
    .filter((section) => !section.pattern.test(prompt))
    .map((section) => section.name)

  if (missingSections.length > 0) {
    errors.push(`Missing sections: ${missingSections.join(", ")}.`)
  }

  return errors
}

function enforceExecutionModeDelegatePrompt(prompt: unknown): void {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error(
      "Delegate prompt missing required execution sections. Provide a structured prompt with TASK/EXPECTED OUTCOME/REQUIRED TOOLS/MUST DO/MUST NOT DO/CONTEXT."
    )
  }

  const errors = getExecutionPromptValidationErrors(prompt)
  if (errors.length === 0) return

  throw new Error(
    `Delegate prompt missing required execution sections. ${errors.join(" ")}`
  )
}

type VerificationReminderMode = "full" | "compact"
type WorkProgress = { total: number; completed: number }

const ORCHESTRATOR_REMINDER_CHAR_BUDGET = 4200
const ORCHESTRATOR_REMINDER_DOWNGRADE_MARKER = "[orchestrator reminder downgraded due to context budget]"
const ORCHESTRATOR_REMINDER_TRUNCATION_MARKER = "[orchestrator reminder truncated to fit context budget]"
const ORCHESTRATOR_PLAN_ID_MAX_LENGTH = 120
const ORCHESTRATOR_PLAN_PATH_MAX_LENGTH = 220
const ORCHESTRATOR_SESSION_ID_MAX_LENGTH = 220
type OrchestratorReminderProfile = "full" | "compact" | "ultra-compact"
type OrchestratorReminderReason =
  | "none"
  | "field-truncation"
  | "budget-downgrade"
  | "hard-budget-truncate"
  | "field-truncation+budget-downgrade"
  | "field-truncation+hard-budget-truncate"

export interface OrchestratorReminderTelemetry {
  profile: OrchestratorReminderProfile
  reason: OrchestratorReminderReason
  charLength: number
  charBudget: number
  fieldTruncated: boolean
  budgetDowngraded: boolean
  hardTruncated: boolean
}

export interface OrchestratorReminderBuildResult {
  content: string
  telemetry: OrchestratorReminderTelemetry
}

interface ReminderTelemetrySummary {
  total: number
  full: number
  compact: number
  ultraCompact: number
  budgetDowngrades: number
  fieldTruncations: number
  hardTruncations: number
}

interface ReminderTelemetryPersistenceSnapshot {
  schema_version: 1
  plan_id: string
  updated_at: string
  summary: ReminderTelemetrySummary
}

function createEmptyReminderTelemetrySummary(): ReminderTelemetrySummary {
  return {
    total: 0,
    full: 0,
    compact: 0,
    ultraCompact: 0,
    budgetDowngrades: 0,
    fieldTruncations: 0,
    hardTruncations: 0,
  }
}

function addReminderTelemetrySummary(
  target: ReminderTelemetrySummary,
  source: ReminderTelemetrySummary
): void {
  target.total += source.total
  target.full += source.full
  target.compact += source.compact
  target.ultraCompact += source.ultraCompact
  target.budgetDowngrades += source.budgetDowngrades
  target.fieldTruncations += source.fieldTruncations
  target.hardTruncations += source.hardTruncations
}

const REMINDER_TELEMETRY_SNAPSHOT_VERSION = 1
const REMINDER_TELEMETRY_FILE_NAME = "orchestrator-reminder-telemetry.json"

function getReminderTelemetryPath(workspaceDir: string, planId: string): string {
  return join(workspaceDir, ".sisyphus", "plans", planId, REMINDER_TELEMETRY_FILE_NAME)
}

function cloneReminderTelemetrySummary(summary: ReminderTelemetrySummary): ReminderTelemetrySummary {
  return {
    ...summary,
  }
}

function truncatePromptField(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 16) return `${value.slice(0, maxLength)}...`

  const prefixLength = maxLength - 16
  const omitted = value.length - prefixLength
  return `${value.slice(0, prefixLength)}...[+${omitted}]`
}

function truncateOrchestratorReminder(content: string): string {
  const suffix = `\n${ORCHESTRATOR_REMINDER_TRUNCATION_MARKER}`
  const maxPrefixLength = Math.max(0, ORCHESTRATOR_REMINDER_CHAR_BUDGET - suffix.length)
  return `${content.slice(0, maxPrefixLength).trimEnd()}${suffix}`
}

function deriveOrchestratorReminderReason(
  fieldTruncated: boolean,
  budgetDowngraded: boolean,
  hardTruncated: boolean
): OrchestratorReminderReason {
  if (hardTruncated) {
    return fieldTruncated ? "field-truncation+hard-budget-truncate" : "hard-budget-truncate"
  }
  if (budgetDowngraded) {
    return fieldTruncated ? "field-truncation+budget-downgrade" : "budget-downgrade"
  }
  if (fieldTruncated) {
    return "field-truncation"
  }
  return "none"
}

function toOrchestratorReminderResult(
  content: string,
  profile: OrchestratorReminderProfile,
  flags: {
    fieldTruncated: boolean
    budgetDowngraded: boolean
    hardTruncated: boolean
  }
): OrchestratorReminderBuildResult {
  return {
    content,
    telemetry: {
      profile,
      reason: deriveOrchestratorReminderReason(
        flags.fieldTruncated,
        flags.budgetDowngraded,
        flags.hardTruncated
      ),
      charLength: content.length,
      charBudget: ORCHESTRATOR_REMINDER_CHAR_BUDGET,
      fieldTruncated: flags.fieldTruncated,
      budgetDowngraded: flags.budgetDowngraded,
      hardTruncated: flags.hardTruncated,
    },
  }
}

function buildVerificationReminder(
  sessionId: string,
  mode: VerificationReminderMode
): string {
  const baseReminder = mode === "compact" ? VERIFICATION_REMINDER_COMPACT : VERIFICATION_REMINDER
  return `${baseReminder}

---

**If ANY verification fails, use this immediately:**
\`\`\`
delegate_task(
  description="Fix verification",
  session_id="${sessionId}",
  load_skills=[],
  run_in_background=false,
  prompt="
## 1. TASK
Fix verification failure with one atomic change.

## 2. EXPECTED OUTCOME
- [ ] Verification command passes.

## 3. REQUIRED TOOLS
- Bash, Read, lsp_diagnostics.

## 4. MUST DO
- Fix only the verified failure.

## 5. MUST NOT DO
- Do not expand scope.

## 6. CONTEXT
- Failure: [describe the specific failure]
"
)
\`\`\``
}

function buildUltraCompactOrchestratorReminder(
  planId: string,
  planPath: string,
  progress: WorkProgress,
  sessionId: string
): string {
  const remaining = progress.total - progress.completed
  return `
---

${ORCHESTRATOR_REMINDER_DOWNGRADE_MARKER}

**WORK STATE (COMPACT):** Plan: \`${planId}\` | ${progress.completed}/${progress.total} done | ${remaining} remaining
Plan file: \`${planPath}\`

**VERIFICATION LOOP (ULTRA-COMPACT)**
1. Run \`lsp_diagnostics\`, targeted tests, and build/typecheck on changed files.
2. Read changed code and confirm acceptance criteria.
3. If any check fails, delegate one atomic fix:
\`\`\`
delegate_task(description="Fix verification", session_id="${sessionId}", run_in_background=false, prompt="[single failure + concrete verification]")
\`\`\`
4. If checks pass, mark task complete via \`task_transition\`.
5. Pull next ready task with \`task_list\` and continue immediately.
`
}

export function buildOrchestratorReminderWithTelemetry(
  planId: string,
  planPath: string,
  progress: WorkProgress,
  sessionId: string,
  verificationReminderMode: VerificationReminderMode
): OrchestratorReminderBuildResult {
  const safePlanId = truncatePromptField(planId, ORCHESTRATOR_PLAN_ID_MAX_LENGTH)
  const safePlanPath = truncatePromptField(planPath, ORCHESTRATOR_PLAN_PATH_MAX_LENGTH)
  const safeSessionId = truncatePromptField(sessionId, ORCHESTRATOR_SESSION_ID_MAX_LENGTH)
  const hasTruncatedField =
    safePlanId !== planId || safePlanPath !== planPath || safeSessionId !== sessionId
  const remaining = progress.total - progress.completed
  const ultraCompactReminder = buildUltraCompactOrchestratorReminder(
    safePlanId,
    safePlanPath,
    progress,
    safeSessionId
  )
  const baseProfile: OrchestratorReminderProfile =
    verificationReminderMode === "compact" ? "compact" : "full"

  if (hasTruncatedField) {
    if (ultraCompactReminder.length <= ORCHESTRATOR_REMINDER_CHAR_BUDGET) {
      return toOrchestratorReminderResult(ultraCompactReminder, "ultra-compact", {
        fieldTruncated: true,
        budgetDowngraded: false,
        hardTruncated: false,
      })
    }

    return toOrchestratorReminderResult(
      truncateOrchestratorReminder(ultraCompactReminder),
      "ultra-compact",
      {
        fieldTruncated: true,
        budgetDowngraded: true,
        hardTruncated: true,
      }
    )
  }

  const fullReminder = `
---

**WORK STATE:** Plan: \`${safePlanId}\` | ${progress.completed}/${progress.total} done | ${remaining} remaining
Plan file: \`${safePlanPath}\`

---

${buildVerificationReminder(safeSessionId, verificationReminderMode)}

**STEP 4: READ SUBAGENT NOTEPAD (LEARNINGS, ISSUES, PROBLEMS)**

Read subagent notepad files now to propagate execution context:
\`\`\`
Glob(".sisyphus/notepads/${safePlanId}/*.md")
\`\`\`
Then \`Read\` each discovered file, especially:
- \`learnings.md\`: reusable patterns and successful approaches
- \`issues.md\`: blockers or gotchas found during implementation
- \`problems.md\`: unresolved follow-ups and technical debt

Use those findings to shape the next delegation and avoid repeated failures.

**STEP 5: MARK COMPLETION IN TASKGRAPH (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

Use \`task_list\` to find the current \`in_progress\` task (should be exactly one), then:
\`\`\`
task_transition({ id: "<task_id>", expected_revision: <revision>, next_state: "completed", scope: "plan", container_id: "${safePlanId}" })
\`\`\`

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 6: HANDOFF VERIFIED CHANGES**

- Stage ONLY the verified changes
- ${
   EXECUTION_POLICY.commit.autoCommitEnabled
     ? "Commit with clear message describing what was done"
     : "Do NOT auto-commit. Report verified delta and let the user decide commit timing."
 }

**STEP 7: PROCEED TO NEXT TASK**

- Use \`task_list({ ready_only: true, scope: "plan", container_id: "${safePlanId}" })\` to find the next ready task
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**${remaining} tasks remain. Keep working.**`
  if (fullReminder.length <= ORCHESTRATOR_REMINDER_CHAR_BUDGET) {
    return toOrchestratorReminderResult(fullReminder, baseProfile, {
      fieldTruncated: false,
      budgetDowngraded: false,
      hardTruncated: false,
    })
  }

  if (ultraCompactReminder.length <= ORCHESTRATOR_REMINDER_CHAR_BUDGET) {
    return toOrchestratorReminderResult(ultraCompactReminder, "ultra-compact", {
      fieldTruncated: false,
      budgetDowngraded: true,
      hardTruncated: false,
    })
  }

  return toOrchestratorReminderResult(
    truncateOrchestratorReminder(ultraCompactReminder),
    "ultra-compact",
    {
      fieldTruncated: false,
      budgetDowngraded: true,
      hardTruncated: true,
    }
  )
}

function extractSessionIdFromOutput(output: string): string {
  const match = output.match(/Session ID:\s*(ses_[a-zA-Z0-9]+)/)
  return match?.[1] ?? "<session_id>"
}

const FILE_CHANGES_SECTION_LIMIT = 4
const FILE_CHANGES_CHAR_BUDGET = 1500
const FILE_CHANGES_TRUNCATION_MARKER = "[summary truncated to fit context budget]"

function applyFileChangeSummaryBudget(summary: string): string {
  if (summary.length <= FILE_CHANGES_CHAR_BUDGET) {
    return summary
  }
  const suffix = `\n${FILE_CHANGES_TRUNCATION_MARKER}`
  const maxPrefixLength = Math.max(0, FILE_CHANGES_CHAR_BUDGET - suffix.length)
  const prefix = summary.slice(0, maxPrefixLength).trimEnd()
  return `${prefix}${suffix}`
}

function appendFileChangeSection(
  lines: string[],
  title: string,
  files: GitFileStat[],
  renderLine: (file: GitFileStat) => string,
  categoryLabel: "modified" | "created" | "deleted"
): void {
  if (files.length === 0) return

  lines.push(title)
  const visibleFiles = files.slice(0, FILE_CHANGES_SECTION_LIMIT)
  for (const file of visibleFiles) {
    lines.push(renderLine(file))
  }

  const omittedCount = files.length - visibleFiles.length
  if (omittedCount > 0) {
    lines.push(`  ... (${omittedCount} more ${categoryLabel} files omitted)`)
  }

  lines.push("")
}

export function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const modified = stats.filter((s) => s.status === "modified")
  const added = stats.filter((s) => s.status === "added")
  const deleted = stats.filter((s) => s.status === "deleted")

  const lines: string[] = [
    "[FILE CHANGES SUMMARY]",
    `Total files: ${stats.length} (modified: ${modified.length}, created: ${added.length}, deleted: ${deleted.length})`,
    "",
  ]

  appendFileChangeSection(
    lines,
    "Modified files:",
    modified,
    (file) => `  ${file.path}  (+${file.added}, -${file.removed})`,
    "modified"
  )
  appendFileChangeSection(
    lines,
    "Created files:",
    added,
    (file) => `  ${file.path}  (+${file.added})`,
    "created"
  )
  appendFileChangeSection(
    lines,
    "Deleted files:",
    deleted,
    (file) => `  ${file.path}  (-${file.removed})`,
    "deleted"
  )

  if (notepadPath) {
    const notepadStat = stats.find((s) => s.path.includes("notepad") || s.path.includes(".sisyphus"))
    if (notepadStat) {
      lines.push("[NOTEPAD UPDATED]")
      lines.push(`  ${notepadStat.path}  (+${notepadStat.added})`)
      lines.push("")
    }
  }

  return applyFileChangeSummaryBudget(lines.join("\n"))
}

interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

interface SessionState {
  lastEventWasAbortError?: boolean
  lastContinuationInjectedAt?: number
  lastDelegationWarningAt?: number
  lastDirectWorkReminderAt?: number
  promptFailureCount: number
  verificationReminderCount: number
  verifierGuardByCallID: Map<string, VerificationVerdict>
  consecutiveContextPressureHits: number
  autoHandoffTriggered: boolean
  autoHandoffTriggeredAt?: number
  lastAutoHandoffReason?: string
  reminderTelemetry: ReminderTelemetrySummary
}

const CONTINUATION_COOLDOWN_MS = 5000
const DELEGATION_WARNING_COOLDOWN_MS = 30000
const CONTEXT_PRESSURE_TRIGGER_RATIO = 0.9

export interface ExecutionOrchestratorHookOptions {
  directory: string
  backgroundManager?: BackgroundManager
  taskConfig?: Partial<OhMyOpenCodeConfig>
  verifierGate?: {
    enabled?: boolean
    evidence_ttl_ms?: number
    require_lsp_clean?: boolean
    require_test_or_build?: boolean
    allow_no_code_change?: boolean
  }
  discoveryChannel?: {
    enabled?: boolean
    capture_delegate_output?: boolean
    capture_assistant_updates?: boolean
    marker_mode?: "xml" | "prefix" | "hybrid"
    dedupe_window_ms?: number
    max_open_items?: number
    auto_task_create?: boolean
  }
  autoHandoff?: {
    enabled?: boolean
    trigger_verifier_denials?: number
    trigger_context_pressure_hits?: number
    trigger_prompt_failures?: number
    cooldown_ms?: number
    launch_mode?: "auto" | "preview"
    stop_continuation_on_launch?: boolean
  }
  requestAutoHandoff?: (request: AutoHandoffRequest) => Promise<AutoHandoffResult>
  markContinuationStopped?: (sessionID: string) => void
  /** Enable 2-action rule (remind to document research after 2 ops) */
  twoActionRule?: boolean
  /** Enable 3-strike protocol (track and guide error handling) */
  threeStrikeProtocol?: boolean
  /** Tools that count as research actions for 2-action rule */
  researchTools?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
  getContinuationRound?: (sessionID: string) => number | undefined
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
}

function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""

    if (name === "MessageAbortedError" || name === "AbortError") return true
    if (name === "DOMException" && message.includes("abort")) return true
    if (message.includes("aborted") || message.includes("cancelled") || message.includes("interrupted")) return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

const DEFAULT_RESEARCH_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"]

export function createExecutionOrchestratorHook(
  ctx: PluginInput,
  options: ExecutionOrchestratorHookOptions
) {
  const verifierGateConfig = {
    enabled: options.verifierGate?.enabled ?? true,
    evidenceTtlMs: options.verifierGate?.evidence_ttl_ms ?? 900_000,
    requireLspClean: options.verifierGate?.require_lsp_clean ?? true,
    requireTestOrBuild: options.verifierGate?.require_test_or_build ?? true,
    allowNoCodeChange: options.verifierGate?.allow_no_code_change ?? true,
  }
  const autoHandoffConfig = {
    enabled: options.autoHandoff?.enabled ?? true,
    triggerVerifierDenials: options.autoHandoff?.trigger_verifier_denials ?? 2,
    triggerContextPressureHits: options.autoHandoff?.trigger_context_pressure_hits ?? 2,
    triggerPromptFailures: options.autoHandoff?.trigger_prompt_failures ?? 2,
    cooldownMs: options.autoHandoff?.cooldown_ms ?? 600_000,
    launchMode: options.autoHandoff?.launch_mode ?? "auto",
    stopContinuationOnLaunch: options.autoHandoff?.stop_continuation_on_launch ?? true,
  } as const
  const discoveryChannelConfig = {
    enabled: options.discoveryChannel?.enabled ?? true,
    captureDelegateOutput: options.discoveryChannel?.capture_delegate_output ?? true,
    captureAssistantUpdates: options.discoveryChannel?.capture_assistant_updates ?? true,
    markerMode: options.discoveryChannel?.marker_mode ?? "hybrid",
    dedupeWindowMs: options.discoveryChannel?.dedupe_window_ms ?? 1_800_000,
    maxOpenItems: options.discoveryChannel?.max_open_items ?? 200,
    autoTaskCreate: options.discoveryChannel?.auto_task_create ?? false,
  } as const

  let requestAutoHandoff = options.requestAutoHandoff
  const backgroundManager = options.backgroundManager
  const taskConfig = options.taskConfig ?? {}
  const twoActionRule = options.twoActionRule ?? false
  const threeStrikeProtocol = options.threeStrikeProtocol ?? false
  const researchTools = new Set((options.researchTools ?? DEFAULT_RESEARCH_TOOLS).map(t => t.toLowerCase()))
  const isContinuationStopped = options.isContinuationStopped
  const getContinuationRound = options.getContinuationRound
  const reportContinuationIntent = options.reportContinuationIntent

  const workStateManager = createWorkStateManager(ctx.directory)
  const discoveryChannel = new DiscoveryChannel(options.directory, {
    enabled: discoveryChannelConfig.enabled,
    captureDelegateOutput: discoveryChannelConfig.captureDelegateOutput,
    captureAssistantUpdates: discoveryChannelConfig.captureAssistantUpdates,
    markerMode: discoveryChannelConfig.markerMode,
    dedupeWindowMs: discoveryChannelConfig.dedupeWindowMs,
    maxOpenItems: discoveryChannelConfig.maxOpenItems,
    autoTaskCreate: discoveryChannelConfig.autoTaskCreate,
  })
  const verifierState = new VerifierGateStateStore(verifierGateConfig)
  const sessions = new Map<string, SessionState>()
  const archivedReminderTelemetryBySession = new Map<string, ReminderTelemetrySummary>()
  const persistedReminderTelemetryByPlan = new Map<string, ReminderTelemetrySummary>()
  const pendingFilePaths = new Map<string, string>()

  function computeWorkProgress(planId: string): { total: number; completed: number; remaining: number; isComplete: boolean } {
    try {
      const tasks = listTaskNodes(
        {
          scope: "plan",
          container_id: planId,
          include_completed: true,
        },
        taskConfig
      )

      const total = tasks.length
      const completed = tasks.filter((t) => t.state === "completed" || t.state === "cancelled").length
      const remaining = total - completed
      return { total, completed, remaining, isComplete: total > 0 && remaining === 0 }
    } catch {
      return { total: 0, completed: 0, remaining: 0, isComplete: false }
    }
  }

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {
        promptFailureCount: 0,
        verificationReminderCount: 0,
        verifierGuardByCallID: new Map<string, VerificationVerdict>(),
        consecutiveContextPressureHits: 0,
        autoHandoffTriggered: false,
        reminderTelemetry: createEmptyReminderTelemetrySummary(),
      }
      sessions.set(sessionID, state)
    }
    return state
  }

  function getActivePlanIdForSession(sessionID: string): string | undefined {
    const workState = workStateManager.load()
    if (!workState) return undefined
    if (!workState.session_ids.includes(sessionID)) return undefined
    return workState.plan_id
  }

  function captureDiscovery(input: {
    sessionID: string
    source: "delegate_output" | "assistant_update"
    sourceEventId: string
    retrievalPath: string
    text: string
  }): void {
    if (!discoveryChannelConfig.enabled || !input.text.trim()) {
      return
    }

    const planId = getActivePlanIdForSession(input.sessionID)
    if (!planId) return

    try {
      const captured = discoveryChannel.capture({
        planId,
        text: input.text,
        source: input.source,
        sourceEventId: input.sourceEventId,
        retrievalPath: input.retrievalPath,
      })

      if (captured.length > 0 && discoveryChannelConfig.autoTaskCreate) {
        const existingTasks = listTaskNodes(
          {
            scope: "plan",
            container_id: planId,
            include_completed: true,
          },
          taskConfig
        )
        const existingTitles = new Set(
          existingTasks
            .map((task) => task.title.trim().toLowerCase())
            .filter((title) => title.length > 0)
        )

        let createdCount = 0
        for (const discovery of captured) {
          const compactClaim = discovery.claim.replace(/\s+/g, " ").trim()
          if (!compactClaim) continue
          const title = `Discovery: ${compactClaim}`.slice(0, 180)
          const normalizedTitle = title.toLowerCase()
          if (existingTitles.has(normalizedTitle)) {
            continue
          }

          try {
            createTaskNode(
              {
                scope: "plan",
                container_id: planId,
                title,
                description:
                  `Captured from ${discovery.source}. ` +
                  `Source event: ${discovery.sourceEventId}. ` +
                  `Retrieval path: ${discovery.retrievalPath}`,
                priority: -10,
              },
              taskConfig
            )
            existingTitles.add(normalizedTitle)
            createdCount += 1
          } catch (error) {
            log(`[${HOOK_NAME}] Failed to create discovery task (fail-open)`, {
              sessionID: input.sessionID,
              planId,
              discoveryId: discovery.id,
              error: String(error),
            })
          }
        }

        if (createdCount > 0) {
          log(`[${HOOK_NAME}] Auto-created discovery tasks`, {
            sessionID: input.sessionID,
            planId,
            created: createdCount,
          })
        }
      }
    } catch (error) {
      log(`[${HOOK_NAME}] Discovery capture failed (fail-open)`, {
        sessionID: input.sessionID,
        source: input.source,
        error: String(error),
      })
    }
  }

  function getTopUnresolvedDiscoveries(sessionID: string, limit = 5): AutoHandoffRequest["unresolvedDiscoveries"] {
    const planId = getActivePlanIdForSession(sessionID)
    if (!planId) return []

    return discoveryChannel.listUnresolved(planId, limit).map((entry) => ({
      id: entry.id,
      claim: entry.claim,
      sourceEventId: entry.sourceEventId,
      retrievalPath: entry.retrievalPath,
    }))
  }

  function buildAutoHandoffGoal(sessionID: string, reason: string): string {
    const workState = workStateManager.load()
    if (workState) {
      const progress = computeWorkProgress(workState.plan_id)
      return `Continue plan "${workState.plan_id}" with fresh context.

Reason: ${reason}
Progress: ${progress.completed}/${progress.total} completed (remaining ${progress.remaining})
Plan path: ${workState.execution_plan_path}`
    }

    return `Continue current session with fresh context. Reason: ${reason}`
  }

  async function triggerAutoHandoff(sessionID: string, reason: string): Promise<void> {
    if (!autoHandoffConfig.enabled || !requestAutoHandoff) {
      return
    }

    const state = getState(sessionID)
    const now = Date.now()
    if (state.autoHandoffTriggered) {
      return
    }
    if (
      state.autoHandoffTriggeredAt !== undefined
      && now - state.autoHandoffTriggeredAt < autoHandoffConfig.cooldownMs
    ) {
      return
    }

    const request: AutoHandoffRequest = {
      sessionID,
      goal: buildAutoHandoffGoal(sessionID, reason),
      reason,
      launchMode: autoHandoffConfig.launchMode,
      unresolvedDiscoveries: getTopUnresolvedDiscoveries(sessionID, 5),
    }

    state.autoHandoffTriggered = true
    state.autoHandoffTriggeredAt = now
    state.lastAutoHandoffReason = reason

    try {
      const result = await requestAutoHandoff(request)
      const launched = result.status === "launched" && Boolean(result.newSessionId)
      if (autoHandoffConfig.stopContinuationOnLaunch && launched) {
        options.markContinuationStopped?.(sessionID)
      }
      log(`[${HOOK_NAME}] Auto handoff triggered`, {
        sessionID,
        reason,
        status: result.status,
        newSessionId: result.newSessionId,
        fallbackPreview: result.fallbackPreview,
      })
    } catch (error) {
      state.autoHandoffTriggered = false
      log(`[${HOOK_NAME}] Auto handoff trigger failed`, {
        sessionID,
        reason,
        error: String(error),
      })
    }
  }

  function getVerifierGuardPayload(input: {
    sessionID: string
    callID?: string
    tool: string
    args: Record<string, unknown>
  }): {
    blocked: boolean
    reasonCode: string
    missingEvidence: string[]
    denialCount: number
    details?: Record<string, unknown>
  } | null {
    const toolName = input.tool.toLowerCase()
    if (toolName !== "task_transition") {
      return null
    }

    const nextStateRaw = input.args.next_state ?? input.args.nextState
    if (nextStateRaw !== "completed") {
      return null
    }

    const verdict = verifierState.evaluateCompletion(input.sessionID)
    const state = getState(input.sessionID)
    if (input.callID) {
      state.verifierGuardByCallID.set(input.callID, verdict)
    }

    if (
      verdict.blocked
      && verdict.denialCount >= autoHandoffConfig.triggerVerifierDenials
    ) {
      void triggerAutoHandoff(
        input.sessionID,
        `Verifier denied completion ${verdict.denialCount} times`
      )
    }

    return {
      blocked: verdict.blocked,
      reasonCode: verdict.reasonCode,
      missingEvidence: [...verdict.missingEvidence],
      denialCount: verdict.denialCount,
      details: {
        hasCodeChanges: verdict.details.hasCodeChanges,
        lastWriteAt: verdict.details.lastWriteAt,
        lspEvidenceCount: verdict.details.lspEvidence.length,
        testOrBuildEvidenceCount: verdict.details.testOrBuildEvidence.length,
      },
    }
  }

  function buildVerifierBlockError(verdict: VerificationVerdict): string {
    const missing = verdict.missingEvidence.map((item) => `- ${item}`).join("\n")
    const guidance = buildVerifierMissingEvidenceGuidance(verdict.missingEvidence)
    return [
      "[work-orchestrator] Verifier gate blocked task completion.",
      "Missing evidence:",
      missing || "- unknown",
      guidance,
    ].filter(Boolean).join("\n")
  }

  function onPolicyContextPressure(input: {
    sessionID: string
    pressureRatio: number
    estimatedRecentTokens: number
    hardLimit: number
  }): void {
    const state = getState(input.sessionID)
    if (input.pressureRatio >= CONTEXT_PRESSURE_TRIGGER_RATIO) {
      state.consecutiveContextPressureHits += 1
      log(`[${HOOK_NAME}] Context pressure observed`, {
        sessionID: input.sessionID,
        pressureRatio: Number(input.pressureRatio.toFixed(3)),
        estimatedRecentTokens: input.estimatedRecentTokens,
        hardLimit: input.hardLimit,
        consecutiveHits: state.consecutiveContextPressureHits,
      })
      if (state.consecutiveContextPressureHits >= autoHandoffConfig.triggerContextPressureHits) {
        void triggerAutoHandoff(
          input.sessionID,
          `Context pressure persisted for ${state.consecutiveContextPressureHits} tool rounds`
        )
      }
      return
    }

    state.consecutiveContextPressureHits = 0
  }

  function recordReminderTelemetry(
    state: SessionState,
    telemetry: OrchestratorReminderTelemetry
  ): void {
    state.reminderTelemetry.total += 1

    if (telemetry.profile === "full") {
      state.reminderTelemetry.full += 1
    } else if (telemetry.profile === "compact") {
      state.reminderTelemetry.compact += 1
    } else {
      state.reminderTelemetry.ultraCompact += 1
    }

    if (telemetry.budgetDowngraded) {
      state.reminderTelemetry.budgetDowngrades += 1
    }
    if (telemetry.fieldTruncated) {
      state.reminderTelemetry.fieldTruncations += 1
    }
    if (telemetry.hardTruncated) {
      state.reminderTelemetry.hardTruncations += 1
    }
  }

  function loadReminderTelemetrySnapshot(planId: string): ReminderTelemetrySummary | null {
    const telemetryPath = getReminderTelemetryPath(options.directory, planId)
    if (!existsSync(telemetryPath)) return null

    try {
      const raw = readFileSync(telemetryPath, "utf-8")
      const parsed = JSON.parse(raw) as Partial<ReminderTelemetryPersistenceSnapshot>
      const summary = parsed.summary
      if (
        parsed.schema_version !== REMINDER_TELEMETRY_SNAPSHOT_VERSION ||
        typeof parsed.plan_id !== "string" ||
        parsed.plan_id !== planId ||
        !summary ||
        typeof summary.total !== "number" ||
        typeof summary.full !== "number" ||
        typeof summary.compact !== "number" ||
        typeof summary.ultraCompact !== "number" ||
        typeof summary.budgetDowngrades !== "number" ||
        typeof summary.fieldTruncations !== "number" ||
        typeof summary.hardTruncations !== "number"
      ) {
        return null
      }

      return cloneReminderTelemetrySummary(summary)
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to read reminder telemetry snapshot`, {
        planId,
        error: String(err),
      })
      return null
    }
  }

  function writeReminderTelemetrySnapshot(planId: string, summary: ReminderTelemetrySummary): void {
    const telemetryPath = getReminderTelemetryPath(options.directory, planId)
    try {
      mkdirSync(dirname(telemetryPath), { recursive: true })
      const payload: ReminderTelemetryPersistenceSnapshot = {
        schema_version: REMINDER_TELEMETRY_SNAPSHOT_VERSION,
        plan_id: planId,
        updated_at: new Date().toISOString(),
        summary: cloneReminderTelemetrySummary(summary),
      }
      const tempPath = `${telemetryPath}.tmp`
      writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8")
      renameSync(tempPath, telemetryPath)
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to persist reminder telemetry snapshot`, {
        planId,
        error: String(err),
      })
    }
  }

  function getPersistedReminderTelemetry(planId: string): ReminderTelemetrySummary {
    const cached = persistedReminderTelemetryByPlan.get(planId)
    if (cached) return cached

    const loaded = loadReminderTelemetrySnapshot(planId) ?? createEmptyReminderTelemetrySummary()
    persistedReminderTelemetryByPlan.set(planId, loaded)
    return loaded
  }

  function persistReminderTelemetry(planId: string, telemetry: OrchestratorReminderTelemetry): void {
    const summary = getPersistedReminderTelemetry(planId)
    summary.total += 1

    if (telemetry.profile === "full") {
      summary.full += 1
    } else if (telemetry.profile === "compact") {
      summary.compact += 1
    } else {
      summary.ultraCompact += 1
    }

    if (telemetry.budgetDowngraded) {
      summary.budgetDowngrades += 1
    }
    if (telemetry.fieldTruncated) {
      summary.fieldTruncations += 1
    }
    if (telemetry.hardTruncated) {
      summary.hardTruncations += 1
    }

    writeReminderTelemetrySnapshot(planId, summary)
  }

  function clearPersistedReminderTelemetry(planId: string): void {
    persistedReminderTelemetryByPlan.delete(planId)
    const telemetryPath = getReminderTelemetryPath(options.directory, planId)
    if (!existsSync(telemetryPath)) return
    try {
      rmSync(telemetryPath, { force: true })
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to clear reminder telemetry snapshot`, {
        planId,
        error: String(err),
      })
    }
  }

  function aggregateReminderTelemetry(sessionIDs: string[]): ReminderTelemetrySummary {
    const summary = createEmptyReminderTelemetrySummary()

    for (const sessionID of sessionIDs) {
      const state = sessions.get(sessionID)
      if (state) {
        addReminderTelemetrySummary(summary, state.reminderTelemetry)
      }

      const archived = archivedReminderTelemetryBySession.get(sessionID)
      if (archived) {
        addReminderTelemetrySummary(summary, archived)
      }
    }

    return summary
  }

  function archiveReminderTelemetryForSession(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state || state.reminderTelemetry.total === 0) return

    const existing = archivedReminderTelemetryBySession.get(sessionID)
    if (existing) {
      addReminderTelemetrySummary(existing, state.reminderTelemetry)
      return
    }

    archivedReminderTelemetryBySession.set(sessionID, {
      ...state.reminderTelemetry,
    })
  }

  function shouldEmitDelegationWarning(state: SessionState, now = Date.now()): boolean {
    if (!state.lastDelegationWarningAt) {
      state.lastDelegationWarningAt = now
      return true
    }
    if (now - state.lastDelegationWarningAt >= DELEGATION_WARNING_COOLDOWN_MS) {
      state.lastDelegationWarningAt = now
      return true
    }
    return false
  }

  function shouldEmitDirectWorkReminder(state: SessionState, now = Date.now()): boolean {
    if (!state.lastDirectWorkReminderAt) {
      state.lastDirectWorkReminderAt = now
      return true
    }
    if (now - state.lastDirectWorkReminderAt >= DELEGATION_WARNING_COOLDOWN_MS) {
      state.lastDirectWorkReminderAt = now
      return true
    }
    return false
  }

  function writeCompletionArtifact(
    planId: string,
    planPath: string,
    progress: { total: number; completed: number; remaining: number },
    reminderTelemetry: ReminderTelemetrySummary
  ): string | null {
    try {
      const completionPath = join(options.directory, ".sisyphus", "plans", planId, "completion.md")
      mkdirSync(dirname(completionPath), { recursive: true })
      const completedAt = new Date().toISOString()
      const content = `# Plan Complete

- Plan ID: \`${planId}\`
- Plan Path: \`${planPath}\`
- Completed At: \`${completedAt}\`
- TaskGraph Progress: ${progress.completed}/${progress.total} (remaining: ${progress.remaining})

## Summary

Execution orchestrator marked all TaskGraph items as complete and finalized work state.

## Reminder Telemetry

- Total reminders: ${reminderTelemetry.total}
- Profiles: full=${reminderTelemetry.full}, compact=${reminderTelemetry.compact}, ultra-compact=${reminderTelemetry.ultraCompact}
- Budget downgrades: ${reminderTelemetry.budgetDowngrades}
- Field truncations: ${reminderTelemetry.fieldTruncations}
- Hard truncations: ${reminderTelemetry.hardTruncations}
`
      writeFileSync(completionPath, content, "utf-8")
      return completionPath
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to write completion artifact`, {
        planId,
        error: String(err),
      })
      return null
    }
  }

  function finalizeCompletedWork(
    sessionID: string,
    workState: WorkState,
    progress: { total: number; completed: number; remaining: number }
  ): void {
    const inMemoryTelemetry = aggregateReminderTelemetry(workState.session_ids)
    const persistedTelemetry = getPersistedReminderTelemetry(workState.plan_id)
    const reminderTelemetry = cloneReminderTelemetrySummary(persistedTelemetry)
    // Keep completion robust if persistence is unavailable for any reason.
    if (reminderTelemetry.total < inMemoryTelemetry.total) {
      addReminderTelemetrySummary(reminderTelemetry, inMemoryTelemetry)
    }

    const completionPath = writeCompletionArtifact(
      workState.plan_id,
      workState.execution_plan_path,
      progress,
      reminderTelemetry
    )

    for (const sid of workState.session_ids) {
      updateSessionAgent(sid, DEFAULT_COMPLETION_FALLBACK_AGENT)
    }

    const cleared = workStateManager.clear()
    for (const sid of workState.session_ids) {
      archivedReminderTelemetryBySession.delete(sid)
    }
    clearPersistedReminderTelemetry(workState.plan_id)
    log(`[${HOOK_NAME}] Completion routine finished`, {
      sessionID,
      plan: workState.plan_id,
      cleared,
      completionPath,
      fallbackAgent: DEFAULT_COMPLETION_FALLBACK_AGENT,
      reminderTelemetry,
    })
  }

  function isExecutionModeSession(sessionID?: string, stateFromCaller?: WorkState | null): boolean {
    if (!sessionID) return false

    const workState = stateFromCaller ?? workStateManager.load()
    if (!workState) return false

    if (!workState.session_ids.includes(sessionID)) return false

    const progress = computeWorkProgress(workState.plan_id)
    if (progress.isComplete) return false

    const ownership = resolveExecutionOwnership(sessionID, EXECUTION_POLICY.owner)
    if (ownership === "mismatched") {
      return false
    }
    if (ownership === "unknown") {
      log(`[${HOOK_NAME}] Execution ownership unresolved; skipping continuation`, {
        sessionID,
        executor: EXECUTION_POLICY.owner,
      })
      return false
    }
    return true
  }

  async function injectContinuation(
    sessionID: string,
    planId: string,
    planPath: string,
    remaining: number,
    total: number,
    round?: number
  ): Promise<void> {
    const state = getState(sessionID)
    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    const prompt = ATLAS_WORK_CONTINUATION_PROMPT
      .replace(/{PLAN_NAME}/g, planId)
      .replace(/{PLAN_PATH}/g, planPath) +
      (total === 0
        ? `\n\n[Status: no plan tasks found in TaskGraph]\nCreate tasks with:\n- task_create({ title: \"1. ...\", scope: \"plan\", container_id: \"${planId}\" })`
        : `\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]`)
    const discoveryReminder = discoveryChannelConfig.enabled
      ? discoveryChannel.renderIdleReminder(planId, 5)
      : null
    const promptWithDiscovery = discoveryReminder
      ? `${prompt}\n\n${discoveryReminder}`
      : prompt

    try {
      log(`[${HOOK_NAME}] Injecting work continuation`, {
        sessionID,
        planId,
        remaining,
        executor: EXECUTION_POLICY.owner,
      })

      const attemptAt = Date.now()
      let model: { providerID: string; modelID: string } | undefined
      let variant: string | undefined
      try {
        const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: { model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          const msgModel = info?.model
          if (msgModel?.providerID && msgModel?.modelID) {
            model = { providerID: msgModel.providerID, modelID: msgModel.modelID }
            break
          }
          if (info?.providerID && info?.modelID) {
            model = { providerID: info.providerID, modelID: info.modelID }
            break
          }
        }
      } catch {
        const messageDir = getMessageDir(sessionID)
        const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
        model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
          ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
          : undefined
        variant = currentMessage?.model?.variant
      }

      await reportContinuationIntent({
        sessionID,
        round,
        source: "work-orchestrator",
        reason: `work_remaining:${remaining}/${total}`,
        prompt: {
          agent: EXECUTION_POLICY.owner,
          ...(model !== undefined ? { model } : {}),
          ...(variant !== undefined ? { variant } : {}),
          text: promptWithDiscovery,
        },
        onResult: (result) => {
          if (result.status === "accepted") {
            state.lastContinuationInjectedAt = attemptAt
          } else if (
            result.rejectReason === "lower_priority" ||
            result.rejectReason === "round_already_written"
          ) {
            state.lastContinuationInjectedAt = attemptAt
          }

          if (result.status !== "accepted") {
            log(`[${HOOK_NAME}] Continuation intent rejected`, {
              sessionID,
              rejectReason: result.rejectReason,
            })
            return
          }
          if (result.error) {
            state.promptFailureCount += 1
            log(`[${HOOK_NAME}] Work continuation failed`, {
              sessionID,
              error: String(result.error),
              promptFailureCount: state.promptFailureCount,
            })
            if (state.promptFailureCount >= autoHandoffConfig.triggerPromptFailures) {
              void triggerAutoHandoff(
                sessionID,
                `Continuation prompt failed ${state.promptFailureCount} times`
              )
            }
            return
          }
          state.promptFailureCount = 0
          log(`[${HOOK_NAME}] Work continuation injected`, {
            sessionID,
            executor: EXECUTION_POLICY.owner,
          })
        },
      })
    } catch (err) {
      state.promptFailureCount += 1
      log(`[${HOOK_NAME}] Work continuation failed`, {
        sessionID,
        error: String(err),
        promptFailureCount: state.promptFailureCount,
      })
      if (state.promptFailureCount >= autoHandoffConfig.triggerPromptFailures) {
        void triggerAutoHandoff(
          sessionID,
          `Continuation prompt failed ${state.promptFailureCount} times`
        )
      }
    }
  }

  return {
    setAutoHandoffRequester: (
      requester: ((request: AutoHandoffRequest) => Promise<AutoHandoffResult>) | undefined
    ): void => {
      requestAutoHandoff = requester
    },

    getVerifierGuard: getVerifierGuardPayload,

    onPolicyContextPressure,

    handler: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        const state = getState(sessionID)
        const isAbort = isAbortError(props?.error)
        state.lastEventWasAbortError = isAbort

        log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort })
        return
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        log(`[${HOOK_NAME}] session.idle`, { sessionID })

        // Read work state FIRST to check if this session is part of an active work
        const workState = workStateManager.load()
        const isWorkSession = workState?.session_ids.includes(sessionID) ?? false

        const mainSessionID = getMainSessionID()
        const isMainSession = sessionID === mainSessionID
        const isBackgroundTaskSession = isSubagentSession(sessionID)

        // Allow continuation if: main session OR background task OR work session
        if (mainSessionID && !isMainSession && !isBackgroundTaskSession && !isWorkSession) {
          log(`[${HOOK_NAME}] Skipped: not main, background task, or work session`, { sessionID })
          return
        }

        const state = getState(sessionID)

        if (state.lastEventWasAbortError) {
          state.lastEventWasAbortError = false
          log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
          return
        }

        if (state.promptFailureCount >= EXECUTION_POLICY.continuation.maxPromptFailures) {
          log(`[${HOOK_NAME}] Skipped: continuation disabled after repeated prompt failures`, {
            sessionID,
            promptFailureCount: state.promptFailureCount,
          })
          return
        }

        if (isContinuationStopped?.(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
          return
        }

        const hasRunningBgTasks = backgroundManager
          ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
          : false

        if (hasRunningBgTasks) {
          log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
          return
        }


        if (!workState) {
          log(`[${HOOK_NAME}] No active work`, { sessionID })
          return
        }

        const progress = computeWorkProgress(workState.plan_id)
        if (progress.isComplete) {
          log(`[${HOOK_NAME}] Work complete`, { sessionID, plan: workState.plan_id })
          finalizeCompletedWork(sessionID, workState, progress)
          return
        }

        if (!isExecutionModeSession(sessionID, workState)) {
          log(`[${HOOK_NAME}] Skipped: session is not in execution mode`, { sessionID })
          return
        }

        const now = Date.now()
        if (state.lastContinuationInjectedAt && now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS) {
          log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, { sessionID, cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - state.lastContinuationInjectedAt) })
          return
        }

        await injectContinuation(
          sessionID,
          workState.plan_id,
          workState.execution_plan_path,
          progress.remaining,
          progress.total,
          getContinuationRound?.(sessionID)
        )
        return
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined

        if (!sessionID) return

        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }

        if (discoveryChannelConfig.enabled && discoveryChannelConfig.captureAssistantUpdates) {
          const role = info?.role
          const content = info?.content
          if (role === "assistant" && typeof content === "string" && content.trim().length > 0) {
            const sourceEventId =
              (info?.messageID as string | undefined)
              ?? (props?.messageID as string | undefined)
              ?? `message.updated:${Date.now()}`
            captureDiscovery({
              sessionID,
              source: "assistant_update",
              sourceEventId,
              retrievalPath: "event.message.updated.assistant",
              text: content,
            })
          }
        }
        return
      }

      if (event.type === "message.part.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined
        const role = info?.role as string | undefined

        if (sessionID && role === "assistant") {
          const state = sessions.get(sessionID)
          if (state) {
            state.lastEventWasAbortError = false
          }
        }
        return
      }

      if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          const state = sessions.get(sessionID)
          if (state) {
            state.lastEventWasAbortError = false
          }
        }
        return
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          archiveReminderTelemetryForSession(sessionInfo.id)
          sessions.delete(sessionInfo.id)
          verifierState.clearSession(sessionInfo.id)
          log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
        }
        return
      }

      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          archiveReminderTelemetryForSession(sessionID)
          sessions.delete(sessionID)
          verifierState.clearSession(sessionID)
          log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
        }
        return
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const sessionID = input.sessionID
      if (!sessionID) {
        return
      }

      if (!isExecutionModeSession(input.sessionID)) {
        return
      }

      if (input.tool.toLowerCase() === "task_transition") {
        const args = output.args
        const nextState = args.next_state ?? args.nextState
        if (nextState === "completed") {
          const state = getState(sessionID)
          let verdict = input.callID
            ? state.verifierGuardByCallID.get(input.callID)
            : undefined

          if (!verdict) {
            const guard = getVerifierGuardPayload({
              sessionID,
              callID: input.callID,
              tool: input.tool,
              args,
            })
            if (input.callID) {
              verdict = state.verifierGuardByCallID.get(input.callID)
            } else if (guard) {
              verdict = {
                blocked: guard.blocked,
                reasonCode: guard.reasonCode,
                missingEvidence: guard.missingEvidence,
                denialCount: guard.denialCount,
                details: {
                  hasCodeChanges: Boolean(guard.details?.hasCodeChanges),
                  lastWriteAt: guard.details?.lastWriteAt as number | undefined,
                  lspEvidence: [],
                  testOrBuildEvidence: [],
                },
              }
            }
          }

          if (input.callID) {
            state.verifierGuardByCallID.delete(input.callID)
          }

          if (verdict?.blocked) {
            throw new Error(buildVerifierBlockError(verdict))
          }
        }
      }

      if (input.tool === "task" || input.tool === "Task") {
        output.message = (output.message || "") + EXECUTION_MODE_TASK_WARNING
        log(`[${HOOK_NAME}] Blocked direct task usage in execution mode`, {
          sessionID,
        })
        throw new Error(EXECUTION_MODE_TASK_BLOCK_ERROR)
      }

      // Check Write/Edit tools for orchestrator - inject strong warning
      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
        if (filePath && !isSisyphusPath(filePath)) {
          const state = getState(sessionID)
          const shouldWarn = shouldEmitDelegationWarning(state)
          if (!shouldWarn) {
            log(`[${HOOK_NAME}] Skipped delegation warning due to cooldown`, {
              sessionID,
              tool: input.tool,
              filePath,
            })
            return
          }
          const activeState = workStateManager.load()
          const executorName = activeState ? EXECUTION_AGENT_LABEL : "Execution Orchestrator"
          // Store filePath for use in tool.execute.after
          if (input.callID) {
            pendingFilePaths.set(input.callID, filePath)
          }
          const warning = buildDelegationRequiredNotice({
            phase: "before-write",
            executorName,
            filePath,
          })
          output.message = (output.message || "") + warning
          log(`[${HOOK_NAME}] Injected delegation warning for direct file modification`, {
            sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      // Check delegate_task - inject single-task directive
      if (input.tool === "delegate_task") {
        const prompt = output.args.prompt as string | undefined
        enforceExecutionModeDelegatePrompt(prompt)
        if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
          injectBudgetedPrompt({
            output: { args: output.args },
            sessionID,
            source: "work-orchestrator",
            id: "single-task-directive",
            priority: "critical",
            content: `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n`,
            oncePerSession: true,
          })
          log(`[${HOOK_NAME}] Injected single-task directive to delegate_task`, {
            sessionID,
          })
        }
      }
    },

    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ): Promise<void> => {
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return
      }
      if (!input.sessionID) {
        return
      }

      const isExecutionMode = isExecutionModeSession(input.sessionID)
      const outputStr = output.output && typeof output.output === "string" ? output.output : ""
      const workState = workStateManager.load()
      const rawArgs =
        (output.metadata as { args?: unknown } | undefined)?.args
        ?? (output as { args?: unknown }).args
      const toolArgs =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : undefined

      if (isExecutionMode) {
        if (isWriteMutationTool(input.tool)) {
          const filePathRaw =
            toolArgs?.filePath
            ?? toolArgs?.path
            ?? toolArgs?.file_path
            ?? toolArgs?.file
          const filePath = typeof filePathRaw === "string" ? filePathRaw : undefined
          verifierState.markWrite(input.sessionID, filePath)
        }

        const evidence = classifyVerificationEvidence({
          now: Date.now(),
          tool: input.tool,
          args: toolArgs,
          output: outputStr,
          metadata: output.metadata,
        })
        verifierState.recordEvidence(input.sessionID, evidence)
      }

      // === Protocol handling (for any session with active work) ===
      if (workState && isExecutionMode) {
        // 3-strike protocol: detect errors
        if (threeStrikeProtocol) {
          const isError = outputStr.startsWith("❌") ||
            outputStr.toLowerCase().startsWith("error:") ||
            outputStr.toLowerCase().startsWith("error ")

          if (isError) {
            const errorKey = `${input.tool}:${outputStr.slice(0, 80)}`
            const { strikes, requiresRecording } = workStateManager.recordError(errorKey, outputStr)

            let guidance = `\n\n<three-strike-protocol strike="${strikes}">\n${workStateManager.getStrikeGuidance(strikes, requiresRecording)}`
            if (requiresRecording) {
              guidance += `\n\n**REQUIRED**: Record this error in \`ledger.yaml\` before retrying (plan=${workState.plan_id}).`
            }
            guidance += `\n</three-strike-protocol>`

            appendBudgetedOutput({
              output,
              sessionID: input.sessionID,
              source: "work-orchestrator",
              id: `${input.callID}:three-strike-guidance`,
              priority: "critical",
              content: guidance,
            })
            log(`[${HOOK_NAME}] 3-strike: ${strikes} strikes`, { tool: input.tool, sessionID: input.sessionID })
          }
        }

        // 2-action rule: track research operations
        if (twoActionRule && researchTools.has(input.tool.toLowerCase())) {
          const count = workStateManager.incrementResearchOps()

          if (workStateManager.shouldRemindTwoAction()) {
            const reminder = `\n\n<two-action-rule>
## Document Your Research

${count} research operations completed. Update your notepad or findings section with:
- Key discoveries from this research
- Decisions made and their rationale
- Resources or references found

This helps maintain context across sessions and prevents knowledge loss.
</two-action-rule>`

            appendBudgetedOutput({
              output,
              sessionID: input.sessionID,
              source: "work-orchestrator",
              id: `${input.callID}:two-action-reminder`,
              priority: "high",
              content: reminder,
            })
            log(`[${HOOK_NAME}] 2-action rule reminder`, { count, sessionID: input.sessionID })
          }
        }
      }

      // === Execution-mode specific handling ===
      if (!isExecutionMode) {
        return
      }

      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        let filePath = input.callID ? pendingFilePaths.get(input.callID) : undefined
        if (input.callID) {
          pendingFilePaths.delete(input.callID)
        }
        if (!filePath) {
          filePath = output.metadata?.filePath as string | undefined
        }
        if (filePath && !isSisyphusPath(filePath)) {
          const state = getState(input.sessionID)
          const shouldRemind = shouldEmitDirectWorkReminder(state)
          if (!shouldRemind) {
            log(`[${HOOK_NAME}] Skipped direct work reminder due to cooldown`, {
              sessionID: input.sessionID,
              tool: input.tool,
              filePath,
            })
            return
          }
          appendBudgetedOutput({
            output,
            sessionID: input.sessionID,
            source: "work-orchestrator",
            id: "direct-work-reminder",
            priority: "critical",
            content: buildDelegationRequiredNotice({
              phase: "after-write",
              executorName: EXECUTION_AGENT_LABEL,
              filePath,
            }),
            oncePerSession: true,
          })
          log(`[${HOOK_NAME}] Direct work reminder appended`, {
            sessionID: input.sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      if (input.tool !== "delegate_task") {
        return
      }

      const delegateOutputStr = output.output && typeof output.output === "string" ? output.output : ""
      const isBackgroundLaunch =
        delegateOutputStr.includes("Background task launched") ||
        delegateOutputStr.includes("Background task continued") ||
        delegateOutputStr.includes("Background task resumed")

      if (isBackgroundLaunch) {
        return
      }

      if (discoveryChannelConfig.enabled && discoveryChannelConfig.captureDelegateOutput) {
        captureDiscovery({
          sessionID: input.sessionID,
          source: "delegate_output",
          sourceEventId: input.callID ?? `delegate_task:${Date.now()}`,
          retrievalPath: "tool.delegate_task.output",
          text: delegateOutputStr,
        })
      }

      if (output.output && typeof output.output === "string") {
        const gitStats = getGitDiffStats(ctx.directory)
        const fileChanges = formatFileChanges(gitStats)
        const subagentSessionId = extractSessionIdFromOutput(output.output)
        const state = getState(input.sessionID)
        const verificationReminderMode: VerificationReminderMode =
          state.verificationReminderCount > 0 ? "compact" : "full"

        // Reload work state in case it was updated by protocol handling
        const currentWorkState = workStateManager.load()

        if (!currentWorkState) {
          return
        }

        const progress = computeWorkProgress(currentWorkState.plan_id)

        if (!currentWorkState.session_ids.includes(input.sessionID)) {
          workStateManager.appendSessionId(input.sessionID)
          log(`[${HOOK_NAME}] Appended session to work`, {
            sessionID: input.sessionID,
            plan: currentWorkState.plan_id,
          })
        }

        // Preserve original subagent response - critical for debugging failed tasks
        const originalResponse = output.output
        const outputPrefixBuffer = { output: "" }
        appendBudgetedOutput({
          output: outputPrefixBuffer,
          sessionID: input.sessionID,
          source: "work-orchestrator",
          id: `${input.callID}:delegate-output-prefix`,
          priority: "high",
          content: `
## SUBAGENT WORK COMPLETED

${fileChanges}

---

**Subagent Response:**

`,
        })

        const outputCore =
          outputPrefixBuffer.output.length > 0
            ? `${outputPrefixBuffer.output}${originalResponse}`
            : originalResponse
        output.output = outputCore
        const reminderResult = buildOrchestratorReminderWithTelemetry(
          currentWorkState.plan_id,
          currentWorkState.execution_plan_path,
          { total: progress.total, completed: progress.completed },
          subagentSessionId,
          verificationReminderMode
        )

        appendBudgetedOutput({
          output,
          sessionID: input.sessionID,
          source: "work-orchestrator",
          id: `${input.callID}:delegate-output-reminder`,
          priority: "critical",
          content: `

<system-reminder>
${reminderResult.content}
</system-reminder>`,
        })

        state.verificationReminderCount += 1
        recordReminderTelemetry(state, reminderResult.telemetry)
        persistReminderTelemetry(currentWorkState.plan_id, reminderResult.telemetry)

        log(`[${HOOK_NAME}] Output transformed for execution mode`, {
          plan: currentWorkState.plan_id,
          progress: `${progress.completed}/${progress.total}`,
          fileCount: gitStats.length,
          reminderProfile: reminderResult.telemetry.profile,
          reminderReason: reminderResult.telemetry.reason,
          reminderLength: reminderResult.telemetry.charLength,
          reminderBudget: reminderResult.telemetry.charBudget,
          reminderFieldTruncated: reminderResult.telemetry.fieldTruncated,
          reminderBudgetDowngraded: reminderResult.telemetry.budgetDowngraded,
          reminderHardTruncated: reminderResult.telemetry.hardTruncated,
        })
      }
    },
  }
}
