import type {
  ContextBudgetConfig,
  ContextEntry,
  ContextPriority,
  PendingContext,
  RegisterContextOptions,
} from "./types"

const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const CONTEXT_SEPARATOR = "\n\n---\n\n"

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()
  private budgetConfig: ContextBudgetConfig = {
    total_budget: 2000,
    overflow_strategy: "drop-low-priority",
  }
  private injectedOnceKeys: Map<string, Set<string>> = new Map()

  /**
   * Configure the context budget
   */
  setBudgetConfig(config: Partial<ContextBudgetConfig>): void {
    this.budgetConfig = { ...this.budgetConfig, ...config }
  }

  /**
   * Get the current budget configuration
   */
  getBudgetConfig(): ContextBudgetConfig {
    return { ...this.budgetConfig }
  }

  register(sessionID: string, options: RegisterContextOptions): void {
    // Check once-per-session constraint
    if (options.oncePerSession) {
      const key = `${options.source}:${options.id}`
      const sessionOnceKeys = this.injectedOnceKeys.get(sessionID)
      if (sessionOnceKeys?.has(key)) {
        return // Already registered for this session
      }
      // Mark as registered for once-per-session
      if (!this.injectedOnceKeys.has(sessionID)) {
        this.injectedOnceKeys.set(sessionID, new Set())
      }
      this.injectedOnceKeys.get(sessionID)!.add(key)
    }

    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Map())
    }

    const sessionMap = this.sessions.get(sessionID)!
    const key = `${options.source}:${options.id}`

    const estimatedTokens =
      options.estimatedTokens ??
      (options.metadata?.estimatedTokens as number | undefined)

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      metadata:
        estimatedTokens === undefined
          ? options.metadata
          : {
              ...options.metadata,
              estimatedTokens,
            },
    }

    sessionMap.set(key, entry)
  }

  getPending(sessionID: string): PendingContext {
    const sessionMap = this.sessions.get(sessionID)

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: "",
        entries: [],
        hasContent: false,
      }
    }

    const sortedEntries = this.sortEntries([...sessionMap.values()])
    const constrainedEntries = this.applyBudgetConstraints(sortedEntries)
    const merged = constrainedEntries.map((e) => e.content).join(CONTEXT_SEPARATOR)

    return {
      merged,
      entries: constrainedEntries,
      hasContent: constrainedEntries.length > 0,
    }
  }

  /**
   * Estimate tokens for a content string (rough: 1 token ≈ 4 chars)
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4)
  }

  /**
   * Truncate content to fit within a token limit
   */
  private truncateToTokens(content: string, maxTokens: number): string {
    const maxChars = maxTokens * 4
    if (content.length <= maxChars) return content
    return content.slice(0, maxChars - 3) + "..."
  }

  /**
   * Apply budget constraints to entries
   */
  private applyBudgetConstraints(entries: ContextEntry[]): ContextEntry[] {
    const { total_budget, source_limits, overflow_strategy } = this.budgetConfig
    let totalTokens = 0
    const result: ContextEntry[] = []

    for (const entry of entries) {
      const tokens = (entry.metadata?.estimatedTokens as number) ?? this.estimateTokens(entry.content)
      const sourceLimit = source_limits?.[entry.source]

      // Check source limit
      let effectiveContent = entry.content
      let effectiveTokens = tokens

      if (sourceLimit && tokens > sourceLimit) {
        const isHighPriority = entry.priority === "critical" || entry.priority === "high"

        // Always keep critical/high by truncating; for others, follow configured strategy.
        if (overflow_strategy === "truncate" || (overflow_strategy === "drop-low-priority" && isHighPriority)) {
          effectiveContent = this.truncateToTokens(entry.content, sourceLimit)
          effectiveTokens = sourceLimit
        } else {
          // drop-low-priority: skip normal/low entries that exceed source limit
          continue
        }
      }

      // Check total budget
      if (totalTokens + effectiveTokens > total_budget) {
        const remaining = total_budget - totalTokens
        const isHighPriority = entry.priority === "critical" || entry.priority === "high"

        if (overflow_strategy === "truncate" || (overflow_strategy === "drop-low-priority" && isHighPriority)) {
          if (remaining > 0) {
            result.push({
              ...entry,
              content: this.truncateToTokens(effectiveContent, remaining),
            })
          }
          break
        }

        // drop-low-priority: skip normal/low entries that don't fit
        continue
      }

      result.push({
        ...entry,
        content: effectiveContent,
      })
      totalTokens += effectiveTokens
    }

    return result
  }

  consume(sessionID: string): PendingContext {
    const pending = this.getPending(sessionID)
    this.clear(sessionID)
    return pending
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  /**
   * Clear all state for a session including once-per-session tracking
   * Use this when a session is deleted
   */
  clearSession(sessionID: string): void {
    this.sessions.delete(sessionID)
    this.injectedOnceKeys.delete(sessionID)
  }

  /**
   * Reset once-per-session tracking for a session (e.g., after compaction)
   * Allows once-per-session contexts to be re-injected
   */
  resetOncePerSession(sessionID: string): void {
    this.injectedOnceKeys.delete(sessionID)
  }

  hasPending(sessionID: string): boolean {
    const sessionMap = this.sessions.get(sessionID)
    return sessionMap !== undefined && sessionMap.size > 0
  }

  private sortEntries(entries: ContextEntry[]): ContextEntry[] {
    return entries.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.timestamp - b.timestamp
    })
  }
}

export const contextCollector = new ContextCollector()
