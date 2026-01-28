/**
 * Governance Integration Layer
 *
 * Adapts governance components to work with the Claude Code hooks system.
 * This module bridges the gap between:
 * - GovernanceLedger, ExecutionTracer, BudgetMonitor, ApprovalGate, Checkpoint
 * - PreToolUse, PostToolUse, UserPromptSubmit hooks
 *
 * @see docs/governance-orchestration-design.md Section 3
 */

import { log } from "../../shared/logger"
import type { GovernanceConfig } from "../../config/schema"
import {
  ExecutionTracer,
  getTracerManager,
} from "./tracer"
import type { TraceNodeStatus } from "./tracer-types"
import {
  BudgetMonitor,
  getBudgetMonitorManager,
  type TaskState,
} from "./budget-monitor"
import { getLedgerManager, type GovernanceLedgerWriter } from "./ledger"
import {
  getToolCriticalityRegistry,
  type ToolCriticalityRegistry,
} from "./tool-criticality"
import type { ToolCriticalityMeta } from "./types"
import {
  getCheckpointRegistry,
  type SemanticCheckpointManager,
  type FileSystemAdapter,
} from "./checkpoint"
import type { CheckpointConfig, CreateCheckpointOptions } from "./checkpoint-types"
import * as fs from "node:fs/promises"
import * as nodePath from "node:path"
import { sanitizeInputs, sanitizeOutputs } from "./utils"

/**
 * Default Node.js file system adapter for checkpoints
 */
const defaultFsAdapter: FileSystemAdapter = {
  async readFile(path: string): Promise<string> {
    return fs.readFile(path, "utf-8")
  },
  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const stats = await fs.stat(path)
    return { mtime: stats.mtimeMs, size: stats.size }
  },
  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  },
  async writeFile(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, "utf-8")
  },
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options)
  },
  async readdir(path: string): Promise<string[]> {
    return fs.readdir(path)
  },
  async unlink(path: string): Promise<void> {
    await fs.unlink(path)
  },
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default governance configuration
 */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  enabled: false,
  approval_gate: {
    enabled: true,
    skip_patterns: ["Read", "Glob", "Grep", "LSP", "TodoRead"],
    token_expiry_minutes: 30,
  },
  tracer: {
    enabled: true,
    max_nodes: 1000,
    auto_compress_threshold: 500,
    sanitize_sensitive_data: true,
  },
  budget_monitor: {
    enabled: true,
    warn_threshold: 0.7,
    gc_threshold: 0.85,
    hard_limit: 0.95,
    context_window_size: 200000,
  },
  checkpoint: {
    enabled: false,
    auto_checkpoint_interval: 10,
    max_checkpoints: 5,
    recovery_preference: "balanced",
  },
  ledger: {
    enabled: true,
    retention_days: 30,
  },
}

// ============================================================================
// Session Context
// ============================================================================

/**
 * Governance context for a session
 */
export interface GovernanceSession {
  sessionId: string
  tracer: ExecutionTracer | null
  budgetMonitor: BudgetMonitor | null
  ledger: GovernanceLedgerWriter | null
  checkpointManager: SemanticCheckpointManager | null
  criticalityRegistry: ToolCriticalityRegistry
  config: GovernanceConfig
  /** Active tool trace nodes (toolUseId -> nodeId) */
  activeToolNodes: Map<string, string>
  /** Tool call counter for auto-checkpoint */
  toolCallCount: number
}

/** Session storage */
const sessions = new Map<string, GovernanceSession>()

// ============================================================================
// Session Lifecycle
// ============================================================================

/**
 * Initialize governance session
 */
export function initGovernanceSession(
  sessionId: string,
  cwd: string,
  config?: Partial<GovernanceConfig>
): GovernanceSession {
  const mergedConfig: GovernanceConfig = {
    ...DEFAULT_GOVERNANCE_CONFIG,
    ...config,
    approval_gate: { ...DEFAULT_GOVERNANCE_CONFIG.approval_gate, ...config?.approval_gate },
    tracer: { ...DEFAULT_GOVERNANCE_CONFIG.tracer, ...config?.tracer },
    budget_monitor: { ...DEFAULT_GOVERNANCE_CONFIG.budget_monitor, ...config?.budget_monitor },
    checkpoint: { ...DEFAULT_GOVERNANCE_CONFIG.checkpoint, ...config?.checkpoint },
    ledger: { ...DEFAULT_GOVERNANCE_CONFIG.ledger, ...config?.ledger },
  }

  if (!mergedConfig.enabled) {
    // Return minimal session for disabled governance
    const session: GovernanceSession = {
      sessionId,
      tracer: null,
      budgetMonitor: null,
      ledger: null,
      checkpointManager: null,
      criticalityRegistry: getToolCriticalityRegistry(),
      config: mergedConfig,
      activeToolNodes: new Map(),
      toolCallCount: 0,
    }
    sessions.set(sessionId, session)
    return session
  }

  // Initialize components based on config
  const tracerManager = mergedConfig.tracer?.enabled
    ? getTracerManager({
        enabled: true,
        maxNodes: mergedConfig.tracer.max_nodes ?? 1000,
        autoCompressThreshold: mergedConfig.tracer.auto_compress_threshold ?? 500,
        sanitizeSensitiveData: mergedConfig.tracer.sanitize_sensitive_data ?? true,
        compression: {
          mergeThreshold: 5,
          alwaysCritical: ["decision", "checkpoint"],
          lowImpactHooks: ["logger", "metrics", "telemetry"],
          highImpactStateKeys: ["plan", "task", "approval", "error"],
        },
      })
    : null

  const budgetManager = mergedConfig.budget_monitor?.enabled
    ? getBudgetMonitorManager({
        defaultAllocation: mergedConfig.budget_monitor.context_window_size ?? 200000,
        warningThreshold: mergedConfig.budget_monitor.warn_threshold ?? 0.7,
        refactorThreshold: mergedConfig.budget_monitor.gc_threshold ?? 0.85,
        hardLimit: mergedConfig.budget_monitor.hard_limit ?? 0.95,
      })
    : null

  const ledgerManager = mergedConfig.ledger?.enabled
    ? getLedgerManager(mergedConfig.ledger?.base_dir ? { baseDir: mergedConfig.ledger.base_dir } : undefined)
    : null

  const checkpointRegistry = mergedConfig.checkpoint?.enabled
    ? getCheckpointRegistry({ fs: defaultFsAdapter })
    : null

  // Apply custom tool criticality overrides
  const criticalityRegistry = getToolCriticalityRegistry()
  if (mergedConfig.approval_gate?.tool_criticality) {
    for (const tc of mergedConfig.approval_gate.tool_criticality) {
      // Convert config format to runtime format
      const meta: ToolCriticalityMeta = {
        critical: tc.level === "critical" || tc.level === "high",
        reason: tc.reason ?? `Configured as ${tc.level} criticality`,
        category: tc.categories?.[0] as ToolCriticalityMeta["category"] ?? "external",
      }
      criticalityRegistry.register(tc.tool, meta)
    }
  }

  const session: GovernanceSession = {
    sessionId,
    tracer: tracerManager?.getTracer(sessionId) ?? null,
    budgetMonitor: budgetManager?.getMonitor(sessionId) ?? null,
    ledger: ledgerManager?.getLedger(sessionId) ?? null,
    checkpointManager: checkpointRegistry?.getManager(sessionId) ?? null,
    criticalityRegistry,
    config: mergedConfig,
    activeToolNodes: new Map(),
    toolCallCount: 0,
  }

  sessions.set(sessionId, session)
  log(`[governance] Session initialized`, { sessionId, enabled: mergedConfig.enabled })

  return session
}

/**
 * Get governance session (creates if not exists)
 */
export function getGovernanceSession(
  sessionId: string,
  cwd?: string,
  config?: Partial<GovernanceConfig>
): GovernanceSession {
  let session = sessions.get(sessionId)
  if (!session) {
    session = initGovernanceSession(sessionId, cwd ?? process.cwd(), config)
  }
  return session
}

/**
 * Check if session exists
 */
export function hasGovernanceSession(sessionId: string): boolean {
  return sessions.has(sessionId)
}

/**
 * Clean up session
 */
export function cleanupGovernanceSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    // Finalize tracer
    if (session.tracer) {
      session.tracer.finalize()
    }
    sessions.delete(sessionId)
    log(`[governance] Session cleaned up`, { sessionId })
  }
}

// ============================================================================
// Pre-Tool Hook Integration
// ============================================================================

export interface PreToolGovernanceInput {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string
  cwd: string
  /** Governance config from user settings */
  config?: Partial<GovernanceConfig>
}

export interface PreToolGovernanceResult {
  /** Whether to proceed with tool execution */
  proceed: boolean
  /** Reason if blocked */
  reason?: string
  /** Modified input if changed */
  modifiedInput?: Record<string, unknown>
  /** Message to inject */
  message?: string
  /** Trace node ID (for debugging/observability) */
  traceNodeId?: string
}

/**
 * Execute pre-tool governance checks
 */
export function executePreToolGovernance(
  input: PreToolGovernanceInput
): PreToolGovernanceResult {
  const session = getGovernanceSession(input.sessionId, input.cwd, input.config)

  if (!session.config.enabled) {
    return { proceed: true }
  }

  const result: PreToolGovernanceResult = {
    proceed: true,
  }

  // 1. Start tracer node
  if (session.tracer) {
    const nodeId = session.tracer.startNode({
      name: input.toolName,
      type: "tool",
      inputs: sanitizeInputs(input.toolInput, session.config.tracer?.sanitize_sensitive_data ?? true),
    })
    result.traceNodeId = nodeId

    if (input.toolUseId) {
      session.activeToolNodes.set(input.toolUseId, nodeId)
    }
  }

  // 2. Log to ledger (with actual budget status if available)
  if (session.ledger && session.budgetMonitor) {
    const status = session.budgetMonitor.getStatus()
    // Only log budget events when approaching thresholds
    if (status.phase !== "healthy") {
      session.ledger.logBudgetEvent({
        subtype: status.phase === "critical" ? "warning" : "warning",
        budgetState: {
          consumed: status.consumed,
          allocated: status.allocated,
          percentage: status.percentage,
        },
        actionTaken: `Pre-tool check: ${input.toolName}`,
      })
    }
  }

  // 3. Increment tool call counter for auto-checkpoint
  session.toolCallCount++

  return result
}

// ============================================================================
// Post-Tool Hook Integration
// ============================================================================

export interface PostToolGovernanceInput {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: Record<string, unknown>
  toolUseId?: string
  success: boolean
  durationMs?: number
  tokensUsed?: number
  cwd: string
  /** Governance config from user settings */
  config?: Partial<GovernanceConfig>
}

export interface PostToolGovernanceResult {
  /** Whether to block further execution */
  block: boolean
  /** Warning messages */
  warnings: string[]
  /** System message to inject */
  systemMessage?: string
  /** Whether auto-checkpoint was triggered */
  checkpointCreated: boolean
}

/**
 * Execute post-tool governance actions
 */
export async function executePostToolGovernance(
  input: PostToolGovernanceInput
): Promise<PostToolGovernanceResult> {
  // Use existing session or create with config
  const session = sessions.get(input.sessionId)
    ?? getGovernanceSession(input.sessionId, input.cwd, input.config)

  if (!session.config.enabled) {
    return { block: false, warnings: [], checkpointCreated: false }
  }

  const result: PostToolGovernanceResult = {
    block: false,
    warnings: [],
    checkpointCreated: false,
  }

  // 1. End tracer node
  if (session.tracer && input.toolUseId) {
    const nodeId = session.activeToolNodes.get(input.toolUseId)
    if (nodeId) {
      const status: TraceNodeStatus = input.success ? "completed" : "failed"
      session.tracer.endNode(nodeId, {
        outputs: sanitizeOutputs(input.toolOutput, session.config.tracer?.sanitize_sensitive_data ?? true),
        status,
        resources: {
          tokensUsed: input.tokensUsed,
        },
      })
      session.activeToolNodes.delete(input.toolUseId)
    }
  }

  // 2. Update budget monitor
  if (session.budgetMonitor && input.tokensUsed) {
    await session.budgetMonitor.recordConsumption(input.tokensUsed)

    const status = session.budgetMonitor.getStatus()
    // Map phases: "healthy" | "midpoint" | "wrapUp" | "critical"
    if (status.phase === "midpoint" || status.phase === "wrapUp") {
      result.warnings.push(
        `Budget ${status.phase}: ${Math.round(status.percentage * 100)}% used, ~${status.estimatedSteps} steps remaining`
      )
    }

    if (status.phase === "critical") {
      result.block = true
      result.systemMessage = `<budget-exhausted>
Budget exhausted (${Math.round(status.percentage * 100)}% used).
Current task should be wrapped up immediately.
Consider creating a checkpoint and suggesting session fork.
</budget-exhausted>`
    }
  }

  // 3. Auto-checkpoint if interval reached
  if (
    session.checkpointManager &&
    session.config.checkpoint?.enabled &&
    session.config.checkpoint.auto_checkpoint_interval
  ) {
    const interval = session.config.checkpoint.auto_checkpoint_interval
    if (session.toolCallCount % interval === 0) {
      try {
        const checkpointOptions: CreateCheckpointOptions = {
          taskDescription: `Auto-checkpoint at tool call ${session.toolCallCount}`,
          files: [], // Could track modified files if available
          initialPhase: "execution",
        }
        await session.checkpointManager.createCheckpoint(checkpointOptions)
        result.checkpointCreated = true
        log(`[governance] Auto-checkpoint created`, {
          sessionId: input.sessionId,
          toolCallCount: session.toolCallCount,
        })
      } catch (err) {
        log(`[governance] Auto-checkpoint failed`, {
          sessionId: input.sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // 4. Log to ledger with actual budget status
  if (session.ledger && session.budgetMonitor) {
    const status = session.budgetMonitor.getStatus()
    // Only log budget events when approaching thresholds
    if (status.phase !== "healthy") {
      session.ledger.logBudgetEvent({
        subtype: status.phase === "critical" ? "exhausted" : "warning",
        budgetState: {
          consumed: status.consumed,
          allocated: status.allocated,
          percentage: status.percentage,
        },
        actionTaken: `Post-tool: ${input.toolName}`,
        tokensFreed: 0,
      })
    }
  }

  return result
}

// ============================================================================
// User Prompt Hook Integration
// ============================================================================

export interface UserPromptGovernanceInput {
  sessionId: string
  prompt: string
  cwd: string
  estimatedTokens?: number
  /** Governance config from user settings */
  config?: Partial<GovernanceConfig>
}

export interface UserPromptGovernanceResult {
  /** Whether to block the prompt */
  block: boolean
  /** Reason if blocked */
  reason?: string
  /** Messages to inject into context */
  messages: string[]
  /** Budget status message */
  budgetStatus?: string
}

/**
 * Execute user prompt governance checks
 */
export function executeUserPromptGovernance(
  input: UserPromptGovernanceInput
): UserPromptGovernanceResult {
  const session = getGovernanceSession(input.sessionId, input.cwd, input.config)

  if (!session.config.enabled) {
    return { block: false, messages: [] }
  }

  const result: UserPromptGovernanceResult = {
    block: false,
    messages: [],
  }

  // 1. Record prompt tokens in budget monitor
  if (session.budgetMonitor && input.estimatedTokens) {
    // recordConsumption is async but we don't await here since user prompt
    // governance should be synchronous - the consumption is best-effort tracking
    void session.budgetMonitor.recordConsumption(input.estimatedTokens)

    const status = session.budgetMonitor.getStatus()

    // Generate hidden budget message (never raw tokens)
    // Map phases: "healthy" | "midpoint" | "wrapUp" | "critical"
    if (status.phase !== "healthy") {
      result.budgetStatus = `<budget-reminder>
Estimated steps remaining: ${status.estimatedSteps}
Phase: ${status.phase}
Tip: Focus on completing current task.
</budget-reminder>`
      result.messages.push(result.budgetStatus)
    }
  }

  // 2. Log to ledger with actual budget status
  if (session.ledger && session.budgetMonitor) {
    const status = session.budgetMonitor.getStatus()
    // Only log budget events when approaching thresholds
    if (status.phase !== "healthy") {
      session.ledger.logBudgetEvent({
        subtype: "warning",
        budgetState: {
          consumed: status.consumed,
          allocated: status.allocated,
          percentage: status.percentage,
        },
        actionTaken: "User prompt received",
      })
    }
  }

  return result
}

