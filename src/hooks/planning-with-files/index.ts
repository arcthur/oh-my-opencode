import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import type { ContextCollector } from "../../features/context-injector"
import { contextCollector as defaultCollector } from "../../features/context-injector"
import type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"
import { DEFAULT_PLANNING_CONFIG } from "../../features/planning-with-files/types"
import {
  detectActivePlan,
  detectPhaseCompletion,
  getPlanDir,
  getCurrentPhase,
  getStrikeGuidance,
  generateErrorRecordingPrompt,
  generateReflectionPrompt,
  initializePlan,
  loadState,
  parsePhases,
  readTaskPlan,
  saveState,
  wasFindingsModified,
} from "../../features/planning-with-files/manager"
import { sanitizePathSegment } from "../../shared/path-sanitizer"

export interface PlanningWithFilesHookOptions {
  config?: Partial<PlanningWithFilesConfig>
  collector?: ContextCollector
  todoContinuationEnabled?: boolean
}

function buildTaskPlanContext(content: string): string {
  return `<task-plan-context>
${content}
</task-plan-context>

<reminder>
Stay focused on the current phase. Do not deviate from the goal.
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

  // Strict, low-false-positive markers.
  if (raw.startsWith("❌")) {
    return raw.slice("❌".length).trim() || "Unknown error"
  }

  const lower = raw.toLowerCase()
  if (lower.startsWith("error:") || lower.startsWith("error ")) {
    return raw
  }

  return null
}

function extractPlanName(toolArgs: unknown): string | null {
  if (typeof toolArgs !== "object" || toolArgs === null) return null
  const obj = toolArgs as Record<string, unknown>
  const rawPlanName = obj.planName
  if (typeof rawPlanName !== "string" || !rawPlanName.trim()) return null
  return sanitizePathSegment(rawPlanName.trim()) ?? null
}

function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim()
}

function parseInitDirective(prompt: string): { planName: string } | null {
  const match = prompt.match(
    /(?:^|\n)\s*(?:start planning for|init plan|create plan for)\s+["']?([^"'\n]+?)["']?\s*(?:\n|$)/i
  )
  if (!match) return null

  const rawPlanName = match[1]?.trim()
  if (!rawPlanName) return null

  const planName = sanitizePathSegment(rawPlanName)
  if (!planName) return null

  return { planName }
}

function buildActiveNotice(cwd: string, planName: string, config: PlanningWithFilesConfig): string {
  // Use a stable, relative path to reduce prompt noise and improve cache hits.
  const planDir = `.sisyphus/${config.directory}/${planName}`
  return `<planning-with-files-active plan="${planName}">
## Planning with Files Active

**Plan**: ${planName}
**Location**: ${planDir}/

**Files**:
- task_plan.md - Phases, decisions, errors, blockers
- findings.md - Research (2-action rule)
- progress.md - Session logs

**Active Protocols**:
- Auto re-read task_plan before Write/Edit/Bash/NotebookEdit
- 2-Action Rule with auto-reset
- 3-Strike Error Protocol (forced recording on Strike 2+)
- Phase Reflection (prompts on completion for plan adjustment)
- Blockers section for escalation (distinct from retry-able errors)
- Stop verification
</planning-with-files-active>`
}

export function createPlanningWithFilesHook(
  ctx: PluginInput,
  options: PlanningWithFilesHookOptions = {}
): Hooks {
  const collector = options.collector ?? defaultCollector
  const config: PlanningWithFilesConfig = {
    ...DEFAULT_PLANNING_CONFIG,
    ...options.config,
    // Preserve defaults when zod optional fields are omitted
    reread_trigger_tools:
      options.config?.reread_trigger_tools ?? DEFAULT_PLANNING_CONFIG.reread_trigger_tools,
    action_count_tools:
      options.config?.action_count_tools ?? DEFAULT_PLANNING_CONFIG.action_count_tools,
  }

  if (!config.enabled) {
    return {}
  }

  const injectedSessions = new Set<string>()
  const activePlanBySessionID = new Map<string, string>()
  const toolArgsByCallID = new Map<string, unknown>()
  const stopVerificationLastPromptAt = new Map<string, number>()
  const STOP_VERIFICATION_COOLDOWN_MS = 60_000
  const rereadTriggerTools = new Set(config.reread_trigger_tools.map((t) => t.toLowerCase()))
  const actionCountTools = new Set(config.action_count_tools.map((t) => t.toLowerCase()))

  const resolveActivePlan = async (sessionID: string): Promise<string | null> => {
    const mapped = activePlanBySessionID.get(sessionID)
    if (mapped) {
      const statePath = path.join(getPlanDir(ctx.directory, mapped, config), ".planning-state.json")
      if (fs.existsSync(statePath)) return mapped
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
      await initializePlan(ctx.directory, init.planName, init.planName, config)
      injectedSessions.delete(input.sessionID)
      activePlanBySessionID.set(input.sessionID, init.planName)
    }

    if (injectedSessions.has(input.sessionID)) return

    const planName =
      init?.planName ??
      activePlanBySessionID.get(input.sessionID) ??
      (await detectActivePlan(ctx.directory, config))
    if (!planName) return
    activePlanBySessionID.set(input.sessionID, planName)

    const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text)
    if (textPartIndex === -1) return

    const notice = buildActiveNotice(ctx.directory, planName, config)
    output.parts[textPartIndex].text = `${output.parts[textPartIndex].text}\n\n${notice}`

    injectedSessions.add(input.sessionID)
  }

  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown }
  ): Promise<void> => {
    toolArgsByCallID.set(input.callID, output.args)

    if (!config.auto_reread) return
    if (!rereadTriggerTools.has(input.tool.toLowerCase())) return

    const planName = await resolveActivePlan(input.sessionID)
    if (!planName) return

    const taskPlan = await readTaskPlan(ctx.directory, planName, config)
    if (!taskPlan) return

    collector.register(input.sessionID, {
      id: "task-plan-context",
      source: "planning-with-files",
      priority: "critical",
      content: buildTaskPlanContext(taskPlan),
      metadata: {
        planName,
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
    const normalizedTool = input.tool.toLowerCase()

    // Auto-create planning files after a successful multi_plan run.
    if (config.auto_from_multi_plan && normalizedTool === "multi_plan") {
      const isSuccess = output.output.trim().startsWith("✅")
      const planNameFromArgs = extractPlanName(toolArgs)

      if (isSuccess && planNameFromArgs) {
        activePlanBySessionID.set(input.sessionID, planNameFromArgs)
        const planDir = getPlanDir(ctx.directory, planNameFromArgs, config)
        const alreadyInitialized = fs.existsSync(path.join(planDir, ".planning-state.json"))

        if (!alreadyInitialized) {
          await initializePlan(ctx.directory, planNameFromArgs, planNameFromArgs, config)
        }

        collector.register(input.sessionID, {
          id: "auto-from-multi-plan",
          source: "planning-with-files",
          priority: "high",
          content: `<planning-with-files-auto-from-multi-plan plan="${planNameFromArgs}">
Planning files initialized at \`.sisyphus/${config.directory}/${planNameFromArgs}/\`.
</planning-with-files-auto-from-multi-plan>`,
          metadata: { planName: planNameFromArgs, created: !alreadyInitialized },
        })
      }
    }

    const planName = await resolveActivePlan(input.sessionID)
    if (!planName) return

    const state = await loadState(ctx.directory, planName, config)
    if (!state) return

    // 3-strike protocol (best-effort) based on tool output markers.
    if (config.three_strike_protocol) {
      const errorText = extractToolError({ output: output.output })
      if (errorText) {
        const errorKey = `${input.tool}:${errorText.slice(0, 80)}`
        state.errorStrikes[errorKey] = (state.errorStrikes[errorKey] ?? 0) + 1
        await saveState(ctx.directory, state, config)

        const strikes = state.errorStrikes[errorKey]
        const requiresRecording = strikes >= 2

        const taskPlan = await readTaskPlan(ctx.directory, planName, config)
        const phases = taskPlan ? parsePhases(taskPlan) : []
        const currentPhase = getCurrentPhase(phases)

        let content = `<three-strike-protocol strike="${strikes}">
${getStrikeGuidance(strikes, requiresRecording)}

Error: ${errorText.slice(0, 150)}
</three-strike-protocol>`

        if (requiresRecording) {
          content += `\n\n${generateErrorRecordingPrompt(errorKey, strikes, currentPhase)}`
        }

        collector.register(input.sessionID, {
          id: `three-strike-${errorKey}`,
          source: "planning-with-files",
          priority: "high",
          content,
          metadata: { planName, errorKey, strikes },
        })
      }
    }

    // Phase reflection: prompt after a phase transitions to complete in task_plan.md
    if (["Write", "Edit", "write", "edit"].includes(input.tool) && filePath?.includes("task_plan.md")) {
      const taskPlan = await readTaskPlan(ctx.directory, planName, config)
      if (taskPlan) {
        const phases = parsePhases(taskPlan)
        const newlyCompleted = detectPhaseCompletion(ctx.directory, planName, phases, config)
        for (const phase of newlyCompleted) {
          collector.register(input.sessionID, {
            id: `phase-reflection-${phase.id}`,
            source: "planning-with-files",
            priority: "high",
            content: generateReflectionPrompt(phase, phases),
            metadata: { planName, phaseId: phase.id },
          })
        }
      }
    }

    const findingsCheck = await wasFindingsModified(
      ctx.directory,
      planName,
      state.lastFindingsMtime,
      config
    )
    if (findingsCheck.modified) {
      state.actionCount = 0
      state.lastFindingsMtime = findingsCheck.newMtime
      await saveState(ctx.directory, state, config)
      return
    }

    if (config.two_action_rule && actionCountTools.has(input.tool.toLowerCase())) {
      state.actionCount += 1
      await saveState(ctx.directory, state, config)

      if (state.actionCount >= 2 && state.actionCount % 2 === 0) {
        const findingsPath = `.sisyphus/${config.directory}/${planName}/findings.md`
        collector.register(input.sessionID, {
          id: "two-action-rule",
          source: "planning-with-files",
          priority: "high",
          content: `<two-action-rule>
## Update findings.md NOW

${state.actionCount} research operations completed.

Update \`${findingsPath}\` with:
- Key discoveries
- Technical decisions
- Resources found

Counter auto-resets when you modify findings.md.
</two-action-rule>`,
          metadata: { planName, actionCount: state.actionCount },
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
      }
      return
    }

    if (input.event.type !== "session.idle") {
      return
    }

    const sessionID = props?.sessionID as string | undefined
    if (!sessionID) return

    const lastPromptAt = stopVerificationLastPromptAt.get(sessionID) ?? 0
    const now = Date.now()
    if (now - lastPromptAt < STOP_VERIFICATION_COOLDOWN_MS) return

    if (options.todoContinuationEnabled) {
      try {
        const todosResp = await ctx.client.session.todo({ path: { id: sessionID } })
        const todos = (todosResp as any)?.data ?? todosResp
        if (Array.isArray(todos)) {
          const incompleteTodos = todos.filter((t) => {
            const status = (t as { status?: string } | null)?.status
            return status !== "completed" && status !== "cancelled"
          })
          if (incompleteTodos.length > 0) return
        }
      } catch {
        // Fail open - stop verification still applies.
      }
    }

    const planName = await resolveActivePlan(sessionID)
    if (!planName) return

    const taskPlan = await readTaskPlan(ctx.directory, planName, config)
    if (!taskPlan) return

    const phases = parsePhases(taskPlan)
    const incomplete = phases.filter(
      (p) => p.status !== "complete" && p.status !== "blocked"
    )
    if (incomplete.length === 0) return

    const reason = `Incomplete phases:\n\n${incomplete
      .map((p) => `- Phase ${p.id}: ${p.name} (${p.status})`)
      .join("\n")}\n\n**Options**:\n1. Complete remaining phases\n2. Mark phases as \`blocked\` in task_plan.md\n3. Use \`/stop --force\` to override`

    stopVerificationLastPromptAt.set(sessionID, now)
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text: reason }] },
      query: { directory: ctx.directory },
    }).catch(() => {})
  }

  return {
    "chat.message": chatMessage,
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
