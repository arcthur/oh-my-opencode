import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import { getMainSessionID, getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import type { ContinuationIntent } from "../continuation-control"

const HOOK_NAME = "unstable-agent-watchdog"
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_THINKING_SUMMARY_MAX_CHARS = 500

type MessageInfo = {
  role?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
}

type MessagePart = {
  type?: string
  text?: string
  thinking?: string
}

interface ReminderCandidate {
  task: BackgroundTask
  idleMs: number
  summary: string | null
}

export interface UnstableAgentWatchdogOptions {
  backgroundManager:
    Pick<BackgroundManager, "getTasksByParentSession">
    & Partial<Pick<BackgroundManager, "getAllDescendantTasks">>
  reportContinuationIntent: (intent: ContinuationIntent) => Promise<void>
  getContinuationRound?: (sessionID: string) => number | undefined
  isContinuationStopped?: (sessionID: string) => boolean
  timeoutMs?: number
  cooldownMs?: number
  thinkingSummaryMaxChars?: number
}

function hasData(value: unknown): value is { data?: unknown } {
  return typeof value === "object" && value !== null && "data" in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessageInfo(value: unknown): MessageInfo | undefined {
  if (!isRecord(value)) return undefined
  if (!isRecord(value.info)) return undefined
  const info = value.info
  const modelValue = isRecord(info.model) ? info.model : undefined
  const model = modelValue &&
    typeof modelValue.providerID === "string" &&
    typeof modelValue.modelID === "string"
    ? { providerID: modelValue.providerID, modelID: modelValue.modelID }
    : undefined

  return {
    role: typeof info.role === "string" ? info.role : undefined,
    agent: typeof info.agent === "string" ? info.agent : undefined,
    model,
    providerID: typeof info.providerID === "string" ? info.providerID : undefined,
    modelID: typeof info.modelID === "string" ? info.modelID : undefined,
  }
}

function getMessageParts(value: unknown): MessagePart[] {
  if (!isRecord(value) || !Array.isArray(value.parts)) {
    return []
  }
  return value.parts
    .filter(isRecord)
    .map((part) => ({
      type: typeof part.type === "string" ? part.type : undefined,
      text: typeof part.text === "string" ? part.text : undefined,
      thinking: typeof part.thinking === "string" ? part.thinking : undefined,
    }))
}

function extractMessages(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (hasData(value) && Array.isArray(value.data)) {
    return value.data
  }
  return []
}

function isUnstableTask(task: BackgroundTask): boolean {
  if (task.isUnstableAgent === true) return true
  const modelId = task.model?.modelID?.toLowerCase()
  return modelId ? modelId.includes("gemini") || modelId.includes("minimax") : false
}

function buildReminder(candidates: ReminderCandidate[], summaryMaxChars: number): string {
  const header = [
    "Unstable background tasks appear idle and may be stuck.",
    "No automatic action was taken.",
    "",
  ]

  const blocks = candidates.flatMap(({ task, idleMs, summary }, index) => {
    const idleSeconds = Math.round(idleMs / 1000)
    const summaryText = summary ?? "(No thinking trace available)"

    return [
      `Task ${index + 1}:`,
      `- Task ID: ${task.id}`,
      `- Description: ${task.description}`,
      `- Agent: ${task.agent}`,
      `- Session ID: ${task.sessionID ?? "N/A"}`,
      `- Idle: ${idleSeconds}s`,
      `- Thinking summary (first ${summaryMaxChars} chars):`,
      summaryText,
      "- Suggested actions:",
      `  - background_output task_id="${task.id}" full_session=true include_thinking=true include_tool_results=true message_limit=50`,
      `  - background_cancel task_id="${task.id}"`,
      "",
    ]
  })

  return [...header, ...blocks].join("\n").trim()
}

async function getThinkingSummary(
  ctx: Pick<PluginInput, "client">,
  sessionID: string,
  maxChars: number
): Promise<string | null> {
  try {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = extractMessages(response)
    const chunks: string[] = []

    for (const message of messages) {
      const info = getMessageInfo(message)
      if (info?.role !== "assistant") continue

      const parts = getMessageParts(message)
      for (const part of parts) {
        if (part.type === "thinking" && part.thinking) {
          chunks.push(part.thinking)
        }
        if (part.type === "reasoning" && part.text) {
          chunks.push(part.text)
        }
      }
    }

    const combined = chunks.join("\n").trim()
    if (!combined) return null
    if (combined.length <= maxChars) return combined
    return combined.slice(0, maxChars) + "..."
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to fetch thinking summary`, {
      sessionID,
      error: String(error),
    })
    return null
  }
}

async function resolveMainSessionTarget(
  ctx: Pick<PluginInput, "client">,
  sessionID: string
): Promise<{ agent?: string; model?: { providerID: string; modelID: string } }> {
  let agent = getSessionAgent(sessionID)
  let model: { providerID: string; modelID: string } | undefined

  try {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
    })
    const messages = extractMessages(response)

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = getMessageInfo(messages[i])
      if (info?.agent || info?.model || (info?.providerID && info?.modelID)) {
        agent = agent ?? info?.agent
        model = info?.model ?? (
          info?.providerID && info?.modelID
            ? { providerID: info.providerID, modelID: info.modelID }
            : undefined
        )
        break
      }
    }
  } catch (error) {
    log(`[${HOOK_NAME}] Failed to resolve target agent/model`, {
      sessionID,
      error: String(error),
    })
  }

  return { agent, model }
}

export function createUnstableAgentWatchdogHook(
  ctx: Pick<PluginInput, "client" | "directory">,
  options: UnstableAgentWatchdogOptions
) {
  const reminderCooldownByTask = new Map<string, number>()

  const event = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type !== "session.idle") return

    const properties = event.properties as Record<string, unknown> | undefined
    const sessionID = properties?.sessionID as string | undefined
    if (!sessionID) return

    const mainSessionID = getMainSessionID()
    if (!mainSessionID || sessionID !== mainSessionID) return
    if (options.isContinuationStopped?.(mainSessionID)) return

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const thinkingSummaryMaxChars =
      options.thinkingSummaryMaxChars ?? DEFAULT_THINKING_SUMMARY_MAX_CHARS

    const directTasks = options.backgroundManager.getTasksByParentSession(mainSessionID)
    const descendantTasks =
      options.backgroundManager.getAllDescendantTasks?.(mainSessionID) ?? []
    const tasks = Array.from(
      new Map(
        [...directTasks, ...descendantTasks].map((task) => [task.id, task])
      ).values()
    )
    if (tasks.length === 0) return

    const now = Date.now()
    const activeRunningTaskIDs = new Set<string>()
    const candidates: Array<{ task: BackgroundTask; idleMs: number }> = []

    for (const task of tasks) {
      if (task.status !== "running") continue
      activeRunningTaskIDs.add(task.id)

      if (!isUnstableTask(task)) continue

      const lastMessageAt = task.progress?.lastMessageAt
      if (!lastMessageAt) continue

      const idleMs = now - lastMessageAt.getTime()
      if (idleMs < timeoutMs) continue

      const lastReminderAt = reminderCooldownByTask.get(task.id)
      if (lastReminderAt && now - lastReminderAt < cooldownMs) continue

      candidates.push({ task, idleMs })
    }

    for (const taskID of reminderCooldownByTask.keys()) {
      if (!activeRunningTaskIDs.has(taskID)) {
        reminderCooldownByTask.delete(taskID)
      }
    }

    if (candidates.length === 0) return

    const reminderCandidates: ReminderCandidate[] = await Promise.all(
      candidates.map(async ({ task, idleMs }) => ({
        task,
        idleMs,
        summary: task.sessionID
          ? await getThinkingSummary(ctx, task.sessionID, thinkingSummaryMaxChars)
          : null,
      }))
    )

    const reminderText = buildReminder(reminderCandidates, thinkingSummaryMaxChars)
    const { agent, model } = await resolveMainSessionTarget(ctx, mainSessionID)

    try {
      await options.reportContinuationIntent({
        sessionID: mainSessionID,
        round: options.getContinuationRound?.(mainSessionID),
        source: "unstable-agent-watchdog",
        reason: `unstable_background_idle:${reminderCandidates.length}`,
        prompt: {
          ...(agent ? { agent } : {}),
          ...(model ? { model } : {}),
          text: reminderText,
        },
        onResult: (result) => {
          if (result.status !== "accepted" || result.error) {
            log(`[${HOOK_NAME}] Reminder not accepted`, {
              sessionID: mainSessionID,
              status: result.status,
              rejectReason: result.rejectReason,
              error: result.error ? String(result.error) : undefined,
            })
            return
          }

          for (const { task } of reminderCandidates) {
            reminderCooldownByTask.set(task.id, now)
          }

          log(`[${HOOK_NAME}] Reminder injected`, {
            sessionID: mainSessionID,
            taskIDs: reminderCandidates.map(({ task }) => task.id),
          })
        },
      })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to report reminder intent`, {
        sessionID: mainSessionID,
        error: String(error),
      })
    }
  }

  return { event }
}
