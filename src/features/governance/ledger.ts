/**
 * Governance Ledger
 *
 * An immutable audit log for all governance-significant events.
 * Provides traceability, diagnostics, and integrity verification.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, unlinkSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import type {
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
  PolicyDecisionEvent,
  PolicyOutcomeEvent,
} from "./types"
import { log } from "../../shared/logger"
import { generateId } from "./utils"
import { getGovernanceLedgerDir } from "./storage-paths"

/**
 * Compute SHA-256 hash of an entry
 */
function computeHash(entry: LedgerEntry): string {
  const content = JSON.stringify(entry)
  return createHash("sha256").update(content).digest("hex").substring(0, 16)
}

/**
 * Ledger storage configuration
 */
export interface LedgerStorageConfig {
  /** Base directory for ledger files */
  baseDir: string

  /** Maximum age in days before cleanup */
  maxAgeDays?: number

  /** Maximum number of ledgers to keep */
  maxCount?: number

  /** Preserve ledgers with unresolved errors */
  preserveErrors?: boolean
}

function getDefaultStorageConfig(): LedgerStorageConfig {
  return {
    baseDir: getGovernanceLedgerDir(),
    maxAgeDays: 30,
    maxCount: 100,
    preserveErrors: true,
  }
}

/**
 * Governance Ledger Writer
 *
 * Manages an append-only audit log with integrity guarantees.
 */
export class GovernanceLedgerWriter {
  private ledger: GovernanceLedger
  private lastHash: string = "genesis"
  private storageConfig: LedgerStorageConfig
  private filePath: string

  constructor(sessionId: string, storageConfig: Partial<LedgerStorageConfig> = {}) {
    this.storageConfig = { ...getDefaultStorageConfig(), ...storageConfig }
    this.filePath = join(this.storageConfig.baseDir, `${sessionId}.jsonl`)

    // Ensure directory exists
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Initialize ledger
    this.ledger = {
      ledgerId: generateId(),
      sessionId,
      createdAt: Date.now(),
      entries: [],
      integrityChain: [],
    }

    // Load existing entries if file exists
    if (existsSync(this.filePath)) {
      this.loadFromFile()
    } else {
      // Write header
      this.writeHeader()
    }
  }

  /**
   * Append an entry to the ledger (immutable)
   */
  append<T extends LedgerEntry>(
    entry: Omit<T, "id" | "timestamp" | "previousHash">
  ): LedgerEntry {
    const fullEntry: LedgerEntry = {
      id: generateId(),
      timestamp: Date.now(),
      previousHash: this.lastHash,
      ...entry,
    } as T

    // Compute hash of this entry
    const entryHash = computeHash(fullEntry)

    // Append to ledger
    this.ledger.entries.push(fullEntry)
    this.ledger.integrityChain.push(entryHash)

    // Update last hash for next entry
    this.lastHash = entryHash

    // Persist immediately (append-only)
    this.persistEntry(fullEntry)

    return fullEntry
  }

  // =========================================================================
  // Convenience methods for specific entry types
  // =========================================================================

  /**
   * Log a permission escalation event
   */
  logPermissionEscalation(params: {
    requestor: string
    permission: string
    grantedBy: "user" | "auto-inferred" | "policy"
    rationale: string
  }): LedgerEntry {
    return this.append<PermissionEscalation>({
      type: "permission-escalation",
      ...params,
    })
  }

  /**
   * Log a permission violation event
   */
  logPermissionViolation(params: {
    violator: string
    attemptedAction: string
    blockReason: string
    userNotified: boolean
  }): LedgerEntry {
    return this.append<PermissionViolation>({
      type: "permission-violation",
      ...params,
    })
  }

  /**
   * Log a budget event
   */
  logBudgetEvent(params: {
    subtype: BudgetEvent["subtype"]
    budgetState: BudgetEvent["budgetState"]
    actionTaken: string
    tokensFreed?: number
    tool?: string
    traceNodeId?: string
  }): LedgerEntry {
    return this.append<BudgetEvent>({
      type: "budget-event",
      traceNodeId: params.traceNodeId,
      subtype: params.subtype,
      budgetState: params.budgetState,
      actionTaken: params.actionTaken,
      tokensFreed: params.tokensFreed,
      tool: params.tool,
    })
  }

  /**
   * Log a checkpoint event
   */
  logCheckpointEvent(params: {
    checkpointId: string
    subtype: CheckpointEvent["subtype"]
    reason: string
    trackedFiles: string[]
  }): LedgerEntry {
    return this.append<CheckpointEvent>({
      type: "checkpoint-event",
      ...params,
    })
  }

  /**
   * Log a recovery event
   */
  logRecoveryEvent(params: {
    decision: RecoveryEvent["decision"]
    trigger: RecoveryEvent["trigger"]
    affectedPhases: string[]
  }): LedgerEntry {
    return this.append<RecoveryEvent>({
      type: "recovery-event",
      ...params,
    })
  }

  /**
   * Log an approval event
   */
  logApprovalEvent(params: {
    tool: string
    decision: ApprovalEvent["decision"]
    previewShown: string
    decisionTimeMs: number
  }): LedgerEntry {
    return this.append<ApprovalEvent>({
      type: "approval-event",
      ...params,
    })
  }

  /**
   * Log a state proposal event
   */
  logStateProposal(params: {
    proposalId: string
    submitter: string
    outcome: StateProposalEvent["outcome"]
    target: StateProposalEvent["target"]
    rejectionReason?: string
    traceNodeId?: string
  }): LedgerEntry {
    return this.append<StateProposalEvent>({
      type: "state-proposal",
      traceNodeId: params.traceNodeId,
      ...params,
    })
  }

  /**
   * Log an environment drift event
   */
  logEnvironmentDrift(params: {
    driftType: EnvironmentDriftEvent["driftType"]
    affected: string[]
    impact: EnvironmentDriftEvent["impact"]
    recommendedAction: string
  }): LedgerEntry {
    return this.append<EnvironmentDriftEvent>({
      type: "environment-drift",
      ...params,
    })
  }

  /**
   * Log a policy decision event
   */
  logPolicyDecision(params: {
    policy: PolicyDecisionEvent["policy"]
    sessionId: string
    hookNodeId: string
    toolName?: string
    mutation?: Record<string, unknown>
    message?: string
    traceNodeId?: string
  }): LedgerEntry {
    return this.append<PolicyDecisionEvent>({
      type: "policy-decision",
      traceNodeId: params.traceNodeId,
      policy: params.policy,
      sessionId: params.sessionId,
      hookNodeId: params.hookNodeId,
      toolName: params.toolName,
      mutation: params.mutation,
      message: params.message,
    })
  }

  /**
   * Log a policy outcome event
   */
  logPolicyOutcome(params: {
    decisionId: string
    clauseId: string
    outcome: PolicyOutcomeEvent["outcome"]
    sessionId: string
    hookPoint: string
    toolName?: string
    message?: string
    traceNodeId?: string
  }): LedgerEntry {
    return this.append<PolicyOutcomeEvent>({
      type: "policy-outcome",
      traceNodeId: params.traceNodeId,
      decisionId: params.decisionId,
      clauseId: params.clauseId,
      outcome: params.outcome,
      sessionId: params.sessionId,
      hookPoint: params.hookPoint,
      toolName: params.toolName,
      message: params.message,
    })
  }

  // =========================================================================
  // Query and verification methods
  // =========================================================================

  /**
   * Verify ledger integrity
   */
  verifyIntegrity(): IntegrityReport {
    const errors: string[] = []

    for (let i = 1; i < this.ledger.entries.length; i++) {
      const entry = this.ledger.entries[i]
      const expectedPrevHash = this.ledger.integrityChain[i - 1]

      if (entry.previousHash !== expectedPrevHash) {
        errors.push(`Entry ${entry.id}: previousHash mismatch at index ${i}`)
      }

      // Verify the hash of the entry itself
      const computedHash = computeHash(entry)
      if (computedHash !== this.ledger.integrityChain[i]) {
        errors.push(`Entry ${entry.id}: content hash mismatch at index ${i}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      entryCount: this.ledger.entries.length,
    }
  }

  /**
   * Query ledger for specific events
   */
  query(filter: LedgerFilter): LedgerEntry[] {
    return this.ledger.entries.filter((entry) => {
      if (filter.type && entry.type !== filter.type) return false
      if (filter.after && entry.timestamp < filter.after) return false
      if (filter.before && entry.timestamp > filter.before) return false
      return true
    })
  }

  /**
   * Get all entries
   */
  getEntries(): LedgerEntry[] {
    return [...this.ledger.entries]
  }

  /**
   * Get ledger metadata
   */
  getMetadata(): Omit<GovernanceLedger, "entries"> {
    return {
      ledgerId: this.ledger.ledgerId,
      sessionId: this.ledger.sessionId,
      createdAt: this.ledger.createdAt,
      integrityChain: [...this.ledger.integrityChain],
    }
  }

  /**
   * Generate a diagnostic report for a symptom
   */
  generateDiagnosticReport(symptom: string): DiagnosticReport {
    const relevantEvents = this.findRelevantEvents(symptom)
    const causalChain = this.buildCausalChain(relevantEvents)

    return {
      symptom,
      likelyCause: this.inferCause(causalChain, relevantEvents),
      supportingEvents: relevantEvents,
      causalChain,
      recommendation: this.generateRecommendation(causalChain, symptom),
    }
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  private writeHeader(): void {
    const header = {
      ledgerId: this.ledger.ledgerId,
      sessionId: this.ledger.sessionId,
      createdAt: this.ledger.createdAt,
      version: "1.0",
    }
    appendFileSync(this.filePath, `# ${JSON.stringify(header)}\n`)
  }

  private persistEntry(entry: LedgerEntry): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n")
    } catch (error) {
      log("[governance-ledger] Failed to persist entry", { error, entryId: entry.id })
    }
  }

  private loadFromFile(): void {
    try {
      const content = readFileSync(this.filePath, "utf-8")
      const lines = content.split("\n").filter((l) => l.trim())

      for (const line of lines) {
        if (line.startsWith("#")) {
          // Header line
          const header = JSON.parse(line.substring(2))
          this.ledger.ledgerId = header.ledgerId
          this.ledger.createdAt = header.createdAt
        } else {
          const entry = JSON.parse(line) as LedgerEntry
          this.ledger.entries.push(entry)
          this.ledger.integrityChain.push(computeHash(entry))
          this.lastHash = this.ledger.integrityChain[this.ledger.integrityChain.length - 1]
        }
      }
    } catch (error) {
      log("[governance-ledger] Failed to load from file", { error, path: this.filePath })
    }
  }

  private findRelevantEvents(symptom: string): LedgerEntry[] {
    const symptomLower = symptom.toLowerCase()
    const relevantTypes: LedgerEntry["type"][] = []

    // Map symptoms to likely event types
    if (symptomLower.includes("90%") || symptomLower.includes("budget") || symptomLower.includes("incomplete")) {
      relevantTypes.push("budget-event")
    }
    if (symptomLower.includes("permission") || symptomLower.includes("blocked") || symptomLower.includes("denied")) {
      relevantTypes.push("permission-violation", "permission-escalation")
    }
    if (symptomLower.includes("rerun") || symptomLower.includes("recovery") || symptomLower.includes("restart")) {
      relevantTypes.push("recovery-event", "checkpoint-event")
    }
    if (symptomLower.includes("approval") || symptomLower.includes("rejected") || symptomLower.includes("suspended")) {
      relevantTypes.push("approval-event")
    }
    if (symptomLower.includes("drift") || symptomLower.includes("changed") || symptomLower.includes("external")) {
      relevantTypes.push("environment-drift")
    }
    if (symptomLower.includes("policy") || symptomLower.includes("clause")) {
      relevantTypes.push("policy-decision", "policy-outcome")
    }

    // If no specific types identified, include all
    if (relevantTypes.length === 0) {
      return this.ledger.entries.slice(-20) // Last 20 entries
    }

    return this.ledger.entries.filter((e) => relevantTypes.includes(e.type))
  }

  private buildCausalChain(events: LedgerEntry[]): string[] {
    const chain: string[] = []

    for (const event of events.slice(-10)) {
      // Last 10 relevant events
      const description = this.describeEvent(event)
      if (description) {
        chain.push(description)
      }
    }

    return chain
  }

  private describeEvent(event: LedgerEntry): string {
    switch (event.type) {
      case "budget-event": {
        const e = event as BudgetEvent
        return `Budget ${e.subtype}: ${(e.budgetState.percentage * 100).toFixed(0)}% used, ${e.actionTaken}`
      }
      case "permission-escalation": {
        const e = event as PermissionEscalation
        return `Permission escalated: ${e.permission} granted by ${e.grantedBy}`
      }
      case "permission-violation": {
        const e = event as PermissionViolation
        return `Permission violation: ${e.attemptedAction} blocked (${e.blockReason})`
      }
      case "approval-event": {
        const e = event as ApprovalEvent
        return `Approval ${e.decision} for ${e.tool} (${e.decisionTimeMs}ms)`
      }
      case "recovery-event": {
        const e = event as RecoveryEvent
        return `Recovery decision: ${e.decision} due to ${e.trigger.description}`
      }
      case "checkpoint-event": {
        const e = event as CheckpointEvent
        return `Checkpoint ${e.subtype}: ${e.checkpointId} (${e.reason})`
      }
      case "environment-drift": {
        const e = event as EnvironmentDriftEvent
        return `Environment drift: ${e.driftType} (${e.impact} impact)`
      }
      case "state-proposal": {
        const e = event as StateProposalEvent
        return `State proposal ${e.outcome}: ${e.target.namespace}.${e.target.key}`
      }
      case "policy-decision": {
        const e = event as PolicyDecisionEvent
        return `Policy decision ${e.policy.decision} (${e.policy.enforcement}) by ${e.policy.clauseId}`
      }
      case "policy-outcome": {
        const e = event as PolicyOutcomeEvent
        return `Policy outcome ${e.outcome} for ${e.decisionId}`
      }
      default:
        return "Unknown event"
    }
  }

  private inferCause(chain: string[], events: LedgerEntry[]): string {
    // Look for common patterns
    const budgetEvents = events.filter((e) => e.type === "budget-event") as BudgetEvent[]
    const hasHighBudget = budgetEvents.some((e) => e.budgetState.percentage >= 0.9)

    const recoveryEvents = events.filter((e) => e.type === "recovery-event") as RecoveryEvent[]
    const hasRecovery = recoveryEvents.length > 0

    const driftEvents = events.filter((e) => e.type === "environment-drift") as EnvironmentDriftEvent[]
    const hasCriticalDrift = driftEvents.some((e) => e.impact === "critical" || e.impact === "major")

    const approvalEvents = events.filter((e) => e.type === "approval-event") as ApprovalEvent[]
    const hasRejection = approvalEvents.some((e) => e.decision === "rejected")

    // Determine likely cause based on patterns
    if (hasHighBudget && hasRecovery) {
      return "Budget exhaustion triggered recovery before task completion"
    }
    if (hasCriticalDrift) {
      const drift = driftEvents.find((e) => e.impact === "critical" || e.impact === "major")!
      return `External ${drift.driftType} caused context invalidation`
    }
    if (hasRejection) {
      const rejection = approvalEvents.find((e) => e.decision === "rejected")!
      return `User rejected ${rejection.tool} operation, interrupting workflow`
    }
    if (hasRecovery) {
      const recovery = recoveryEvents[recoveryEvents.length - 1]
      return `Recovery triggered: ${recovery.trigger.description}`
    }

    return "Unable to determine specific cause from available events"
  }

  private generateRecommendation(chain: string[], symptom: string): string {
    const symptomLower = symptom.toLowerCase()

    if (symptomLower.includes("budget") || symptomLower.includes("90%")) {
      return "Consider increasing budget allocation, enabling earlier GC, or breaking task into smaller units"
    }
    if (symptomLower.includes("rerun") || symptomLower.includes("recovery")) {
      return "Review checkpoint granularity; consider more frequent saves or adding environment monitoring"
    }
    if (symptomLower.includes("permission")) {
      return "Review hook trust levels and permission policies; consider pre-authorizing common operations"
    }
    if (symptomLower.includes("drift")) {
      return "Implement file watching or stricter environment contracts; consider isolation strategies"
    }

    return "Review event chain above and adjust governance policies accordingly"
  }
}

// =============================================================================
// Ledger Manager (handles multiple sessions)
// =============================================================================

/**
 * Ledger Manager
 *
 * Manages ledgers across multiple sessions with cleanup and retention.
 */
export class LedgerManager {
  private ledgers = new Map<string, GovernanceLedgerWriter>()
  private config: LedgerStorageConfig

  constructor(config: Partial<LedgerStorageConfig> = {}) {
    this.config = { ...getDefaultStorageConfig(), ...config }
  }

  /**
   * Get or create a ledger for a session
   */
  getLedger(sessionId: string): GovernanceLedgerWriter {
    let ledger = this.ledgers.get(sessionId)
    if (!ledger) {
      ledger = new GovernanceLedgerWriter(sessionId, this.config)
      this.ledgers.set(sessionId, ledger)
    }
    return ledger
  }

  /**
   * Check if a session has a ledger
   */
  hasLedger(sessionId: string): boolean {
    return (
      this.ledgers.has(sessionId) ||
      existsSync(join(this.config.baseDir, `${sessionId}.jsonl`))
    )
  }

  /**
   * Check if a session's ledger writer is loaded in memory
   */
  hasLoadedLedger(sessionId: string): boolean {
    return this.ledgers.has(sessionId)
  }

  /**
   * Remove a session's ledger from memory (file persists)
   */
  unloadLedger(sessionId: string): void {
    this.ledgers.delete(sessionId)
  }

  /**
   * Delete a session's ledger completely
   */
  deleteLedger(sessionId: string): boolean {
    this.ledgers.delete(sessionId)
    const filePath = join(this.config.baseDir, `${sessionId}.jsonl`)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return true
    }
    return false
  }

  /**
   * List all session IDs with ledgers
   */
  listSessions(): string[] {
    if (!existsSync(this.config.baseDir)) {
      return []
    }

    return readdirSync(this.config.baseDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
  }

  /**
   * Clean up old ledgers based on retention policy
   */
  cleanup(): { deleted: number; preserved: number } {
    const maxAgeMs = (this.config.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000
    const now = Date.now()
    let deleted = 0
    let preserved = 0

    const sessions = this.listSessions()

    // Sort by age (oldest first)
    const sessionsByAge = sessions
      .map((sessionId) => {
        const filePath = join(this.config.baseDir, `${sessionId}.jsonl`)
        const stat = statSync(filePath)
        return { sessionId, mtime: stat.mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime)

    for (const { sessionId, mtime } of sessionsByAge) {
      const age = now - mtime
      const exceedsMaxAge = age > maxAgeMs
      const exceedsMaxCount = sessions.length - deleted > (this.config.maxCount ?? 100)

      if (exceedsMaxAge || exceedsMaxCount) {
        // Check if we should preserve due to errors
        if (this.config.preserveErrors) {
          const ledger = this.getLedger(sessionId)
          const hasErrors = ledger.query({ type: "permission-violation" }).length > 0
          if (hasErrors) {
            preserved++
            continue
          }
        }

        if (this.deleteLedger(sessionId)) {
          deleted++
        }
      }
    }

    return { deleted, preserved }
  }
}

// =============================================================================
// Global instance
// =============================================================================

let globalManager: LedgerManager | undefined

/**
 * Get the global ledger manager
 */
export function getLedgerManager(config?: Partial<LedgerStorageConfig>): LedgerManager {
  if (!globalManager) {
    globalManager = new LedgerManager(config)
  }
  return globalManager
}

/**
 * Get the global ledger manager if already initialized
 */
export function peekLedgerManager(): LedgerManager | undefined {
  return globalManager
}

/**
 * Reset the global ledger manager (for testing)
 */
export function resetLedgerManager(): void {
  globalManager = undefined
}
