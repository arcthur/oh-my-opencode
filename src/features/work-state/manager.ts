/**
 * WorkStateManager
 *
 * Unified state management for orchestrator workflows.
 * Single source of truth: .sisyphus/work.yaml
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { dirname, join, basename, isAbsolute, relative, resolve, sep } from "node:path"
import * as yaml from "js-yaml"
import {
  WorkStateSchema,
  type WorkState,
  type ErrorRecord,
  type BlockerRecord,
  type PhaseCompletion,
  type Decision,
  type PlanProgress,
  type Phase,
  type PhaseStatus,
  type TaskSnapshot,
  WORK_STATE_DIR,
  WORK_STATE_FILE,
  PLANS_DIR,
} from "./types"
import { log } from "../../shared/logger"

const HOOK_NAME = "work-state"

/** In-memory cache for phase status tracking (phase transition detection) */
const phaseStatusCache = new Map<string, Map<string, PhaseStatus>>()

export class WorkStateManager {
  private directory: string
  private state: WorkState | null = null

  constructor(directory: string) {
    this.directory = directory
  }

  private getCacheKey(): string {
    return `${this.directory}:${this.state?.plan_name ?? "unknown"}`
  }

  private isManusTaskPlanPath(planPath: string): boolean {
    const file = basename(planPath).toLowerCase()
    return file === "task_plan.md" || file === "task-plan.md"
  }

  private derivePlanName(planPath: string): string {
    // Manus plans store the plan as a folder containing task_plan.md.
    // Use the directory name as plan_name to keep work-state stable and human-readable.
    if (this.isManusTaskPlanPath(planPath)) {
      const parent = basename(dirname(planPath))
      return parent || basename(planPath, ".md")
    }

    return basename(planPath, ".md")
  }

  // === File Paths ===

  private get statePath(): string {
    return join(this.directory, WORK_STATE_DIR, WORK_STATE_FILE)
  }

  private get plansDir(): string {
    return join(this.directory, PLANS_DIR)
  }

  /**
   * Get the absolute path to the active plan file.
   */
  private getAbsolutePlanPath(): string | null {
    if (!this.state) return null
    return this.state.active_plan.startsWith("/")
      ? this.state.active_plan
      : join(this.directory, this.state.active_plan)
  }

  /**
   * Get the mtime of the plan file (for cache invalidation).
   */
  private getPlanMtime(): number {
    const planPath = this.getAbsolutePlanPath()
    if (!planPath || !existsSync(planPath)) return 0
    try {
      return statSync(planPath).mtimeMs
    } catch {
      return 0
    }
  }

  // === Lifecycle ===

  /**
   * Normalize a plan path to be workspace-relative when possible.
   * Keeps absolute paths when the target is outside the workspace.
   */
  private normalizePlanPath(inputPath: string): string {
    if (!inputPath) return inputPath

    const abs = isAbsolute(inputPath) ? inputPath : resolve(this.directory, inputPath)
    const rel = relative(this.directory, abs)

    // Outside workspace or cannot be represented safely as relative.
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return inputPath
    }

    // Normalize separators for portability (store forward slashes).
    return rel.split(sep).join("/")
  }

  /**
   * Initialize work state for a new plan.
   * Called by /start-work when beginning new work.
   */
  initialize(planPath: string, sessionId: string): WorkState {
    const normalizedPlanPath = this.normalizePlanPath(planPath)
    const planName = this.derivePlanName(normalizedPlanPath)

    this.state = {
      active_plan: normalizedPlanPath,
      plan_name: planName,
      started_at: new Date().toISOString(),
      session_ids: [sessionId],
      research_ops: 0,
      last_findings_mtime: 0,
      errors: [],
      blockers: [],
      phase_completions: [],
      decisions: [],
      last_updated: new Date().toISOString(),
    }

    this.save()
    log(`[${HOOK_NAME}] Initialized work state`, { planName, sessionId })
    return this.state
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
      const validated = WorkStateSchema.parse(parsed)

      // Normalize plan path for portability (best-effort).
      const normalized = this.normalizePlanPath(validated.active_plan)
      const derivedPlanName = this.derivePlanName(normalized)
      const shouldRewrite =
        normalized !== validated.active_plan || derivedPlanName !== validated.plan_name

      this.state = shouldRewrite
        ? { ...validated, active_plan: normalized, plan_name: derivedPlanName }
        : validated

      if (shouldRewrite) {
        this.save()
      }

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

    this.state.research_ops++
    this.save()
    log(`[${HOOK_NAME}] Research ops incremented`, { count: this.state.research_ops })
    return this.state.research_ops
  }

  /**
   * Reset research ops (called when findings.md is modified).
   */
  resetResearchOps(): void {
    if (!this.state) return

    this.state.research_ops = 0
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
      const modified = newMtime > this.state.last_findings_mtime

      if (modified) {
        this.state.last_findings_mtime = newMtime
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
    return this.state.research_ops >= 2 && this.state.research_ops % 2 === 0
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
   * Mark an error as recorded in plan file.
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
        return "Strike 2: MUST record this error in task_plan.md Errors section before retrying."
      }
      return "Strike 2: Error pattern detected. Try different approach."
    }
    return `Strike ${strikes}: Recurring error. Consider marking as blocker or escalating.`
  }

  // === Blocker Management ===

  /**
   * Add a blocker.
   */
  addBlocker(errorText: string): void {
    if (!this.state) return

    // Check for duplicate (by similar error text)
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

  // === Phase Completion ===

  /**
   * Record phase completion for reflection tracking.
   */
  recordPhaseCompletion(phaseId: string): boolean {
    if (!this.state) return false

    const exists = this.state.phase_completions.some((p) => p.phase_id === phaseId)
    if (exists) return false

    this.state.phase_completions.push({
      phase_id: phaseId,
      completed_at: new Date().toISOString(),
      reflected: false,
    })
    this.save()
    log(`[${HOOK_NAME}] Phase completed`, { phaseId })
    return true
  }

  /**
   * Mark phase as reflected.
   */
  markPhaseReflected(phaseId: string): void {
    if (!this.state) return

    const phase = this.state.phase_completions.find((p) => p.phase_id === phaseId)
    if (phase) {
      phase.reflected = true
      this.save()
    }
  }

  /**
   * Get phases needing reflection.
   */
  getPhasesNeedingReflection(): PhaseCompletion[] {
    return this.state?.phase_completions.filter((p) => !p.reflected) ?? []
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

  // === Plan Progress ===

  /**
   * Get progress from plan file with snapshot caching.
   * Uses cached snapshot if plan file hasn't changed (mtime check).
   * Primary: checkbox counting (- [ ] / - [x])
   * Fallback: phase status counting when no checkboxes (e.g., Manus-style task_plan.md)
   */
  getPlanProgress(): PlanProgress {
    if (!this.state) return { total: 0, completed: 0, isComplete: true }

    const planPath = this.getAbsolutePlanPath()
    if (!planPath || !existsSync(planPath)) {
      return { total: 0, completed: 0, isComplete: true }
    }

    // Check if cached snapshot is still valid
    const currentMtime = this.getPlanMtime()
    const snapshot = this.state.task_snapshot
    if (snapshot && snapshot.plan_mtime === currentMtime) {
      // Cache hit: return cached progress
      return {
        total: snapshot.total,
        completed: snapshot.completed,
        isComplete: snapshot.total === 0 ? false : snapshot.completed === snapshot.total,
      }
    }

    // Cache miss: recalculate from plan file
    const progress = this.calculatePlanProgress(planPath)

    // Update snapshot cache
    this.updateTaskSnapshot(progress.total, progress.completed, currentMtime)

    return progress
  }

  /**
   * Calculate progress from plan file (internal, no caching).
   */
  private calculatePlanProgress(planPath: string): PlanProgress {
    try {
      const content = readFileSync(planPath, "utf-8")

      // Match markdown checkboxes: - [ ] or - [x] or - [X]
      const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || []
      const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || []

      const checkboxTotal = uncheckedMatches.length + checkedMatches.length
      const checkboxCompleted = checkedMatches.length

      // If checkboxes found, use checkbox-based progress
      if (checkboxTotal > 0) {
        return {
          total: checkboxTotal,
          completed: checkboxCompleted,
          isComplete: checkboxCompleted === checkboxTotal,
        }
      }

      // Fallback: use parsePhases() for Manus-style or phase-tagged plans
      const phases = this.parsePhases()
      if (phases.length > 0) {
        const phaseTotal = phases.length
        const isManusTaskPlan = this.isManusTaskPlanPath(planPath)
        const phaseCompleted = phases.filter(
          (p) => p.status === "complete" || (isManusTaskPlan && p.status === "blocked")
        ).length
        return {
          total: phaseTotal,
          completed: phaseCompleted,
          isComplete: phaseCompleted === phaseTotal,
        }
      }

      // No checkboxes and no phases: treat as unknown progress (NOT complete)
      return { total: 0, completed: 0, isComplete: false }
    } catch {
      return { total: 0, completed: 0, isComplete: true }
    }
  }

  /**
   * Update the task snapshot in work state.
   */
  private updateTaskSnapshot(total: number, completed: number, planMtime: number): void {
    if (!this.state) return

    this.state.task_snapshot = {
      total,
      completed,
      plan_mtime: planMtime,
      last_sync: new Date().toISOString(),
    }
    this.save()
    log(`[${HOOK_NAME}] Task snapshot updated`, { total, completed })
  }

  /**
   * Force sync task snapshot from plan file.
   * Call this after modifying the plan file to update the cache.
   */
  syncTaskSnapshot(): PlanProgress {
    if (!this.state) return { total: 0, completed: 0, isComplete: true }

    const planPath = this.getAbsolutePlanPath()
    if (!planPath || !existsSync(planPath)) {
      return { total: 0, completed: 0, isComplete: true }
    }

    const currentMtime = this.getPlanMtime()
    const progress = this.calculatePlanProgress(planPath)
    this.updateTaskSnapshot(progress.total, progress.completed, currentMtime)

    return progress
  }

  /**
   * Get task snapshot (for inspection, returns null if not cached).
   */
  getTaskSnapshot(): TaskSnapshot | null {
    return this.state?.task_snapshot ?? null
  }

  /**
   * Parse phases from plan file.
   */
  parsePhases(): Phase[] {
    if (!this.state) return []

    const planPath = this.state.active_plan.startsWith("/")
      ? this.state.active_plan
      : join(this.directory, this.state.active_plan)

    if (!existsSync(planPath)) return []

    try {
      const content = readFileSync(planPath, "utf-8")
      const phases: Phase[] = []

      // Match phase headers: ## Phase 1: Name or ## 1. Name
      const phaseRegex = /^##\s*(?:Phase\s*)?(\d+)[.:]\s*(.+?)(?:\s*\[(\w+)\])?$/gm
      let match: RegExpExecArray | null

      while ((match = phaseRegex.exec(content)) !== null) {
        const id = match[1]
        const name = match[2].trim()
        const statusTag = match[3]?.toLowerCase()

        let status: PhaseStatus = "pending"
        if (statusTag === "complete" || statusTag === "done") {
          status = "complete"
        } else if (statusTag === "blocked") {
          status = "blocked"
        } else if (statusTag === "in_progress" || statusTag === "active") {
          status = "in_progress"
        }

        phases.push({ id, name, status })
      }

      // Manus-style phases table under "## Phases"
      if (phases.length === 0) {
        const phasesSectionMatch = content.match(
          /##\s*Phases\b[\s\S]*?(?=\n##\s|\n#\s|$)/i
        )
        const phasesSection = phasesSectionMatch?.[0] ?? content
        const tableRowRegex =
          /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(pending|in_progress|complete|blocked)\s*\|/gim

        while ((match = tableRowRegex.exec(phasesSection)) !== null) {
          const id = match[1]
          const name = match[2].trim()
          const status = match[3].toLowerCase() as PhaseStatus
          phases.push({ id, name, status })
        }
      }

      // If no explicit phases, treat checkboxes as tasks
      if (phases.length === 0) {
        const checkboxes = content.match(/^[-*]\s*\[[ xX]\]\s*(.+)$/gm) || []
        checkboxes.forEach((line, idx) => {
          const isComplete = /\[[xX]\]/.test(line)
          const name = line.replace(/^[-*]\s*\[[ xX]\]\s*/, "").trim()
          phases.push({
            id: String(idx + 1),
            name: name.slice(0, 50),
            status: isComplete ? "complete" : "pending",
          })
        })
      }

      return phases
    } catch {
      return []
    }
  }

  /**
   * Get current (first non-complete) phase.
   */
  getCurrentPhase(): Phase | null {
    const phases = this.parsePhases()
    return phases.find((p) => p.status !== "complete") || null
  }

  /**
   * Get next pending task.
   */
  getNextTask(): Phase | null {
    const phases = this.parsePhases()
    return phases.find((p) => p.status === "pending") || null
  }

  /**
   * Detect phases that were just completed (for reflection triggers).
   * On first call, initializes cache and returns empty to avoid false positives.
   */
  detectPhaseCompletion(): Array<{ id: string; name: string }> {
    const currentPhases = this.parsePhases()
    const cacheKey = this.getCacheKey()
    const previousStatuses = phaseStatusCache.get(cacheKey)

    // First call: initialize cache, return empty (no false positives on restart)
    if (!previousStatuses) {
      const initialCache = new Map<string, PhaseStatus>()
      for (const phase of currentPhases) {
        initialCache.set(phase.id, phase.status)
      }
      phaseStatusCache.set(cacheKey, initialCache)
      return []
    }

    const completedPhases: Array<{ id: string; name: string }> = []

    for (const phase of currentPhases) {
      const previousStatus = previousStatuses.get(phase.id)
      // Phase just became complete (was not complete before)
      if (phase.status === "complete" && previousStatus !== "complete") {
        completedPhases.push({ id: phase.id, name: phase.name })
      }
    }

    // Update cache
    const newCache = new Map<string, PhaseStatus>()
    for (const phase of currentPhases) {
      newCache.set(phase.id, phase.status)
    }
    phaseStatusCache.set(cacheKey, newCache)

    return completedPhases
  }

  /**
   * Generate reflection prompt for completed phase.
   */
  generateReflectionPrompt(completedPhase: { id: string; name: string }): string {
    const allPhases = this.parsePhases()
    const remainingPhases = allPhases
      .filter((p) => p.status === "pending" || p.status === "in_progress")
      .map((p) => `  - Phase ${p.id}: ${p.name} (${p.status})`)
      .join("\n")

    return `<phase-reflection>
## Phase ${completedPhase.id} Complete: ${completedPhase.name}

**Before proceeding, reflect on:**

1. **Discoveries**: Did you learn anything that affects the remaining plan?
2. **Assumptions**: Were any assumptions proven wrong?
3. **Remaining Phases**: Do they still make sense?
${remainingPhases ? `\n**Remaining:**\n${remainingPhases}` : ""}

**Actions you can take:**
- Add new phases if needed
- Remove phases that are no longer relevant
- Reorder phases based on new understanding
- Update phase descriptions with new context

**Update task_plan.md if any changes are needed, then continue.**
</phase-reflection>`
  }

  /**
   * Generate error recording prompt (when strikes >= 2).
   */
  generateErrorRecordingPrompt(errorKey: string, strikes: number): string {
    const currentPhase = this.getCurrentPhase()
    const phaseNote = currentPhase ? `Phase ${currentPhase.id}` : "Current phase"

    return `<error-recording-required>
## Record Error Before Continuing

This error has occurred ${strikes} times. You MUST record it in task_plan.md before retrying.

**Add to ## Errors section:**

| # | Error | Phase | Attempts | Root Cause | Resolution |
|---|-------|-------|----------|------------|------------|
| N | ${errorKey.slice(0, 50)} | ${phaseNote} | ${strikes} | [ANALYZE] | [PLAN] |

**Required fields:**
- **Root Cause**: Why is this happening? (not just "it failed")
- **Resolution**: What different approach will you try?
${
  strikes >= 3
    ? `
**Consider adding to ## Blockers if:**
- The error requires external input (credentials, permissions)
- Multiple approaches have failed
- The issue is outside your control
`
    : ""
}
</error-recording-required>`
  }

  /**
   * Generate blocker prompt.
   */
  generateBlockerPrompt(issue: string): string {
    const currentPhase = this.getCurrentPhase()

    return `<blocker-detected>
## Blocker Identified

This issue requires escalation. Add to task_plan.md ## Blockers section:

| # | Blocker | Phase | Impact | Status | Escalation |
|---|---------|-------|--------|--------|------------|
| N | ${issue.slice(0, 40)} | ${currentPhase?.id ?? "?"} | [DESCRIBE] | open | [WHAT NEEDED] |

**Then:**
1. Mark the affected phase as \`blocked\` in ## Phases
2. Consider if other phases can proceed in parallel
3. Communicate the blocker to the user

</blocker-detected>`
  }

  /**
   * Clear phase status cache for the current plan.
   * @param planName Optional explicit plan name. If not provided, uses current state's plan_name.
   */
  clearPhaseCache(planName?: string): void {
    const targetPlanName = planName ?? this.state?.plan_name
    if (targetPlanName) {
      const key = `${this.directory}:${targetPlanName}`
      phaseStatusCache.delete(key)
      log(`[${HOOK_NAME}] Phase cache cleared`, { key })
    }
  }

  /**
   * Clear all phase caches for this directory (all plans).
   * Use this when doing a full session cleanup.
   */
  clearAllPhaseCaches(): void {
    const prefix = `${this.directory}:`
    let cleared = 0
    for (const key of phaseStatusCache.keys()) {
      if (key.startsWith(prefix)) {
        phaseStatusCache.delete(key)
        cleared++
      }
    }
    if (cleared > 0) {
      log(`[${HOOK_NAME}] All phase caches cleared for directory`, { directory: this.directory, cleared })
    }
  }

  // === Plan Discovery ===

  /**
   * Find available plan files.
   */
  findPlans(): string[] {
    if (!existsSync(this.plansDir)) return []

    try {
      const { readdirSync } = require("node:fs")
      const files = readdirSync(this.plansDir) as string[]
      return files
        .filter((f: string) => f.endsWith(".md"))
        // Return workspace-relative stable paths for comparisons and persistence.
        .map((f: string) => `${PLANS_DIR}/${f}`)
        .sort((a: string, b: string) => {
          const aStat = statSync(join(this.plansDir, basename(a)))
          const bStat = statSync(join(this.plansDir, basename(b)))
          return bStat.mtimeMs - aStat.mtimeMs
        })
    } catch {
      return []
    }
  }

  /**
   * Find incomplete plans.
   */
  findIncompletePlans(): Array<{ path: string; name: string; progress: PlanProgress }> {
    const plans = this.findPlans()
    const results: Array<{ path: string; name: string; progress: PlanProgress }> = []

    for (const planPath of plans) {
      // Temporarily set active_plan to get progress
      const originalState = this.state
      this.state = { ...this.state!, active_plan: planPath, plan_name: basename(planPath, ".md") }
      const progress = this.getPlanProgress()
      this.state = originalState

      if (!progress.isComplete) {
        results.push({
          path: planPath,
          name: basename(planPath, ".md"),
          progress,
        })
      }
    }

    return results
  }
}

/**
 * Create a WorkStateManager instance.
 */
export function createWorkStateManager(directory: string): WorkStateManager {
  return new WorkStateManager(directory)
}
