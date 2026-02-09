import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import type { BackgroundTaskConfig, OhMyOpenCodeConfig } from "../../config/schema"
import type { ParallelRuntimeConfig, RunEventType, SlotAcquireRequest } from "../parallel-runtime"
import {
  TASK_TTL_MS,
  MIN_STABILITY_TIME_MS,
  DEFAULT_STALE_TIMEOUT_MS,
  MIN_RUNTIME_BEFORE_STALE_MS,
  MIN_IDLE_TIME_MS,
  POLLING_INTERVAL_MS,
  type ProcessCleanupEvent,
  type OpencodeClient,
  type MessagePartInfo,
  type BackgroundEvent,
} from "./constants"
import { TaskStateManager } from "./state"
import { createTask, startTask, resumeTask, type SpawnerContext } from "./spawner"
import {
  checkSessionTasks,
  validateSessionHasOutput,
  tryCompleteTask,
  notifyParentSession,
  type ResultHandlerContext,
} from "./result-handler"
import { log } from "../../shared"
import { ConcurrencyManager } from "./concurrency"
import { markSubagentSession, unmarkSubagentSession } from "../claude-code-session-state"
import { getTaskToastManager } from "../task-toast-manager"
import {
  acquireSlot,
  recordRunEvent,
  releaseSlot,
  renewSlot,
  resolveParallelRuntimeConfig,
} from "../parallel-runtime"

type ProcessCleanupHandler = () => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export class BackgroundManager {
  private static cleanupManagers = new Set<BackgroundManager>()
  private static cleanupRegistered = false
  private static cleanupHandlers = new Map<ProcessCleanupEvent, ProcessCleanupHandler>()

  private client: OpencodeClient
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private concurrencyManager: ConcurrencyManager
  private shutdownTriggered = false
  private config?: BackgroundTaskConfig
  private parallelRuntimeConfig: ParallelRuntimeConfig
  private taskConfig: Partial<OhMyOpenCodeConfig>
  private onShutdown?: () => void
  private state: TaskStateManager
  private leaseHeartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    ctx: PluginInput,
    config?: BackgroundTaskConfig,
    options?: {
      onShutdown?: () => void
      parallelRuntimeConfig?: Partial<ParallelRuntimeConfig>
      taskConfig?: Partial<OhMyOpenCodeConfig>
    }
  ) {
    this.state = new TaskStateManager()
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
    this.config = config
    this.parallelRuntimeConfig = resolveParallelRuntimeConfig(
      options?.parallelRuntimeConfig ?? { enabled: false }
    )
    this.taskConfig = options?.taskConfig ?? {}
    this.onShutdown = options?.onShutdown
    this.registerProcessCleanup()
  }

  private getSpawnerContext(): SpawnerContext {
    return {
      client: this.client,
      directory: this.directory,
      concurrencyManager: this.concurrencyManager,
      onTaskError: (task, error) => this.handleTaskError(task, error),
    }
  }

  private getResultHandlerContext(): ResultHandlerContext {
    return {
      client: this.client,
      concurrencyManager: this.concurrencyManager,
      state: this.state,
      taskConfig: this.taskConfig,
      onTaskFinalized: async (task, status) => {
        this.releaseParallelLease(task, status)
      },
    }
  }

  private getTaskRunId(task: BackgroundTask): string {
    if (!task.parallelRunId) {
      task.parallelRunId = `background:${task.id}`
    }
    return task.parallelRunId
  }

  private shouldUseParallelRuntime(): boolean {
    return this.parallelRuntimeConfig.enabled
  }

  private startLeaseHeartbeat(task: BackgroundTask): void {
    if (!this.shouldUseParallelRuntime()) return
    if (!task.parallelLeaseId) return

    this.stopLeaseHeartbeat(task.id)
    const heartbeatMs = this.parallelRuntimeConfig.heartbeat_ms
    const timer = setInterval(() => {
      const currentTask = this.state.getTask(task.id)
      const leaseId = currentTask?.parallelLeaseId
      if (!leaseId) {
        this.stopLeaseHeartbeat(task.id)
        return
      }

      renewSlot(leaseId, this.parallelRuntimeConfig).catch((error) => {
        log("[background-agent] Failed to renew global lease", {
          taskId: task.id,
          leaseId,
          error: String(error),
        })
      })
    }, heartbeatMs)
    timer.unref()
    this.leaseHeartbeatTimers.set(task.id, timer)
  }

  private stopLeaseHeartbeat(taskId: string): void {
    const timer = this.leaseHeartbeatTimers.get(taskId)
    if (!timer) return
    clearInterval(timer)
    this.leaseHeartbeatTimers.delete(taskId)
  }

  private recordParallelEvent(
    task: BackgroundTask,
    type: RunEventType,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.shouldUseParallelRuntime()) return
    const runId = this.getTaskRunId(task)

    recordRunEvent(
      {
        runId,
        subsystem: "background",
        type,
        ownerSessionId: task.sessionID ?? task.parentSessionID,
        leaseId: task.parallelLeaseId,
        metadata,
      },
      this.parallelRuntimeConfig
    ).catch((error) => {
      log("[background-agent] Failed to record parallel runtime event", {
        taskId: task.id,
        runId,
        type,
        error: String(error),
      })
    })
  }

  private async acquireParallelSlot(
    task: BackgroundTask,
    input: { parentSessionID: string; parentAgent?: string }
  ): Promise<boolean> {
    if (!this.shouldUseParallelRuntime()) return true

    const request: SlotAcquireRequest = {
      subsystem: "background",
      runId: this.getTaskRunId(task),
      ownerSessionId: task.sessionID ?? input.parentSessionID,
      metadata: {
        taskId: task.id,
        agent: task.agent,
        category: task.category,
        parentAgent: input.parentAgent,
      },
    }

    const lease = await acquireSlot(request, this.parallelRuntimeConfig)
    if (!lease) {
      this.recordParallelEvent(task, "timed_out", {
        reason: "global_slots_exhausted",
      })
      return false
    }

    task.parallelLeaseId = lease.leaseId
    this.startLeaseHeartbeat(task)
    return true
  }

  private releaseParallelLease(
    task: BackgroundTask,
    type: "completed" | "failed" | "cancelled" | "timed_out" | "released",
    metadata?: Record<string, unknown>
  ): void {
    const leaseId = task.parallelLeaseId
    this.stopLeaseHeartbeat(task.id)
    this.recordParallelEvent(task, type, metadata)

    if (!this.shouldUseParallelRuntime() || !leaseId) {
      task.parallelLeaseId = undefined
      return
    }

    task.parallelLeaseId = undefined
    releaseSlot(leaseId, this.parallelRuntimeConfig).catch((error) => {
      log("[background-agent] Failed to release global lease", {
        taskId: task.id,
        leaseId,
        error: String(error),
      })
    })
  }

  private handleTaskError(task: BackgroundTask, error: Error): void {
    const existingTask = this.state.findBySession(task.sessionID ?? "")
    if (existingTask) {
      existingTask.status = "interrupt"
      const errorMessage = error.message
      if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
        existingTask.error = `Agent "${task.agent}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.`
      } else {
        existingTask.error = errorMessage
      }
      existingTask.completedAt = new Date()
      if (existingTask.concurrencyKey) {
        this.concurrencyManager.release(existingTask.concurrencyKey)
        existingTask.concurrencyKey = undefined
      }
      this.releaseParallelLease(existingTask, "failed", {
        error: existingTask.error,
      })

      this.state.markForNotification(existingTask)
      notifyParentSession(existingTask, this.getResultHandlerContext()).catch(err => {
        log("[background-agent] Failed to notify on error:", err)
      })
    }
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      category: input.category,
      parentSessionID: input.parentSessionID,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const task = createTask(input)
    this.getTaskRunId(task)
    this.state.addTask(task)
    this.recordParallelEvent(task, "queued")

    if (input.parentSessionID) {
      this.state.trackPendingTask(input.parentSessionID, task.id)
    }

    const key = this.state.getConcurrencyKeyFromInput(input)
    this.state.addToQueue(key, { task, input })

    log("[background-agent] Task queued:", { taskId: task.id, key, queueLength: this.state.getQueue(key)?.length ?? 0 })

    const toastManager = getTaskToastManager()
    if (toastManager) {
      toastManager.addTask({
        id: task.id,
        description: input.description,
        agent: input.agent,
        isBackground: true,
        status: "queued",
        category: input.category,
        skills: input.skills,
      })
    }

    this.processKey(key)

    return task
  }

  private async processKey(key: string): Promise<void> {
    if (this.state.processingKeys.has(key)) {
      return
    }

    this.state.processingKeys.add(key)

    try {
      const queue = this.state.getQueue(key)
      while (queue && queue.length > 0) {
        const item = queue[0]

        await this.concurrencyManager.acquire(key)

        if (item.task.status === "cancelled") {
          this.concurrencyManager.release(key)
          this.releaseParallelLease(item.task, "cancelled", {
            reason: "cancelled_before_start",
          })
          queue.shift()
          continue
        }

        const acquiredGlobalSlot = await this.acquireParallelSlot(item.task, {
          parentSessionID: item.input.parentSessionID,
          parentAgent: item.input.parentAgent,
        })
        if (!acquiredGlobalSlot && this.parallelRuntimeConfig.mode === "enforce") {
          this.concurrencyManager.release(key)
          item.task.status = "error"
          item.task.error = "Global parallel slots exhausted (background admission timeout)"
          item.task.completedAt = new Date()
          this.state.markForNotification(item.task)
          await notifyParentSession(item.task, this.getResultHandlerContext()).catch((err) => {
            log("[background-agent] Failed to notify parent after global slot timeout", {
              taskId: item.task.id,
              error: String(err),
            })
          })
          queue.shift()
          continue
        }

        try {
          await startTask(item, this.getSpawnerContext())
          this.recordParallelEvent(item.task, "started")
          this.startPolling()
        } catch (error) {
          log("[background-agent] Error starting task:", error)
          if (!item.task.concurrencyKey) {
            this.concurrencyManager.release(key)
          }
          item.task.status = "error"
          item.task.error = error instanceof Error ? error.message : String(error)
          item.task.completedAt = new Date()
          this.releaseParallelLease(item.task, "failed", {
            reason: "start_task_failed",
          })
          this.state.markForNotification(item.task)
          await notifyParentSession(item.task, this.getResultHandlerContext()).catch((err) => {
            log("[background-agent] Failed to notify parent after start error", {
              taskId: item.task.id,
              error: String(err),
            })
          })
        }

        queue.shift()
      }
    } finally {
      this.state.processingKeys.delete(key)
    }
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.state.getTask(id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    return this.state.getTasksByParentSession(sessionID)
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    return this.state.getAllDescendantTasks(sessionID)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    return this.state.findBySession(sessionID)
  }

  async trackTask(input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    const existingTask = this.state.getTask(input.taskId)
    if (existingTask) {
      this.getTaskRunId(existingTask)
      const parentChanged = input.parentSessionID !== existingTask.parentSessionID
      if (parentChanged) {
        this.state.cleanupPendingByParent(existingTask)
        existingTask.parentSessionID = input.parentSessionID
      }
      if (input.parentAgent !== undefined) {
        existingTask.parentAgent = input.parentAgent
      }
      if (!existingTask.concurrencyGroup) {
        existingTask.concurrencyGroup = input.concurrencyKey ?? existingTask.agent
      }

      if (existingTask.sessionID) {
        markSubagentSession(existingTask.sessionID, existingTask.parentSessionID)
      }
      this.startPolling()

      if (existingTask.status === "pending" || existingTask.status === "running") {
        this.state.trackPendingTask(input.parentSessionID, existingTask.id)
      } else if (!parentChanged) {
        this.state.cleanupPendingByParent(existingTask)
      }

      log("[background-agent] External task already registered:", { taskId: existingTask.id, sessionID: existingTask.sessionID, status: existingTask.status })

      return existingTask
    }

    const concurrencyGroup = input.concurrencyKey ?? input.agent ?? "delegate_task"

    if (input.concurrencyKey) {
      await this.concurrencyManager.acquire(input.concurrencyKey)
    }

    const task: BackgroundTask = {
      id: input.taskId,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      parentMessageID: "",
      description: input.description,
      prompt: "",
      agent: input.agent || "delegate_task",
      status: "running",
      startedAt: new Date(),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(),
      },
      parentAgent: input.parentAgent,
      concurrencyKey: input.concurrencyKey,
      concurrencyGroup,
    }

    this.state.addTask(task)
    this.getTaskRunId(task)
    markSubagentSession(input.sessionID, input.parentSessionID)
    this.startPolling()

    const acquiredGlobalSlot = await this.acquireParallelSlot(task, {
      parentSessionID: input.parentSessionID,
      parentAgent: input.parentAgent,
    })
    if (!acquiredGlobalSlot && this.parallelRuntimeConfig.mode === "enforce") {
      if (input.concurrencyKey) {
        this.concurrencyManager.release(input.concurrencyKey)
      }
      this.state.removeTask(task.id)
      throw new Error("Global parallel slots exhausted (trackTask admission timeout)")
    }
    this.recordParallelEvent(task, "started", {
      source: "trackTask",
    })

    if (input.parentSessionID) {
      this.state.trackPendingTask(input.parentSessionID, task.id)
    }

    log("[background-agent] Registered external task:", { taskId: task.id, sessionID: input.sessionID })

    return task
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    const existingTask = this.state.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    this.getTaskRunId(existingTask)
    if (existingTask.status === "running") {
      return existingTask
    }

    const acquiredGlobalSlot = await this.acquireParallelSlot(existingTask, {
      parentSessionID: input.parentSessionID,
      parentAgent: input.parentAgent,
    })
    if (!acquiredGlobalSlot && this.parallelRuntimeConfig.mode === "enforce") {
      throw new Error("Global parallel slots exhausted (resume admission timeout)")
    }

    try {
      await resumeTask(existingTask, input, {
        client: this.client,
        concurrencyManager: this.concurrencyManager,
        onTaskError: (task, error) => this.handleTaskError(task, error),
      })
    } catch (error) {
      this.releaseParallelLease(existingTask, "failed", {
        source: "resume",
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    this.recordParallelEvent(existingTask, "started", {
      source: "resume",
    })

    this.startPolling()
    if (existingTask.sessionID) {
      markSubagentSession(existingTask.sessionID, existingTask.parentSessionID)
    }

    if (input.parentSessionID) {
      this.state.trackPendingTask(input.parentSessionID, existingTask.id)
    }

    return existingTask
  }

  handleEvent(event: BackgroundEvent): void {
    const props = event.properties

    if (event.type === "message.part.updated") {
      if (!props || typeof props !== "object" || !("sessionID" in props)) return
      const partInfo = props as unknown as MessagePartInfo
      const sessionID = partInfo?.sessionID
      if (!sessionID) return

      const task = this.state.findBySession(sessionID)
      if (!task) return

      if (partInfo?.type === "tool" || partInfo?.tool) {
        if (!task.progress) {
          task.progress = {
            toolCalls: 0,
            lastUpdate: new Date(),
          }
        }
        task.progress.toolCalls += 1
        task.progress.lastTool = partInfo.tool
        task.progress.lastUpdate = new Date()
      }
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const task = this.state.findBySession(sessionID)
      if (!task || task.status !== "running") return

      const startedAt = task.startedAt
      if (!startedAt) return

      const elapsedMs = Date.now() - startedAt.getTime()
      if (elapsedMs < MIN_IDLE_TIME_MS) {
        log("[background-agent] Ignoring early session.idle, elapsed:", { elapsedMs, taskId: task.id })
        return
      }

      validateSessionHasOutput(this.client, sessionID).then(async (hasValidOutput) => {
        if (task.status !== "running") {
          log("[background-agent] Task status changed during validation, skipping:", { taskId: task.id, status: task.status })
          return
        }

        if (!hasValidOutput) {
          log("[background-agent] Session.idle but no valid output yet, waiting:", task.id)
          return
        }

        const hasIncompleteTasks = await checkSessionTasks(sessionID, this.taskConfig)

        if (task.status !== "running") {
          log("[background-agent] Task status changed during task check, skipping:", { taskId: task.id, status: task.status })
          return
        }

        if (hasIncompleteTasks) {
          log("[background-agent] Task has incomplete tasks, waiting for task continuation:", task.id)
          return
        }

        await tryCompleteTask(task, "session.idle event", this.getResultHandlerContext())
      }).catch(err => {
        log("[background-agent] Error in session.idle handler:", err)
      })
    }

    if (event.type === "session.deleted") {
      const info = props?.info
      if (!info || typeof info.id !== "string") return
      const sessionID = info.id

      const tasksToCancel = new Map<string, BackgroundTask>()
      const directTask = this.state.findBySession(sessionID)
      if (directTask) {
        tasksToCancel.set(directTask.id, directTask)
      }
      for (const descendant of this.state.getAllDescendantTasks(sessionID)) {
        tasksToCancel.set(descendant.id, descendant)
      }

      if (tasksToCancel.size === 0) return

      for (const task of tasksToCancel.values()) {
        if (task.status === "running" || task.status === "pending") {
          task.status = "cancelled"
          task.completedAt = new Date()
          task.error = "Session deleted"
        }

        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey)
          task.concurrencyKey = undefined
        }
        this.releaseParallelLease(task, "cancelled", {
          reason: "session_deleted",
        })
        this.state.clearCompletionTimer(task.id)
        this.state.cleanupPendingByParent(task)
        this.state.removeTask(task.id)
        this.state.clearNotificationsForTask(task.id)
        if (task.sessionID) {
          unmarkSubagentSession(task.sessionID)
        }
      }
    }
  }

  markForNotification(task: BackgroundTask): void {
    this.state.markForNotification(task)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.state.getPendingNotifications(sessionID)
  }

  clearNotifications(sessionID: string): void {
    this.state.clearNotifications(sessionID)
  }

  cancelPendingTask(taskId: string): boolean {
    return this.state.cancelPendingTask(taskId)
  }

  getRunningTasks(): BackgroundTask[] {
    return this.state.getRunningTasks()
  }

  getNonRunningTasks(): BackgroundTask[] {
    return this.state.getNonRunningTasks()
  }

  getCompletedTasks(): BackgroundTask[] {
    return this.state.getCompletedTasks()
  }

  private startPolling(): void {
    if (this.pollingInterval) return

    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks()
    }, POLLING_INTERVAL_MS)
    this.pollingInterval.unref()
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = undefined
    }
  }

  private registerProcessCleanup(): void {
    BackgroundManager.cleanupManagers.add(this)

    if (BackgroundManager.cleanupRegistered) return
    BackgroundManager.cleanupRegistered = true

    const cleanupAll = () => {
      for (const manager of BackgroundManager.cleanupManagers) {
        try {
          manager.shutdown()
        } catch (error) {
          log("[background-agent] Error during shutdown cleanup:", error)
        }
      }
    }

    const registerSignal = (signal: ProcessCleanupEvent, exitAfter: boolean): void => {
      const listener = registerProcessSignal(signal, cleanupAll, exitAfter)
      BackgroundManager.cleanupHandlers.set(signal, listener)
    }

    registerSignal("SIGINT", true)
    registerSignal("SIGTERM", true)
    if (process.platform === "win32") {
      registerSignal("SIGBREAK", true)
    }
    registerSignal("beforeExit", false)
    registerSignal("exit", false)
  }

  private unregisterProcessCleanup(): void {
    BackgroundManager.cleanupManagers.delete(this)

    if (BackgroundManager.cleanupManagers.size > 0) return

    for (const [signal, listener] of BackgroundManager.cleanupHandlers.entries()) {
      process.off(signal, listener)
    }
    BackgroundManager.cleanupHandlers.clear()
    BackgroundManager.cleanupRegistered = false
  }

  private pruneStaleTasksAndNotifications(): void {
    const now = Date.now()

    for (const [taskId, task] of this.state.tasks.entries()) {
      const timestamp = task.status === "pending"
        ? task.queuedAt?.getTime()
        : task.startedAt?.getTime()

      if (!timestamp) {
        continue
      }

      const age = now - timestamp
      if (age > TASK_TTL_MS) {
        const errorMessage = task.status === "pending"
          ? "Task timed out while queued (30 minutes)"
          : "Task timed out after 30 minutes"

        log("[background-agent] Pruning stale task:", { taskId, status: task.status, age: Math.round(age / 1000) + "s" })
        task.status = "error"
        task.error = errorMessage
        task.completedAt = new Date()
        if (task.concurrencyKey) {
          this.concurrencyManager.release(task.concurrencyKey)
          task.concurrencyKey = undefined
        }
        this.releaseParallelLease(task, "timed_out", {
          reason: "task_ttl_exceeded",
        })
        this.state.cleanupPendingByParent(task)
        this.state.clearNotificationsForTask(taskId)
        this.state.removeTask(taskId)
      }
    }

    for (const [sessionID, notifications] of this.state.notifications.entries()) {
      if (notifications.length === 0) {
        this.state.notifications.delete(sessionID)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        if (!task.startedAt) return false
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      if (validNotifications.length === 0) {
        this.state.notifications.delete(sessionID)
      } else if (validNotifications.length !== notifications.length) {
        this.state.notifications.set(sessionID, validNotifications)
      }
    }
  }

  private async checkAndInterruptStaleTasks(): Promise<void> {
    const staleTimeoutMs = this.config?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS
    const now = Date.now()

    for (const task of this.state.tasks.values()) {
      if (task.status !== "running") continue
      if (!task.progress?.lastUpdate) continue

      const startedAt = task.startedAt
      const sessionID = task.sessionID
      if (!startedAt || !sessionID) continue

      const runtime = now - startedAt.getTime()
      if (runtime < MIN_RUNTIME_BEFORE_STALE_MS) continue

      const timeSinceLastUpdate = now - task.progress.lastUpdate.getTime()
      if (timeSinceLastUpdate <= staleTimeoutMs) continue

      if (task.status !== "running") continue

      const staleMinutes = Math.round(timeSinceLastUpdate / 60000)
      task.status = "cancelled"
      task.error = `Stale timeout (no activity for ${staleMinutes}min)`
      task.completedAt = new Date()

      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }
      this.releaseParallelLease(task, "timed_out", {
        reason: "stale_timeout",
      })

      this.client.session.abort({
        path: { id: sessionID },
      }).catch(() => {})

      log(`[background-agent] Task ${task.id} interrupted: stale timeout`)

      try {
        await notifyParentSession(task, this.getResultHandlerContext())
      } catch (err) {
        log("[background-agent] Error in notifyParentSession for stale task:", { taskId: task.id, error: err })
      }
    }
  }

  private async pollRunningTasks(): Promise<void> {
    this.pruneStaleTasksAndNotifications()
    await this.checkAndInterruptStaleTasks()

    const statusResult = await this.client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>

    for (const task of this.state.tasks.values()) {
      if (task.status !== "running") continue

      const sessionID = task.sessionID
      if (!sessionID) continue

      try {
        const sessionStatus = allStatuses[sessionID]

        if (sessionStatus?.type === "idle") {
          const hasValidOutput = await validateSessionHasOutput(this.client, sessionID)
          if (!hasValidOutput) {
            log("[background-agent] Polling idle but no valid output yet, waiting:", task.id)
            continue
          }

          if (task.status !== "running") continue

          const hasIncompleteTasks = await checkSessionTasks(sessionID, this.taskConfig)
          if (hasIncompleteTasks) {
            log("[background-agent] Task has incomplete tasks via polling, waiting:", task.id)
            continue
          }

          await tryCompleteTask(task, "polling (idle status)", this.getResultHandlerContext())
          continue
        }

        const messagesResult = await this.client.session.messages({
          path: { id: sessionID },
        })

        const hasMessageError =
          isRecord(messagesResult) && "error" in messagesResult && Boolean(messagesResult.error)
        if (!hasMessageError) {
          const messagesPayload = Array.isArray(messagesResult)
            ? messagesResult
            : isRecord(messagesResult) && "data" in messagesResult
              ? messagesResult.data
              : undefined

          const messages = Array.isArray(messagesPayload)
            ? (messagesPayload as Array<{
              info?: { role?: string }
              parts?: Array<{ type?: string; tool?: string; name?: string; text?: string }>
            }>)
            : []

          if (messages.length === 0) continue

          const assistantMsgs = messages.filter(
            (m) => m.info?.role === "assistant"
          )

          let toolCalls = 0
          let lastTool: string | undefined
          let lastMessage: string | undefined

          for (const msg of assistantMsgs) {
            const parts = msg.parts ?? []
            for (const part of parts) {
              if (part.type === "tool_use" || part.tool) {
                toolCalls++
                lastTool = part.tool || part.name || "unknown"
              }
              if (part.type === "text" && part.text) {
                lastMessage = part.text
              }
            }
          }

          if (!task.progress) {
            task.progress = { toolCalls: 0, lastUpdate: new Date() }
          }
          task.progress.toolCalls = toolCalls
          task.progress.lastTool = lastTool
          task.progress.lastUpdate = new Date()
          if (lastMessage) {
            task.progress.lastMessage = lastMessage
            task.progress.lastMessageAt = new Date()
          }

          const currentMsgCount = messages.length
          const startedAt = task.startedAt
          if (!startedAt) continue

          const elapsedMs = Date.now() - startedAt.getTime()

          if (elapsedMs >= MIN_STABILITY_TIME_MS) {
            if (task.lastMsgCount === currentMsgCount) {
              task.stablePolls = (task.stablePolls ?? 0) + 1
              if (task.stablePolls >= 3) {
                const recheckStatus = await this.client.session.status()
                const recheckData = (recheckStatus.data ?? {}) as Record<string, { type: string }>
                const currentStatus = recheckData[sessionID]

                if (currentStatus?.type !== "idle") {
                  log("[background-agent] Stability reached but session not idle, resetting:", {
                    taskId: task.id,
                    sessionStatus: currentStatus?.type ?? "not_in_status"
                  })
                  task.stablePolls = 0
                  continue
                }

                const hasValidOutput = await validateSessionHasOutput(this.client, sessionID)
                if (!hasValidOutput) {
                  log("[background-agent] Stability reached but no valid output, waiting:", task.id)
                  continue
                }

                if (task.status !== "running") continue

                const hasIncompleteTasks = await checkSessionTasks(sessionID, this.taskConfig)
                if (!hasIncompleteTasks) {
                  await tryCompleteTask(task, "stability detection", this.getResultHandlerContext())
                  continue
                }
              }
            } else {
              task.stablePolls = 0
            }
          }
          task.lastMsgCount = currentMsgCount
        }
      } catch (error) {
        log("[background-agent] Poll error for task:", { taskId: task.id, error })
      }
    }

    if (!this.state.hasRunningTasks()) {
      this.stopPolling()
    }
  }

  shutdown(): void {
    if (this.shutdownTriggered) return
    this.shutdownTriggered = true
    log("[background-agent] Shutting down BackgroundManager")
    this.stopPolling()

    for (const task of this.state.tasks.values()) {
      if (task.status === "running" && task.sessionID) {
        this.client.session.abort({
          path: { id: task.sessionID },
        }).catch(() => {})
      }
    }

    if (this.onShutdown) {
      try {
        this.onShutdown()
      } catch (error) {
        log("[background-agent] Error in onShutdown callback:", error)
      }
    }

    for (const task of this.state.tasks.values()) {
      if (task.concurrencyKey) {
        this.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }
      this.releaseParallelLease(task, "cancelled", {
        reason: "manager_shutdown",
      })
    }

    for (const timer of this.leaseHeartbeatTimers.values()) {
      clearInterval(timer)
    }
    this.leaseHeartbeatTimers.clear()

    this.state.clear()
    this.concurrencyManager.clear()
    this.unregisterProcessCleanup()
    log("[background-agent] Shutdown complete")
  }
}

function registerProcessSignal(
  signal: ProcessCleanupEvent,
  handler: () => void,
  exitAfter: boolean
): () => void {
  const listener = () => {
    handler()
    if (exitAfter) {
      process.exitCode = 0
      setTimeout(() => process.exit(), 6000)
    }
  }
  process.on(signal, listener)
  return listener
}
