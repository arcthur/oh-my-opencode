/**
 * Planning with Files Manager
 *
 * Optimized implementation with:
 * - State persistence via .planning-state.json
 * - Full task_plan.md re-read for KV-cache optimization
 * - Auto-detection of findings.md updates via mtime
 * - Unified directory structure with multi-plan
 */

import * as fs from "fs"
import * as path from "path"
import type { PlanningState, PlanningWithFilesConfig, PhaseStatus } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"

/** In-memory cache */
const stateCache = new Map<string, PlanningState>()

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
export async function loadState(cwd: string, planName: string): Promise<PlanningState | null> {
  const cacheKey = `${cwd}:${planName}`
  if (stateCache.has(cacheKey)) {
    return stateCache.get(cacheKey)!
  }

  try {
    const content = await fs.promises.readFile(getStatePath(cwd, planName), "utf-8")
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
export async function saveState(cwd: string, state: PlanningState): Promise<void> {
  const statePath = getStatePath(cwd, state.planName)
  const cacheKey = `${cwd}:${state.planName}`

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
  lastMtime: number
): Promise<{ modified: boolean; newMtime: number }> {
  const findingsPath = path.join(getPlanDir(cwd, planName), "findings.md")
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
export async function readTaskPlan(cwd: string, planName: string): Promise<string | null> {
  const taskPlanPath = path.join(getPlanDir(cwd, planName), "task_plan.md")
  try {
    return await fs.promises.readFile(taskPlanPath, "utf-8")
  } catch {
    return null
  }
}

/**
 * Detect active plan from directory
 */
export async function detectActivePlan(cwd: string): Promise<string | null> {
  const plansDir = path.join(cwd, ".sisyphus", "plans")
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
 * Initialize a new planning session
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

  // Minimal, focused templates
  const taskPlanContent = `# Task Plan: ${planName}

> **Goal**: ${goal}

## Phases

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | Discovery | pending | Understand requirements |
| 2 | Implementation | pending | Build the solution |
| 3 | Verification | pending | Test and validate |

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| - | (none yet) | - |

## Errors (3-Strike Protocol)

| # | Error | Strikes | Resolution |
|---|-------|---------|------------|
| - | (none yet) | - | - |

---
*Created: ${now}*
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

## 5-Question Reboot

1. **Where am I?** -
2. **Where am I going?** -
3. **What is my goal?** -
4. **What have I learned?** -
5. **What have I completed?** -
`

  await Promise.all([
    fs.promises.writeFile(taskPlanPath, taskPlanContent),
    fs.promises.writeFile(findingsPath, findingsContent),
    fs.promises.writeFile(progressPath, progressContent),
  ])

  const state: PlanningState = {
    planName,
    actionCount: 0,
    lastFindingsMtime: Date.now(),
    errorStrikes: {},
    activatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  }
  await saveState(cwd, state)

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
 * Get 3-strike guidance
 */
export function getStrikeGuidance(strikes: number): string {
  switch (strikes) {
    case 1:
      return `**Strike 1/3**: Diagnose - Read error carefully, check context`
    case 2:
      return `**Strike 2/3**: Pivot - Try alternative approach`
    case 3:
      return `**Strike 3/3**: Reassess - Review assumptions, consider blocking phase`
    default:
      return `**Strike ${strikes}/3**: ESCALATE - Mark phase as BLOCKED`
  }
}

/**
 * Cleanup session cache
 */
export function cleanupSession(cwd: string, planName: string): void {
  stateCache.delete(`${cwd}:${planName}`)
}

// Legacy exports for compatibility
export const initializePlanningSession = initializePlan
export const getPlanningSession = loadState
export const loadPlanningSession = loadState
export const readFindings = async (cwd: string, planName: string) =>
  fs.promises.readFile(path.join(getPlanDir(cwd, planName), "findings.md"), "utf-8")
export const readProgress = async (cwd: string, planName: string) =>
  fs.promises.readFile(path.join(getPlanDir(cwd, planName), "progress.md"), "utf-8")
export const areAllPhasesComplete = async (cwd: string, planName: string) => {
  const content = await readTaskPlan(cwd, planName)
  if (!content) return false
  const phases = parsePhases(content)
  return phases.length > 0 && phases.every(p => p.status === "complete" || p.status === "blocked")
}
export const getIncompletePhases = async (cwd: string, planName: string) => {
  const content = await readTaskPlan(cwd, planName)
  if (!content) return []
  return parsePhases(content)
    .filter(p => p.status !== "complete" && p.status !== "blocked")
    .map(p => `Phase ${p.id}: ${p.name} (${p.status})`)
}
