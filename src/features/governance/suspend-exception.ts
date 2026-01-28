/**
 * Suspend Exception
 *
 * A special exception type that signals execution should pause
 * for user approval or intervention. When thrown, the execution
 * context is preserved and can be resumed after user decision.
 */

import type {
  SuspendInfo,
  ApprovalPreview,
  ApprovalAction,
  SuspendState,
  ResumeInput,
  ResumeResult,
  ApprovalResult,
} from "./types"

/**
 * Exception thrown to suspend execution for approval
 *
 * Usage:
 * ```typescript
 * throw new SuspendException({
 *   reason: "Critical operation requires approval",
 *   tool: "Bash",
 *   toolArgs: { command: "rm -rf ..." },
 *   sessionId: ctx.sessionId,
 *   previewData: {
 *     title: "Destructive Command",
 *     description: "This will delete files",
 *     affectedItems: [{ type: "directory", identifier: "/path", action: "delete" }]
 *   },
 *   availableActions: [
 *     { type: "approve", label: "Proceed" },
 *     { type: "reject", label: "Cancel" }
 *   ]
 * })
 * ```
 */
export class SuspendException extends Error {
  public readonly suspendInfo: SuspendInfo

  constructor(info: Omit<SuspendInfo, "resumeToken" | "timestamp">) {
    super(`Execution suspended: ${info.reason}`)
    this.name = "SuspendException"

    // Generate resume token and timestamp
    this.suspendInfo = {
      ...info,
      resumeToken: generateResumeToken(info.sessionId, info.tool),
      timestamp: Date.now(),
    }

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SuspendException)
    }
  }

  /**
   * Check if an error is a SuspendException
   */
  static isSuspendException(error: unknown): error is SuspendException {
    return error instanceof SuspendException
  }

  /**
   * Create a suspension for tool approval
   */
  static forToolApproval(params: {
    tool: string
    toolArgs: unknown
    sessionId: string
    reason: string
    preview: ApprovalPreview
    actions?: ApprovalAction[]
  }): SuspendException {
    return new SuspendException({
      reason: params.reason,
      tool: params.tool,
      toolArgs: params.toolArgs,
      sessionId: params.sessionId,
      previewData: params.preview,
      availableActions: params.actions ?? getDefaultApprovalActions(),
    })
  }

  /**
   * Create a suspension for budget warning
   */
  static forBudgetWarning(params: {
    sessionId: string
    percentage: number
    remaining: number
  }): SuspendException {
    return new SuspendException({
      reason: `Budget threshold exceeded (${(params.percentage * 100).toFixed(1)}%)`,
      tool: "system:budget-monitor",
      toolArgs: { percentage: params.percentage, remaining: params.remaining },
      sessionId: params.sessionId,
      previewData: {
        title: "Context Budget Warning",
        description: `Session has used ${(params.percentage * 100).toFixed(1)}% of available context. ${params.remaining.toLocaleString()} tokens remaining.`,
        affectedItems: [],
        estimatedImpact: { tokensRequired: params.remaining },
      },
      availableActions: [
        { type: "approve", label: "Continue with caution" },
        { type: "modify", label: "Adjust scope", modifyPrompt: "What would you like to simplify or defer?" },
        { type: "defer", label: "Fork to new session" },
      ],
    })
  }

  /**
   * Get serializable representation for storage/transmission
   */
  toJSON(): SuspendInfo & { error: string } {
    return {
      ...this.suspendInfo,
      error: this.message,
    }
  }
}

/**
 * Generate a unique resume token
 */
function generateResumeToken(sessionId: string, tool: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `resume_${sessionId.substring(0, 8)}_${tool}_${timestamp}_${random}`
}

/**
 * Default approval actions
 */
function getDefaultApprovalActions(): ApprovalAction[] {
  return [
    { type: "approve", label: "Approve and continue" },
    { type: "reject", label: "Reject and cancel" },
    { type: "modify", label: "Modify parameters", modifyPrompt: "How would you like to adjust this operation?" },
  ]
}

/**
 * Resume token storage interface
 * Implementations can use in-memory, file, or external storage
 */
export interface ResumeTokenStore {
  /** Store suspension info for later resume */
  store(token: string, info: SuspendInfo): Promise<void>

  /** Retrieve suspension info by token */
  retrieve(token: string): Promise<SuspendInfo | null>

  /** Mark token as consumed (cannot be reused) */
  consume(token: string): Promise<boolean>

  /** Clean up expired tokens */
  cleanup(maxAgeMs: number): Promise<number>
}

/**
 * In-memory resume token store (for testing and development)
 */
export class InMemoryResumeTokenStore implements ResumeTokenStore {
  private tokens = new Map<string, SuspendInfo>()

  async store(token: string, info: SuspendInfo): Promise<void> {
    this.tokens.set(token, info)
  }

  async retrieve(token: string): Promise<SuspendInfo | null> {
    return this.tokens.get(token) ?? null
  }

  async consume(token: string): Promise<boolean> {
    return this.tokens.delete(token)
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const now = Date.now()
    let cleaned = 0

    for (const [token, info] of this.tokens.entries()) {
      if (now - info.timestamp > maxAgeMs) {
        this.tokens.delete(token)
        cleaned++
      }
    }

    return cleaned
  }

  /** Get all stored tokens (for debugging) */
  getAll(): Map<string, SuspendInfo> {
    return new Map(this.tokens)
  }

  /** Clear all tokens */
  clear(): void {
    this.tokens.clear()
  }
}

// ============================================================================
// Resume Handler
// ============================================================================

/**
 * Handles resume flow for suspended executions
 *
 * State machine:
 *   running -> suspended -> pending_approval -> {approved|modified|rejected|deferred}
 *                                                      |
 *                                                      v
 *                                               resumed | cancelled
 */
export class ResumeHandler {
  private tokenStore: ResumeTokenStore
  private stateMap = new Map<string, SuspendState>()

  constructor(tokenStore: ResumeTokenStore) {
    this.tokenStore = tokenStore
  }

  /**
   * Register a suspension (called when SuspendException is caught)
   */
  async registerSuspension(exception: SuspendException): Promise<void> {
    const { resumeToken, ...info } = exception.suspendInfo
    await this.tokenStore.store(resumeToken, exception.suspendInfo)
    this.stateMap.set(resumeToken, "pending_approval")
  }

  /**
   * Get current state of a suspension
   */
  getState(resumeToken: string): SuspendState | undefined {
    return this.stateMap.get(resumeToken)
  }

  /**
   * Process user's resume decision
   */
  async processResume(input: ResumeInput): Promise<ResumeResult> {
    const suspendInfo = await this.tokenStore.retrieve(input.resumeToken)

    if (!suspendInfo) {
      return {
        success: false,
        state: "cancelled",
        suspendInfo: {} as SuspendInfo,
        error: "Invalid or expired resume token",
      }
    }

    const currentState = this.stateMap.get(input.resumeToken)
    if (currentState !== "pending_approval") {
      return {
        success: false,
        state: currentState ?? "cancelled",
        suspendInfo,
        error: `Cannot resume from state: ${currentState}`,
      }
    }

    // Validate action is available
    const validActions = suspendInfo.availableActions.map((a) => a.type)
    if (!validActions.includes(input.action)) {
      return {
        success: false,
        state: "pending_approval",
        suspendInfo,
        error: `Action "${input.action}" not available. Valid: ${validActions.join(", ")}`,
      }
    }

    // Process based on action
    let newState: SuspendState
    let resolvedArgs: unknown

    switch (input.action) {
      case "approve":
        newState = "approved"
        resolvedArgs = suspendInfo.toolArgs
        break

      case "modify":
        if (!input.modifiedArgs) {
          return {
            success: false,
            state: "pending_approval",
            suspendInfo,
            error: "Modified args required for modify action",
          }
        }
        newState = "modified"
        resolvedArgs = input.modifiedArgs
        break

      case "reject":
        newState = "rejected"
        break

      case "defer":
        newState = "deferred"
        // Re-queue for later - stay in pending_approval
        this.stateMap.set(input.resumeToken, "pending_approval")
        return {
          success: true,
          state: "deferred",
          suspendInfo,
        }

      default:
        return {
          success: false,
          state: "pending_approval",
          suspendInfo,
          error: `Unknown action: ${input.action}`,
        }
    }

    // Update state
    this.stateMap.set(input.resumeToken, newState)

    // For approve/modify, mark as ready to resume
    if (newState === "approved" || newState === "modified") {
      // Consume token (one-time use for approve/modify)
      await this.tokenStore.consume(input.resumeToken)
      this.stateMap.set(input.resumeToken, "resumed")

      return {
        success: true,
        state: "resumed",
        suspendInfo,
        resolvedArgs,
      }
    }

    // For reject, mark as cancelled
    if (newState === "rejected") {
      await this.tokenStore.consume(input.resumeToken)
      this.stateMap.set(input.resumeToken, "cancelled")

      return {
        success: true,
        state: "cancelled",
        suspendInfo,
      }
    }

    return {
      success: true,
      state: newState,
      suspendInfo,
      resolvedArgs,
    }
  }

  /**
   * Convert ResumeResult to ApprovalResult for ledger logging
   */
  toApprovalResult(result: ResumeResult, decisionTimeMs: number): ApprovalResult {
    let decision: ApprovalResult["decision"]

    switch (result.state) {
      case "resumed":
      case "approved":
        decision = result.resolvedArgs !== result.suspendInfo.toolArgs ? "modified" : "approved"
        break
      case "cancelled":
      case "rejected":
        decision = "rejected"
        break
      case "deferred":
        decision = "deferred"
        break
      default:
        decision = "rejected"
    }

    return {
      decision,
      modifiedArgs: result.resolvedArgs,
      decisionTimeMs,
    }
  }

  /**
   * Check if a token is valid and pending
   */
  async isPending(resumeToken: string): Promise<boolean> {
    const state = this.stateMap.get(resumeToken)
    if (state !== "pending_approval") return false

    const info = await this.tokenStore.retrieve(resumeToken)
    return info !== null
  }

  /**
   * Get all pending suspensions for a session
   */
  async getPendingForSession(sessionId: string): Promise<SuspendInfo[]> {
    const pending: SuspendInfo[] = []

    for (const [token, state] of this.stateMap.entries()) {
      if (state === "pending_approval") {
        const info = await this.tokenStore.retrieve(token)
        if (info && info.sessionId === sessionId) {
          pending.push(info)
        }
      }
    }

    return pending
  }

  /**
   * Clear all states (for testing)
   */
  clear(): void {
    this.stateMap.clear()
  }
}
