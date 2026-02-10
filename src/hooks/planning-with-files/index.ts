import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { ContextCollector } from "../../features/context-injector"
import { contextCollector as defaultCollector } from "../../features/context-injector"
import type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import {
  detectActivePlan,
  getExecutionPlanPath,
  getPlanDir,
  initializePlan,
  isErrorRecorded,
  readPlan,
} from "../../features/planning-with-files/manager"
import {
  isBlockerLikely,
  BlockerPromptCache,
} from "../../features/planning-with-files/blocker-detection"
import { sanitizePathSegment } from "../../shared/path-sanitizer"
import { createWorkStateManager } from "../../features/work-state"
import { listIncompleteTasks, listTaskNodes, syncPlanTasksToTaskGraph } from "../../features/task-system"
import { log } from "../../shared/logger"
import type { ContinuationIntent } from "../continuation-control"

export interface PlanningWithFilesHookOptions {
  config?: Partial<PlanningWithFilesConfig>
  taskConfig?: Partial<OhMyOpenCodeConfig>
  collector?: ContextCollector
  taskContinuationEnabled?: boolean
  isContinuationStopped?: (sessionID: string) => boolean
  getContinuationRound?: (sessionID: string) => number | undefined
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
}

const HOOK_NAME = "planning-with-files"

function buildPlanContext(content: string): string {
  return `<plan-context>
${content}
</plan-context>

<reminder>
Stay focused on the current TaskGraph task. Do not deviate from the goal.
</reminder>`
}

function extractFilePath(toolArgs: unknown): string | null {
  if (typeof toolArgs !== "object" || toolArgs === null) return null
  const obj = toolArgs as Record<string, unknown>

  const candidates = ["file_path", "path", "filePath", "notebook_path"]
  for (const field of candidates) {
    if (typeof obj[field] === "string" && obj[field]) {
      return obj[field] as string
    }
  }

  return null
}

function extractToolError(output: { output: string }): string | null {
  const raw = output.output?.trim()
  if (!raw) return null

  if (raw.startsWith("❌")) {
    return raw.slice("❌".length).trim() || "Unknown error"
  }

  const lower = raw.toLowerCase()
  if (lower.startsWith("error:") || lower.startsWith("error ")) {
    return raw
  }

  return null
}

async function seedPlanTasksIfMissing(
  cwd: string,
  planId: string,
  taskConfig: Partial<OhMyOpenCodeConfig>,
  planningConfig: PlanningWithFilesConfig
): Promise<void> {
  try {
    const existing = listTaskNodes(
      {
        scope: "plan",
        container_id: planId,
        include_completed: true,
      },
      taskConfig
    )

    if (existing.length > 0) return

    const planMarkdown = await readPlan(cwd, planId, planningConfig)
    if (!planMarkdown) return

    syncPlanTasksToTaskGraph({
      config: taskConfig,
      scope: "plan",
      container_id: planId,
      planId,
      planMarkdown,
    })
  } catch {
    // Best effort seeding. Runtime behavior falls back to manual task_create.
  }
}

function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim()
}

function parseInitDirective(prompt: string): { planId: string } | null {
  const match = prompt.match(
    /(?:^|\n)\s*(?:start planning for|init plan|create plan for)\s+["']?([^"'\n]+?)["']?\s*(?:\n|$)/i
  )
  if (!match) return null

  const rawPlanId = match[1]?.trim()
  if (!rawPlanId) return null

  const planId = sanitizePathSegment(rawPlanId)
  if (!planId) return null

  return { planId }
}

function buildActiveNotice(planId: string): string {
  const planDir = `.sisyphus/plans/${planId}`
  return `<planning-with-files-active plan_id="${planId}">
## Planning with Files Active

**Plan ID**: ${planId}
**Location**: ${planDir}/

**Files**:
- plan.md - Execution plan file (tasks are tracked in TaskGraph via task_* tools)
- ledger.yaml - Runtime errors/blockers/decisions
- findings.md - Research (2-action rule)
- progress.md - Session logs

**Active Protocols**:
- Auto re-read plan.md before Write/Edit/Bash/NotebookEdit
- 2-Action Rule with auto-reset
- 3-Strike Error Protocol (forced recording on Strike 2+)
- Task Reflection (prompts on completion for plan adjustment)
- Stop verification
</planning-with-files-active>`
}

function isPlanFilePath(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").endsWith("/plan.md") || filePath.endsWith("plan.md")
}

export function createPlanningWithFilesHook(
  ctx: PluginInput,
  options: PlanningWithFilesHookOptions
): Hooks {
  const taskConfig = options.taskConfig ?? {}
  const collector = options.collector ?? defaultCollector
  const config: PlanningWithFilesConfig = {
    ...DEFAULT_PLANNING_CONFIG,
    ...options.config,
    // directory is deprecated and ignored; canonical path is fixed to .sisyphus/plans
    directory: "plans",
    reread_trigger_tools:
      options.config?.reread_trigger_tools ?? DEFAULT_PLANNING_CONFIG.reread_trigger_tools,
    action_count_tools:
      options.config?.action_count_tools ?? DEFAULT_PLANNING_CONFIG.action_count_tools,
  }

  if (!config.enabled) {
    return {}
  }

  const workStateManager = createWorkStateManager(ctx.directory)

  const injectedSessions = new Set<string>()
  const activePlanBySessionID = new Map<string, string>()
  const toolArgsByCallID = new Map<string, unknown>()
  const stopVerificationLastPromptAt = new Map<string, number>()
  const blockerCache = new BlockerPromptCache({ maxSessions: 100, maxBlockersPerSession: 50 })
  const STOP_VERIFICATION_COOLDOWN_MS = 60_000
  const rereadTriggerTools = new Set(config.reread_trigger_tools.map((t) => t.toLowerCase()))
  const actionCountTools = new Set(config.action_count_tools.map((t) => t.toLowerCase()))
  const isContinuationStopped = options.isContinuationStopped
  const getContinuationRound = options.getContinuationRound
  const reportContinuationIntent = options.reportContinuationIntent

  const ensureActiveWorkState = (planId: string, sessionID: string): boolean => {
    const planPath = getExecutionPlanPath(ctx.directory, planId, config)
    if (!fs.existsSync(planPath)) return false

    const workState = workStateManager.load()
    if (!workState) {
      workStateManager.initializePlan(planId, sessionID)
    } else if (workState.plan_id !== planId) {
      workStateManager.switchPlan(planId, sessionID)
    } else {
      workStateManager.appendSessionId(sessionID)
    }

    const currentState = workStateManager.getState()
    if (currentState && currentState.last_findings_mtime === 0) {
      const findingsPath = path.join(getPlanDir(ctx.directory, planId, config), "findings.md")
      workStateManager.checkFindingsModified(findingsPath)
    }

    return true
  }

  const resolveActivePlan = async (sessionID: string): Promise<string | null> => {
    const mapped = activePlanBySessionID.get(sessionID)
    if (mapped) {
      if (fs.existsSync(getExecutionPlanPath(ctx.directory, mapped, config))) return mapped
      activePlanBySessionID.delete(sessionID)
    }

    const detected = await detectActivePlan(ctx.directory, config)
    if (detected) {
      activePlanBySessionID.set(sessionID, detected)
    }
    return detected
  }

  const chatMessage = async (
    input: { sessionID: string; messageID?: string },
    output: { parts: Array<{ type: string; text?: string }> }
  ): Promise<void> => {
    const prompt = extractPromptText(output.parts)
    const init = parseInitDirective(prompt)

    if (init) {
      await initializePlan(ctx.directory, init.planId, init.planId, config)
      injectedSessions.delete(input.sessionID)
      activePlanBySessionID.set(input.sessionID, init.planId)
      ensureActiveWorkState(init.planId, input.sessionID)
    }

    if (injectedSessions.has(input.sessionID)) return

    const planId =
      init?.planId ??
      activePlanBySessionID.get(input.sessionID) ??
      (await detectActivePlan(ctx.directory, config))

    if (!planId) return
    activePlanBySessionID.set(input.sessionID, planId)

    const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text)
    if (textPartIndex === -1) return

    const notice = buildActiveNotice(planId)
    output.parts[textPartIndex].text = `${output.parts[textPartIndex].text}\n\n${notice}`

    injectedSessions.add(input.sessionID)
    ensureActiveWorkState(planId, input.sessionID)
  }

  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown }
  ): Promise<void> => {
    toolArgsByCallID.set(input.callID, output.args)

    if (!config.auto_reread) return
    if (!rereadTriggerTools.has(input.tool.toLowerCase())) return

    const planId = await resolveActivePlan(input.sessionID)
    if (!planId) return

    const planMarkdown = await readPlan(ctx.directory, planId, config)
    if (!planMarkdown) return

    collector.register(input.sessionID, {
      id: "plan-context",
      source: "planning-with-files",
      priority: "critical",
      content: buildPlanContext(planMarkdown),
      metadata: {
        planId,
        triggerTool: input.tool,
      },
    })
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ): Promise<void> => {
    const toolArgs = toolArgsByCallID.get(input.callID)
    toolArgsByCallID.delete(input.callID)
    const filePath = extractFilePath(toolArgs)

    const planId = await resolveActivePlan(input.sessionID)
    if (!planId) return
    if (!ensureActiveWorkState(planId, input.sessionID)) return

    const errorText = extractToolError({ output: output.output })
    if (errorText) {
      if (config.three_strike_protocol) {
        const errorKey = `${input.tool}:${errorText.slice(0, 80)}`

        let { strikes, requiresRecording } = workStateManager.recordError(errorKey, errorText)

        if (requiresRecording) {
          const recordedInLedger = await isErrorRecorded(ctx.directory, planId, errorKey, config)
          if (recordedInLedger) {
            workStateManager.markErrorRecorded(errorKey)
            requiresRecording = false
          }
        }

        let content = `<three-strike-protocol strike="${strikes}">
${workStateManager.getStrikeGuidance(strikes, requiresRecording)}

Error: ${errorText.slice(0, 150)}
</three-strike-protocol>`

        if (requiresRecording) {
          content += `\n\n${workStateManager.generateErrorRecordingPrompt(errorKey, strikes)}`
        }

        collector.register(input.sessionID, {
          id: `three-strike-${errorKey}`,
          source: "planning-with-files",
          priority: "high",
          content,
          metadata: { planId, errorKey, strikes },
        })
      }

      if (isBlockerLikely(errorText)) {
        const blockerKey = `${planId}:${input.tool}:${errorText.slice(0, 80)}`
        if (!blockerCache.has(input.sessionID, blockerKey)) {
          blockerCache.add(input.sessionID, blockerKey)

          workStateManager.addBlocker(errorText)

          collector.register(input.sessionID, {
            id: `blocker-${blockerKey}`,
            source: "planning-with-files",
            priority: "high",
            content: workStateManager.generateBlockerPrompt(errorText),
            metadata: { planId, errorText },
          })
        }
      }
    }

    if (["Write", "Edit", "write", "edit"].includes(input.tool) && filePath && isPlanFilePath(filePath)) {
      await seedPlanTasksIfMissing(ctx.directory, planId, taskConfig, config)
    }

    const findingsPath = path.join(getPlanDir(ctx.directory, planId, config), "findings.md")
    const findingsCheck = workStateManager.checkFindingsModified(findingsPath)

    if (findingsCheck.modified) {
      workStateManager.resetResearchOps()
      return
    }

    if (config.two_action_rule && actionCountTools.has(input.tool.toLowerCase())) {
      const newCount = workStateManager.incrementResearchOps()

      if (workStateManager.shouldRemindTwoAction()) {
        const findingsRelPath = `.sisyphus/plans/${planId}/findings.md`
        collector.register(input.sessionID, {
          id: "two-action-rule",
          source: "planning-with-files",
          priority: "high",
          content: `<two-action-rule>
## Update findings.md NOW

${newCount} research operations completed.

Update \`${findingsRelPath}\` with:
- Key discoveries
- Technical decisions
- Resources found

Counter auto-resets when you modify findings.md.
</two-action-rule>`,
          metadata: { planId, actionCount: newCount },
        })
      }
    }
  }

  const eventHandler = async (input: {
    event: { type: string; properties?: unknown }
  }): Promise<void> => {
    if (!config.stop_verification) return

    const props = input.event.properties as Record<string, unknown> | undefined

    if (input.event.type === "session.deleted") {
      const deletedID =
        (props?.sessionID as string | undefined) ??
        ((props?.info as { id?: string } | undefined)?.id as string | undefined)

      if (deletedID) {
        injectedSessions.delete(deletedID)
        activePlanBySessionID.delete(deletedID)
        stopVerificationLastPromptAt.delete(deletedID)
        blockerCache.delete(deletedID)
      }
      return
    }

    if (input.event.type !== "session.idle") {
      return
    }

    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    if (isContinuationStopped?.(sessionID)) return
    if (options.taskContinuationEnabled) return

    const lastPromptAt = stopVerificationLastPromptAt.get(sessionID) ?? 0
    const attemptAt = Date.now()
    if (attemptAt - lastPromptAt < STOP_VERIFICATION_COOLDOWN_MS) return

    const planId = await resolveActivePlan(sessionID)
    if (!planId) return

    await seedPlanTasksIfMissing(ctx.directory, planId, taskConfig, config)

    const incompleteTasks = listIncompleteTasks(
      {
        scope: "plan",
        container_id: planId,
      },
      taskConfig
    )
    if (incompleteTasks.length === 0) return

    const reason = `Incomplete plan tasks remain:\n\n${incompleteTasks
      .map((t) => `- ${t.title} [state=${t.state}, readiness=${t.readiness}]`)
      .join("\n")}\n\n**Options**:\n1. Complete remaining ready tasks\n2. If blocked: fix dependencies (task_update) or cancel the task (task_transition -> cancelled), and record blocker in \`ledger.yaml\`\n3. Use \`/stop --force\` to override`

    try {
      await reportContinuationIntent({
        sessionID,
        round: getContinuationRound?.(sessionID),
        source: "planning-with-files",
        reason: `stop_verification:${incompleteTasks.length}`,
        prompt: { text: reason },
        onResult: (result) => {
          if (result.status === "accepted") {
            stopVerificationLastPromptAt.set(sessionID, attemptAt)
            return
          }

          if (
            result.rejectReason === "lower_priority" ||
            result.rejectReason === "round_already_written"
          ) {
            stopVerificationLastPromptAt.set(sessionID, attemptAt)
            return
          }

          if (result.rejectReason) {
            log(`[${HOOK_NAME}] stop verification continuation rejected`, {
              sessionID,
              reason: result.rejectReason,
            })
          }
        },
      })
    } catch (err) {
      log(`[${HOOK_NAME}] stop verification continuation failed to report intent`, {
        sessionID,
        error: String(err),
      })
    }
  }

  return {
    "chat.message": chatMessage,
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
