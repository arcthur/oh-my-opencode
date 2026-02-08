import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  startPolling,
  sendMessage,
  type Disposable,
  type InboxMessage,
  broadcast,
  createInbox,
  type PermissionMode,
} from "../mailbox"
import {
  createAgentIdentity,
  createTeam,
  readManifest,
  deleteTeam,
  getStaleMembers,
  removeMember,
  teamExists,
  addMember,
  takeoverAsCoordinator,
  heartbeat,
} from "../team"
import { getSwarmEnvContext } from "../tmux/utils"
import {
  approveJoin,
  rejectJoin,
  approveShutdown,
  rejectShutdown,
} from "../team/membership"
import type { AgentIdentity, AgentCapability, TeamManifest } from "../team/types"
import {
  autoAssignTasksWithRuntime,
  createSwarmTask,
  getSwarmTaskPoolStats,
  reassignStaleTasks,
  releaseSwarmTaskLease,
  reassignSwarmTask,
  listSwarmTaskSummaries,
  readSwarmTaskNode,
  getAssignmentStatus,
  type SwarmTaskCreateInput,
} from "../task-graph"
import { renewSlot, resolveParallelRuntimeConfig } from "../../parallel-runtime"
import { AgentStateMachine } from "./state"
import type { RiskLevel } from "./worker"

/**
 * Pending permission request for human approval
 */
interface PendingPermission {
  from: string
  requestId: string
  toolName: string
  input: unknown
  riskLevel: RiskLevel
  requestedAt: number
}

/**
 * Pending plan approval request
 */
interface PendingPlanApproval {
  from: string
  requestId: string
  plan: string
  planFile?: string
  taskId?: string
  requestedAt: number
}

/**
 * Coordinator agent configuration
 */
export interface CoordinatorConfig {
  /** Team name to create/manage */
  teamName: string
  /** Agent name */
  name: string
  /** Session ID */
  sessionId: string
  /** Team description */
  description?: string
  /** Auto-approve join requests */
  autoApprove?: boolean
  /** Max team members */
  maxMembers?: number
  /** Heartbeat timeout in ms */
  heartbeatTimeoutMs?: number
  /** Assignment strategy */
  assignmentStrategy?: "round-robin" | "capability-match" | "load-balance"
  /** Coordination loop interval in ms */
  loopIntervalMs?: number
  /** Auto-approve low-risk permission requests */
  autoApproveLowRisk?: boolean
  /** State change callback */
  onStateChange?: (state: ReturnType<AgentStateMachine["getState"]>) => void
  /** Join request callback (return true to approve) */
  onJoinRequest?: (agent: {
    name: string
    sessionId: string
    capabilities?: AgentCapability[]
    tmuxPane?: string
    worktreePath?: string
  }) => Promise<boolean>
  /** Shutdown request callback (return true to approve) */
  onShutdownRequest?: (agentId: string) => Promise<boolean>
  /** Permission request callback (return true to approve) */
  onPermissionRequest?: (request: {
    agentId: string
    toolName: string
    input: unknown
    riskLevel: RiskLevel
  }) => Promise<{ approved: boolean; feedback?: string; updatedInput?: unknown }>
  /** Task completed callback */
  onTaskCompleted?: (taskId: string, agentId: string) => void
  /** Permission pending callback (for UI notification) */
  onPermissionPending?: (request: PendingPermission) => void
  /**
   * Plan approval request callback.
   * If provided, called for each plan approval request.
   * If not provided, plans are queued for manual approval via approvePlan/rejectPlan.
   */
  onPlanApprovalRequest?: (request: {
    agentId: string
    plan: string
    planFile?: string
    taskId?: string
  }) => Promise<{
    decision: "approved" | "rejected" | "revision_requested"
    feedback?: string
  }>
  /** Plan approval pending callback (for UI notification) */
  onPlanApprovalPending?: (request: PendingPlanApproval) => void
  /** Mode change acknowledged callback */
  onModeChangeAcknowledged?: (agentId: string, mode: PermissionMode) => void
  /** Error callback */
  onError?: (error: Error) => void
}

/**
 * Coordinator agent runtime
 */
export class CoordinatorAgent {
  private identity: AgentIdentity
  private stateMachine: AgentStateMachine
  private config: Partial<OhMyOpenCodeConfig>
  private coordConfig: CoordinatorConfig
  private mailboxWatcher: Disposable | null = null
  private coordinationTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private manifest: TeamManifest | null = null
  private pendingPermissions: Map<string, PendingPermission> = new Map()
  private coordinationInFlight = false
  private pendingPlanApprovals: Map<string, PendingPlanApproval> = new Map()

  /**
   * Low-risk tools that can be auto-approved
   */
  private static readonly AUTO_APPROVE_TOOLS = [
    "Read", "Glob", "Grep", "LSP", "WebFetch", "WebSearch", "Task", "TaskOutput"
  ]

  constructor(coordConfig: CoordinatorConfig, config: Partial<OhMyOpenCodeConfig>) {
    this.coordConfig = coordConfig
    this.config = config

    // Get agent ID from environment if available (for orchestrator-spawned coordinators)
    const envContext = getSwarmEnvContext()

    // Create identity
    this.identity = createAgentIdentity({
      id: envContext?.agentId,
      name: coordConfig.name,
      sessionId: coordConfig.sessionId,
      role: "coordinator",
      capabilities: ["code", "design", "review"], // Coordinator has all capabilities
    })

    // Initialize state machine
    this.stateMachine = new AgentStateMachine()

    // Subscribe to state changes
    if (coordConfig.onStateChange) {
      this.stateMachine.subscribe((state) => {
        coordConfig.onStateChange!(state)
      })
    }
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
   * Get team manifest
   */
  getManifest(): TeamManifest | null {
    return this.manifest
  }

  /**
   * Get state summary
   */
  getSummary(): string {
    const stats = this.getStats()
    return `${this.stateMachine.getSummary()} | Workers: ${stats.workers} | Tasks: ${stats.pending}/${stats.total}`
  }

  /**
   * Get team statistics
   */
  getStats(): {
    workers: number
    total: number
    pending: number
    inProgress: number
    completed: number
  } {
    if (!this.manifest) {
      return { workers: 0, total: 0, pending: 0, inProgress: 0, completed: 0 }
    }

    const poolStats = getSwarmTaskPoolStats(this.coordConfig.teamName, this.config)

    return {
      workers: this.manifest.members.length - 1, // Exclude coordinator
      total: poolStats.total,
      pending: poolStats.open,
      inProgress: poolStats.in_progress,
      completed: poolStats.completed,
    }
  }

  /**
   * Start the coordinator agent
   */
  async start(): Promise<boolean> {
    if (this.running) {
      return true
    }

    const { teamName, description, autoApprove, maxMembers, heartbeatTimeoutMs, assignmentStrategy } = this.coordConfig

    try {
      // Check if team already exists (created by /swarm create)
      if (teamExists(teamName, this.config)) {
        // Team exists - attempt to take over as coordinator
        this.manifest = readManifest(teamName, this.config)
        if (!this.manifest) {
          throw new Error(`Team "${teamName}" exists but manifest unreadable`)
        }

        // Create inbox for this coordinator
        createInbox(teamName, this.identity.id, this.config)

        // If our ID doesn't match the registered coordinator, we need to take over
        // This handles:
        // 1. /swarm create registers a placeholder coordinator
        // 2. Previous coordinator crashed/died and we're recovering
        if (this.manifest.coordinatorId !== this.identity.id) {
          const takeoverResult = takeoverAsCoordinator(
            teamName,
            this.identity,
            this.config
          )

          if (!takeoverResult.success) {
            throw new Error(`Failed to become coordinator: ${takeoverResult.reason}`)
          }

          this.manifest = readManifest(teamName, this.config)
        }
      } else {
        // Create new team
        this.manifest = createTeam(teamName, this.identity, this.config, {
          description,
          settings: {
            autoApprove: autoApprove ?? false,
            maxMembers: maxMembers ?? 10,
            heartbeatTimeoutMs: heartbeatTimeoutMs ?? 30000,
            assignmentStrategy: assignmentStrategy ?? "capability-match",
          },
        })
      }

      // Transition to idle (coordinator is always "idle" in terms of task execution)
      this.stateMachine.dispatch({ type: "JOIN_APPROVED" })
      this.running = true

      // Start mailbox polling
      this.startMailboxPolling()

      // Start coordination loop
      this.startCoordinationLoop()

      return true
    } catch (err) {
      this.coordConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  /**
   * Stop the coordinator agent
   */
  async stop(options?: { deleteTeam?: boolean }): Promise<boolean> {
    if (!this.running) {
      return true
    }

    const { teamName } = this.coordConfig

    // Stop coordination loop
    this.stopCoordinationLoop()

    // Stop mailbox polling
    this.stopMailboxPolling()

    // Send shutdown_approved to all workers (as if they requested it)
    // This tells workers they should stop immediately
    broadcast(teamName, this.identity.id, { type: "shutdown_approved" }, this.config)

    // Optionally delete team
    if (options?.deleteTeam) {
      try {
        deleteTeam(teamName, this.config)
      } catch {
        // Ignore deletion errors
      }
    }

    // Transition through proper state machine sequence: idle/working → leaving → dead
    this.stateMachine.dispatch({ type: "SHUTDOWN_REQUESTED" })
    this.stateMachine.dispatch({ type: "SHUTDOWN_APPROVED" })
    this.running = false

    return true
  }

  /**
   * Add a task to the pool
   *
   * After creating the task, automatically attempts to assign it
   * to any idle workers (level-triggered assignment).
   */
  addTask(input: SwarmTaskCreateInput): string {
    if (!this.manifest) {
      throw new Error("Coordinator not started")
    }

    const task = createSwarmTask(this.coordConfig.teamName, input, this.config)

    // Trigger auto-assignment for idle workers (level-triggered)
    // This ensures newly added tasks are immediately assigned if workers are waiting
    this.autoAssignWithAdmissionControl().catch((err) => {
      this.coordConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
    })

    return task.id
  }

  /**
   * Get task assignment status with statistics
   */
  getTaskStatus() {
    if (!this.manifest) {
      return {
        tasks: [],
        stats: {
          total: 0,
          open: 0,
          in_progress: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          blocked: 0,
        },
      }
    }

    return getAssignmentStatus(this.coordConfig.teamName, this.config)
  }

  private async autoAssignWithAdmissionControl(): Promise<void> {
    await autoAssignTasksWithRuntime(this.coordConfig.teamName, this.identity.id, this.config)
  }

  /**
   * Renew parallel-runtime leases for all in-progress swarm tasks.
   *
   * Without periodic renewal, leases expire after lease_ttl_ms (default 120s)
   * and the global slot becomes available while the worker is still running.
   */
  private async renewSwarmLeases(): Promise<void> {
    if (!this.manifest) return

    const runtimeConfig = resolveParallelRuntimeConfig(this.config.parallel_runtime)
    if (!runtimeConfig.enabled) return

    const inProgressTasks = listSwarmTaskSummaries(this.coordConfig.teamName, this.config, {
      include_completed: true,
    }).filter((task) => task.state === "in_progress")

    const renewals: Array<Promise<boolean>> = []
    for (const task of inProgressTasks) {
      const node = readSwarmTaskNode(this.coordConfig.teamName, task.id, this.config)
      const leaseId = node?.lease?.lease_id
      if (!leaseId) continue

      renewals.push(
        renewSlot(leaseId, runtimeConfig).catch(() => {
          // Lease may have already expired or been released; non-fatal.
          return false
        })
      )
    }

    if (renewals.length > 0) {
      await Promise.all(renewals)
    }
  }

  private releaseParallelLeaseFromTask(taskId: string, outcome: "completed" | "failed" | "cancelled", reason?: string): void {
    releaseSwarmTaskLease(this.coordConfig.teamName, taskId, this.config, outcome, reason ? { reason } : undefined)
  }

  /**
   * Handle join request
   *
   * Issue A fix: Add member FIRST, then send approval AFTER.
   * This prevents split-brain where approval is sent but addMember fails.
   *
   * Issue B fix: Use actual capabilities from join_request payload.
   */
  private async handleJoinRequest(
    agentId: string,
    agentName: string,
    sessionId: string,
    capabilities: AgentCapability[] | undefined,
    tmuxPane: string | undefined,
    worktreePath: string | undefined,
    messageId: string
  ): Promise<void> {
    const { teamName, onJoinRequest, autoApprove } = this.coordConfig

    // Check auto-approve or callback
    let approved = autoApprove ?? false

    if (onJoinRequest && !approved) {
      approved = await onJoinRequest({
        name: agentName,
        sessionId,
        capabilities,
        tmuxPane,
        worktreePath,
      })
    }

    if (approved) {
      // Build agent identity with actual capabilities (default to ["code"] for backward compat)
      const agentIdentity: AgentIdentity = {
        id: agentId,
        name: agentName,
        sessionId: sessionId,
        role: "worker",
        capabilities: capabilities ?? ["code"],
        tmuxPane,
        worktreePath,
        joinedAt: Date.now(),
        lastHeartbeat: Date.now(),
      }

      try {
        // STEP 1: Add member FIRST (may fail if maxMembers reached)
        addMember(teamName, agentIdentity, this.config)

        // STEP 2: Only approve AFTER successful add
        approveJoin(teamName, this.identity.id, agentId, this.config)

        // Refresh manifest
        this.manifest = readManifest(teamName, this.config)
      } catch (err) {
        // addMember failed (e.g., maxMembers reached) - reject instead
        const reason = err instanceof Error ? err.message : "Failed to add member"
        rejectJoin(teamName, this.identity.id, agentId, reason, this.config)
      }
    } else {
      rejectJoin(teamName, this.identity.id, agentId, "Join request denied", this.config)
    }
  }

  /**
   * Handle shutdown request
   */
  private async handleShutdownRequest(agentId: string): Promise<void> {
    const { teamName, onShutdownRequest } = this.coordConfig

    // Check callback
    let approved = true

    if (onShutdownRequest) {
      approved = await onShutdownRequest(agentId)
    }

    if (approved) {
      approveShutdown(teamName, this.identity.id, agentId, this.config)

      // Remove from team
      try {
        removeMember(teamName, agentId, this.config)
        this.manifest = readManifest(teamName, this.config)
      } catch {
        // Ignore removal errors
      }
    } else {
      rejectShutdown(teamName, this.identity.id, agentId, "Cannot shutdown now", this.config)
    }
  }

  /**
   * Classify risk level of a tool
   */
  private classifyRisk(toolName: string, _input: unknown): RiskLevel {
    if (CoordinatorAgent.AUTO_APPROVE_TOOLS.includes(toolName)) {
      return "low"
    }

    // High risk: destructive operations
    const highRiskTools = ["Bash", "Write", "Edit", "NotebookEdit"]
    if (highRiskTools.includes(toolName)) {
      return "high"
    }

    return "medium"
  }

  /**
   * Handle permission request from a worker
   *
   * Flow:
   * 1. Classify risk level
   * 2. Auto-approve low-risk if configured
   * 3. Otherwise, queue for human approval or invoke callback
   */
  private async handlePermissionRequest(
    fromAgentId: string,
    requestId: string,
    toolName: string,
    input: unknown
  ): Promise<void> {
    const { teamName, autoApproveLowRisk, onPermissionRequest, onPermissionPending } = this.coordConfig
    const riskLevel = this.classifyRisk(toolName, input)

    // Auto-approve low-risk operations if enabled
    if ((autoApproveLowRisk ?? true) && riskLevel === "low") {
      sendMessage(
        teamName,
        this.identity.id,
        fromAgentId,
        {
          type: "permission_response",
          requestId,
          decision: "approved",
        },
        this.config
      )
      return
    }

    // If we have a callback, use it for immediate decision
    if (onPermissionRequest) {
      try {
        const result = await onPermissionRequest({
          agentId: fromAgentId,
          toolName,
          input,
          riskLevel,
        })

        sendMessage(
          teamName,
          this.identity.id,
          fromAgentId,
          {
            type: "permission_response",
            requestId,
            decision: result.approved ? "approved" : "rejected",
            feedback: result.feedback,
            updatedInput: result.updatedInput,
          },
          this.config
        )
        return
      } catch (err) {
        // On callback error, reject the request
        sendMessage(
          teamName,
          this.identity.id,
          fromAgentId,
          {
            type: "permission_response",
            requestId,
            decision: "rejected",
            feedback: `Permission handler error: ${err instanceof Error ? err.message : String(err)}`,
          },
          this.config
        )
        return
      }
    }

    // Queue for human approval
    const pendingRequest: PendingPermission = {
      from: fromAgentId,
      requestId,
      toolName,
      input,
      riskLevel,
      requestedAt: Date.now(),
    }
    this.pendingPermissions.set(requestId, pendingRequest)

    // Notify UI if callback is provided
    onPermissionPending?.(pendingRequest)
  }

  /**
   * Approve a pending permission request (called by UI/external code)
   */
  approvePermission(requestId: string, options?: { updatedInput?: unknown }): boolean {
    const request = this.pendingPermissions.get(requestId)
    if (!request) {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      request.from,
      {
        type: "permission_response",
        requestId,
        decision: "approved",
        updatedInput: options?.updatedInput,
      },
      this.config
    )

    this.pendingPermissions.delete(requestId)
    return true
  }

  /**
   * Reject a pending permission request (called by UI/external code)
   */
  rejectPermission(requestId: string, reason?: string): boolean {
    const request = this.pendingPermissions.get(requestId)
    if (!request) {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      request.from,
      {
        type: "permission_response",
        requestId,
        decision: "rejected",
        feedback: reason ?? "Permission denied by coordinator",
      },
      this.config
    )

    this.pendingPermissions.delete(requestId)
    return true
  }

  /**
   * Get list of pending permission requests
   */
  getPendingPermissions(): PendingPermission[] {
    return Array.from(this.pendingPermissions.values())
  }

  // ============================================================================
  // Plan Approval Methods
  // ============================================================================

  /**
   * Handle plan approval request from a worker
   *
   * Flow:
   * 1. If callback provided, invoke it for immediate decision
   * 2. Otherwise, queue for manual approval
   */
  private async handlePlanApprovalRequest(
    fromAgentId: string,
    requestId: string,
    plan: string,
    planFile?: string,
    taskId?: string
  ): Promise<void> {
    const { teamName, onPlanApprovalRequest, onPlanApprovalPending } = this.coordConfig

    // If we have a callback, use it for immediate decision
    if (onPlanApprovalRequest) {
      try {
        const result = await onPlanApprovalRequest({
          agentId: fromAgentId,
          plan,
          planFile,
          taskId,
        })

        sendMessage(
          teamName,
          this.identity.id,
          fromAgentId,
          {
            type: "plan_approval_response",
            requestId,
            decision: result.decision,
            feedback: result.feedback,
          },
          this.config
        )
        return
      } catch (err) {
        // On callback error, reject the request
        sendMessage(
          teamName,
          this.identity.id,
          fromAgentId,
          {
            type: "plan_approval_response",
            requestId,
            decision: "rejected",
            feedback: `Plan approval handler error: ${err instanceof Error ? err.message : String(err)}`,
          },
          this.config
        )
        return
      }
    }

    // Queue for manual approval
    const pendingRequest: PendingPlanApproval = {
      from: fromAgentId,
      requestId,
      plan,
      planFile,
      taskId,
      requestedAt: Date.now(),
    }
    this.pendingPlanApprovals.set(requestId, pendingRequest)

    // Notify UI if callback is provided
    onPlanApprovalPending?.(pendingRequest)
  }

  /**
   * Approve a pending plan approval request (called by UI/external code)
   */
  approvePlan(requestId: string, feedback?: string): boolean {
    const request = this.pendingPlanApprovals.get(requestId)
    if (!request) {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      request.from,
      {
        type: "plan_approval_response",
        requestId,
        decision: "approved",
        feedback,
      },
      this.config
    )

    this.pendingPlanApprovals.delete(requestId)
    return true
  }

  /**
   * Reject a pending plan approval request (called by UI/external code)
   */
  rejectPlan(requestId: string, feedback?: string): boolean {
    const request = this.pendingPlanApprovals.get(requestId)
    if (!request) {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      request.from,
      {
        type: "plan_approval_response",
        requestId,
        decision: "rejected",
        feedback: feedback ?? "Plan rejected by coordinator",
      },
      this.config
    )

    this.pendingPlanApprovals.delete(requestId)
    return true
  }

  /**
   * Request revision for a pending plan (called by UI/external code)
   */
  requestPlanRevision(requestId: string, feedback: string): boolean {
    const request = this.pendingPlanApprovals.get(requestId)
    if (!request) {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      request.from,
      {
        type: "plan_approval_response",
        requestId,
        decision: "revision_requested",
        feedback,
      },
      this.config
    )

    this.pendingPlanApprovals.delete(requestId)
    return true
  }

  /**
   * Get list of pending plan approval requests
   */
  getPendingPlanApprovals(): PendingPlanApproval[] {
    return Array.from(this.pendingPlanApprovals.values())
  }

  // ============================================================================
  // Mode Control Methods
  // ============================================================================

  /**
   * Set permission mode for a specific worker
   *
   * @param workerId Target worker agent ID
   * @param mode Target permission mode
   * @param options Optional reason and duration
   * @returns true if message was sent (not a guarantee of receipt)
   */
  setWorkerMode(
    workerId: string,
    mode: PermissionMode,
    options?: { reason?: string; durationMs?: number }
  ): boolean {
    if (!this.manifest) {
      return false
    }

    // Verify worker is a team member
    const member = this.manifest.members.find(m => m.id === workerId)
    if (!member || member.role !== "worker") {
      return false
    }

    sendMessage(
      this.coordConfig.teamName,
      this.identity.id,
      workerId,
      {
        type: "mode_set_request",
        mode,
        reason: options?.reason,
        duration: options?.durationMs,
      },
      this.config
    )

    return true
  }

  /**
   * Broadcast mode change to all workers
   *
   * @param mode Target permission mode
   * @param options Optional reason and duration
   */
  broadcastMode(
    mode: PermissionMode,
    options?: { reason?: string; durationMs?: number }
  ): void {
    if (!this.manifest) {
      return
    }

    // Send to all workers (not coordinator)
    for (const member of this.manifest.members) {
      if (member.role === "worker") {
        sendMessage(
          this.coordConfig.teamName,
          this.identity.id,
          member.id,
          {
            type: "mode_set_request",
            mode,
            reason: options?.reason,
            duration: options?.durationMs,
          },
          this.config
        )
      }
    }
  }

  /**
   * Handle incoming mailbox message
   */
  private async handleMessage(message: InboxMessage): Promise<void> {
    const { payload } = message

    switch (payload.type) {
      case "join_request":
        await this.handleJoinRequest(
          message.from,
          payload.agentName,
          payload.sessionId,
          payload.capabilities as AgentCapability[] | undefined,
          payload.tmuxPane,
          payload.worktreePath,
          message.id
        )
        break

      case "shutdown_request":
        await this.handleShutdownRequest(message.from)
        break

      case "task_completed":
        this.coordConfig.onTaskCompleted?.(payload.taskId, payload.agentId)
        this.releaseParallelLeaseFromTask(payload.taskId, "completed")
        break

      case "idle_notification":
        // Worker is idle - trigger immediate auto-assign for responsiveness
        // (coordination loop also runs periodically as fallback)
        await this.autoAssignWithAdmissionControl()
        break

      case "permission_request":
        await this.handlePermissionRequest(
          message.from,
          payload.requestId,
          payload.toolName,
          payload.input
        )
        break

      case "task_rejected":
        // Worker rejected/failed task. Coordinator must requeue safely.
        this.coordConfig.onError?.(
          new Error(`Task ${payload.taskId} rejected by ${payload.agentId}: ${payload.reason}`)
        )
        this.releaseParallelLeaseFromTask(payload.taskId, "failed", payload.reason)
        // Only reassign if the task is still owned by this rejecting worker.
        reassignSwarmTask(this.coordConfig.teamName, payload.taskId, payload.reason, this.config, {
          expectedOwnerId: payload.agentId,
        })
        // Trigger auto-assign to try assigning the requeued task to another worker
        await this.autoAssignWithAdmissionControl()
        break

      case "plan_approval_request":
        await this.handlePlanApprovalRequest(
          message.from,
          payload.requestId,
          payload.plan,
          payload.planFile,
          payload.taskId
        )
        break

      case "mode_set_response":
        // Worker acknowledged mode change
        if (payload.success) {
          this.coordConfig.onModeChangeAcknowledged?.(message.from, payload.currentMode)
        }
        break

      default:
        // Unknown message type - ignore
        break
    }
  }

  /**
   * Coordination loop - runs periodically
   *
   * Issue C fix: Remove duplicate processing of join/shutdown/completion messages.
   * These are now handled ONLY by mailbox polling (handleMessage).
   * The coordination loop focuses on:
   * - Heartbeat (coordinator liveness)
   * - Stale worker detection (level-triggered from manifest)
   * - Auto-assign tasks (level-triggered from manifest idleWorkers)
   */
  private async runCoordinationLoop(): Promise<void> {
    if (!this.running || !this.manifest) return
    if (this.coordinationInFlight) return
    this.coordinationInFlight = true

    const { teamName } = this.coordConfig

    try {
      // 0. Update coordinator heartbeat
      // This allows workers to detect if coordinator is still alive
      heartbeat(teamName, this.identity.id, this.config)

      // REMOVED: getPendingJoinRequests loop (now handled by mailbox polling)
      // REMOVED: getPendingShutdownRequests loop (now handled by mailbox polling)
      // REMOVED: coordinatorReceiveCompletions loop (now handled by mailbox polling)

      // 1. Check for stale workers and reassign their tasks (level-triggered)
      const staleMembers = getStaleMembers(teamName, this.config)
      if (staleMembers.length > 0) {
        reassignStaleTasks(teamName, this.identity.id, this.config)
      }

      // 2. Renew parallel-runtime leases for active swarm tasks
      await this.renewSwarmLeases()

      // 3. Auto-assign tasks to idle workers (level-triggered from manifest)
      await this.autoAssignWithAdmissionControl()

      // 4. Refresh manifest
      this.manifest = readManifest(teamName, this.config)
    } catch (err) {
      this.coordConfig.onError?.(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.coordinationInFlight = false
    }
  }

  /**
   * Start mailbox polling
   */
  private startMailboxPolling(): void {
    if (this.mailboxWatcher) return

    const { teamName } = this.coordConfig

    this.mailboxWatcher = startPolling(
      teamName,
      this.identity.id,
      (message) => this.handleMessage(message),
      this.config,
      {
        intervalMs: 500,
        onError: (err) => this.coordConfig.onError?.(err),
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
   * Start coordination loop
   */
  private startCoordinationLoop(): void {
    if (this.coordinationTimer) return

    const interval = this.coordConfig.loopIntervalMs ?? 2000

    this.coordinationTimer = setInterval(() => {
      this.runCoordinationLoop()
    }, interval)

    // Run immediately
    this.runCoordinationLoop()
  }

  /**
   * Stop coordination loop
   */
  private stopCoordinationLoop(): void {
    if (this.coordinationTimer) {
      clearInterval(this.coordinationTimer)
      this.coordinationTimer = null
    }
  }
}

/**
 * Create and start a coordinator agent
 */
export async function createCoordinator(
  coordConfig: CoordinatorConfig,
  config: Partial<OhMyOpenCodeConfig>
): Promise<CoordinatorAgent | null> {
  const coordinator = new CoordinatorAgent(coordConfig, config)
  const started = await coordinator.start()

  if (!started) {
    return null
  }

  return coordinator
}
