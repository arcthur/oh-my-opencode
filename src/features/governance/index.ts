/**
 * Governance Orchestration Module
 *
 * Provides governance-oriented orchestration capabilities:
 * - SuspendException for pausable execution (Phase 1)
 * - Tool criticality registry for approval decisions (Phase 1)
 * - Approval gate middleware for user confirmation (Phase 1)
 * - Governance ledger for audit and diagnostics (Phase 1)
 * - Execution tracer for observability (Phase 2)
 * - Agent envelope for structured communication (Phase 2)
 * - Budget monitor with hidden budget strategy (Phase 3)
 * - Semantic checkpoints for environment-aware recovery (Phase 4)
 * - Hook isolation with Proxy-based sandbox (Phase 5)
 * - Trace visualization for debugging and reporting (Phase 6)
 *
 * @see docs/governance-orchestration-design.md
 */

// Types
export type {
  // Approval Gate types
  ToolCriticalityMeta,
  ApprovalPreview,
  SuspendInfo,
  ApprovalAction,
  ApprovalResult,
  CheckpointRef,

  // Suspend/Resume state machine types
  SuspendState,
  ResumeInput,
  ResumeResult,

  // Ledger types
  GovernanceLedger,
  LedgerEntry,
  LedgerEntryBase,
  LedgerFilter,
  IntegrityReport,
  DiagnosticReport,

  // Specific ledger entry types
  PermissionEscalation,
  PermissionViolation,
  BudgetEvent,
  CheckpointEvent,
  RecoveryEvent,
  ApprovalEvent,
  StateProposalEvent,
  EnvironmentDriftEvent,

  // Envelope types (Phase 2)
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

// Suspend Exception
export {
  SuspendException,
  InMemoryResumeTokenStore,
  ResumeHandler,
  type ResumeTokenStore,
} from "./suspend-exception"

// Tool Criticality Registry
export {
  ToolCriticalityRegistry,
  getToolCriticalityRegistry,
  resetToolCriticalityRegistry,
} from "./tool-criticality"

// Approval Gate Hook
export {
  createApprovalGateHook,
  type ApprovalGateHook,
  type ApprovalGateConfig,
  HOOK_NAME as APPROVAL_GATE_HOOK_NAME,
} from "./approval-gate"

// Governance Ledger
export {
  GovernanceLedgerWriter,
  LedgerManager,
  getLedgerManager,
  resetLedgerManager,
  type LedgerStorageConfig,
} from "./ledger"

// Execution Tracer (Phase 2)
export {
  ExecutionTracer,
  TracerManager,
  getTracerManager,
  resetTracerManager,
} from "./tracer"

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

export {
  DEFAULT_TRACER_CONFIG,
  DEFAULT_COMPRESSION_RULES,
} from "./tracer-types"

// Agent Envelope (Phase 2)
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

// Budget Monitor (Phase 3)
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

// Semantic Checkpoint (Phase 4)
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

export type {
  // Task phase model
  TaskPhase,
  PhaseDefinition,

  // Core checkpoint types
  SemanticCheckpoint,
  TaskIntent,
  FileState,
  FileRole,
  FileValidity,
  CriticalDeps,
  GitContext,
  PhaseRecord,
  ExportFingerprint,

  // Change detection types
  FingerprintMode,
  ChangeAnalysis,
  ChangeType,
  ConfidenceLevel,
  FileChangeResult,

  // Recovery types
  RecoveryDecision,
  RecoveryContinue,
  RecoveryPartialRerun,
  RecoveryFullRerun,
  RecoveryUserDecision,
  ChangeReport,
  LayerChangeSummary,

  // Checkpoint events
  CheckpointEvent as SemanticCheckpointEvent,
  CheckpointCreatedEvent,
  CheckpointRestoredEvent,
  CheckpointInvalidatedEvent,
  EnvironmentDriftDetectedEvent,
  DriftType,

  // Configuration
  CheckpointConfig,
  RecoveryStrategyPreference,
  CreateCheckpointOptions,
  CheckpointValidation,
  SerializedCheckpoint,
} from "./checkpoint-types"

export {
  DEFAULT_CHECKPOINT_CONFIG,
  RECOVERY_STRATEGY_TABLE,
  CHECKPOINT_SCHEMA_VERSION,
  PHASE_DEFINITIONS,
  getPhasesAfter,
} from "./checkpoint-types"

// Hook Isolation (Phase 5)
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

export type {
  // Trust levels
  HookTrustLevel,

  // Permission types
  HookPermissions,

  // State proposal types
  StateProposal,
  ProposalType,
  ProposalPriority,
  ProposalStatus,
  ProposalRejection,

  // Hook context types
  HookDefinition,
  SessionState,
  SandboxedHookContext,
  ScopedStateWriter,
  ScopedLogger,
  RestrictedToolInvoker,
  ProposalSubmitter,

  // Isolation events
  IsolationEvent,
  PermissionDeniedEvent,
  ProposalSubmittedEvent,
  ProposalAppliedEvent,
  ProposalRejectedEvent,
  HookTimeoutEvent,
  SharedWriteRequestEvent,

  // Configuration
  IsolationConfig,
} from "./isolation-types"

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

// Trace Visualization (Phase 6)
export {
  TraceVisualizer,
  toMermaidFlowchart,
  toMermaidSequence,
  toMermaidGantt,
  toD3Force,
  toHtmlReport,
  calculateTraceStatistics,
} from "./visualization"

export type {
  // Visualization format types
  VisualizationFormat,
  VisualizationOutput,
  AnyVisualizationOutput,
  VisualizationConfig,

  // Mermaid output types
  MermaidFlowchartOutput,
  MermaidSequenceOutput,
  MermaidGanttOutput,

  // D3 output types
  D3ForceOutput,
  D3ForceNode,
  D3ForceLink,
  D3TreeOutput,
  D3TreeNode,
  D3TimelineOutput,
  D3TimelineEvent,

  // Report output types
  HtmlReportOutput,
  JsonSummaryOutput,
  ReportSection,

  // Statistics types
  TraceStatistics,
  GovernanceSummary,
} from "./visualization-types"

export {
  DEFAULT_VISUALIZATION_CONFIG,
  NODE_TYPE_COLORS,
  NODE_STATUS_COLORS,
  EDGE_TYPE_COLORS,
} from "./visualization-types"
