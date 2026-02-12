import type {
  ContextBudgetConfig,
  ContextEntry,
  ContextPriority,
  PendingContext,
  RegisterContextOptions,
} from "./types"
import { contextBudgetArbiter, type ContextBudgetArbiter } from "../context-budget"
import {
  contextLedgerStore,
  configureContextLedgerStore,
} from "../context-ledger/store"

const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const CONTEXT_SEPARATOR = "\n\n---\n\n"
const STABLE_IMMUTABLE_SOURCES = new Set<string>([
  "rules-injector",
  "directory-agents",
  "directory-readme",
  "conditional-rules",
  "context-manifest-injector",
  "repo-overview-injector",
  "claude-code-hooks",
])

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()
  private arbiter: ContextBudgetArbiter
  private ledgerEnabled = false

  constructor(arbiter: ContextBudgetArbiter = contextBudgetArbiter) {
    this.arbiter = arbiter
  }

  /**
   * Configure the context budget
   */
  setBudgetConfig(config: Partial<ContextBudgetConfig>): void {
    this.arbiter.setBudgetConfig(config)
  }

  /**
   * Get the current budget configuration
   */
  getBudgetConfig(): ContextBudgetConfig {
    return this.arbiter.getBudgetConfig()
  }

  configureLedger(config: { enabled: boolean; baseDir?: string }): void {
    this.ledgerEnabled = config.enabled
    configureContextLedgerStore({
      enabled: config.enabled,
      ...(config.baseDir ? { baseDir: config.baseDir } : {}),
    })
  }

  /**
   * Resets session turn budget counters.
   * Called at the beginning of each user turn.
   */
  beginTurn(sessionID: string): void {
    this.arbiter.beginTurn(sessionID)
  }

  register(sessionID: string, options: RegisterContextOptions): void {
    const requestedContent = options.content
    const requestedTokens =
      options.estimatedTokens ??
      (options.metadata?.estimatedTokens as number | undefined)
    const channel = options.channel ?? "messages-transform"
    const priority = options.priority ?? "normal"

    // If the same key already exists, revoke its old budget allocation
    // so the new decide() call gets a fair budget assessment.
    const sessionMap = this.sessions.get(sessionID)
    const key = `${options.source}:${options.id}`
    const existing = sessionMap?.get(key)
    if (existing) {
      const oldTokens = (existing.metadata?.estimatedTokens as number | undefined) ?? 0
      if (oldTokens > 0) {
        this.arbiter.revoke(sessionID, existing.source, channel, oldTokens, existing.priority)
      }
    }

    const decision = this.arbiter.decide({
      sessionID,
      source: options.source,
      channel,
      id: options.id,
      priority,
      content: requestedContent,
      oncePerSession: options.oncePerSession,
      estimatedTokens: requestedTokens,
    })
    if (!decision.accepted) {
      return
    }

    if (!sessionMap) {
      this.sessions.set(sessionID, new Map())
    }

    const entryMap = this.sessions.get(sessionID)!

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: decision.finalContent,
      priority,
      timestamp: Date.now(),
      metadata: {
        ...(options.metadata ?? {}),
        estimatedTokens: decision.finalTokens,
      },
    }

    entryMap.set(key, entry)

    if (this.ledgerEnabled) {
      const immutable =
        typeof options.immutable === "boolean"
          ? options.immutable
          : options.oncePerSession === true || STABLE_IMMUTABLE_SOURCES.has(options.source)

      contextLedgerStore.append({
        sessionID,
        source: options.source,
        content: decision.finalContent,
        immutable,
        metadata: {
          id: options.id,
          priority,
          channel,
          immutable,
          estimatedTokens: decision.finalTokens,
          oncePerSession: options.oncePerSession ?? false,
          kind: "collector-entry",
          ...(options.metadata ?? {}),
        },
      })
    }
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
    const merged = sortedEntries.map((e) => e.content).join(CONTEXT_SEPARATOR)

    return {
      merged,
      entries: sortedEntries,
      hasContent: sortedEntries.length > 0,
    }
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
    this.arbiter.clearSession(sessionID)
  }

  /**
   * Reset once-per-session tracking for a session (e.g., after compaction)
   * Allows once-per-session contexts to be re-injected
   */
  resetOncePerSession(sessionID: string): void {
    this.arbiter.resetOncePerSession(sessionID)
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
