/**
 * Governance Orchestration Module
 *
 * Provides governance-oriented orchestration capabilities for agent execution.
 *
 * ## Public API
 *
 * The main entry points are the integration functions:
 * - `executePreToolGovernance` - Called before each tool execution
 * - `executePostToolGovernance` - Called after each tool execution
 * - `executeUserPromptGovernance` - Called when user submits a prompt
 * - `cleanupGovernanceSession` - Cleanup when session ends
 *
 * ## Architecture
 *
 * Internally composed of:
 * - ExecutionTracer for observability (Phase 2)
 * - BudgetMonitor with hidden budget strategy (Phase 3)
 * - SemanticCheckpointManager for recovery (Phase 4)
 * - GovernanceLedger for audit (Phase 1)
 *
 * @see docs/governance-orchestration-design.md
 */

// =============================================================================
// PUBLIC API - Main integration functions
// =============================================================================

export {
  // Session management
  initGovernanceSession,
  getGovernanceSession,
  hasGovernanceSession,
  cleanupGovernanceSession,

  // Hook integration
  executePreToolGovernance,
  executePostToolGovernance,
  executeUserPromptGovernance,

  // Default config
  DEFAULT_GOVERNANCE_CONFIG,
} from "./integration"

export type {
  GovernanceSession,
  PreToolGovernanceInput,
  PreToolGovernanceResult,
  PostToolGovernanceInput,
  PostToolGovernanceResult,
  UserPromptGovernanceInput,
  UserPromptGovernanceResult,
} from "./integration"

// =============================================================================
// TYPES - For TypeScript consumers
// =============================================================================

// Core governance types
export type {
  ToolCriticalityMeta,
  ApprovalPreview,
  SuspendInfo,
  ApprovalAction,
  ApprovalResult,
  CheckpointRef,
  SuspendState,
  ResumeInput,
  ResumeResult,
  GovernanceLedger,
  LedgerEntry,
  LedgerEntryBase,
  LedgerFilter,
  IntegrityReport,
  DiagnosticReport,
  PermissionEscalation,
  PermissionViolation,
  BudgetEvent,
  CheckpointEvent,
  RecoveryEvent,
  ApprovalEvent,
  StateProposalEvent,
  EnvironmentDriftEvent,
  AgentEnvelope,
  EnvelopeMetadata,
  EnvelopePermissions,
  EnvelopeResult,
  EnvelopeSuccess,
  EnvelopeError,
  EnvelopeSuspended,
  EnvelopeValidationResult,
  EnvelopeValidationError,
} from "./types"

// Tracer types
export type {
  ExecutionTrace,
  TraceNode,
  TraceNodeType,
  TraceNodeStatus,
  TraceEdge,
  TraceEdgeType,
  TraceEvent,
  TraceEventType,
  TraceMetrics,
  TraceResources,
  TraceError,
  EdgeTrigger,
  CompressedTrace,
  GovernanceBlock,
  CriticalPathTrace,
  CriticalityReason,
  TraceVisualization,
  MermaidDiagram,
  TracerConfig,
  CompressionRules,
} from "./tracer-types"

// Budget types
export type {
  TokenBudget,
  BudgetStatus,
  BudgetPhase,
  BudgetMonitorEvent,
  BudgetConsumptionEvent,
  BudgetWarningEvent,
  BudgetGCTriggeredEvent,
  BudgetGCDegradedEvent,
  BudgetRefactorTriggeredEvent,
  BudgetHardLimitEvent,
  GCTarget,
  GCResult,
  ContextSummary,
  CriticalContext,
  ForkResult,
  TransferManifest,
  BudgetMonitorConfig,
} from "./budget-types"

// Checkpoint types
export type {
  TaskPhase,
  PhaseDefinition,
  SemanticCheckpoint,
  TaskIntent,
  FileState,
  FileRole,
  FileValidity,
  CriticalDeps,
  GitContext,
  PhaseRecord,
  ExportFingerprint,
  FingerprintMode,
  ChangeAnalysis,
  ChangeType,
  ConfidenceLevel,
  FileChangeResult,
  RecoveryDecision,
  RecoveryContinue,
  RecoveryPartialRerun,
  RecoveryFullRerun,
  RecoveryUserDecision,
  ChangeReport,
  LayerChangeSummary,
  CheckpointEvent as SemanticCheckpointEvent,
  CheckpointCreatedEvent,
  CheckpointRestoredEvent,
  CheckpointInvalidatedEvent,
  EnvironmentDriftDetectedEvent,
  DriftType,
  CheckpointConfig,
  RecoveryStrategyPreference,
  CreateCheckpointOptions,
  CheckpointValidation,
  SerializedCheckpoint,
} from "./checkpoint-types"

// Isolation types
export type {
  HookTrustLevel,
  HookPermissions,
  StateProposal,
  ProposalType,
  ProposalPriority,
  ProposalStatus,
  ProposalRejection,
  HookDefinition,
  SessionState,
  SandboxedHookContext,
  ScopedStateWriter,
  ScopedLogger,
  RestrictedToolInvoker,
  ProposalSubmitter,
  IsolationEvent,
  PermissionDeniedEvent,
  ProposalSubmittedEvent,
  ProposalAppliedEvent,
  ProposalRejectedEvent,
  HookTimeoutEvent,
  SharedWriteRequestEvent,
  IsolationConfig,
} from "./isolation-types"

// Visualization types
export type {
  VisualizationFormat,
  VisualizationOutput,
  AnyVisualizationOutput,
  VisualizationConfig,
  MermaidFlowchartOutput,
  MermaidSequenceOutput,
  MermaidGanttOutput,
  D3ForceOutput,
  D3ForceNode,
  D3ForceLink,
  D3TreeOutput,
  D3TreeNode,
  D3TimelineOutput,
  D3TimelineEvent,
  HtmlReportOutput,
  JsonSummaryOutput,
  ReportSection,
  TraceStatistics,
  GovernanceSummary,
} from "./visualization-types"

// =============================================================================
// CONSTANTS - Default configurations
// =============================================================================

export {
  DEFAULT_TRACER_CONFIG,
  DEFAULT_COMPRESSION_RULES,
} from "./tracer-types"

export {
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_THRESHOLDS,
  DEFAULT_GC_TARGETS,
  ALWAYS_PRESERVE,
  PHASE_DESCRIPTIONS,
  generateConvergenceHint,
  BudgetExhaustedError,
  SessionForkRequiredError,
} from "./budget-types"

export {
  DEFAULT_CHECKPOINT_CONFIG,
  RECOVERY_STRATEGY_TABLE,
  CHECKPOINT_SCHEMA_VERSION,
  PHASE_DEFINITIONS,
  getPhasesAfter,
} from "./checkpoint-types"

export {
  DEFAULT_ISOLATION_CONFIG,
  DEFAULT_PERMISSIONS,
  TRUST_LEVEL_HIERARCHY,
  getTrustLevelRank,
  isAtLeastAsTrusted,
  HookPermissionError,
  HookTimeoutError,
  ProposalError,
} from "./isolation-types"

export {
  DEFAULT_VISUALIZATION_CONFIG,
  NODE_TYPE_COLORS,
  NODE_STATUS_COLORS,
  EDGE_TYPE_COLORS,
} from "./visualization-types"

// =============================================================================
// ADVANCED API - For testing, plugins, and advanced use cases
// =============================================================================

// Suspend/Resume mechanism
export {
  SuspendException,
  InMemoryResumeTokenStore,
  ResumeHandler,
  type ResumeTokenStore,
} from "./suspend-exception"

// Tool criticality
export {
  ToolCriticalityRegistry,
  getToolCriticalityRegistry,
  resetToolCriticalityRegistry,
} from "./tool-criticality"

// Approval gate (not integrated in main flow yet)
export {
  createApprovalGateHook,
  type ApprovalGateHook,
  type ApprovalGateConfig,
  HOOK_NAME as APPROVAL_GATE_HOOK_NAME,
} from "./approval-gate"

// Ledger (internal, exposed for testing/debugging)
export {
  GovernanceLedgerWriter,
  LedgerManager,
  getLedgerManager,
  resetLedgerManager,
  type LedgerStorageConfig,
} from "./ledger"

// Tracer (internal, exposed for testing/debugging)
export {
  ExecutionTracer,
  TracerManager,
  getTracerManager,
  resetTracerManager,
} from "./tracer"

// Envelope (internal, exposed for testing/debugging)
export {
  EnvelopeValidator,
  EnvelopeFactory,
  getEnvelopeFactory,
  resetEnvelopeFactory,
  envelopeSuccess,
  envelopeError,
  envelopeSuspended,
  isEnvelopeSuccess,
  isEnvelopeError,
  isEnvelopeSuspended,
  type EnvelopeValidatorConfig,
} from "./envelope"

// Budget monitor (internal, reset exposed for testing)
export {
  BudgetMonitor,
  BudgetMonitorManager,
  getBudgetMonitorManager,
  resetBudgetMonitorManager,
  SimpleRefactorStrategy,
  type RefactorStrategy,
  type GarbageCollector,
  type TaskState,
} from "./budget-monitor"

// Checkpoint (internal, exposed for testing/debugging)
export {
  SemanticCheckpointManager,
  DefaultFingerprintStrategy,
  CheckpointManagerRegistry,
  getCheckpointRegistry,
  resetCheckpointRegistry,
  type FingerprintStrategy,
  type FileSystemAdapter,
  type GitAdapter,
} from "./checkpoint"

// Isolation (internal, exposed for testing/debugging)
export {
  ProposalQueue,
  IsolationManager,
  createSandboxedContext,
  executeIsolatedHook,
  getIsolationManager,
  hasIsolationManager,
  removeIsolationManager,
  resetIsolationManagers,
  type CreateSandboxedContextOptions,
} from "./isolation"

// Visualization (internal, exposed for testing/debugging)
export {
  TraceVisualizer,
  toMermaidFlowchart,
  toMermaidSequence,
  toMermaidGantt,
  toD3Force,
  toHtmlReport,
  calculateTraceStatistics,
} from "./visualization"

// Trace persistence (for debugging/observability)
export {
  persistTrace,
  loadTrace,
  listTraces,
  getLatestTrace,
  deleteTrace,
  formatTraceAsYaml,
  traceToMermaid,
  getTracesSummary,
  type PersistedTrace,
  type PersistedTraceNode,
  type TraceQueryFilter,
  type TraceListEntry,
} from "./trace-persistence"

// Shared utilities
export {
  generateId,
  sanitizeData,
  sanitizeInputs,
  sanitizeOutputs,
  type SanitizeOptions,
} from "./utils"
