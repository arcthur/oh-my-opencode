import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config/schema"
import type { BackgroundManager } from "../features/background-agent"
import { getMainSessionID, isSubagentSession } from "../features/claude-code-session-state"
import { listIncompleteTasks, listTaskNodes, type TaskSummary } from "../features/task-system"
import {
    findNearestMessageWithFields,
    type ToolPermission,
} from "../features/hook-message-injector"
import { resolveActiveTaskSelector } from "../features/work-state"
import { log } from "../shared/logger"
import { getMessageDir } from "../shared/session-utils"
import { createSystemDirective, SystemDirectiveTypes } from "../shared/system-directive"
import type { ContinuationIntent } from "./continuation-control"

const HOOK_NAME = "task-auto-continuation"

const DEFAULT_SKIP_AGENTS = ["prometheus", "compaction"]

export interface TaskAutoContinuationHookOptions {
  backgroundManager?: BackgroundManager
  taskConfig?: Partial<OhMyOpenCodeConfig>
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
  getContinuationRound?: (sessionID: string) => number | undefined
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
}

export interface TaskAutoContinuationHook {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cancelAllCountdowns: () => void
}

interface SessionState {
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
  idleRound?: number
}

const CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.TASK_CONTINUATION)}

Incomplete tasks remain in TaskGraph. Continue working on the next ready task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900
const COUNTDOWN_GRACE_PERIOD_MS = 500

function getIncompleteCount(tasks: TaskSummary[]): number {
  return tasks.filter((task) => task.state !== "completed" && task.state !== "cancelled").length
}

interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
}

function isLastAssistantMessageAborted(messages: Array<{ info?: MessageInfo }>): boolean {
  if (!messages || messages.length === 0) return false

  const assistantMessages = messages.filter(m => m.info?.role === "assistant")
  if (assistantMessages.length === 0) return false

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const errorName = lastAssistant.info?.error?.name

  if (!errorName) return false

  return errorName === "MessageAbortedError" || errorName === "AbortError"
}

export function createTaskAutoContinuationHook(
  ctx: PluginInput,
  options: TaskAutoContinuationHookOptions
): TaskAutoContinuationHook {
  const {
    backgroundManager,
    taskConfig = {},
    skipAgents = DEFAULT_SKIP_AGENTS,
    isContinuationStopped,
    getContinuationRound,
    reportContinuationIntent,
  } = options
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
    state.countdownStartedAt = undefined
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
    }
  }

  async function showCountdownToast(seconds: number, incompleteCount: number): Promise<void> {
    await ctx.client.tui.showToast({
      body: {
        title: "Task Continuation",
        message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
        variant: "warning" as const,
        duration: TOAST_DURATION_MS,
      },
    }).catch(() => {})
  }

  interface ResolvedMessageInfo {
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    tools?: Record<string, ToolPermission>
  }

  async function injectContinuation(
    sessionID: string,
    incompleteCount: number,
    resolvedInfo?: ResolvedMessageInfo,
    round?: number
  ): Promise<void> {
    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
      return
    }

    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    let incompleteTasks: TaskSummary[] = []
    let totalTaskCount = 0
    try {
      const resolved = resolveActiveTaskSelector(ctx.directory, sessionID)
      incompleteTasks = listIncompleteTasks(resolved.selector, taskConfig)
      totalTaskCount = listTaskNodes(
        {
          scope: resolved.selector.scope,
          container_id: resolved.selector.container_id,
          include_completed: true,
        },
        taskConfig
      ).length
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to query tasks`, { sessionID, error: String(err) })
      return
    }

    const freshIncompleteCount = getIncompleteCount(incompleteTasks)
    if (freshIncompleteCount === 0) {
      log(`[${HOOK_NAME}] Skipped injection: no incomplete tasks`, { sessionID })
      return
    }

    let agentName = resolvedInfo?.agent
    let model = resolvedInfo?.model
    let variant = resolvedInfo?.variant
    let tools = resolvedInfo?.tools

    if (!agentName || !model || !tools || variant === undefined) {
      const messageDir = getMessageDir(sessionID)
      const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
      agentName = agentName ?? prevMessage?.agent
      model = model ?? (prevMessage?.model?.providerID && prevMessage?.model?.modelID
        ? { 
            providerID: prevMessage.model.providerID, 
            modelID: prevMessage.model.modelID,
          }
        : undefined)
      variant = variant ?? prevMessage?.model?.variant
      tools = tools ?? prevMessage?.tools
    }

    if (agentName && skipAgents.includes(agentName)) {
      log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
      return
    }

    const editPermission = tools?.edit
    const writePermission = tools?.write
    const hasWritePermission = !tools ||
      ((editPermission !== false && editPermission !== "deny") &&
       (writePermission !== false && writePermission !== "deny"))
    if (!hasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: agentName })
      return
    }

    const taskList = incompleteTasks
      .map((task) => `- [${task.state}] ${task.title}`)
      .join("\n")
    const selectorInfo = (() => {
      const resolved = resolveActiveTaskSelector(ctx.directory, sessionID)
      return `TaskGraph selector: scope=${resolved.selector.scope}, container_id=${resolved.selector.container_id}`
    })()
    const prompt = `${CONTINUATION_PROMPT}

[${selectorInfo}]

[Status: ${Math.max(0, totalTaskCount - freshIncompleteCount)}/${Math.max(totalTaskCount, freshIncompleteCount)} completed, ${freshIncompleteCount} remaining]

Remaining tasks:
${taskList}`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, { sessionID, agent: agentName, model, incompleteCount: freshIncompleteCount })

      await reportContinuationIntent({
        sessionID,
        round,
        source: "task-auto-continuation",
        reason: `incomplete_tasks:${freshIncompleteCount}/${Math.max(totalTaskCount, freshIncompleteCount)}`,
        prompt: {
          ...(agentName !== undefined ? { agent: agentName } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(variant !== undefined ? { variant } : {}),
          text: prompt,
        },
        onResult: (result) => {
          if (result.status !== "accepted") {
            log(`[${HOOK_NAME}] Continuation intent rejected`, {
              sessionID,
              rejectReason: result.rejectReason,
            })
            return
          }

          if (result.error) {
            log(`[${HOOK_NAME}] Continuation injection failed`, {
              sessionID,
              error: String(result.error),
            })
            return
          }

          log(`[${HOOK_NAME}] Continuation injected`, { sessionID })
        },
      })

      log(`[${HOOK_NAME}] Continuation intent reported`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(err) })
    }
  }

  function startCountdown(
    sessionID: string,
    incompleteCount: number,
    resolvedInfo?: ResolvedMessageInfo,
    round?: number
  ): void {
    const state = getState(sessionID)
    cancelCountdown(sessionID)

    let secondsRemaining = COUNTDOWN_SECONDS
    showCountdownToast(secondsRemaining, incompleteCount)
    state.countdownStartedAt = Date.now()

    state.countdownInterval = setInterval(() => {
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    state.countdownTimer = setTimeout(() => {
      cancelCountdown(sessionID)
      injectContinuation(sessionID, incompleteCount, resolvedInfo, round)
    }, COUNTDOWN_SECONDS * 1000)

    log(`[${HOOK_NAME}] Countdown started`, { sessionID, seconds: COUNTDOWN_SECONDS, incompleteCount })
  }

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const error = props?.error as { name?: string } | undefined
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = getState(sessionID)
        state.abortDetectedAt = Date.now()
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      }

      cancelCountdown(sessionID)
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const mainSessionID = getMainSessionID()
      const isMainSession = sessionID === mainSessionID
      const isBackgroundTaskSession = isSubagentSession(sessionID)

      if (mainSessionID && !isMainSession && !isBackgroundTaskSession) {
        log(`[${HOOK_NAME}] Skipped: not main or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)
      state.idleRound = getContinuationRound?.(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      // Check 1: Event-based abort detection (primary, most reliable)
      if (state.abortDetectedAt) {
        const timeSinceAbort = Date.now() - state.abortDetectedAt
        const ABORT_WINDOW_MS = 3000
        if (timeSinceAbort < ABORT_WINDOW_MS) {
          log(`[${HOOK_NAME}] Skipped: abort detected via event ${timeSinceAbort}ms ago`, { sessionID })
          state.abortDetectedAt = undefined
          return
        }
        state.abortDetectedAt = undefined
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      // Check 2: API-based abort detection (fallback, for cases where event was missed)
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const messages = (messagesResp as { data?: Array<{ info?: MessageInfo }> }).data ?? []

        if (isLastAssistantMessageAborted(messages)) {
          log(`[${HOOK_NAME}] Skipped: last assistant message was aborted (API fallback)`, { sessionID })
          return
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Messages fetch failed, continuing`, { sessionID, error: String(err) })
      }

      let incompleteTasks: TaskSummary[] = []
      let totalTasks = 0
      try {
        const resolved = resolveActiveTaskSelector(ctx.directory, sessionID)
        incompleteTasks = listIncompleteTasks(resolved.selector, taskConfig)
        totalTasks = listTaskNodes(
          {
            scope: resolved.selector.scope,
            container_id: resolved.selector.container_id,
            include_completed: true,
          },
          taskConfig
        ).length
      } catch (err) {
        log(`[${HOOK_NAME}] Task query failed`, { sessionID, error: String(err) })
        return
      }

      if (totalTasks === 0) {
        log(`[${HOOK_NAME}] No tasks`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(incompleteTasks)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All tasks complete`, { sessionID, total: totalTasks })
        return
      }

      let resolvedInfo: ResolvedMessageInfo | undefined
      let hasCompactionMessage = false
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
        })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: {
            agent?: string
            model?: { providerID: string; modelID: string }
            modelID?: string
            providerID?: string
            tools?: Record<string, ToolPermission>
          }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          if (info?.agent === "compaction") {
            hasCompactionMessage = true
            continue
          }
          if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
            resolvedInfo = {
              agent: info.agent,
              model: info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
              tools: info.tools,
            }
            break
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(err) })
      }

      log(`[${HOOK_NAME}] Agent check`, { sessionID, agentName: resolvedInfo?.agent, skipAgents, hasCompactionMessage })
      if (resolvedInfo?.agent && skipAgents.includes(resolvedInfo.agent)) {
        log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: resolvedInfo.agent })
        return
      }
      if (hasCompactionMessage && !resolvedInfo?.agent) {
        log(`[${HOOK_NAME}] Skipped: compaction occurred but no agent info resolved`, { sessionID })
        return
      }

      if (isContinuationStopped?.(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID })
        return
      }

      startCountdown(sessionID, incompleteCount, resolvedInfo, state.idleRound)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (!sessionID) return

      if (role === "user") {
        const state = sessions.get(sessionID)
        if (state?.countdownStartedAt) {
          const elapsed = Date.now() - state.countdownStartedAt
          if (elapsed < COUNTDOWN_GRACE_PERIOD_MS) {
            log(`[${HOOK_NAME}] Ignoring user message in grace period`, { sessionID, elapsed })
            return
          }
        }
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }

      if (role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }
  }

  const cancelAllCountdowns = (): void => {
    for (const sessionID of sessions.keys()) {
      cancelCountdown(sessionID)
    }
    log(`[${HOOK_NAME}] All countdowns cancelled`)
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancelAllCountdowns,
  }
}
