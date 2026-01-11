/**
 * Planning with Files Manager
 *
 * Optimized implementation with:
 * - State persistence via .planning-state.json
 * - Full task_plan.md re-read for KV-cache optimization
 * - Auto-detection of findings.md updates via mtime
 * - Forced error recording to task_plan.md
 * - Blockers section for issues requiring escalation
 * - Reflection prompts on phase completion
 */

import * as fs from "fs"
import * as path from "path"
import type { PlanningState, PlanningWithFilesConfig, PhaseStatus } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"

/** In-memory cache */
const stateCache = new Map<string, PlanningState>()

/** Track last known phase statuses for reflection detection */
const phaseStatusCache = new Map<string, Map<number, PhaseStatus>>()

function getCacheKey(cwd: string, planName: string, config: PlanningWithFilesConfig): string {
  return `${cwd}:${config.directory}:${planName}`
}

/**
 * Get plan directory path
 */
export function getPlanDir(cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(cwd, ".sisyphus", config.directory, planName)
}

/**
 * Get state file path
 */
function getStatePath(cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(getPlanDir(cwd, planName, config), ".planning-state.json")
}

/**
 * Load persisted state
 */
export async function loadState(
  cwd: string,
  planName: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<PlanningState | null> {
  const cacheKey = getCacheKey(cwd, planName, config)
  if (stateCache.has(cacheKey)) {
    return stateCache.get(cacheKey)!
  }

  try {
    const content = await fs.promises.readFile(getStatePath(cwd, planName, config), "utf-8")
    const state = JSON.parse(content) as PlanningState
    stateCache.set(cacheKey, state)
    return state
  } catch {
    return null
  }
}

/**
 * Save state to disk
 */
export async function saveState(
  cwd: string,
  state: PlanningState,
  config = DEFAULT_PLANNING_CONFIG
): Promise<void> {
  const statePath = getStatePath(cwd, state.planName, config)
  const cacheKey = getCacheKey(cwd, state.planName, config)

  await fs.promises.mkdir(path.dirname(statePath), { recursive: true })
  state.lastActivityAt = new Date().toISOString()
  await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2))
  stateCache.set(cacheKey, state)
}

/**
 * Check if findings.md was modified
 */
export async function wasFindingsModified(
  cwd: string,
  planName: string,
  lastMtime: number,
  config = DEFAULT_PLANNING_CONFIG
): Promise<{ modified: boolean; newMtime: number }> {
  const findingsPath = path.join(getPlanDir(cwd, planName, config), "findings.md")
  try {
    const stat = await fs.promises.stat(findingsPath)
    return { modified: stat.mtimeMs > lastMtime, newMtime: stat.mtimeMs }
  } catch {
    return { modified: false, newMtime: lastMtime }
  }
}

/**
 * Read FULL task_plan.md for KV-cache optimization
 */
export async function readTaskPlan(
  cwd: string,
  planName: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<string | null> {
  const taskPlanPath = path.join(getPlanDir(cwd, planName, config), "task_plan.md")
  try {
    return await fs.promises.readFile(taskPlanPath, "utf-8")
  } catch {
    return null
  }
}

/**
 * Write task_plan.md
 */
export async function writeTaskPlan(
  cwd: string,
  planName: string,
  content: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<void> {
  const taskPlanPath = path.join(getPlanDir(cwd, planName, config), "task_plan.md")
  await fs.promises.writeFile(taskPlanPath, content)
}

/**
 * Detect active plan from directory
 */
export async function detectActivePlan(
  cwd: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<string | null> {
  const plansDir = path.join(cwd, ".sisyphus", config.directory)
  try {
    const entries = await fs.promises.readdir(plansDir, { withFileTypes: true })
    let latestPlan: string | null = null
    let latestMtime = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const statePath = path.join(plansDir, entry.name, ".planning-state.json")
      try {
        const stat = await fs.promises.stat(statePath)
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs
          latestPlan = entry.name
        }
      } catch {
        // No state file
      }
    }
    return latestPlan
  } catch {
    return null
  }
}

/**
 * Initialize a new planning session with enhanced template
 */
export async function initializePlan(
  cwd: string,
  planName: string,
  goal: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<{ taskPlanPath: string; findingsPath: string; progressPath: string }> {
  const planDir = getPlanDir(cwd, planName, config)
  await fs.promises.mkdir(planDir, { recursive: true })

  const taskPlanPath = path.join(planDir, "task_plan.md")
  const findingsPath = path.join(planDir, "findings.md")
  const progressPath = path.join(planDir, "progress.md")

  const now = new Date().toISOString().split("T")[0]

  // Enhanced template with Blockers section
  const taskPlanContent = `# Task Plan: ${planName}

> **Goal**: ${goal}

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | pending | Understand requirements |
| 2 | Implementation | pending | Build the solution |
| 3 | Verification | pending | Test and validate |

## Decisions

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| - | (none yet) | - | - |

## Errors (Must Record on Strike 2+)

| # | Error | Phase | Attempts | Root Cause | Resolution |
|---|-------|-------|----------|------------|------------|
| - | (none yet) | - | - | - | - |

## Blockers (Require Escalation)

| # | Blocker | Phase | Impact | Status | Escalation |
|---|---------|-------|--------|--------|------------|
| - | (none yet) | - | - | - | - |

---
*Created: ${now}*
*Last Reflection: (none yet)*
`

  const findingsContent = `# Findings: ${planName}

## Research

| Source | Finding |
|--------|---------|
| - | (update after 2 actions) |

## Resources

| Name | URL |
|------|-----|
| - | - |

---
*Last updated: ${now}*
`

  const progressContent = `# Progress: ${planName}

## Session Log

| Time | Action | Files |
|------|--------|-------|
| ${new Date().toISOString().split("T")[1].slice(0, 5)} | Session started | - |

## Phase Transitions

| Phase | Started | Completed | Revisited |
|-------|---------|-----------|-----------|
| - | - | - | - |

## 5-Question Reboot

1. **Where am I?** -
2. **Where am I going?** -
3. **What is my goal?** -
4. **What have I learned?** -
5. **What have I completed?** -
`

  const writes: Array<Promise<void>> = []
  if (!fs.existsSync(taskPlanPath)) {
    writes.push(fs.promises.writeFile(taskPlanPath, taskPlanContent))
  }
  if (!fs.existsSync(findingsPath)) {
    writes.push(fs.promises.writeFile(findingsPath, findingsContent))
  }
  if (!fs.existsSync(progressPath)) {
    writes.push(fs.promises.writeFile(progressPath, progressContent))
  }
  await Promise.all(writes)

  const existingState = await loadState(cwd, planName, config)

  if (existingState) {
    await saveState(cwd, existingState, config)
  } else {
    const state: PlanningState = {
      planName,
      actionCount: 0,
      lastFindingsMtime: Date.now(),
      errorStrikes: {},
      activatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    }
    await saveState(cwd, state, config)
  }

  return { taskPlanPath, findingsPath, progressPath }
}

/**
 * Parse phases from task_plan.md
 */
export function parsePhases(content: string): Array<{ id: number; name: string; status: PhaseStatus }> {
  const phases: Array<{ id: number; name: string; status: PhaseStatus }> = []
  const regex = /\|\s*(\d+)\s*\|([^|]+)\|\s*(pending|in_progress|complete|blocked)\s*\|/gi
  let match
  while ((match = regex.exec(content)) !== null) {
    phases.push({
      id: parseInt(match[1]),
      name: match[2].trim(),
      status: match[3].toLowerCase() as PhaseStatus,
    })
  }
  return phases
}

/**
 * Detect if any phase was just completed (for reflection trigger)
 *
 * On first call (cache miss), initializes cache and returns empty array
 * to avoid false positives on session restart.
 */
export function detectPhaseCompletion(
  cwd: string,
  planName: string,
  currentPhases: Array<{ id: number; name: string; status: PhaseStatus }>,
  config = DEFAULT_PLANNING_CONFIG
): Array<{ id: number; name: string }> {
  const cacheKey = getCacheKey(cwd, planName, config)
  const previousStatuses = phaseStatusCache.get(cacheKey)

  // First call: initialize cache, return empty (no false positives on restart)
  if (!previousStatuses) {
    const initialCache = new Map<number, PhaseStatus>()
    for (const phase of currentPhases) {
      initialCache.set(phase.id, phase.status)
    }
    phaseStatusCache.set(cacheKey, initialCache)
    return []
  }

  const completedPhases: Array<{ id: number; name: string }> = []

  for (const phase of currentPhases) {
    const previousStatus = previousStatuses.get(phase.id)
    // Phase just became complete (was not complete before)
    if (phase.status === "complete" && previousStatus !== "complete") {
      completedPhases.push({ id: phase.id, name: phase.name })
    }
  }

  // Update cache
  const newCache = new Map<number, PhaseStatus>()
  for (const phase of currentPhases) {
    newCache.set(phase.id, phase.status)
  }
  phaseStatusCache.set(cacheKey, newCache)

  return completedPhases
}

/**
 * Get 3-strike guidance with forced recording requirement
 */
export function getStrikeGuidance(strikes: number, requiresRecording: boolean): string {
  const recordingNote = requiresRecording
    ? "\n\n**REQUIRED**: Record this error in task_plan.md ## Errors section before continuing."
    : ""

  switch (strikes) {
    case 1:
      return `**Strike 1/3**: Diagnose - Read error carefully, check context`
    case 2:
      return `**Strike 2/3**: Pivot - Try alternative approach${recordingNote}`
    case 3:
      return `**Strike 3/3**: Reassess - Review assumptions, consider blocking phase${recordingNote}`
    default:
      return `**Strike ${strikes}/3**: ESCALATE - Add to ## Blockers section and ask for help${recordingNote}`
  }
}

/**
 * Generate reflection prompt for completed phase
 */
export function generateReflectionPrompt(
  completedPhase: { id: number; name: string },
  allPhases: Array<{ id: number; name: string; status: PhaseStatus }>
): string {
  const remainingPhases = allPhases
    .filter(p => p.status === "pending" || p.status === "in_progress")
    .map(p => `  - Phase ${p.id}: ${p.name} (${p.status})`)
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
 * Generate forced error recording prompt
 */
export function generateErrorRecordingPrompt(
  errorKey: string,
  strikes: number,
  currentPhase: number | null
): string {
  const phaseNote = currentPhase ? `Phase ${currentPhase}` : "Current phase"

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

${strikes >= 3 ? `
**Consider adding to ## Blockers if:**
- The error requires external input (credentials, permissions)
- Multiple approaches have failed
- The issue is outside your control
` : ""}
</error-recording-required>`
}

/**
 * Generate blocker recording prompt
 */
export function generateBlockerPrompt(
  issue: string,
  phase: number | null
): string {
  return `<blocker-detected>
## Blocker Identified

This issue requires escalation. Add to task_plan.md ## Blockers section:

| # | Blocker | Phase | Impact | Status | Escalation |
|---|---------|-------|--------|--------|------------|
| N | ${issue.slice(0, 40)} | ${phase || "?"} | [DESCRIBE] | open | [WHAT NEEDED] |

**Then:**
1. Mark the affected phase as \`blocked\` in ## Phases
2. Consider if other phases can proceed in parallel
3. Communicate the blocker to the user

</blocker-detected>`
}

/**
 * Check if error recording is present for a given error
 */
export async function isErrorRecorded(
  cwd: string,
  planName: string,
  errorKey: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<boolean> {
  const content = await readTaskPlan(cwd, planName, config)
  if (!content) return false

  // Check if error appears in the Errors table
  const errorsSection = content.match(/## Errors[\s\S]*?(?=##|$)/i)
  if (!errorsSection) return false

  // Normalize for comparison
  const normalizedError = errorKey.slice(0, 30).toLowerCase()
  return errorsSection[0].toLowerCase().includes(normalizedError)
}

/**
 * Get current in_progress phase
 */
export function getCurrentPhase(
  phases: Array<{ id: number; name: string; status: PhaseStatus }>
): number | null {
  const inProgress = phases.find(p => p.status === "in_progress")
  return inProgress ? inProgress.id : null
}

/**
 * Cleanup session cache
 */
export function cleanupSession(
  cwd: string,
  planName: string,
  config = DEFAULT_PLANNING_CONFIG
): void {
  stateCache.delete(getCacheKey(cwd, planName, config))
  phaseStatusCache.delete(getCacheKey(cwd, planName, config))
}

// Legacy exports for compatibility
export const initializePlanningSession = initializePlan
export const getPlanningSession = loadState
export const loadPlanningSession = loadState
export const readFindings = async (cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG) =>
  fs.promises.readFile(path.join(getPlanDir(cwd, planName, config), "findings.md"), "utf-8")
export const readProgress = async (cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG) =>
  fs.promises.readFile(path.join(getPlanDir(cwd, planName, config), "progress.md"), "utf-8")
export const areAllPhasesComplete = async (cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG) => {
  const content = await readTaskPlan(cwd, planName, config)
  if (!content) return false
  const phases = parsePhases(content)
  return phases.length > 0 && phases.every(p => p.status === "complete" || p.status === "blocked")
}
export const getIncompletePhases = async (cwd: string, planName: string, config = DEFAULT_PLANNING_CONFIG) => {
  const content = await readTaskPlan(cwd, planName, config)
  if (!content) return []
  return parsePhases(content)
    .filter(p => p.status !== "complete" && p.status !== "blocked")
    .map(p => `Phase ${p.id}: ${p.name} (${p.status})`)
}
