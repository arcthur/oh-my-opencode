/**
 * Budget Monitor
 *
 * Circuit breaker for token budget management.
 * Implements two-phase refactoring: GC at 70%, Fork at 90%.
 *
 * Key design principle: Hidden Budget Strategy
 * - Never expose raw token counts to LLM
 * - Use "estimated steps" and qualitative phases instead
 * - Prevents "terminal hallucination" anxiety behavior
 *
 * @see docs/governance-orchestration-design.md Section 2.6
 */

import { EventEmitter } from "node:events"
import type {
  TokenBudget,
  BudgetStatus,
  BudgetPhase,
  BudgetMonitorEvent,
  BudgetMonitorConfig,
  GCTarget,
  GCResult,
  ContextSummary,
  CriticalContext,
  ForkResult,
  TransferManifest,
} from "./budget-types"
import {
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_BUDGET_THRESHOLDS,
  ALWAYS_PRESERVE,
  PHASE_DESCRIPTIONS,
  generateConvergenceHint,
  BudgetExhaustedError,
  SessionForkRequiredError,
} from "./budget-types"
import type { BudgetEvent } from "./types"
import { peekLedgerManager } from "./ledger"

// ============================================================================
// Refactor Strategy Interface
// ============================================================================

/**
 * Strategy interface for context refactoring
 * Implementations can use LLM or rule-based approaches
 */
export interface RefactorStrategy {
  /**
   * Generate compressed context summary
   */
  generateSummary(state: TaskState): Promise<ContextSummary>

  /**
   * Determine what to carry forward
   */
  selectCriticalContext(summary: ContextSummary): CriticalContext

  /**
   * Create new session with compressed context
   */
  forkSession(context: CriticalContext, remainingBudget: number): Promise<ForkResult>
}

/**
 * Task state for refactoring
 */
export interface TaskState {
  /** Task description */
  taskDescription: string

  /** Session ID */
  sessionId: string

  /** Modified files */
  modifiedFiles: Array<{
    path: string
    changeType: "created" | "modified" | "deleted"
  }>

  /** Recent actions (last N) */
  recentActions: string[]

  /** Current progress estimate (0-100) */
  progressEstimate: number

  /** Any blockers */
  blockers: string[]
}

/**
 * Garbage collector interface
 */
export interface GarbageCollector {
  /**
   * Collect garbage from context
   */
  collect(targets: GCTarget[]): Promise<GCResult>

  /**
   * Get estimated token count for an item type
   */
  estimateTokens(type: GCTarget["type"]): number
}

// ============================================================================
// Budget Monitor
// ============================================================================

type BudgetEventHandler = (event: BudgetMonitorEvent) => void

/**
 * Budget Monitor
 *
 * Tracks token consumption and triggers circuit breaker actions:
 * - Phase 1 (70%): Garbage Collection
 * - Phase 2 (90%): Session Fork
 */
export class BudgetMonitor extends EventEmitter {
  private budget: TokenBudget
  private config: BudgetMonitorConfig
  private stepCount: number = 0
  private gcTriggered: boolean = false
  private forkTriggered: boolean = false
  private sessionId: string
  private garbageCollector?: GarbageCollector
  private refactorStrategy?: RefactorStrategy
  private taskState?: TaskState

  constructor(
    sessionId: string,
    options: {
      allocated?: number
      config?: Partial<BudgetMonitorConfig>
      garbageCollector?: GarbageCollector
      refactorStrategy?: RefactorStrategy
    } = {}
  ) {
    super()
    this.sessionId = sessionId
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...options.config }
    this.garbageCollector = options.garbageCollector
    this.refactorStrategy = options.refactorStrategy

    this.budget = {
      allocated: options.allocated ?? this.config.defaultAllocation,
      consumed: 0,
      warningThreshold: this.config.warningThreshold,
      refactorThreshold: this.config.refactorThreshold,
      hardLimit: this.config.hardLimit,
    }
  }

  // ===========================================================================
  // Core API
  // ===========================================================================

  /**
   * Record token consumption
   */
  async recordConsumption(tokens: number): Promise<void> {
    this.budget.consumed += tokens
    this.stepCount++

    const percentage = this.getPercentage()

    // Emit consumption event
    this.emitEvent({
      type: "consumption",
      amount: tokens,
      total: this.budget.consumed,
      percentage,
    })

    // Note: Ledger logging for consumption/exhausted is handled by integration.ts
    // to include tool name and traceNodeId correlation. Only GC events are logged here.

    // Check thresholds
    if (percentage >= this.budget.hardLimit) {
      this.emitEvent({
        type: "hard-limit-reached",
        consumed: this.budget.consumed,
        allocated: this.budget.allocated,
      })

      throw new BudgetExhaustedError(
        "Token budget exhausted",
        this.budget.consumed,
        this.budget.allocated
      )
    }

    if (percentage >= this.budget.refactorThreshold && !this.forkTriggered) {
      await this.triggerRefactor("Budget refactor threshold exceeded")
    } else if (percentage >= this.budget.warningThreshold && !this.gcTriggered) {
      await this.triggerGarbageCollection()
    }
  }

  /**
   * Get current budget status
   */
  getStatus(): BudgetStatus {
    const percentage = this.getPercentage()
    const estimatedSteps = this.estimateRemainingSteps()

    return {
      consumed: this.budget.consumed,
      allocated: this.budget.allocated,
      percentage,
      remaining: this.budget.allocated - this.budget.consumed,
      phase: this.getPhase(percentage),
      estimatedSteps,
    }
  }

  /**
   * Get convergence hint for LLM (hidden budget)
   */
  getConvergenceHint(): string | null {
    const status = this.getStatus()

    if (status.phase === "healthy") {
      return null
    }

    return generateConvergenceHint(status.phase, status.estimatedSteps)
  }

  /**
   * Check if hint should be injected
   */
  shouldInjectHint(): boolean {
    const percentage = this.getPercentage()
    return percentage >= this.budget.warningThreshold
  }

  /**
   * Set task state for refactoring
   */
  setTaskState(state: TaskState): void {
    this.taskState = state
  }

  /**
   * Update budget allocation
   */
  updateAllocation(newAllocation: number): void {
    this.budget.allocated = newAllocation
  }

  /**
   * Reset consumption (for new task in same session)
   */
  resetConsumption(): void {
    this.budget.consumed = 0
    this.stepCount = 0
    this.gcTriggered = false
    this.forkTriggered = false
  }

  /**
   * Get raw budget (for advanced use cases)
   */
  getBudget(): Readonly<TokenBudget> {
    return { ...this.budget }
  }

  // ===========================================================================
  // Phase 1: Garbage Collection
  // ===========================================================================

  /**
   * Trigger garbage collection with degradation strategy
   *
   * Strategy:
   * 1. If GC collector is configured, attempt collection
   * 2. If GC fails or no collector, degrade to convergence hint injection
   * 3. Log degradation event for auditing
   */
  private async triggerGarbageCollection(): Promise<GCResult> {
    this.gcTriggered = true
    const percentage = this.getPercentage()

    this.emitEvent({
      type: "gc-triggered",
      percentage,
      reason: "Warning threshold reached",
    })

    this.logToLedger("gc-triggered", { percentage })

    // No collector configured - degrade to hint-only mode
    if (!this.garbageCollector) {
      this.emitEvent({
        type: "gc-degraded",
        percentage,
        reason: "no_collector_configured",
        message: "GC degraded to hint-only mode (no collector configured)",
      })

      this.logToLedger("gc-degraded", {
        percentage,
        reason: "no_collector_configured",
        fallback: "hint_injection",
      })

      // Inject convergence hint as fallback
      return {
        freedTokens: 0,
        removedItems: [],
        preservedItems: [...this.config.preserveItems],
        timestamp: Date.now(),
        degraded: true,
        degradeReason: "no_collector_configured",
      }
    }

    // Attempt GC with error handling
    try {
      const result = await this.garbageCollector.collect(this.config.gcTargets)

      // Check if GC was effective
      if (result.freedTokens === 0) {
        this.emitEvent({
          type: "warning",
          percentage,
          remaining: this.budget.allocated - this.budget.consumed,
          phase: this.getPhase(percentage),
          estimatedSteps: this.estimateRemainingSteps(),
        })

        this.logToLedger("gc-ineffective", {
          percentage,
          reason: "no_tokens_freed",
        })
      }

      // Update consumed tokens
      this.budget.consumed = Math.max(0, this.budget.consumed - result.freedTokens)

      this.logToLedger("gc-completed", {
        freedTokens: result.freedTokens,
        removedCount: result.removedItems.reduce((sum, item) => sum + item.count, 0),
      })

      return result
    } catch (error) {
      // GC failed - degrade to hint-only mode
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      this.emitEvent({
        type: "gc-degraded",
        percentage,
        reason: "gc_execution_failed",
        message: `GC failed, degraded to hint-only mode: ${errorMessage}`,
      })

      this.logToLedger("gc-degraded", {
        percentage,
        reason: "gc_execution_failed",
        error: errorMessage,
        fallback: "hint_injection",
      })

      return {
        freedTokens: 0,
        removedItems: [],
        preservedItems: [...this.config.preserveItems],
        timestamp: Date.now(),
        degraded: true,
        degradeReason: `gc_failed: ${errorMessage}`,
      }
    }
  }

  /**
   * Manually trigger GC
   */
  async forceGarbageCollection(): Promise<GCResult> {
    return this.triggerGarbageCollection()
  }

  // ===========================================================================
  // Phase 2: Session Fork
  // ===========================================================================

  /**
   * Trigger context refactoring (session fork)
   */
  private async triggerRefactor(reason: string): Promise<void> {
    this.forkTriggered = true
    const percentage = this.getPercentage()

    this.emitEvent({
      type: "refactor-triggered",
      percentage,
      reason,
    })

    this.logToLedger("fork-triggered", { percentage, reason })

    if (!this.config.autoFork) {
      // Auto-fork disabled - just emit event
      return
    }

    if (!this.refactorStrategy || !this.taskState) {
      // No strategy configured - can't fork
      return
    }

    // Generate context summary
    const summary = await this.refactorStrategy.generateSummary(this.taskState)

    // Select critical context
    const criticalContext = this.refactorStrategy.selectCriticalContext(summary)

    // Calculate remaining budget for new session (30% of original)
    const remainingBudget = Math.floor(this.budget.allocated * 0.3)

    // Create transfer manifest
    const manifest: TransferManifest = {
      progressPercentage: this.taskState.progressEstimate,
      completedMilestones: summary.keyDecisions.map((d) => d.decision),
      remainingWork: summary.remainingTasks,
      criticalContext: {
        keyDecisions: summary.keyDecisions.map((d) => `${d.decision}: ${d.rationale}`),
        currentState: summary.progressSummary,
        blockers: summary.blockers,
      },
      essentialFiles: Array.from(criticalContext.essentialFiles.keys()),
      timestamp: Date.now(),
      originalSessionId: this.sessionId,
    }

    // Throw to signal fork required
    throw new SessionForkRequiredError(
      "Session fork required due to budget threshold",
      manifest,
      criticalContext
    )
  }

  /**
   * Manually trigger session fork
   */
  async forceSessionFork(): Promise<ForkResult> {
    if (!this.refactorStrategy || !this.taskState) {
      throw new Error("RefactorStrategy and TaskState must be configured for fork")
    }

    const summary = await this.refactorStrategy.generateSummary(this.taskState)
    const criticalContext = this.refactorStrategy.selectCriticalContext(summary)
    const remainingBudget = Math.floor(this.budget.allocated * 0.3)

    return this.refactorStrategy.forkSession(criticalContext, remainingBudget)
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private getPercentage(): number {
    return this.budget.consumed / this.budget.allocated
  }

  private getPhase(percentage: number): BudgetPhase {
    if (percentage >= this.budget.refactorThreshold) return "critical"
    if (percentage >= this.budget.warningThreshold) return "wrapUp"
    if (percentage >= 0.5) return "midpoint"
    return "healthy"
  }

  private estimateRemainingSteps(): number {
    if (this.stepCount <= 0 || this.budget.consumed <= 0) return 0

    const avgStepCost = this.budget.consumed / this.stepCount
    if (avgStepCost <= 0) return 0

    const remainingTokens = Math.max(0, this.budget.allocated - this.budget.consumed)
    return Math.floor(remainingTokens / avgStepCost)
  }

  private emitEvent(event: BudgetMonitorEvent): void {
    this.emit(event.type, event)
    this.emit("budget-event", event)
  }

  private logToLedger(subtype: BudgetEvent["subtype"], data: Record<string, unknown>): void {
    try {
      const manager = peekLedgerManager()
      if (!manager?.hasLoadedLedger(this.sessionId)) return
      const ledger = manager.getLedger(this.sessionId)
      const percentage = this.getPercentage()

      ledger.logBudgetEvent({
        subtype,
        budgetState: {
          consumed: this.budget.consumed,
          allocated: this.budget.allocated,
          percentage,
        },
        actionTaken: subtype,
        tokensFreed: typeof data.freedTokens === "number" ? data.freedTokens : undefined,
      })
    } catch {
      // Ledger may not be initialized - ignore
    }
  }
}

// ============================================================================
// Default Refactor Strategy (Stub)
// ============================================================================

/**
 * Simple rule-based refactor strategy (no LLM required)
 * For production use, implement with LLM for better summaries
 */
export class SimpleRefactorStrategy implements RefactorStrategy {
  async generateSummary(state: TaskState): Promise<ContextSummary> {
    return {
      progressSummary: `Task "${state.taskDescription}" is approximately ${state.progressEstimate}% complete.`,
      keyDecisions: [],
      fileChanges: state.modifiedFiles.map((f) => ({
        path: f.path,
        changeType: f.changeType,
        summary: `File ${f.changeType}`,
      })),
      remainingTasks: [],
      blockers: state.blockers,
    }
  }

  selectCriticalContext(summary: ContextSummary): CriticalContext {
    const nextAction =
      summary.blockers.length > 0
        ? `Resolve blocker: ${summary.blockers[0]}`
        : summary.remainingTasks.length > 0
          ? summary.remainingTasks[0]
          : "Complete the task"

    return {
      summary: summary.progressSummary,
      essentialFiles: new Map(),
      nextAction,
    }
  }

  async forkSession(context: CriticalContext, remainingBudget: number): Promise<ForkResult> {
    const newSessionId = `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

    // Calculate estimated steps (hidden budget principle - never expose raw tokens)
    const estimatedSteps = Math.floor(remainingBudget / 2000) // Rough estimate: ~2k tokens per step

    const handoffPrompt = `
Continue from checkpoint. Context:

${context.summary}

Essential files carried forward:
${context.essentialFiles.size > 0 ? Array.from(context.essentialFiles.keys()).join(", ") : "None"}

Next action: ${context.nextAction}

Note: This is a continuation session. Focus on completing the remaining work efficiently.
Estimated capacity: approximately ${estimatedSteps} more actions available.
`.trim()

    return {
      newSessionId,
      manifest: {
        progressPercentage: 0,
        completedMilestones: [],
        remainingWork: [context.nextAction],
        criticalContext: {
          keyDecisions: [],
          currentState: context.summary,
          blockers: [],
        },
        essentialFiles: Array.from(context.essentialFiles.keys()),
        timestamp: Date.now(),
        originalSessionId: "unknown",
      },
      handoffPrompt,
      newBudget: {
        allocated: remainingBudget,
        consumed: 0,
        ...DEFAULT_BUDGET_THRESHOLDS,
      },
    }
  }
}

// ============================================================================
// Manager (Multi-session)
// ============================================================================

/**
 * Manages budget monitors across multiple sessions
 */
export class BudgetMonitorManager {
  private monitors = new Map<string, BudgetMonitor>()
  private config: Partial<BudgetMonitorConfig>

  constructor(config: Partial<BudgetMonitorConfig> = {}) {
    this.config = config
  }

  /**
   * Get or create monitor for session
   */
  getMonitor(
    sessionId: string,
    options?: {
      allocated?: number
      garbageCollector?: GarbageCollector
      refactorStrategy?: RefactorStrategy
    }
  ): BudgetMonitor {
    let monitor = this.monitors.get(sessionId)
    if (!monitor) {
      monitor = new BudgetMonitor(sessionId, {
        ...options,
        config: this.config,
      })
      this.monitors.set(sessionId, monitor)
    }
    return monitor
  }

  /**
   * Check if session has monitor
   */
  hasMonitor(sessionId: string): boolean {
    return this.monitors.has(sessionId)
  }

  /**
   * Remove monitor for session
   */
  removeMonitor(sessionId: string): boolean {
    return this.monitors.delete(sessionId)
  }

  /**
   * List all sessions
   */
  listSessions(): string[] {
    return Array.from(this.monitors.keys())
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalManager: BudgetMonitorManager | undefined

/**
 * Get global budget monitor manager
 */
export function getBudgetMonitorManager(config?: Partial<BudgetMonitorConfig>): BudgetMonitorManager {
  if (!globalManager) {
    globalManager = new BudgetMonitorManager(config)
  }
  return globalManager
}

/**
 * Reset global manager (for testing)
 */
export function resetBudgetMonitorManager(): void {
  globalManager = undefined
}
