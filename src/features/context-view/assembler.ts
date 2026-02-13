import { log } from "../../shared"
import type {
  BudgetDecision,
  BudgetDecisionReason,
  BudgetPriority,
  BudgetRequest,
  ContextBudgetConfig,
  ContextChannel,
} from "./types"

const CHARS_PER_TOKEN = 4

interface SessionTurnUsage {
  totalTokens: number
  normalLowTokens: number
  sourceTokens: Map<string, number>
  channelTokens: Map<ContextChannel, number>
}

function createEmptyUsage(): SessionTurnUsage {
  return {
    totalTokens: 0,
    normalLowTokens: 0,
    sourceTokens: new Map(),
    channelTokens: new Map(),
  }
}

const DEFAULT_BUDGET_CONFIG: ContextBudgetConfig = {
  total_budget: 2000,
  reserved_budget: 400,
  overflow_strategy: "drop-low-priority",
}

export class ContextViewAssembler {
  private budgetConfig: ContextBudgetConfig = { ...DEFAULT_BUDGET_CONFIG }
  private sessionTurnUsage = new Map<string, SessionTurnUsage>()
  private onceKeysBySession = new Map<string, Set<string>>()

  setBudgetConfig(config: Partial<ContextBudgetConfig>): void {
    const nextTotal = config.total_budget ?? this.budgetConfig.total_budget
    const nextReservedRaw = config.reserved_budget ?? this.budgetConfig.reserved_budget
    const nextReserved = Math.max(0, Math.min(nextReservedRaw, nextTotal))

    this.budgetConfig = {
      ...this.budgetConfig,
      ...config,
      reserved_budget: nextReserved,
      source_limits: config.source_limits
        ? {
            ...(this.budgetConfig.source_limits ?? {}),
            ...config.source_limits,
          }
        : this.budgetConfig.source_limits,
      channel_limits: config.channel_limits
        ? {
            ...(this.budgetConfig.channel_limits ?? {}),
            ...config.channel_limits,
          }
        : this.budgetConfig.channel_limits,
    }
  }

  getBudgetConfig(): ContextBudgetConfig {
    return {
      ...this.budgetConfig,
      source_limits: this.budgetConfig.source_limits
        ? { ...this.budgetConfig.source_limits }
        : undefined,
      channel_limits: this.budgetConfig.channel_limits
        ? { ...this.budgetConfig.channel_limits }
        : undefined,
    }
  }

  /**
   * Resets per-turn usage counters for the given session.
   * Must be called once at the start of each user turn (before any hooks run)
   * so that per-turn budget limits restart from zero.  Hooks that call
   * `decide()` before `beginTurn()` will lazily initialise a fresh usage
   * record, so ordering is safe—but budget accounting will be most accurate
   * when `beginTurn()` is the first call in a turn.
   */
  beginTurn(sessionID: string): void {
    this.sessionTurnUsage.set(sessionID, createEmptyUsage())
  }

  clearSession(sessionID: string): void {
    this.sessionTurnUsage.delete(sessionID)
    this.onceKeysBySession.delete(sessionID)
  }

  resetOncePerSession(sessionID: string): void {
    this.onceKeysBySession.delete(sessionID)
  }

  /**
   * Return previously counted tokens back to the budget.
   * Used when a registered entry is overwritten (e.g. ContextCollector
   * re-register with same key) so the old allocation is freed.
   */
  revoke(
    sessionID: string,
    source: string,
    channel: ContextChannel,
    tokens: number,
    priority: BudgetPriority
  ): void {
    const usage = this.sessionTurnUsage.get(sessionID)
    if (!usage || tokens <= 0) return
    usage.totalTokens = Math.max(0, usage.totalTokens - tokens)
    usage.sourceTokens.set(
      source,
      Math.max(0, (usage.sourceTokens.get(source) ?? 0) - tokens)
    )
    usage.channelTokens.set(
      channel,
      Math.max(0, (usage.channelTokens.get(channel) ?? 0) - tokens)
    )
    if (!this.isHighPriority(priority)) {
      usage.normalLowTokens = Math.max(0, usage.normalLowTokens - tokens)
    }
  }

  /**
   * Test-only reset helper for shared singleton state.
   */
  resetForTesting(): void {
    this.budgetConfig = { ...DEFAULT_BUDGET_CONFIG }
    this.sessionTurnUsage.clear()
    this.onceKeysBySession.clear()
  }

  decide(request: BudgetRequest): BudgetDecision {
    if (!request.content) {
      return {
        accepted: false,
        finalContent: "",
        finalTokens: 0,
        reason: "dropped_total",
      }
    }

    if (request.oncePerSession) {
      const onceKey = `${request.source}:${request.id}`
      const onceSet = this.getOrCreateOnceSet(request.sessionID)
      if (onceSet.has(onceKey)) {
        const decision: BudgetDecision = {
          accepted: false,
          finalContent: "",
          finalTokens: 0,
          reason: "once_per_session",
        }
        this.logBudgetDecision(request, decision, this.estimateTokens(request.content), 0)
        return decision
      }
    }

    const usage = this.getOrCreateTurnUsage(request.sessionID)
    const config = this.budgetConfig
    const requestedTokens = Math.max(
      0,
      request.estimatedTokens ?? this.estimateTokens(request.content)
    )

    const sourceUsed = usage.sourceTokens.get(request.source) ?? 0
    const channelUsed = usage.channelTokens.get(request.channel) ?? 0

    const sourceLimit = config.source_limits?.[request.source]
    const channelLimit = config.channel_limits?.[request.channel]

    const sourceRemaining =
      sourceLimit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, sourceLimit - sourceUsed)
    const channelRemaining =
      channelLimit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, channelLimit - channelUsed)

    const totalRemaining = Math.max(0, config.total_budget - usage.totalTokens)
    const normalCap = Math.max(0, config.total_budget - config.reserved_budget)
    const normalRemaining = Math.max(0, normalCap - usage.normalLowTokens)
    const isHighPriority = this.isHighPriority(request.priority)
    const budgetRemainingForPriority = isHighPriority ? totalRemaining : Math.min(totalRemaining, normalRemaining)

    const allowedTokens = Math.max(
      0,
      Math.min(budgetRemainingForPriority, sourceRemaining, channelRemaining)
    )

    const limitingReason = this.getLimitingReason({
      budgetRemainingForPriority,
      sourceRemaining,
      channelRemaining,
    })

    if (requestedTokens <= allowedTokens) {
      const accepted: BudgetDecision = {
        accepted: true,
        finalContent: request.content,
        finalTokens: requestedTokens,
        reason: "accepted",
      }
      this.markAccepted(request, accepted, usage)
      return accepted
    }

    const shouldTruncate =
      allowedTokens > 0 &&
      (config.overflow_strategy === "truncate" || isHighPriority)

    if (shouldTruncate) {
      const truncated: BudgetDecision = {
        accepted: true,
        finalContent: this.truncateToTokens(request.content, allowedTokens),
        finalTokens: allowedTokens,
        reason: "truncated",
      }
      this.markAccepted(request, truncated, usage)
      this.logBudgetDecision(request, truncated, requestedTokens, allowedTokens)
      return truncated
    }

    const rejected: BudgetDecision = {
      accepted: false,
      finalContent: "",
      finalTokens: 0,
      reason: limitingReason,
    }
    this.logBudgetDecision(request, rejected, requestedTokens, allowedTokens)
    return rejected
  }

  private markAccepted(
    request: BudgetRequest,
    decision: BudgetDecision,
    usage: SessionTurnUsage
  ): void {
    usage.totalTokens += decision.finalTokens
    usage.sourceTokens.set(
      request.source,
      (usage.sourceTokens.get(request.source) ?? 0) + decision.finalTokens
    )
    usage.channelTokens.set(
      request.channel,
      (usage.channelTokens.get(request.channel) ?? 0) + decision.finalTokens
    )
    if (!this.isHighPriority(request.priority)) {
      usage.normalLowTokens += decision.finalTokens
    }

    if (request.oncePerSession) {
      const onceKey = `${request.source}:${request.id}`
      this.getOrCreateOnceSet(request.sessionID).add(onceKey)
    }
  }

  private getOrCreateTurnUsage(sessionID: string): SessionTurnUsage {
    let usage = this.sessionTurnUsage.get(sessionID)
    if (!usage) {
      usage = createEmptyUsage()
      this.sessionTurnUsage.set(sessionID, usage)
    }
    return usage
  }

  private getOrCreateOnceSet(sessionID: string): Set<string> {
    let onceSet = this.onceKeysBySession.get(sessionID)
    if (!onceSet) {
      onceSet = new Set<string>()
      this.onceKeysBySession.set(sessionID, onceSet)
    }
    return onceSet
  }

  private isHighPriority(priority: BudgetPriority): boolean {
    return priority === "critical" || priority === "high"
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / CHARS_PER_TOKEN)
  }

  private truncateToTokens(content: string, maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN
    if (content.length <= maxChars) {
      return content
    }
    if (maxChars <= 3) {
      return content.slice(0, Math.max(0, maxChars))
    }
    return `${content.slice(0, maxChars - 3)}...`
  }

  private getLimitingReason(input: {
    budgetRemainingForPriority: number
    sourceRemaining: number
    channelRemaining: number
  }): Exclude<BudgetDecisionReason, "accepted" | "truncated" | "once_per_session"> {
    const { budgetRemainingForPriority, sourceRemaining, channelRemaining } = input
    const min = Math.min(budgetRemainingForPriority, sourceRemaining, channelRemaining)
    if (min === sourceRemaining) return "dropped_source"
    if (min === channelRemaining) return "dropped_channel"
    return "dropped_total"
  }

  private logBudgetDecision(
    request: BudgetRequest,
    decision: BudgetDecision,
    requestedTokens: number,
    allowedTokens: number
  ): void {
    if (decision.accepted && decision.reason !== "truncated") {
      return
    }
    log("[context-view] decision", {
      sessionID: request.sessionID,
      source: request.source,
      channel: request.channel,
      id: request.id,
      priority: request.priority,
      accepted: decision.accepted,
      reason: decision.reason,
      requestedTokens,
      finalTokens: decision.finalTokens,
      allowedTokens,
    })
  }
}

export const contextViewAssembler = new ContextViewAssembler()

// Transitional aliases while migrating callsites to context-view naming.
export class ContextBudgetArbiter extends ContextViewAssembler {}
export const contextBudgetArbiter = contextViewAssembler
