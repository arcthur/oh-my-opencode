/**
 * Hook Isolation Types
 *
 * Type definitions for hook logical sandbox.
 * Implements layered trust model with Proxy-based isolation.
 *
 * Key concepts:
 * - Trust levels: core > plugin > external
 * - Scoped state: hooks can only write to their namespace
 * - StateProposal: mutations via proposal queue for auditability
 *
 * ## Threat Model (IMPORTANT)
 *
 * This isolation system is a **logical sandbox** for preventing accidental
 * misuse and ensuring auditability. It is NOT a security sandbox.
 *
 * **What it prevents:**
 * - Accidental writes to shared state from untrusted hooks
 * - Unaudited state mutations (all changes go through proposal queue)
 * - Permission confusion (clear trust level hierarchy)
 * - Namespace collisions between plugins
 *
 * **What it does NOT prevent:**
 * - Malicious code using Node.js APIs directly (require('fs'), process.env, etc.)
 * - Global object pollution via prototype manipulation
 * - Resource exhaustion (CPU, memory, network)
 * - Side effects through closures or captured references
 *
 * **Design choice:** We prioritize developer experience and auditability over
 * hard security. For stronger isolation, consider:
 * - Node.js permission flags (--experimental-permission)
 * - Worker threads with restricted permissions
 * - Subprocess isolation with IPC
 * - WebAssembly sandboxes
 *
 * The current Proxy-based approach is sufficient for:
 * - Plugin systems where plugins are semi-trusted
 * - Development tools where convenience matters
 * - Audit trails where "who changed what" is the main concern
 *
 * @see docs/governance-orchestration-design.md Section 2.2
 */

// ============================================================================
// Trust Levels
// ============================================================================

/**
 * Trust levels for hook execution
 * Higher trust = more permissions
 */
export type HookTrustLevel =
  | "core" // System hooks, can modify global state
  | "plugin" // Plugin hooks, namespace-scoped writes
  | "external" // External hooks, read-only + explicit grants

/**
 * Trust level hierarchy (higher index = lower trust)
 */
export const TRUST_LEVEL_HIERARCHY: HookTrustLevel[] = ["core", "plugin", "external"]

/**
 * Get numeric trust level for comparison
 */
export function getTrustLevelRank(level: HookTrustLevel): number {
  return TRUST_LEVEL_HIERARCHY.indexOf(level)
}

/**
 * Check if a trust level is at least as trusted as another
 */
export function isAtLeastAsTrusted(level: HookTrustLevel, required: HookTrustLevel): boolean {
  return getTrustLevelRank(level) <= getTrustLevelRank(required)
}

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Permission manifest for a hook
 */
export interface HookPermissions {
  /** Trust level of this hook */
  trustLevel: HookTrustLevel

  /** Namespaces this hook can write to */
  writeNamespaces: string[]

  /** Global state keys this hook can read ("*" for all) */
  readableGlobals: string[] | "*"

  /** Tools this hook can invoke ("*" for all) */
  allowedTools: string[] | "*"

  /** Maximum execution time (ms) */
  timeoutMs: number

  /** Maximum memory allocation hint (MB) */
  memoryLimitMb?: number
}

/**
 * Default permissions by trust level
 */
export const DEFAULT_PERMISSIONS: Record<HookTrustLevel, Partial<HookPermissions>> = {
  core: {
    trustLevel: "core",
    writeNamespaces: ["*"],
    readableGlobals: "*",
    allowedTools: "*",
    timeoutMs: 30000,
  },
  plugin: {
    trustLevel: "plugin",
    writeNamespaces: [], // Must be explicitly granted
    readableGlobals: "*",
    allowedTools: "*",
    timeoutMs: 10000,
  },
  external: {
    trustLevel: "external",
    writeNamespaces: [],
    readableGlobals: [], // Must be explicitly granted
    allowedTools: [],
    timeoutMs: 5000,
  },
}

// ============================================================================
// State Proposal Types
// ============================================================================

/**
 * State proposal for auditable mutations
 *
 * Hooks cannot directly modify shared state - they propose changes via
 * a proposal queue. This ensures:
 * 1. All state mutations are auditable (logged to ledger)
 * 2. Untrusted hooks cannot bypass governance
 * 3. Conflicts can be detected before application
 *
 * ## Apply Timing Semantics
 *
 * Proposals are NOT applied immediately upon submission. The apply timing
 * depends on the submitter's trust level and configuration:
 *
 * | Trust Level | Apply Timing                                      |
 * |-------------|---------------------------------------------------|
 * | core        | Immediate (auto-approved, sync during hook exec)  |
 * | plugin      | Deferred (batch applied after hook completes)     |
 * | external    | Manual (requires explicit approval call)          |
 *
 * This means that within a single hook execution:
 * - Core hooks see their writes immediately
 * - Plugin hooks do NOT see their own writes until after hook returns
 * - External hooks do NOT see writes until explicitly approved
 *
 * ## Lifecycle
 *
 * 1. **pending**: Submitted but not yet reviewed
 * 2. **applied**: Approved and written to state
 * 3. **rejected**: Denied (e.g., permission violation, conflict)
 * 4. **expired**: Not reviewed within `proposalExpiryMs`
 *
 * ## Auto-approval
 *
 * Proposals from hooks at or above `autoApproveFromTrust` level are
 * automatically approved. Default is "core" - only core hooks get
 * auto-approval.
 *
 * @see IsolationConfig.autoApproveFromTrust
 * @see IsolationConfig.proposalExpiryMs
 */
export interface StateProposal {
  /** Unique proposal ID */
  id: string

  /** Hook that submitted this proposal */
  submitter: string

  /** Timestamp */
  timestamp: number

  /** Type of state change */
  type: ProposalType

  /** Target namespace */
  namespace: string

  /** Key to modify */
  key: string

  /** Proposed value */
  value: unknown

  /** Rationale for the change */
  rationale: string

  /** Priority (higher = more urgent) */
  priority: ProposalPriority

  /** Status of this proposal */
  status: ProposalStatus
}

/**
 * Proposal types
 */
export type ProposalType = "write" | "delete" | "merge"

/**
 * Proposal priority
 */
export type ProposalPriority = "low" | "normal" | "high" | "critical"

/**
 * Proposal status
 */
export type ProposalStatus = "pending" | "applied" | "rejected" | "expired"

/**
 * Proposal rejection reason
 */
export interface ProposalRejection {
  proposalId: string
  reason: string
  rejectedBy: string
  timestamp: number
}

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * Hook definition for sandboxing
 */
export interface HookDefinition {
  /** Hook name */
  name: string

  /** Hook namespace (for scoped state) */
  namespace: string

  /** Hook permissions */
  permissions: HookPermissions

  /** Hook event type */
  event: string
}

/**
 * Base session state interface
 */
export interface SessionState {
  /** Session ID */
  sessionId: string

  /** Current task description */
  task?: string

  /** Current plan */
  plan?: unknown

  /** Approval state */
  approvals?: Map<string, boolean>

  /** Error context */
  errors?: unknown[]

  /** Custom state */
  [key: string]: unknown
}

/**
 * Sandboxed execution context for hooks
 */
export interface SandboxedHookContext {
  /** Session ID (read-only) */
  readonly sessionId: string

  /** Read-only access to session state */
  readonly sessionState: Readonly<SessionState>

  /** Scoped state writer */
  scopedState: ScopedStateWriter

  /** Logger with hook context */
  logger: ScopedLogger

  /** Tool invoker with permission checks */
  tools: RestrictedToolInvoker

  /** Proposal queue for shared state mutations */
  proposals: ProposalSubmitter
}

/**
 * Scoped state writer interface
 */
export interface ScopedStateWriter {
  /** Write to hook's own namespace */
  set(key: string, value: unknown): void

  /** Read from hook's own namespace */
  get<T>(key: string): T | undefined

  /** Delete from hook's own namespace */
  delete(key: string): boolean

  /** Check if key exists in hook's namespace */
  has(key: string): boolean

  /** Get all keys in hook's namespace */
  keys(): string[]

  /** Clear hook's namespace */
  clear(): void
}

/**
 * Scoped logger interface
 */
export interface ScopedLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * Restricted tool invoker interface
 */
export interface RestrictedToolInvoker {
  /** Invoke a tool with permission check */
  invoke<T = unknown>(toolName: string, args: unknown): Promise<T>

  /** Check if tool is allowed */
  isAllowed(toolName: string): boolean

  /** List allowed tools */
  listAllowed(): string[]
}

/**
 * Proposal submitter interface
 */
export interface ProposalSubmitter {
  /** Submit a proposal for shared state modification */
  submit(proposal: Omit<StateProposal, "id" | "timestamp" | "submitter" | "status">): string

  /** Check proposal status */
  getStatus(proposalId: string): ProposalStatus | undefined

  /** Cancel a pending proposal */
  cancel(proposalId: string): boolean
}

// ============================================================================
// Isolation Events
// ============================================================================

/**
 * Isolation event types
 */
export type IsolationEvent =
  | PermissionDeniedEvent
  | ProposalSubmittedEvent
  | ProposalAppliedEvent
  | ProposalRejectedEvent
  | HookTimeoutEvent
  | SharedWriteRequestEvent

export interface PermissionDeniedEvent {
  type: "permission-denied"
  hook: string
  action: "read" | "write" | "tool-invoke"
  target: string
  reason: string
}

export interface ProposalSubmittedEvent {
  type: "proposal-submitted"
  proposalId: string
  submitter: string
  namespace: string
  key: string
}

export interface ProposalAppliedEvent {
  type: "proposal-applied"
  proposalId: string
  appliedBy: string
}

export interface ProposalRejectedEvent {
  type: "proposal-rejected"
  proposalId: string
  reason: string
}

export interface HookTimeoutEvent {
  type: "hook-timeout"
  hook: string
  timeoutMs: number
}

export interface SharedWriteRequestEvent {
  type: "shared-write-request"
  hook: string
  namespace: string
  key: string
  value: unknown
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Hook isolation configuration
 */
export interface IsolationConfig {
  /** Enable hook sandboxing */
  enabled: boolean

  /** Default trust level for unknown hooks */
  defaultTrustLevel: HookTrustLevel

  /** Hook timeout (ms) */
  hookTimeoutMs: number

  /** Per-hook trust overrides */
  trustOverrides: Record<string, HookTrustLevel>

  /** Per-hook permission overrides */
  permissionOverrides: Record<string, Partial<HookPermissions>>

  /**
   * Enable StateProposal enforcement
   *
   * When true, all shared state mutations must go through the proposal queue.
   * When false, hooks can write directly (bypasses audit trail).
   */
  enforceProposals: boolean

  /**
   * Auto-approve proposals from hooks at or above this trust level
   *
   * - "core": Only core hooks get auto-approval (default)
   * - "plugin": Core and plugin hooks get auto-approval
   * - "external": All hooks get auto-approval (not recommended)
   *
   * Auto-approved proposals are applied synchronously during hook execution,
   * so the hook sees its writes immediately.
   */
  autoApproveFromTrust: HookTrustLevel

  /**
   * Proposal expiry time (ms)
   *
   * Pending proposals that are not reviewed within this time
   * automatically transition to "expired" status and are not applied.
   * Default: 60000 (1 minute)
   */
  proposalExpiryMs: number
}

/**
 * Default isolation configuration
 */
export const DEFAULT_ISOLATION_CONFIG: IsolationConfig = {
  enabled: false, // Disabled by default until stable
  defaultTrustLevel: "plugin",
  hookTimeoutMs: 10000,
  trustOverrides: {},
  permissionOverrides: {},
  enforceProposals: true,
  autoApproveFromTrust: "core",
  proposalExpiryMs: 60000,
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Hook permission error
 */
export class HookPermissionError extends Error {
  readonly hook: string
  readonly action: string
  readonly target: string

  constructor(message: string, hook: string, action: string, target: string) {
    super(message)
    this.name = "HookPermissionError"
    this.hook = hook
    this.action = action
    this.target = target
  }
}

/**
 * Hook timeout error
 */
export class HookTimeoutError extends Error {
  readonly hook: string
  readonly timeoutMs: number

  constructor(hook: string, timeoutMs: number) {
    super(`Hook "${hook}" exceeded timeout of ${timeoutMs}ms`)
    this.name = "HookTimeoutError"
    this.hook = hook
    this.timeoutMs = timeoutMs
  }
}

/**
 * Proposal error
 */
export class ProposalError extends Error {
  readonly proposalId: string
  readonly reason: string

  constructor(message: string, proposalId: string, reason: string) {
    super(message)
    this.name = "ProposalError"
    this.proposalId = proposalId
    this.reason = reason
  }
}
