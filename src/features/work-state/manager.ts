/**
 * WorkStateManager
 *
 * Unified state management for orchestrator workflows.
 * Single source of truth: .orchestrator/work.yaml
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import * as yaml from "js-yaml"
import {
  WorkStateSchema,
  LegacyWorkStateV5Schema,
  type WorkState,
  type LegacyWorkStateV5,
  type ErrorRecord,
  type BlockerRecord,
  WORK_STATE_DIR,
  WORK_STATE_FILE,
  PLANS_DIR,
  PLAN_FILE,
  LEDGER_FILE,
} from "./types"
import { log } from "../../shared/logger"

const HOOK_NAME = "work-state"

export class WorkStateManager {
  private directory: string
  private state: WorkState | null = null

  constructor(directory: string) {
    this.directory = directory
  }

  private getCanonicalExecutionPlanPath(planId: string): string {
    return `${PLANS_DIR}/${planId}/${PLAN_FILE}`
  }

  private getCanonicalRuntimeLedgerPath(planId: string): string {
    return `${PLANS_DIR}/${planId}/${LEDGER_FILE}`
  }

  private normalizePath(inputPath: string): string {
    if (!inputPath) return inputPath
    const abs = isAbsolute(inputPath) ? inputPath : resolve(this.directory, inputPath)
    const rel = relative(this.directory, abs)
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return inputPath.split(sep).join("/")
    }
    return rel.split(sep).join("/")
  }

  private ensurePlanInvariant(planId: string, executionPlanPath: string, runtimeLedgerPath: string): void {
    const normalizedPlanPath = this.normalizePath(executionPlanPath)
    const normalizedLedgerPath = this.normalizePath(runtimeLedgerPath)
    const expectedPlanPath = this.getCanonicalExecutionPlanPath(planId)
    const expectedLedgerPath = this.getCanonicalRuntimeLedgerPath(planId)

    if (normalizedPlanPath !== expectedPlanPath || normalizedLedgerPath !== expectedLedgerPath) {
      throw new Error(
        `[${HOOK_NAME}] Invalid work-state invariant for plan_id="${planId}". ` +
          `Expected execution_plan_path="${expectedPlanPath}", runtime_ledger_path="${expectedLedgerPath}" ` +
          `but got execution_plan_path="${normalizedPlanPath}", runtime_ledger_path="${normalizedLedgerPath}".`
      )
    }
  }

  private migrateFromV5(legacy: LegacyWorkStateV5): WorkState {
    return {
      schema_version: 6,
      executor: legacy.executor,
      plan_id: legacy.plan_id,
      execution_plan_path: this.normalizePath(legacy.execution_plan_path),
      runtime_ledger_path: this.normalizePath(legacy.runtime_ledger_path),
      started_at: legacy.started_at,
      session_ids: legacy.session_ids,
      protocol: {
        research_ops: legacy.research_ops,
        last_findings_mtime: legacy.last_findings_mtime,
        stop_verification_last_prompt_at_by_session: {},
      },
      errors: legacy.errors,
      blockers: legacy.blockers,
      decisions: legacy.decisions,
      last_updated: legacy.last_updated,
    }
  }

  // === File Paths ===

  private get statePath(): string {
    return join(this.directory, WORK_STATE_DIR, WORK_STATE_FILE)
  }

  private get plansDir(): string {
    return join(this.directory, PLANS_DIR)
  }

  // === Lifecycle ===

  initializePlan(
    planId: string,
    sessionId: string,
    executionPlanPath: string | undefined
  ): WorkState {
    const canonicalExecutionPlanPath = this.getCanonicalExecutionPlanPath(planId)
    const canonicalRuntimeLedgerPath = this.getCanonicalRuntimeLedgerPath(planId)
    const selectedExecutionPlanPath = this.normalizePath(executionPlanPath ?? canonicalExecutionPlanPath)

    this.ensurePlanInvariant(planId, selectedExecutionPlanPath, canonicalRuntimeLedgerPath)

    this.state = {
      schema_version: 6,
      executor: "workflow-automator",
      plan_id: planId,
      execution_plan_path: selectedExecutionPlanPath,
      runtime_ledger_path: canonicalRuntimeLedgerPath,
      started_at: new Date().toISOString(),
      session_ids: [sessionId],
      protocol: {
        research_ops: 0,
        last_findings_mtime: 0,
        stop_verification_last_prompt_at_by_session: {},
      },
      errors: [],
      blockers: [],
      decisions: [],
      last_updated: new Date().toISOString(),
    }

    this.save()
    log(`[${HOOK_NAME}] Initialized work state`, { planId, sessionId })
    return this.state
  }

  switchPlan(
    planId: string,
    sessionId: string,
    executionPlanPath: string | undefined
  ): WorkState {
    return this.initializePlan(planId, sessionId, executionPlanPath)
  }

  /**
   * Load existing work state from disk.
   * Returns null if no active work.
   */
  load(): WorkState | null {
    if (!existsSync(this.statePath)) {
      this.state = null
      return null
    }

    try {
      const content = readFileSync(this.statePath, "utf-8")
      const parsed = yaml.load(content)
      const raw = parsed as { schema_version?: unknown } | null

      if (!raw || typeof raw !== "object") {
        throw new Error("work state must be a YAML object")
      }

      const rawVersion = raw.schema_version
      let validated: WorkState

      if (rawVersion === 6) {
        validated = WorkStateSchema.parse(parsed)
      } else if (rawVersion === 5) {
        const legacy = LegacyWorkStateV5Schema.parse(parsed)
        validated = this.migrateFromV5(legacy)
        this.state = validated
        this.save()
        log(`[${HOOK_NAME}] Migrated work state v5 -> v6`, { planId: validated.plan_id })
      } else {
        throw new Error(`unsupported work-state schema_version: ${String(rawVersion)}`)
      }

      this.ensurePlanInvariant(
        validated.plan_id,
        validated.execution_plan_path,
        validated.runtime_ledger_path
      )
      this.state = validated
      return this.state
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to load work state`, { error: String(err) })
      this.state = null
      return null
    }
  }

  /**
   * Save current state to disk.
   */
  save(): boolean {
    if (!this.state) return false

    try {
      const dir = dirname(this.statePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      this.ensurePlanInvariant(
        this.state.plan_id,
        this.state.execution_plan_path,
        this.state.runtime_ledger_path
      )
      this.state.last_updated = new Date().toISOString()
      const content = yaml.dump(this.state, { indent: 2 })
      writeFileSync(this.statePath, content, "utf-8")
      return true
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to save work state`, { error: String(err) })
      return false
    }
  }

  /**
   * Clear work state (when plan is complete or abandoned).
   */
  clear(): boolean {
    try {
      if (existsSync(this.statePath)) {
        const { unlinkSync } = require("node:fs")
        unlinkSync(this.statePath)
      }
      this.state = null
      log(`[${HOOK_NAME}] Cleared work state`)
      return true
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to clear work state`, { error: String(err) })
      return false
    }
  }

  /**
   * Get current state (loads if not cached).
   */
  getState(): WorkState | null {
    if (!this.state) {
      this.load()
    }
    return this.state
  }

  // === Session Management ===

  /**
   * Add a session ID to the list (for cross-session tracking).
   */
  appendSessionId(sessionId: string): boolean {
    if (!this.state) return false

    if (!this.state.session_ids.includes(sessionId)) {
      this.state.session_ids.push(sessionId)
      this.save()
      log(`[${HOOK_NAME}] Appended session`, { sessionId })
    }
    return true
  }

  /**
   * Check if a session is part of this work.
   */
  hasSession(sessionId: string): boolean {
    return this.state?.session_ids.includes(sessionId) ?? false
  }

  // === 2-Action Rule ===

  /**
   * Increment research operations counter.
   * Returns new count.
   */
  incrementResearchOps(): number {
    if (!this.state) return 0

    this.state.protocol.research_ops++
    this.save()
    log(`[${HOOK_NAME}] Research ops incremented`, { count: this.state.protocol.research_ops })
    return this.state.protocol.research_ops
  }

  /**
   * Reset research ops (called when findings.md is modified).
   */
  resetResearchOps(): void {
    if (!this.state) return

    this.state.protocol.research_ops = 0
    this.save()
    log(`[${HOOK_NAME}] Research ops reset`)
  }

  /**
   * Check if findings.md was modified (for auto-reset).
   */
  checkFindingsModified(findingsPath: string): { modified: boolean; newMtime: number } {
    if (!this.state) return { modified: false, newMtime: 0 }

    try {
      if (!existsSync(findingsPath)) {
        return { modified: false, newMtime: 0 }
      }

      const stat = statSync(findingsPath)
      const newMtime = stat.mtimeMs
      const modified = newMtime > this.state.protocol.last_findings_mtime

      if (modified) {
        this.state.protocol.last_findings_mtime = newMtime
        this.save()
      }

      return { modified, newMtime }
    } catch {
      return { modified: false, newMtime: 0 }
    }
  }

  /**
   * Should show 2-action rule reminder?
   */
  shouldRemindTwoAction(): boolean {
    if (!this.state) return false
    return (
      this.state.protocol.research_ops >= 2 &&
      this.state.protocol.research_ops % 2 === 0
    )
  }

  getStopVerificationLastPromptAt(sessionId: string): number {
    if (!this.state) return 0
    return this.state.protocol.stop_verification_last_prompt_at_by_session[sessionId] ?? 0
  }

  setStopVerificationLastPromptAt(sessionId: string, timestampMs: number): void {
    if (!this.state) return
    this.state.protocol.stop_verification_last_prompt_at_by_session[sessionId] = timestampMs
    this.save()
  }

  clearStopVerificationLastPromptAt(sessionId: string): void {
    if (!this.state) return
    if (!(sessionId in this.state.protocol.stop_verification_last_prompt_at_by_session)) {
      return
    }
    delete this.state.protocol.stop_verification_last_prompt_at_by_session[sessionId]
    this.save()
  }

  // === 3-Strike Protocol ===

  /**
   * Record an error occurrence.
   * Returns strike count and whether recording is required.
   */
  recordError(key: string, errorText?: string): { strikes: number; requiresRecording: boolean } {
    if (!this.state) return { strikes: 0, requiresRecording: false }

    let errorRecord = this.state.errors.find((e) => e.key === key)

    if (!errorRecord) {
      errorRecord = {
        key,
        strikes: 1,
        recorded: false,
        last_at: new Date().toISOString(),
        error_text: errorText?.slice(0, 200),
      }
      this.state.errors.push(errorRecord)
    } else {
      errorRecord.strikes++
      errorRecord.last_at = new Date().toISOString()
      if (errorText) {
        errorRecord.error_text = errorText.slice(0, 200)
      }
    }

    this.save()

    const requiresRecording = errorRecord.strikes >= 2 && !errorRecord.recorded
    log(`[${HOOK_NAME}] Error recorded`, { key, strikes: errorRecord.strikes, requiresRecording })

    return { strikes: errorRecord.strikes, requiresRecording }
  }

  /**
   * Mark an error as recorded in ledger.yaml.
   */
  markErrorRecorded(key: string): void {
    if (!this.state) return

    const errorRecord = this.state.errors.find((e) => e.key === key)
    if (errorRecord) {
      errorRecord.recorded = true
      this.save()
    }
  }

  /**
   * Check if error is already recorded.
   */
  isErrorRecorded(key: string): boolean {
    if (!this.state) return false
    return this.state.errors.find((e) => e.key === key)?.recorded ?? false
  }

  /**
   * Get strike guidance message.
   */
  getStrikeGuidance(strikes: number, requiresRecording: boolean): string {
    if (strikes === 1) {
      return "First occurrence. Analyze and attempt fix."
    }
    if (strikes === 2) {
      if (requiresRecording) {
        return "Strike 2: MUST record this error in ledger.yaml before retrying."
      }
      return "Strike 2: Error pattern detected. Try different approach."
    }
    return `Strike ${strikes}: Recurring error. Consider marking as blocker or escalating.`
  }

  generateErrorRecordingPrompt(errorKey: string, strikes: number): string {
    return `<error-recording-required>
## Record Error Before Continuing

This error has occurred ${strikes} times. You MUST record it in ledger.yaml before retrying.

**Record in \`ledger.yaml\` under \`errors\`:**

key: ${errorKey.slice(0, 80)}
attempts: ${strikes}
task: [TaskGraph task id/title]
root_cause: [ANALYZE]
resolution: [PLAN]

**Required fields:**
- **Root Cause**: Why is this happening? (not just "it failed")
- **Resolution**: What different approach will you try?
</error-recording-required>`
  }

  // === Blocker Management ===

  /**
   * Add a blocker.
   */
  addBlocker(errorText: string): void {
    if (!this.state) return

    const exists = this.state.blockers.some(
      (b) => b.error_text.slice(0, 80) === errorText.slice(0, 80) && !b.resolved
    )
    if (exists) return

    this.state.blockers.push({
      error_text: errorText.slice(0, 500),
      detected_at: new Date().toISOString(),
      resolved: false,
    })
    this.save()
    log(`[${HOOK_NAME}] Blocker added`, { errorText: errorText.slice(0, 50) })
  }

  /**
   * Mark a blocker as resolved.
   */
  resolveBlocker(errorTextPrefix: string, resolution?: string): void {
    if (!this.state) return

    const blocker = this.state.blockers.find(
      (b) => b.error_text.startsWith(errorTextPrefix) && !b.resolved
    )
    if (blocker) {
      blocker.resolved = true
      blocker.resolution = resolution
      this.save()
    }
  }

  /**
   * Get unresolved blockers.
   */
  getUnresolvedBlockers(): BlockerRecord[] {
    return this.state?.blockers.filter((b) => !b.resolved) ?? []
  }

  generateBlockerPrompt(issue: string): string {
    return `<blocker-detected>
## Blocker Identified

This issue requires escalation. Record it in ledger.yaml and adjust TaskGraph tasks as needed.

**Record in \`ledger.yaml\` under \`blockers\`:**
blocker: ${issue.slice(0, 80)}
task: [TaskGraph task id/title]
impact: [DESCRIBE]
status: open
escalation: [WHAT NEEDED]

**Then:**
1. Decide whether to cancel or re-scope the affected task(s)
2. If you can proceed, pick another ready task
</blocker-detected>`
  }

  // === Decision History ===

  /**
   * Record a decision.
   */
  recordDecision(decision: string, rationale?: string, alternativesRejected?: string[]): void {
    if (!this.state) return

    this.state.decisions.push({
      timestamp: new Date().toISOString(),
      decision,
      rationale,
      alternatives_rejected: alternativesRejected,
    })
    this.save()
    log(`[${HOOK_NAME}] Decision recorded`, { decision: decision.slice(0, 50) })
  }

  // === Plan Discovery ===

  /**
   * Find available plan files.
   */
  findPlans(): string[] {
    if (!existsSync(this.plansDir)) return []

    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs")
      const entries = readdirSync(this.plansDir, { withFileTypes: true }) as Array<{
        name: string
        isDirectory: () => boolean
      }>

      const plans = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${PLANS_DIR}/${entry.name}/${PLAN_FILE}`)
        .filter((planPath) => existsSync(join(this.directory, planPath)))

      return plans
    } catch {
      return []
    }
  }
}

export function createWorkStateManager(directory: string): WorkStateManager {
  return new WorkStateManager(directory)
}
