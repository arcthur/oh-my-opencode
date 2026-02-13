import { randomUUID } from "crypto"
import { existsSync, readdirSync, statSync, unlinkSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  createFsMailboxTransport,
  type MailboxTransport,
  type Disposable,
  type InboxMessage,
  type PermissionMode,
  type ProtocolMessage,
} from "../mailbox"
import { verifyInboxControlMessageSignature } from "../security/control-message-signature"
import {
  createAgentIdentity,
  heartbeat as sendHeartbeat,
  getCoordinatorEpoch,
  readManifest,
  getMember,
  isCoordinatorAlive,
} from "../team"
import {
  requestJoin,
  requestLeave,
  notifyIdle,
} from "../team/membership"
import type { AgentIdentity, AgentCapability } from "../team/types"
import { workerReportCompletion } from "../task-graph"
import { AgentStateMachine, type StateEvent } from "./state"
import { getSwarmEnvContext } from "../tmux/utils"
import { getTeamDir, writeJsonAtomic } from "../../orchestrator-tasks/storage"

/**
 * Permission request result
 */
export type PermissionResult =
  | { approved: true; updatedInput?: unknown }
  | { approved: false; reason: string }

/**
 * Plan approval request result
 */
export type PlanApprovalResult =
  | { decision: "approved"; feedback?: string }
  | { decision: "rejected"; feedback?: string }
  | { decision: "revision_requested"; feedback?: string }

/**
 * Pending permission watcher
 */
interface PermissionWatcher {
  requestId: string
  timeoutId: ReturnType<typeof setTimeout>
  onApproved: (updatedInput?: unknown) => void
  onDenied: (reason: string) => void
}

/**
 * Pending plan approval watcher
 */
interface PlanApprovalWatcher {
  requestId: string
  timeoutId: ReturnType<typeof setTimeout>
  resolve: (result: PlanApprovalResult) => void
}

/**
 * Risk level for permission classification
 */
export type RiskLevel = "low" | "medium" | "high"

/**
 * Task information passed to callbacks
 *
 * Extended metadata fields enable richer worker prompts with context.
 */
export interface TaskInfo {
  id: string
  title: string
  description: string
  /** Optional context summary (e.g., relevant notepad content) */
  contextSummary?: string
  /** List of relevant file paths for this task */
  relevantFiles?: string[]
  /** Parent context for retry scenarios */
  parentContext?: {
    /** Number of previous attempts at this task */
    previousAttempts: number
    /** Error from last attempt if any */
    lastError?: string
    /** ID of the previous worker who attempted this */
    lastWorkerId?: string
  }
  /** Required capabilities for this task */
  requiredCapabilities?: string[]
  /** Priority level (higher = more urgent) */
  priority?: number
}

/**
 * Worker agent configuration
 */
export interface WorkerConfig {
  /** Team to join */
  teamName: string
  /** Agent name */
  name: string
  /** Session ID */
  sessionId: string
  /** Agent capabilities */
  capabilities?: AgentCapability[]
  /** Tmux pane reference */
  tmuxPane?: string
  /** Git worktree path */
  worktreePath?: string
  /** Heartbeat interval in ms */
  heartbeatIntervalMs?: number
  /** Task timeout in ms (auto-fail if exceeded) */
  taskTimeoutMs?: number
  /**
   * Called when a task is assigned.
   * Return true to accept the task, false to reject.
   * After accepting, worker stays in "working" state until
   * reportTaskComplete() or reportTaskFailed() is called.
   */
  onTaskAssigned?: (task: TaskInfo) => Promise<boolean>
  /** State change callback */
  onStateChange?: (state: ReturnType<AgentStateMachine["getState"]>) => void
  /** Error callback */
  onError?: (error: Error) => void
  /** Optional mailbox transport override */
  mailboxTransport?: MailboxTransport
}

/**
 * Worker agent runtime
 *
 * Key design: Task acceptance and completion are separate:
 * 1. onTaskAssigned callback decides whether to accept
 * 2. Worker stays in "working" state after accepting
 * 3. External code calls reportTaskComplete/Failed when done
 */
export class WorkerAgent {
  private identity: AgentIdentity
  private stateMachine: AgentStateMachine
  private config: Partial<OhMyOpenCodeConfig>
  private workerConfig: WorkerConfig
  private mailboxTransport: MailboxTransport
  private mailboxWatcher: Disposable | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private taskTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private currentTask: TaskInfo | null = null
  private approvedPlanForTaskId: string | null = null
  private permissionWatcher: PermissionWatcher | null = null
  private planApprovalWatcher: PlanApprovalWatcher | null = null
  private coordinatorCheckCount = 0
  private expiredPermissionRequests = new Map<string, number>()
  private expiredPlanApprovalRequests = new Map<string, number>()
  private static readonly MAX_EXPIRED_REQUESTS = 200

  // Mode control state
  private currentMode: PermissionMode = "default"
  private modeExpiresAt: number | null = null
  private modeResetTimer: ReturnType<typeof setTimeout> | null = null

  constructor(workerConfig: WorkerConfig, config: Partial<OhMyOpenCodeConfig>) {
    this.workerConfig = workerConfig
    this.config = config
    this.mailboxTransport = workerConfig.mailboxTransport ?? createFsMailboxTransport(config)

    // Get agent ID from environment if available (for orchestrator-spawned agents)
    const envContext = getSwarmEnvContext()

    // Create identity
    this.identity = createAgentIdentity({
      id: envContext?.agentId,
      name: workerConfig.name,
      sessionId: workerConfig.sessionId,
      role: "worker",
      capabilities: workerConfig.capabilities,
      tmuxPane: workerConfig.tmuxPane,
      worktreePath: workerConfig.worktreePath,
    })

    // Initialize state machine
    this.stateMachine = new AgentStateMachine()

    // Subscribe to state changes
    if (workerConfig.onStateChange) {
      this.stateMachine.subscribe((state) => {
        workerConfig.onStateChange!(state)
      })
    }
  }

  private isSenderValidationEnabled(): boolean {
    return this.config.orchestrator?.swarm?.enforce_sender_validation ?? true
  }

  private reportSecurityEvent(event: string, details: Record<string, unknown>): void {
    const serialized = JSON.stringify({
      component: "swarm.worker",
      event,
      teamName: this.workerConfig.teamName,
      workerId: this.identity.id,
      ...details,
    })
    console.warn(serialized)
    this.workerConfig.onError?.(new Error(serialized))
  }

  private isSignatureEnforced(): boolean {
    return this.config.orchestrator?.swarm?.enforce_signature ?? true
  }

  private getCoordinatorId(): string | null {
    const manifest = readManifest(this.workerConfig.teamName, this.config, { includeHeartbeats: false })
    return manifest?.coordinatorId ?? null
  }

  private getCurrentCoordinatorEpoch(): number | null {
    return getCoordinatorEpoch(this.workerConfig.teamName, this.config)
  }

  private assertFromCoordinator(message: InboxMessage, messageType: string): boolean {
    if (!this.isSenderValidationEnabled()) {
      return true
    }
    const manifest = readManifest(this.workerConfig.teamName, this.config, { includeHeartbeats: false })
    if (!manifest) {
      this.reportSecurityEvent("sender_validation_failed", {
        reason: "manifest_missing",
        messageType,
        from: message.from,
      })
      return false
    }
    const sender = manifest.members.find((member) => member.id === message.from)
    if (!sender) {
      this.reportSecurityEvent("sender_validation_failed", {
        reason: "unknown_sender",
        messageType,
        from: message.from,
      })
      return false
    }
    if (sender.id !== manifest.coordinatorId || sender.role !== "coordinator") {
      this.reportSecurityEvent("sender_validation_failed", {
        reason: "sender_not_coordinator",
        messageType,
        from: message.from,
        coordinatorId: manifest.coordinatorId,
        senderRole: sender.role,
      })
      return false
    }
    const expectedEpoch = this.getCurrentCoordinatorEpoch()
    if (expectedEpoch !== null) {
      if (!message.epoch || message.epoch !== expectedEpoch) {
        this.reportSecurityEvent("epoch_validation_failed", {
          reason: "coordinator_epoch_mismatch",
          messageType,
          from: message.from,
          messageEpoch: message.epoch,
          expectedEpoch,
        })
        return false
      }
    }
    if (this.isSignatureEnforced()) {
      const verification = verifyInboxControlMessageSignature({
        teamName: this.workerConfig.teamName,
        recipientAgentId: this.identity.id,
        message,
        config: this.config,
      })
      if (!verification.ok) {
        this.reportSecurityEvent("signature_validation_failed", {
          reason: verification.reason,
          messageType,
          from: message.from,
          keyId: message.auth?.keyId,
        })
        return false
      }
    }
    return true
  }

  private trackExpiredRequest(
    bucket: Map<string, number>,
    requestId: string,
    expiredAt: number
  ): void {
    bucket.set(requestId, expiredAt)
    if (bucket.size > WorkerAgent.MAX_EXPIRED_REQUESTS) {
      for (const key of bucket.keys()) {
        bucket.delete(key)
        if (bucket.size <= WorkerAgent.MAX_EXPIRED_REQUESTS) {
          break
        }
      }
    }
  }

  private diagnosticsLateResponseDir(): string {
    const teamDir = getTeamDir(this.workerConfig.teamName, this.config)
    return join(teamDir, "diagnostics", "late-responses")
  }

  private pruneLateResponseDiagnostics(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const diagnosticsDir = this.diagnosticsLateResponseDir()
    if (!existsSync(diagnosticsDir)) {
      return
    }
    const now = Date.now()
    const files = readdirSync(diagnosticsDir).filter((name) => name.endsWith(".json"))
    for (const file of files) {
      const filePath = join(diagnosticsDir, file)
      try {
        const stats = statSync(filePath)
        if (now - stats.mtimeMs > maxAgeMs) {
          unlinkSync(filePath)
        }
      } catch {
        // Ignore individual file errors
      }
    }
  }

  private recordLateResponse(
    type: "late_permission_response" | "late_plan_approval_response",
    requestId: string,
    expiredAt: number,
    details: Record<string, unknown>
  ): void {
    const now = Date.now()
    const entry = {
      type,
      requestId,
      teamName: this.workerConfig.teamName,
      workerId: this.identity.id,
      expiredAt,
      receivedAt: now,
      latencyMs: Math.max(0, now - expiredAt),
      ...details,
    }

    this.reportSecurityEvent(type, entry)

    const diagnosticsDir = this.diagnosticsLateResponseDir()
    const fileName = `${type}_${requestId}_${now}.json`
    const filePath = join(diagnosticsDir, fileName)
    try {
      writeJsonAtomic(filePath, entry)
      this.pruneLateResponseDiagnostics()
    } catch (err) {
      this.workerConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private sendToCoordinator(payload: ProtocolMessage): boolean {
    const coordinatorId = this.getCoordinatorId()
    if (!coordinatorId) {
      return false
    }
    const epoch = this.getCurrentCoordinatorEpoch() ?? undefined
    this.mailboxTransport.sendMessage(
      this.workerConfig.teamName,
      this.identity.id,
      coordinatorId,
      payload,
      { epoch }
    )
    return true
  }

  /**
   * Get agent identity
   */
  getIdentity(): AgentIdentity {
    return this.identity
  }

  /**
   * Get current state
   */
  getState() {
    return this.stateMachine.getState()
  }

  /**
   * Get state summary
   */
  getSummary(): string {
    return this.stateMachine.getSummary()
  }

  /**
   * Get current task (if any)
   */
  getCurrentTask(): TaskInfo | null {
    return this.currentTask
  }

  /**
   * Whether the current task's plan has been approved (plan-mode gate).
   */
  isPlanApprovedForCurrentTask(): boolean {
    const taskId = this.currentTask?.id
    if (!taskId) return false
    return this.approvedPlanForTaskId === taskId
  }

  /**
   * Get current permission mode
   */
  getCurrentMode(): PermissionMode {
    // Check if mode has expired
    if (this.modeExpiresAt && Date.now() >= this.modeExpiresAt) {
      this.resetMode()
    }
    return this.currentMode
  }

  /**
   * Check if currently working on a task
   */
  isWorking(): boolean {
    return this.stateMachine.is("working") && this.currentTask !== null
  }

  /**
   * Start the worker agent
   */
  async start(): Promise<boolean> {
    if (this.running) {
      return true
    }

    const { teamName } = this.workerConfig

    try {
      // Create inbox
      this.mailboxTransport.createInbox(teamName, this.identity.id)

      // Request to join team
      const joinResult = await requestJoin(teamName, this.identity, this.config, {
        mailboxTransport: this.mailboxTransport,
      })

      if (!joinResult.approved) {
        this.stateMachine.dispatch({ type: "JOIN_REJECTED", reason: joinResult.reason ?? "Unknown" })
        return false
      }

      // Joined successfully
      this.stateMachine.dispatch({ type: "JOIN_APPROVED" })
      this.running = true

      // Start heartbeat
      this.startHeartbeat()

      // Start mailbox polling
      this.startMailboxPolling()

      // Notify idle (ready for work)
      notifyIdle(teamName, this.identity.id, this.config, {
        mailboxTransport: this.mailboxTransport,
      })

      return true
    } catch (err) {
      this.workerConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  /**
   * Stop the worker agent
   */
  async stop(options?: { force?: boolean }): Promise<boolean> {
    if (!this.running) {
      return true
    }

    const { teamName } = this.workerConfig

    // Stop heartbeat
    this.stopHeartbeat()

    // Stop mailbox polling
    this.stopMailboxPolling()

    // Clear task timeout
    this.clearTaskTimeout()

    // Clear pending watchers
    this.clearPermissionWatcher()
    this.clearPlanApprovalWatcher()

    // Clear mode reset timer
    if (this.modeResetTimer) {
      clearTimeout(this.modeResetTimer)
      this.modeResetTimer = null
    }

    // Request to leave
    this.stateMachine.dispatch({ type: "SHUTDOWN_REQUESTED" })

    try {
      const leaveResult = await requestLeave(teamName, this.identity.id, this.config, {
        force: options?.force,
        mailboxTransport: this.mailboxTransport,
      })

      if (leaveResult.approved || options?.force) {
        this.stateMachine.dispatch({ type: "SHUTDOWN_APPROVED" })
        this.running = false
        this.currentTask = null
        return true
      }

      this.stateMachine.dispatch({ type: "SHUTDOWN_REJECTED", reason: leaveResult.reason ?? "Unknown" })
      return false
    } catch (err) {
      if (options?.force) {
        this.stateMachine.dispatch({ type: "SHUTDOWN_APPROVED" })
        this.running = false
        this.currentTask = null
        return true
      }
      this.workerConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  /**
   * Report task completion (called by external code)
   *
   * This is the key API for the decoupled completion model.
   * After onTaskAssigned returns true, external code should call
   * this method when the task is actually complete.
   */
  reportTaskComplete(taskId?: string): boolean {
    if (!this.currentTask) {
      return false
    }

    if (taskId && taskId !== this.currentTask.id) {
      return false
    }

    const { teamName } = this.workerConfig
    const completedTaskId = this.currentTask.id

    // Clear task timeout
    this.clearTaskTimeout()

    // Report to coordinator
    workerReportCompletion(teamName, this.identity.id, completedTaskId, this.config, {
      mailboxTransport: this.mailboxTransport,
    })

    // Update state
    this.stateMachine.dispatch({ type: "TASK_COMPLETED" })
    this.currentTask = null
    this.approvedPlanForTaskId = null

    // Notify idle (ready for next task)
    notifyIdle(teamName, this.identity.id, this.config, {
      mailboxTransport: this.mailboxTransport,
    })

    return true
  }

  /**
   * Report task failure (called by external code)
   */
  reportTaskFailed(error: string, taskId?: string): boolean {
    if (!this.currentTask) {
      return false
    }

    if (taskId && taskId !== this.currentTask.id) {
      return false
    }

    const { teamName } = this.workerConfig
    const failedTaskId = this.currentTask.id

    // Clear task timeout
    this.clearTaskTimeout()

    // Clear any pending watchers
    this.clearPermissionWatcher()
    this.clearPlanApprovalWatcher()

    // Notify coordinator so the task can be safely requeued/reassigned.
    // Critical: the worker must NOT directly mutate the shared TaskGraph in a way
    // that could clobber a newer assignment.
    this.rejectTaskAssignment(failedTaskId, error)

    // Update state
    this.stateMachine.dispatch({ type: "TASK_FAILED", error })
    this.currentTask = null
    this.approvedPlanForTaskId = null

    // Notify idle (ready for next task)
    notifyIdle(teamName, this.identity.id, this.config, {
      mailboxTransport: this.mailboxTransport,
    })

    return true
  }

  /**
   * Request permission for a tool/action (non-blocking)
   *
   * This is the key API for non-blocking permission flow:
   * 1. Sends permission_request to coordinator
   * 2. Transitions to PAUSED state
   * 3. Returns a Promise that resolves when permission is granted/denied
   * 4. Worker can continue processing other messages while paused
   *
   * @param toolName Name of the tool requiring permission
   * @param input Tool input parameters
   * @param options Optional timeout configuration
   * @returns Promise resolving to permission result
   */
  async requestPermission(
    toolName: string,
    input: unknown,
    options?: { timeoutMs?: number }
  ): Promise<PermissionResult> {
    if (!this.stateMachine.is("working")) {
      return { approved: false, reason: "Worker not in working state" }
    }

    // Disallow overlapping permission requests (single-flight)
    if (this.permissionWatcher) {
      return { approved: false, reason: "Permission request already pending" }
    }

    // Mode overrides: allow bypassing coordinator approval for trusted scenarios.
    // These modes are enforced here so Mode Control has a real effect.
    if (this.currentMode === "bypassPermissions") {
      return { approved: true, updatedInput: input }
    }
    if (
      this.currentMode === "acceptEdits" &&
      ["Edit", "Write", "NotebookEdit"].includes(toolName)
    ) {
      return { approved: true, updatedInput: input }
    }

    const timeoutMs = options?.timeoutMs ?? 30000
    const requestId = `perm_${randomUUID().slice(0, 12)}`

    // Send permission request
    const sent = this.sendToCoordinator({
      type: "permission_request",
      requestId,
      toolName,
      input,
      agentId: this.identity.id,
      timestamp: Date.now(),
    })
    if (!sent) {
      return { approved: false, reason: "Coordinator not available" }
    }

    // Transition to paused state
    this.stateMachine.dispatch({
      type: "PAUSE",
      reason: `Awaiting permission for ${toolName}`,
      resumeOn: "permission_response",
      timeoutMs,
      requestId,
    })

    // Return promise that resolves on response
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        if (this.permissionWatcher?.requestId === requestId) {
          // Treat timeout as a denial but keep the worker in WORKING state.
          // Dropping to IDLE while a task is active creates task-orphaning deadlocks.
          this.permissionWatcher = null
          this.trackExpiredRequest(this.expiredPermissionRequests, requestId, Date.now())
          this.stateMachine.dispatch({ type: "RESUME" })
          resolve({ approved: false, reason: "Permission request timed out" })
        }
      }, timeoutMs)

      this.permissionWatcher = {
        requestId,
        timeoutId,
        onApproved: (updatedInput) => {
          clearTimeout(timeoutId)
          this.permissionWatcher = null
          this.stateMachine.dispatch({ type: "RESUME" })
          resolve({ approved: true, updatedInput })
        },
        onDenied: (reason) => {
          clearTimeout(timeoutId)
          this.permissionWatcher = null
          // Resume to working state, let caller handle the denial
          this.stateMachine.dispatch({ type: "RESUME" })
          resolve({ approved: false, reason })
        },
      }
    })
  }

  /**
   * Request plan approval from coordinator (non-blocking)
   *
   * Similar to requestPermission but at task/plan level:
   * 1. Sends plan_approval_request to coordinator
   * 2. Transitions to PAUSED state
   * 3. Returns a Promise that resolves when decision is received
   * 4. Worker can continue processing other messages while paused
   *
   * @param plan The plan content (markdown or text)
   * @param options Optional configuration (planFile path, timeout)
   * @returns Promise resolving to plan approval result
   */
  async requestPlanApproval(
    plan: string,
    options?: { planFile?: string; timeoutMs?: number }
  ): Promise<PlanApprovalResult> {
    if (!this.stateMachine.is("working")) {
      return { decision: "rejected", feedback: "Worker not in working state" }
    }

    // Disallow overlapping plan approval requests (single-flight)
    if (this.planApprovalWatcher) {
      return { decision: "rejected", feedback: "Plan approval request already pending" }
    }

    const timeoutMs = options?.timeoutMs ?? 60000 // 60s default (plans need more review time)
    const requestId = `plan_${randomUUID().slice(0, 12)}`

    // Send plan approval request
    const sent = this.sendToCoordinator({
      type: "plan_approval_request",
      requestId,
      plan,
      planFile: options?.planFile,
      agentId: this.identity.id,
      taskId: this.currentTask?.id,
      timestamp: Date.now(),
    })
    if (!sent) {
      return { decision: "rejected", feedback: "Coordinator not available" }
    }

    // Transition to paused state
    this.stateMachine.dispatch({
      type: "PAUSE",
      reason: "Awaiting plan approval",
      resumeOn: "plan_approval_response",
      timeoutMs,
      requestId,
    })

    // Return promise that resolves on response
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        if (this.planApprovalWatcher?.requestId === requestId) {
          // Treat timeout as rejection but keep worker in WORKING state.
          // Dropping to IDLE while a task is active can orphan tasks.
          this.planApprovalWatcher = null
          this.trackExpiredRequest(this.expiredPlanApprovalRequests, requestId, Date.now())
          this.stateMachine.dispatch({ type: "RESUME" })
          resolve({ decision: "rejected", feedback: "Plan approval request timed out" })
        }
      }, timeoutMs)

      this.planApprovalWatcher = {
        requestId,
        timeoutId,
        resolve: (result) => {
          clearTimeout(timeoutId)
          this.planApprovalWatcher = null
          this.stateMachine.dispatch({ type: "RESUME" })
          if (result.decision === "approved" && this.currentTask?.id) {
            this.approvedPlanForTaskId = this.currentTask.id
          }
          resolve(result)
        },
      }
    })
  }

  /**
   * Clear permission watcher
   */
  private clearPermissionWatcher(): void {
    if (this.permissionWatcher) {
      clearTimeout(this.permissionWatcher.timeoutId)
      this.permissionWatcher = null
    }
  }

  /**
   * Clear plan approval watcher
   */
  private clearPlanApprovalWatcher(): void {
    if (this.planApprovalWatcher) {
      clearTimeout(this.planApprovalWatcher.timeoutId)
      this.planApprovalWatcher = null
    }
  }

  /**
   * Set permission mode (internal, called by mode_set_request handler)
   */
  private setMode(mode: PermissionMode, durationMs?: number): void {
    this.currentMode = mode

    // Clear existing reset timer
    if (this.modeResetTimer) {
      clearTimeout(this.modeResetTimer)
      this.modeResetTimer = null
    }

    // Set expiration if duration specified
    if (durationMs && durationMs > 0) {
      this.modeExpiresAt = Date.now() + durationMs
      this.modeResetTimer = setTimeout(() => {
        this.resetMode()
      }, durationMs)
    } else {
      this.modeExpiresAt = null
    }
  }

  /**
   * Reset mode to default
   */
  private resetMode(): void {
    this.currentMode = "default"
    this.modeExpiresAt = null
    if (this.modeResetTimer) {
      clearTimeout(this.modeResetTimer)
      this.modeResetTimer = null
    }
  }

  /**
   * Process a task assignment
   */
  private async processTaskAssignment(task: TaskInfo): Promise<void> {
    const { teamName, onTaskAssigned, taskTimeoutMs } = this.workerConfig

    // Transition to working
    this.stateMachine.dispatch({
      type: "TASK_ASSIGNED",
      taskId: task.id,
      title: task.title,
    })

    // Store current task
    this.currentTask = task
    this.approvedPlanForTaskId = null

    try {
      // Check if task is accepted
      let accepted = true
      if (onTaskAssigned) {
        accepted = await onTaskAssigned(task)
      }

      if (!accepted) {
        // Task rejected by worker callback - notify coordinator so it can requeue safely
        this.rejectTaskAssignment(task.id, "Task rejected by worker callback")

        // Go back to idle
        this.stateMachine.dispatch({
          type: "TASK_FAILED",
          error: "Task rejected by worker",
        })
        this.currentTask = null
        notifyIdle(teamName, this.identity.id, this.config, {
          mailboxTransport: this.mailboxTransport,
        })
        return
      }

      // Task accepted - worker stays in "working" state
      // Start task timeout if configured
      if (taskTimeoutMs && taskTimeoutMs > 0) {
        this.startTaskTimeout(taskTimeoutMs, task.id)
      }

      // Note: We do NOT report completion here!
      // External code must call reportTaskComplete() when done.

    } catch (err) {
      this.stateMachine.dispatch({
        type: "TASK_FAILED",
        error: err instanceof Error ? err.message : String(err),
      })
      this.currentTask = null
      notifyIdle(teamName, this.identity.id, this.config, {
        mailboxTransport: this.mailboxTransport,
      })
    }
  }

  /**
   * Start task timeout timer
   */
  private startTaskTimeout(timeoutMs: number, taskId: string): void {
    this.clearTaskTimeout()

    this.taskTimeoutTimer = setTimeout(() => {
      if (this.currentTask?.id === taskId) {
        this.reportTaskFailed(`Task timeout after ${timeoutMs}ms`, taskId)
      }
    }, timeoutMs)
  }

  /**
   * Clear task timeout timer
   */
  private clearTaskTimeout(): void {
    if (this.taskTimeoutTimer) {
      clearTimeout(this.taskTimeoutTimer)
      this.taskTimeoutTimer = null
    }
  }

  /**
   * Reject a task assignment (when worker is busy or callback rejects)
   *
  * Sends task_rejected message to coordinator.
  *
  * Note: The worker intentionally does NOT directly reassign the task in the
  * shared pool, because doing so can race with coordinator actions and clobber
  * newer assignments. The coordinator is responsible for requeueing.
   */
  private rejectTaskAssignment(
    taskId: string,
    reason: string
  ): void {
    // Send rejection message to coordinator
    this.sendToCoordinator({
      type: "task_rejected",
      taskId,
      agentId: this.identity.id,
      reason,
      timestamp: Date.now(),
    })
  }

  /**
   * Handle incoming mailbox message
   */
  private async handleMessage(message: InboxMessage): Promise<void> {
    const { payload } = message

    switch (payload.type) {
      case "task_assignment":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        if (this.stateMachine.is("idle")) {
          await this.processTaskAssignment({
            id: payload.taskId,
            title: payload.title,
            description: payload.description,
            // Extended metadata fields
            contextSummary: payload.contextSummary,
            relevantFiles: payload.relevantFiles,
            parentContext: payload.parentContext,
            requiredCapabilities: payload.requiredCapabilities,
            priority: payload.priority,
          })
        } else {
          // Worker is not idle - reject the assignment so it can be reassigned
          // This can happen if coordinator assigned task based on stale idle state
          this.rejectTaskAssignment(
            payload.taskId,
            `Worker ${this.identity.id} is not idle (state: ${this.stateMachine.getState().status})`
          )
        }
        break

      case "permission_response":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        // Handle permission response for paused state
        if (this.stateMachine.is("paused") && this.permissionWatcher) {
          if (payload.requestId === this.permissionWatcher.requestId) {
            this.expiredPermissionRequests.delete(payload.requestId)
            if (payload.decision === "approved") {
              this.permissionWatcher.onApproved(payload.updatedInput)
            } else {
              this.permissionWatcher.onDenied(payload.feedback ?? "Permission denied")
            }
          }
        } else {
          const expiredAt = this.expiredPermissionRequests.get(payload.requestId)
          if (expiredAt) {
            this.expiredPermissionRequests.delete(payload.requestId)
            this.recordLateResponse("late_permission_response", payload.requestId, expiredAt, {
              from: message.from,
              decision: payload.decision,
            })
          }
        }
        break

      case "shutdown_approved":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        // If not already in "leaving" state, transition there first
        // This handles coordinator-initiated forced shutdown
        if (!this.stateMachine.is("leaving")) {
          this.stateMachine.dispatch({ type: "SHUTDOWN_REQUESTED" })
        }
        this.stateMachine.dispatch({ type: "SHUTDOWN_APPROVED" })
        this.running = false
        this.currentTask = null
        this.stopHeartbeat()
        this.stopMailboxPolling()
        this.clearTaskTimeout()
        this.clearPermissionWatcher()
        this.clearPlanApprovalWatcher()
        if (this.modeResetTimer) {
          clearTimeout(this.modeResetTimer)
          this.modeResetTimer = null
        }
        break

      case "shutdown_rejected":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        this.stateMachine.dispatch({
          type: "SHUTDOWN_REJECTED",
          reason: payload.reason ?? "Shutdown rejected",
        })
        break

      case "plan_approval_response":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        // Handle plan approval response for paused state
        if (this.stateMachine.is("paused") && this.planApprovalWatcher) {
          if (payload.requestId === this.planApprovalWatcher.requestId) {
            this.expiredPlanApprovalRequests.delete(payload.requestId)
            this.planApprovalWatcher.resolve({
              decision: payload.decision,
              feedback: payload.feedback,
            })
          }
        } else {
          const expiredAt = this.expiredPlanApprovalRequests.get(payload.requestId)
          if (expiredAt) {
            this.expiredPlanApprovalRequests.delete(payload.requestId)
            this.recordLateResponse("late_plan_approval_response", payload.requestId, expiredAt, {
              from: message.from,
              decision: payload.decision,
            })
          }
        }
        break

      case "mode_set_request":
        if (!this.assertFromCoordinator(message, payload.type)) {
          break
        }
        // Handle mode change request from coordinator
        this.setMode(payload.mode, payload.duration)
        // Send acknowledgment back to coordinator
        {
          this.sendToCoordinator({
            type: "mode_set_response",
            success: true,
            currentMode: this.currentMode,
            message: payload.reason
              ? `Mode changed: ${payload.reason}`
              : undefined,
          })
        }
        break

      default:
        // Unknown message type - ignore
        break
    }
  }

  /**
   * Start mailbox polling
   */
  private startMailboxPolling(): void {
    if (this.mailboxWatcher) return

    const { teamName } = this.workerConfig

    this.mailboxWatcher = this.mailboxTransport.startPolling(
      teamName,
      this.identity.id,
      (message) => this.handleMessage(message),
      {
        intervalMs: 500,
        onError: (err) => this.workerConfig.onError?.(err),
      }
    )
  }

  /**
   * Stop mailbox polling
   */
  private stopMailboxPolling(): void {
    if (this.mailboxWatcher) {
      this.mailboxWatcher.dispose()
      this.mailboxWatcher = null
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return

    const { teamName, heartbeatIntervalMs } = this.workerConfig
    const interval = heartbeatIntervalMs ?? 10000

    this.heartbeatTimer = setInterval(() => {
      try {
        sendHeartbeat(teamName, this.identity.id, this.config)

        // Periodically check if coordinator is alive (every 5 heartbeats)
        this.coordinatorCheckCount++
        if (this.coordinatorCheckCount % 5 === 0) {
          this.checkCoordinatorHealth()
        }
      } catch (err) {
        this.workerConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }, interval)
  }

  /**
   * Check if the coordinator is still alive
   *
   * If coordinator appears offline, log a warning. The worker will
   * continue operating but won't receive new tasks until coordinator
   * is restored.
   */
  private checkCoordinatorHealth(): void {
    const { teamName } = this.workerConfig

    if (!isCoordinatorAlive(teamName, this.config)) {
      // Log warning - in a real implementation, this could trigger
      // degraded mode or notify an external monitoring system
      console.warn(
        `[Worker ${this.identity.id}] Coordinator appears offline for team "${teamName}". ` +
        "Run /swarm resume or restart the coordinator."
      )

      // Optionally notify via callback
      this.workerConfig.onError?.(
        new Error(`Coordinator offline for team "${teamName}"`)
      )
    }
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}

/**
 * Create and start a worker agent
 */
export async function createWorker(
  workerConfig: WorkerConfig,
  config: Partial<OhMyOpenCodeConfig>
): Promise<WorkerAgent | null> {
  const worker = new WorkerAgent(workerConfig, config)
  const started = await worker.start()

  if (!started) {
    return null
  }

  return worker
}
