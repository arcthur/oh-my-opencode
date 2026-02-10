import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import type { OpencodeClient, QueueItem } from "./constants"
import { log, getAgentToolRestrictions, promptWithModelSuggestionRetry } from "../../shared"
import { markSubagentSession } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import type { ConcurrencyManager } from "./concurrency"

export interface SpawnerContext {
  client: OpencodeClient
  directory: string
  concurrencyManager: ConcurrencyManager
  onTaskError: (task: BackgroundTask, error: Error) => void
}

export function createTask(input: LaunchInput): BackgroundTask {
  return {
    id: `bg_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    queuedAt: new Date(),
    description: input.description,
    prompt: input.prompt,
    agent: input.agent,
    category: input.category,
    isUnstableAgent: input.isUnstableAgent,
    parentSessionID: input.parentSessionID,
    parentMessageID: input.parentMessageID,
    parentModel: input.parentModel,
    parentAgent: input.parentAgent,
    model: input.model,
  }
}

export async function startTask(
  item: QueueItem,
  ctx: SpawnerContext
): Promise<void> {
  const { task, input } = item
  const { client, directory, concurrencyManager, onTaskError } = ctx

  log("[background-agent] Starting task:", {
    taskId: task.id,
    agent: input.agent,
    model: input.model,
  })

  const concurrencyKey = input.model
    ? `${input.model.providerID}/${input.model.modelID}`
    : input.agent

  const parentSession = await client.session.get({
    path: { id: input.parentSessionID },
  }).catch((err) => {
    log(`[background-agent] Failed to get parent session: ${err}`)
    return null
  })
  const parentDirectory = parentSession?.data?.directory ?? directory
  const sessionDirectory =
    typeof input.directory === "string" && input.directory.trim().length > 0
      ? input.directory
      : parentDirectory
  log(`[background-agent] Parent dir: ${parentSession?.data?.directory}, using: ${sessionDirectory}`)

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `Background: ${input.description}`,
      permission: [
        { permission: "question", action: "deny" as const, pattern: "*" },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    query: {
      directory: sessionDirectory,
    },
  }).catch((error) => {
    concurrencyManager.release(concurrencyKey)
    throw error
  })

  if (createResult.error) {
    concurrencyManager.release(concurrencyKey)
    throw new Error(`Failed to create background session: ${createResult.error}`)
  }

  const sessionID = createResult.data.id
  markSubagentSession(sessionID, input.parentSessionID)

  task.status = "running"
  task.startedAt = new Date()
  task.sessionID = sessionID
  task.progress = {
    toolCalls: 0,
    lastUpdate: new Date(),
  }
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.updateTask(task.id, "running")
  }

  log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
    sessionID,
    agent: input.agent,
    model: input.model,
    hasSkillContent: !!input.skillContent,
    promptLength: input.prompt.length,
  })

  const launchModel = input.model
    ? { providerID: input.model.providerID, modelID: input.model.modelID }
    : undefined
  const launchVariant = input.model?.variant

  promptWithModelSuggestionRetry(client, {
    path: { id: sessionID },
    body: {
      agent: input.agent,
      ...(launchModel ? { model: launchModel } : {}),
      ...(launchVariant ? { variant: launchVariant } : {}),
      system: input.skillContent,
      tools: {
        ...getAgentToolRestrictions(input.agent),
        task: false,
        delegate_task: false,
        question: false,
      },
      parts: [{ type: "text", text: input.prompt }],
    },
  }).catch((error) => {
    log("[background-agent] promptAsync error:", error)
    onTaskError(task, error instanceof Error ? error : new Error(String(error)))
  })
}

export async function resumeTask(
  task: BackgroundTask,
  input: ResumeInput,
  ctx: Pick<SpawnerContext, "client" | "concurrencyManager" | "onTaskError">
): Promise<void> {
  const { client, concurrencyManager, onTaskError } = ctx

  if (!task.sessionID) {
    throw new Error(`Task has no sessionID: ${task.id}`)
  }

  if (task.status === "running") {
    log("[background-agent] Resume skipped - task already running:", {
      taskId: task.id,
      sessionID: task.sessionID,
    })
    return
  }

  const concurrencyKey =
    task.concurrencyGroup ??
    (task.model
      ? `${task.model.providerID}/${task.model.modelID}`
      : task.agent)
  await concurrencyManager.acquire(concurrencyKey)
  task.concurrencyKey = concurrencyKey
  task.concurrencyGroup = concurrencyKey

  task.status = "running"
  task.completedAt = undefined
  task.error = undefined
  task.parentSessionID = input.parentSessionID
  task.parentMessageID = input.parentMessageID
  task.parentModel = input.parentModel
  task.parentAgent = input.parentAgent
  task.startedAt = new Date()

  task.progress = {
    toolCalls: task.progress?.toolCalls ?? 0,
    lastUpdate: new Date(),
  }

  markSubagentSession(task.sessionID, task.parentSessionID)

  const toastManager = getTaskToastManager()
  if (toastManager) {
    toastManager.addTask({
      id: task.id,
      description: task.description,
      agent: task.agent,
      isBackground: true,
    })
  }

  log("[background-agent] Resuming task:", { taskId: task.id, sessionID: task.sessionID })

  log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
    sessionID: task.sessionID,
    agent: task.agent,
    model: task.model,
    promptLength: input.prompt.length,
  })

  const resumeModel = task.model
    ? { providerID: task.model.providerID, modelID: task.model.modelID }
    : undefined
  const resumeVariant = task.model?.variant

  client.session.prompt({
    path: { id: task.sessionID },
    body: {
      agent: task.agent,
      ...(resumeModel ? { model: resumeModel } : {}),
      ...(resumeVariant ? { variant: resumeVariant } : {}),
      tools: {
        ...getAgentToolRestrictions(task.agent),
        task: false,
        delegate_task: false,
        question: false,
      },
      parts: [{ type: "text", text: input.prompt }],
    },
  }).catch((error) => {
    log("[background-agent] resume prompt error:", error)
    onTaskError(task, error instanceof Error ? error : new Error(String(error)))
  })
}
