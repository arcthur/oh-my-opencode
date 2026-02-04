/**
 * Hook Isolation (Logical Sandbox)
 *
 * Implements logical sandbox for hook execution:
 * - Proxy-based state isolation
 * - Permission enforcement
 * - StateProposal pattern for auditable mutations
 *
 * @see docs/research/governance-orchestration-design.md Section 2.2
 */

import { EventEmitter } from "node:events"
import type {
  HookTrustLevel,
  HookPermissions,
  HookDefinition,
  SessionState,
  SandboxedHookContext,
  ScopedStateWriter,
  ScopedLogger,
  RestrictedToolInvoker,
  ProposalSubmitter,
  StateProposal,
  ProposalStatus,
  ProposalRejection,
  IsolationEvent,
  IsolationConfig,
} from "./isolation-types"
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ISOLATION_CONFIG,
  HookPermissionError,
  HookTimeoutError,
  ProposalError,
  isAtLeastAsTrusted,
} from "./isolation-types"
import { getLedgerManager } from "./ledger"

// ============================================================================
// Deep Freeze Utility
// ============================================================================

/**
 * Deep freeze an object to make it immutable
 */
function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") {
    return obj
  }

  if (Object.isFrozen(obj)) {
    return obj
  }

  // Freeze the object itself
  Object.freeze(obj)

  // Recursively freeze all properties
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === "object") {
      deepFreeze(value)
    }
  }

  return obj
}

// ============================================================================
// Proposal Queue
// ============================================================================

/**
 * Proposal queue for managing state proposals
 */
export class ProposalQueue extends EventEmitter {
  private proposals = new Map<string, StateProposal>()
  private rejections = new Map<string, ProposalRejection>()
  private config: IsolationConfig

  constructor(config: Partial<IsolationConfig> = {}) {
    super()
    this.config = { ...DEFAULT_ISOLATION_CONFIG, ...config }
  }

  /**
   * Submit a proposal
   */
  submit(
    proposal: Omit<StateProposal, "id" | "timestamp" | "status">,
    submitterTrust: HookTrustLevel
  ): string {
    const id = this.generateId()
    const fullProposal: StateProposal = {
      ...proposal,
      id,
      timestamp: Date.now(),
      status: "pending",
    }

    this.proposals.set(id, fullProposal)

    this.emitEvent({
      type: "proposal-submitted",
      proposalId: id,
      submitter: proposal.submitter,
      namespace: proposal.namespace,
      key: proposal.key,
    })

    // Auto-approve if submitter has sufficient trust
    if (isAtLeastAsTrusted(submitterTrust, this.config.autoApproveFromTrust)) {
      this.apply(id, "auto-approve")
    }

    return id
  }

  /**
   * Get proposal by ID
   */
  get(id: string): StateProposal | undefined {
    return this.proposals.get(id)
  }

  /**
   * Get proposal status
   */
  getStatus(id: string): ProposalStatus | undefined {
    return this.proposals.get(id)?.status
  }

  /**
   * Review pending proposals
   */
  reviewPending(): StateProposal[] {
    const pending: StateProposal[] = []
    const now = Date.now()

    for (const proposal of this.proposals.values()) {
      if (proposal.status === "pending") {
        // Check expiry
        if (now - proposal.timestamp > this.config.proposalExpiryMs) {
          proposal.status = "expired"
        } else {
          pending.push(proposal)
        }
      }
    }

    return pending
  }

  /**
   * Apply a proposal
   */
  apply(id: string, appliedBy: string): StateProposal {
    const proposal = this.proposals.get(id)
    if (!proposal) {
      throw new ProposalError(`Proposal not found: ${id}`, id, "not-found")
    }

    if (proposal.status !== "pending") {
      throw new ProposalError(
        `Proposal ${id} is not pending (status: ${proposal.status})`,
        id,
        "invalid-status"
      )
    }

    proposal.status = "applied"

    this.emitEvent({
      type: "proposal-applied",
      proposalId: id,
      appliedBy,
    })

    return proposal
  }

  /**
   * Reject a proposal
   */
  reject(id: string, reason: string, rejectedBy: string): void {
    const proposal = this.proposals.get(id)
    if (!proposal) {
      throw new ProposalError(`Proposal not found: ${id}`, id, "not-found")
    }

    if (proposal.status !== "pending") {
      throw new ProposalError(
        `Proposal ${id} is not pending (status: ${proposal.status})`,
        id,
        "invalid-status"
      )
    }

    proposal.status = "rejected"

    const rejection: ProposalRejection = {
      proposalId: id,
      reason,
      rejectedBy,
      timestamp: Date.now(),
    }
    this.rejections.set(id, rejection)

    this.emitEvent({
      type: "proposal-rejected",
      proposalId: id,
      reason,
    })
  }

  /**
   * Cancel a pending proposal
   */
  cancel(id: string): boolean {
    const proposal = this.proposals.get(id)
    if (!proposal || proposal.status !== "pending") {
      return false
    }

    proposal.status = "rejected"
    return true
  }

  /**
   * Get rejection reason
   */
  getRejection(id: string): ProposalRejection | undefined {
    return this.rejections.get(id)
  }

  /**
   * Clear expired proposals
   */
  clearExpired(): number {
    const now = Date.now()
    let cleared = 0

    for (const [id, proposal] of this.proposals) {
      if (
        proposal.status === "expired" ||
        (proposal.status !== "pending" &&
          now - proposal.timestamp > this.config.proposalExpiryMs * 2)
      ) {
        this.proposals.delete(id)
        this.rejections.delete(id)
        cleared++
      }
    }

    return cleared
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `prop-${timestamp}-${random}`
  }

  private emitEvent(event: IsolationEvent): void {
    this.emit(event.type, event)
    this.emit("isolation-event", event)
  }
}

// ============================================================================
// Scoped State Implementation
// ============================================================================

/**
 * Creates a scoped state writer for a hook
 */
function createScopedStateWriter(
  namespace: string,
  storage: Map<string, unknown>
): ScopedStateWriter {
  const prefix = `${namespace}:`

  return {
    set(key: string, value: unknown): void {
      storage.set(`${prefix}${key}`, value)
    },

    get<T>(key: string): T | undefined {
      return storage.get(`${prefix}${key}`) as T | undefined
    },

    delete(key: string): boolean {
      return storage.delete(`${prefix}${key}`)
    },

    has(key: string): boolean {
      return storage.has(`${prefix}${key}`)
    },

    keys(): string[] {
      const keys: string[] = []
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) {
          keys.push(key.substring(prefix.length))
        }
      }
      return keys
    },

    clear(): void {
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) {
          storage.delete(key)
        }
      }
    },
  }
}

// ============================================================================
// Scoped Logger Implementation
// ============================================================================

/**
 * Creates a scoped logger for a hook
 */
function createScopedLogger(hookName: string, baseLogger?: ScopedLogger): ScopedLogger {
  const prefix = `[${hookName}]`

  const defaultLogger: ScopedLogger = {
    debug: (msg, ...args) => console.debug(prefix, msg, ...args),
    info: (msg, ...args) => console.info(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
  }

  if (!baseLogger) {
    return defaultLogger
  }

  return {
    debug: (msg, ...args) => baseLogger.debug(`${prefix} ${msg}`, ...args),
    info: (msg, ...args) => baseLogger.info(`${prefix} ${msg}`, ...args),
    warn: (msg, ...args) => baseLogger.warn(`${prefix} ${msg}`, ...args),
    error: (msg, ...args) => baseLogger.error(`${prefix} ${msg}`, ...args),
  }
}

// ============================================================================
// Restricted Tool Invoker Implementation
// ============================================================================

/**
 * Creates a restricted tool invoker for a hook
 */
function createRestrictedToolInvoker(
  hook: HookDefinition,
  baseInvoker: (name: string, args: unknown) => Promise<unknown>,
  allTools: string[],
  onDenied: (event: IsolationEvent) => void
): RestrictedToolInvoker {
  const { permissions } = hook
  const allowedSet =
    permissions.allowedTools === "*"
      ? new Set(allTools)
      : new Set(permissions.allowedTools)

  return {
    async invoke<T = unknown>(toolName: string, args: unknown): Promise<T> {
      if (!allowedSet.has(toolName)) {
        onDenied({
          type: "permission-denied",
          hook: hook.name,
          action: "tool-invoke",
          target: toolName,
          reason: `Tool "${toolName}" is not allowed for hook "${hook.name}"`,
        })

        throw new HookPermissionError(
          `Hook "${hook.name}" cannot invoke tool "${toolName}"`,
          hook.name,
          "tool-invoke",
          toolName
        )
      }

      return baseInvoker(toolName, args) as Promise<T>
    },

    isAllowed(toolName: string): boolean {
      return allowedSet.has(toolName)
    },

    listAllowed(): string[] {
      return Array.from(allowedSet)
    },
  }
}

// ============================================================================
// Proposal Submitter Implementation
// ============================================================================

/**
 * Creates a proposal submitter for a hook
 */
function createProposalSubmitter(
  hook: HookDefinition,
  queue: ProposalQueue
): ProposalSubmitter {
  return {
    submit(
      proposal: Omit<StateProposal, "id" | "timestamp" | "submitter" | "status">
    ): string {
      return queue.submit(
        {
          ...proposal,
          submitter: hook.name,
        },
        hook.permissions.trustLevel
      )
    },

    getStatus(proposalId: string): ProposalStatus | undefined {
      return queue.getStatus(proposalId)
    },

    cancel(proposalId: string): boolean {
      const proposal = queue.get(proposalId)
      if (proposal && proposal.submitter === hook.name) {
        return queue.cancel(proposalId)
      }
      return false
    },
  }
}

// ============================================================================
// Sandboxed Context Creation
// ============================================================================

/**
 * Options for creating sandboxed context
 */
export interface CreateSandboxedContextOptions {
  /** Hook definition */
  hook: HookDefinition

  /** Base session state */
  sessionState: SessionState

  /** Scoped state storage */
  scopedStorage: Map<string, unknown>

  /** Proposal queue */
  proposalQueue: ProposalQueue

  /** Base tool invoker */
  toolInvoker: (name: string, args: unknown) => Promise<unknown>

  /** Available tools */
  availableTools: string[]

  /** Base logger */
  logger?: ScopedLogger

  /** Event handler */
  onEvent: (event: IsolationEvent) => void
}

/**
 * Creates a sandboxed context for hook execution
 * Uses Proxy to intercept and validate all state access
 */
export function createSandboxedContext(
  options: CreateSandboxedContextOptions
): SandboxedHookContext {
  const { hook, sessionState, scopedStorage, proposalQueue, onEvent } = options
  const { permissions } = hook

  // Create session state proxy - enforces read-only
  const sessionStateProxy = new Proxy(sessionState, {
    get(target, prop: string) {
      // Check read permission
      if (
        permissions.readableGlobals !== "*" &&
        !permissions.readableGlobals.includes(prop)
      ) {
        onEvent({
          type: "permission-denied",
          hook: hook.name,
          action: "read",
          target: prop,
          reason: `Hook "${hook.name}" cannot read global state "${prop}"`,
        })

        throw new HookPermissionError(
          `Hook "${hook.name}" cannot read global state "${prop}"`,
          hook.name,
          "read",
          prop
        )
      }

      const value = target[prop as keyof SessionState]

      // Deep freeze to prevent modification
      return deepFreeze(value)
    },

    set(_target, prop: string) {
      onEvent({
        type: "permission-denied",
        hook: hook.name,
        action: "write",
        target: prop,
        reason: `Hook "${hook.name}" cannot modify session state directly`,
      })

      throw new HookPermissionError(
        `Hook "${hook.name}" cannot modify session state directly. Use proposals for shared state.`,
        hook.name,
        "write",
        prop
      )
    },

    deleteProperty(_target, prop: string) {
      throw new HookPermissionError(
        `Hook "${hook.name}" cannot delete session state properties`,
        hook.name,
        "delete",
        String(prop)
      )
    },
  }) as Readonly<SessionState>

  // Create scoped state writer
  const scopedState = createScopedStateWriter(hook.namespace, scopedStorage)

  // Create scoped logger
  const logger = createScopedLogger(hook.name, options.logger)

  // Create restricted tool invoker
  const tools = createRestrictedToolInvoker(
    hook,
    options.toolInvoker,
    options.availableTools,
    onEvent
  )

  // Create proposal submitter
  const proposals = createProposalSubmitter(hook, proposalQueue)

  return {
    sessionId: sessionState.sessionId,
    sessionState: sessionStateProxy,
    scopedState,
    logger,
    tools,
    proposals,
  }
}

// ============================================================================
// Hook Executor with Isolation
// ============================================================================

type HookFunction<T = void> = (ctx: SandboxedHookContext) => Promise<T>

/**
 * Execute a hook with isolation and timeout
 */
export async function executeIsolatedHook<T>(
  hook: HookDefinition,
  context: SandboxedHookContext,
  execute: HookFunction<T>,
  onEvent: (event: IsolationEvent) => void
): Promise<T> {
  const { timeoutMs } = hook.permissions

  return new Promise<T>((resolve, reject) => {
    let completed = false

    // Timeout handler
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true

        onEvent({
          type: "hook-timeout",
          hook: hook.name,
          timeoutMs,
        })

        reject(new HookTimeoutError(hook.name, timeoutMs))
      }
    }, timeoutMs)

    // Execute hook
    execute(context)
      .then((result) => {
        if (!completed) {
          completed = true
          clearTimeout(timer)
          resolve(result)
        }
      })
      .catch((error) => {
        if (!completed) {
          completed = true
          clearTimeout(timer)
          reject(error)
        }
      })
  })
}

// ============================================================================
// Isolation Manager
// ============================================================================

type IsolationEventHandler = (event: IsolationEvent) => void

/**
 * Manages hook isolation for a session
 */
export class IsolationManager extends EventEmitter {
  private config: IsolationConfig
  private scopedStorage = new Map<string, unknown>()
  private proposalQueue: ProposalQueue
  private sharedState = new Map<string, unknown>()
  private sessionId: string

  constructor(sessionId: string, config: Partial<IsolationConfig> = {}) {
    super()
    this.sessionId = sessionId
    this.config = { ...DEFAULT_ISOLATION_CONFIG, ...config }
    this.proposalQueue = new ProposalQueue(this.config)

    // Forward proposal queue events
    this.proposalQueue.on("isolation-event", (event: IsolationEvent) => {
      this.emitEvent(event)
    })
  }

  /**
   * Get effective permissions for a hook
   */
  getEffectivePermissions(hook: HookDefinition): HookPermissions {
    // Start with default for trust level
    const defaults = DEFAULT_PERMISSIONS[hook.permissions.trustLevel]

    // Apply hook's own permissions
    let permissions: HookPermissions = {
      ...defaults,
      ...hook.permissions,
    } as HookPermissions

    // Apply trust override if configured
    const trustOverride = this.config.trustOverrides[hook.name]
    if (trustOverride) {
      const overrideDefaults = DEFAULT_PERMISSIONS[trustOverride]
      permissions = {
        ...permissions,
        ...overrideDefaults,
        trustLevel: trustOverride,
      } as HookPermissions
    }

    // Apply permission override if configured
    const permOverride = this.config.permissionOverrides[hook.name]
    if (permOverride) {
      permissions = {
        ...permissions,
        ...permOverride,
      }
    }

    // Ensure own namespace is writable
    if (!permissions.writeNamespaces.includes(hook.namespace)) {
      permissions.writeNamespaces = [...permissions.writeNamespaces, hook.namespace]
    }

    return permissions
  }

  /**
   * Create sandboxed context for a hook
   */
  createContext(
    hook: HookDefinition,
    sessionState: SessionState,
    toolInvoker: (name: string, args: unknown) => Promise<unknown>,
    availableTools: string[],
    logger?: ScopedLogger
  ): SandboxedHookContext {
    // Get effective permissions
    const effectiveHook: HookDefinition = {
      ...hook,
      permissions: this.getEffectivePermissions(hook),
    }

    return createSandboxedContext({
      hook: effectiveHook,
      sessionState,
      scopedStorage: this.scopedStorage,
      proposalQueue: this.proposalQueue,
      toolInvoker,
      availableTools,
      logger,
      onEvent: (event) => this.emitEvent(event),
    })
  }

  /**
   * Execute a hook with full isolation
   */
  async executeHook<T>(
    hook: HookDefinition,
    sessionState: SessionState,
    execute: HookFunction<T>,
    toolInvoker: (name: string, args: unknown) => Promise<unknown>,
    availableTools: string[],
    logger?: ScopedLogger
  ): Promise<T> {
    if (!this.config.enabled) {
      // Isolation disabled - create context but skip isolation checks
      const context = this.createContext(
        hook,
        sessionState,
        toolInvoker,
        availableTools,
        logger
      )
      return execute(context)
    }

    const context = this.createContext(
      hook,
      sessionState,
      toolInvoker,
      availableTools,
      logger
    )

    return executeIsolatedHook(hook, context, execute, (event) => this.emitEvent(event))
  }

  /**
   * Get proposal queue
   */
  getProposalQueue(): ProposalQueue {
    return this.proposalQueue
  }

  /**
   * Process pending proposals and apply approved ones
   */
  processPendingProposals(
    approver: (proposal: StateProposal) => boolean
  ): Array<{ proposal: StateProposal; applied: boolean }> {
    const results: Array<{ proposal: StateProposal; applied: boolean }> = []
    const pending = this.proposalQueue.reviewPending()

    for (const proposal of pending) {
      const shouldApprove = approver(proposal)

      if (shouldApprove) {
        this.proposalQueue.apply(proposal.id, "manual-review")
        this.applyProposalToState(proposal)
        results.push({ proposal, applied: true })
      } else {
        this.proposalQueue.reject(proposal.id, "Rejected by reviewer", "manual-review")
        results.push({ proposal, applied: false })
      }
    }

    return results
  }

  /**
   * Apply a proposal to shared state
   */
  private applyProposalToState(proposal: StateProposal): void {
    const key = `${proposal.namespace}:${proposal.key}`

    switch (proposal.type) {
      case "write":
        this.sharedState.set(key, proposal.value)
        break
      case "delete":
        this.sharedState.delete(key)
        break
      case "merge":
        const existing = this.sharedState.get(key)
        if (typeof existing === "object" && typeof proposal.value === "object") {
          this.sharedState.set(key, { ...existing as object, ...proposal.value as object })
        } else {
          this.sharedState.set(key, proposal.value)
        }
        break
    }

    // Log to ledger
    this.logToLedger("proposal-applied", proposal)
  }

  /**
   * Get shared state value
   */
  getSharedState<T>(namespace: string, key: string): T | undefined {
    return this.sharedState.get(`${namespace}:${key}`) as T | undefined
  }

  /**
   * Get all scoped state for a namespace
   */
  getScopedState(namespace: string): Map<string, unknown> {
    const result = new Map<string, unknown>()
    const prefix = `${namespace}:`

    for (const [key, value] of this.scopedStorage) {
      if (key.startsWith(prefix)) {
        result.set(key.substring(prefix.length), value)
      }
    }

    return result
  }

  /**
   * Clear all scoped state for a namespace
   */
  clearScopedState(namespace: string): void {
    const prefix = `${namespace}:`
    for (const key of this.scopedStorage.keys()) {
      if (key.startsWith(prefix)) {
        this.scopedStorage.delete(key)
      }
    }
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.scopedStorage.clear()
    this.sharedState.clear()
    this.proposalQueue.clearExpired()
  }

  private emitEvent(event: IsolationEvent): void {
    this.emit(event.type, event)
    this.emit("isolation-event", event)

    // Log permission violations to ledger
    if (event.type === "permission-denied") {
      this.logToLedger("permission-violation", event)
    }
  }

  private logToLedger(subtype: string, data: unknown): void {
    try {
      const ledger = getLedgerManager().getLedger(this.sessionId)

      if (subtype === "permission-violation") {
        const event = data as IsolationEvent & { type: "permission-denied" }
        ledger.logPermissionViolation({
          violator: event.hook,
          attemptedAction: `${event.action}:${event.target}`,
          blockReason: event.reason,
          userNotified: false,
        })
      } else if (subtype === "proposal-applied") {
        const proposal = data as StateProposal
        ledger.logStateProposal({
          proposalId: proposal.id,
          submitter: proposal.submitter,
          outcome: "applied",
          target: { namespace: proposal.namespace, key: proposal.key },
        })
      }
    } catch {
      // Ledger may not be initialized - ignore
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

const managers = new Map<string, IsolationManager>()

/**
 * Get isolation manager for a session
 */
export function getIsolationManager(
  sessionId: string,
  config?: Partial<IsolationConfig>
): IsolationManager {
  let manager = managers.get(sessionId)
  if (!manager) {
    manager = new IsolationManager(sessionId, config)
    managers.set(sessionId, manager)
  }
  return manager
}

/**
 * Check if session has isolation manager
 */
export function hasIsolationManager(sessionId: string): boolean {
  return managers.has(sessionId)
}

/**
 * Remove isolation manager for session
 */
export function removeIsolationManager(sessionId: string): boolean {
  return managers.delete(sessionId)
}

/**
 * Reset all isolation managers (for testing)
 */
export function resetIsolationManagers(): void {
  managers.clear()
}
