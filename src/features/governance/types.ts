/**
 * Governance Orchestration Types
 *
 * Core type definitions for governance-oriented orchestration.
 * Implements the design from docs/research/governance-orchestration-design.md
 */

// ============================================================================
// Approval Gate Types
// ============================================================================

/**
 * Tool criticality metadata for approval gate decisions
 */
export interface ToolCriticalityMeta {
  /** Static criticality flag or dynamic evaluator */
  critical: boolean | ((args: unknown) => boolean)

  /** Human-readable reason for criticality */
  reason: string

  /** Category of critical action */
  category: "destructive" | "external" | "expensive" | "irreversible"

  /** Preview generator for approval UI */
  generatePreview?: (args: unknown) => ApprovalPreview
}

/**
 * Preview data for user approval decision
 */
export interface ApprovalPreview {
  /** Title of the approval request */
  title: string

  /** Human-readable description */
  description: string

  /** Items affected by this action */
  affectedItems: Array<{
    type: string
    identifier: string
    action: string
  }>

  /** Estimated impact metrics */
  estimatedImpact?: {
    filesAffected?: number
    tokensRequired?: number
    externalCalls?: number
  }
}

/**
 * Semantic checkpoint reference (Phase 4)
 * Placeholder for future SemanticCheckpoint integration
 */
export interface CheckpointRef {
  /** Checkpoint ID */
  id: string

  /** Checkpoint creation timestamp */
  createdAt: number

  /** Files tracked at checkpoint */
  trackedFiles?: string[]
}

/**
 * Suspend info for pausing execution
 */
export interface SuspendInfo {
  /** Reason for suspension */
  reason: string

  /** Token for resuming execution */
  resumeToken: string

  /** Preview data for user decision */
  previewData: ApprovalPreview

  /** Available actions for user */
  availableActions: ApprovalAction[]

  /** Tool that triggered suspension */
  tool: string

  /** Tool arguments at suspension point */
  toolArgs: unknown

  /** Session ID */
  sessionId: string

  /** Timestamp */
  timestamp: number

  /**
   * Checkpoint reference for resumption (Phase 4)
   * Optional until SemanticCheckpoint is implemented
   */
  checkpoint?: CheckpointRef
}

/**
 * Actions available to user when approval is requested
 */
export type ApprovalAction =
  | { type: "approve"; label: string }
  | { type: "reject"; label: string }
  | { type: "modify"; label: string; modifyPrompt: string }
  | { type: "defer"; label: string; deferUntil?: string }

/**
 * Result of user approval decision
 */
export interface ApprovalResult {
  /** Decision type */
  decision: "approved" | "rejected" | "modified" | "deferred"

  /** Modified args if decision was "modified" */
  modifiedArgs?: unknown

  /** Reason for decision */
  reason?: string

  /** Time taken to decide (ms) */
  decisionTimeMs: number
}

// ============================================================================
// Suspend/Resume State Machine Types
// ============================================================================

/**
 * Suspension state machine states
 *
 * State transitions:
 *   running -> suspended (on SuspendException)
 *   suspended -> pending_approval (waiting for user)
 *   pending_approval -> approved | modified | rejected | deferred
 *   approved -> resumed (continue with original args)
 *   modified -> resumed (continue with modified args)
 *   rejected -> cancelled
 *   deferred -> pending_approval (re-ask later)
 */
export type SuspendState =
  | "running"
  | "suspended"
  | "pending_approval"
  | "approved"
  | "modified"
  | "rejected"
  | "deferred"
  | "resumed"
  | "cancelled"

/**
 * Input for resuming suspended execution
 */
export interface ResumeInput {
  /** Resume token from SuspendException */
  resumeToken: string

  /** User's action/decision */
  action: ApprovalAction["type"]

  /** Modified arguments (if action is "modify") */
  modifiedArgs?: unknown

  /** Reason for the decision */
  reason?: string

  /** Deferred until (if action is "defer") */
  deferUntil?: string
}

/**
 * Result of resume attempt
 */
export interface ResumeResult {
  /** Whether resume was successful */
  success: boolean

  /** New state after resume */
  state: SuspendState

  /** Original suspend info */
  suspendInfo: SuspendInfo

  /** Error message if failed */
  error?: string

  /** Arguments to use (original or modified) */
  resolvedArgs?: unknown
}

// ============================================================================
// Governance Ledger Types
// ============================================================================

/**
 * Base interface for all ledger entries
 */
export interface LedgerEntryBase {
  /** Entry ID */
  id: string

  /** Timestamp */
  timestamp: number

  /** Hash of previous entry (for integrity chain) */
  previousHash: string

  /** Entry type discriminator */
  type: string

  /** Correlation ID to link with tracer node (optional) */
  traceNodeId?: string
}

/**
 * Permission escalation event
 */
export interface PermissionEscalation extends LedgerEntryBase {
  type: "permission-escalation"

  /** Who requested escalation */
  requestor: string

  /** What permission was requested */
  permission: string

  /** How it was granted */
  grantedBy: "user" | "auto-inferred" | "policy"

  /** Rationale */
  rationale: string
}

/**
 * Permission violation event
 */
export interface PermissionViolation extends LedgerEntryBase {
  type: "permission-violation"

  /** Who attempted the violation */
  violator: string

  /** What was attempted */
  attemptedAction: string

  /** Why it was blocked */
  blockReason: string

  /** Was it logged to user */
  userNotified: boolean
}

/**
 * Budget-related event
 */
export interface BudgetEvent extends LedgerEntryBase {
  type: "budget-event"

  /** Event subtype */
  subtype:
    | "consumption"
    | "warning"
    | "gc-triggered"
    | "gc-degraded"
    | "gc-ineffective"
    | "gc-completed"
    | "fork-triggered"
    | "exhausted"

  /** Budget state at time of event */
  budgetState: {
    consumed: number
    allocated: number
    percentage: number
  }

  /** Action taken */
  actionTaken: string

  /** Tool that triggered this consumption (if applicable) */
  tool?: string

  /** Tokens freed (if GC) */
  tokensFreed?: number
}

/**
 * Checkpoint event
 */
export interface CheckpointEvent extends LedgerEntryBase {
  type: "checkpoint-event"

  /** Checkpoint ID */
  checkpointId: string

  /** Event subtype */
  subtype: "created" | "restored" | "invalidated"

  /** Reason for event */
  reason: string

  /** Files tracked */
  trackedFiles: string[]
}

/**
 * Recovery event
 */
export interface RecoveryEvent extends LedgerEntryBase {
  type: "recovery-event"

  /** Recovery decision */
  decision: "continue" | "partial-rerun" | "full-rerun" | "user-choice"

  /** What triggered recovery */
  trigger: {
    layer: 0 | 1 | 2 | 3
    description: string
  }

  /** Affected phases */
  affectedPhases: string[]
}

/**
 * Approval event
 */
export interface ApprovalEvent extends LedgerEntryBase {
  type: "approval-event"

  /** Tool that required approval */
  tool: string

  /** User decision */
  decision: "approved" | "rejected" | "modified" | "deferred"

  /** Preview shown to user */
  previewShown: string

  /** Time to decision (ms) */
  decisionTimeMs: number
}

/**
 * State proposal event
 */
export interface StateProposalEvent extends LedgerEntryBase {
  type: "state-proposal"

  /** Proposal ID */
  proposalId: string

  /** Submitter */
  submitter: string

  /** Proposal outcome */
  outcome: "applied" | "rejected" | "pending"

  /** Target namespace and key */
  target: { namespace: string; key: string }

  /** Rejection reason if rejected */
  rejectionReason?: string
}

/**
 * Environment drift event
 */
export interface EnvironmentDriftEvent extends LedgerEntryBase {
  type: "environment-drift"

  /** What drifted */
  driftType: "file-changed" | "dependency-changed" | "branch-switched" | "external-commit"

  /** Affected files/items */
  affected: string[]

  /** Impact assessment */
  impact: "none" | "minor" | "major" | "critical"

  /** Action recommended */
  recommendedAction: string
}

/**
 * Union of all ledger entry types
 */
export type LedgerEntry =
  | PermissionEscalation
  | PermissionViolation
  | BudgetEvent
  | CheckpointEvent
  | RecoveryEvent
  | ApprovalEvent
  | StateProposalEvent
  | EnvironmentDriftEvent

/**
 * Governance Ledger structure
 */
export interface GovernanceLedger {
  /** Ledger identifier */
  ledgerId: string

  /** Session this ledger belongs to */
  sessionId: string

  /** Creation time */
  createdAt: number

  /** Immutable event entries */
  entries: LedgerEntry[]

  /** Integrity chain (each entry references previous hash) */
  integrityChain: string[]
}

/**
 * Ledger query filter
 */
export interface LedgerFilter {
  type?: LedgerEntry["type"]
  after?: number
  before?: number
}

/**
 * Integrity verification report
 */
export interface IntegrityReport {
  valid: boolean
  errors: string[]
  entryCount: number
}

/**
 * Diagnostic report for ledger analysis
 */
export interface DiagnosticReport {
  symptom: string
  likelyCause: string
  supportingEvents: LedgerEntry[]
  causalChain: string[]
  recommendation: string
}

// ============================================================================
// Agent Envelope Types
// ============================================================================

/**
 * Standardized envelope for all agent/tool communication
 * Ensures traceability and permission management
 */
export interface AgentEnvelope<T = unknown> {
  /** Envelope version for compatibility */
  version: "1.0"

  /** Unique envelope identifier */
  envelopeId: string

  /** Metadata about this operation */
  metadata: EnvelopeMetadata

  /** The actual payload */
  payload: T

  /** Permission and action guidance */
  permissions: EnvelopePermissions
}

/**
 * Envelope metadata for tracking and integrity
 */
export interface EnvelopeMetadata {
  /** Token/cost consumption */
  gasUsed: number

  /** Integrity hash of payload */
  integrityHash: string

  /** Timestamp */
  timestamp: number

  /** Source of this envelope */
  source: {
    type: "tool" | "agent" | "hook" | "user"
    id: string
  }

  /** Trace context for distributed tracing */
  traceContext?: {
    traceId: string
    spanId: string
    parentSpanId?: string
  }
}

/**
 * Permission and action guidance within envelope
 */
export interface EnvelopePermissions {
  /** How this permission was granted */
  grantedBy: "task-definition" | "user-escalation" | "auto-inferred"

  /** Scope of this permission */
  scope: "this-step" | "this-session" | "persistent"

  /** Human-readable rationale */
  rationale?: string

  /** Suggested next actions (soft guidance) */
  suggestedNextActions: string[]

  /** Actions requiring explicit user confirmation */
  escalationRequired: string[]

  /** Actions explicitly forbidden */
  forbidden: string[]
}

/**
 * Envelope result types - union of possible outcomes
 */
export type EnvelopeResult<T> = EnvelopeSuccess<T> | EnvelopeError | EnvelopeSuspended

/**
 * Successful envelope result
 */
export interface EnvelopeSuccess<T> {
  status: "success"
  envelope: AgentEnvelope<T>
}

/**
 * Error envelope result
 */
export interface EnvelopeError {
  status: "error"
  error: {
    type: string
    message: string
    recoverable: boolean
    suggestedAction?: string
  }
  partialEnvelope?: AgentEnvelope<unknown>
}

/**
 * Suspended envelope result
 */
export interface EnvelopeSuspended {
  status: "suspended"
  reason: string
  resumeToken: string
  previewData?: unknown
  envelope: AgentEnvelope<{ suspendedAt: string }>
}

/**
 * Validation result for envelope validation
 */
export interface EnvelopeValidationResult {
  valid: boolean
  errors: EnvelopeValidationError[]
}

/**
 * Validation error details
 */
export interface EnvelopeValidationError {
  field: string
  error: string
}
