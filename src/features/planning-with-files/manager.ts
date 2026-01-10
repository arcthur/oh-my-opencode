/**
 * Planning with Files Manager
 *
 * Manages the 3-file planning pattern lifecycle:
 * - Creates and initializes planning files
 * - Tracks action counts for the 2-action rule
 * - Manages error strikes for the 3-strike protocol
 * - Provides file access and update utilities
 */

import * as fs from "fs"
import * as path from "path"
import type { PlanningSession, PlanningWithFilesConfig, PhaseStatus } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"
import {
  generateTaskPlanTemplate,
  generateFindingsTemplate,
  generateProgressTemplate,
  parseTaskPlan,
  getFindingsActionCount,
  updateFindingsActionCount,
  resetFindingsActionCount,
  updatePhaseStatus as updateProgressPhaseStatus,
  updateLastActivity,
  addPhaseLogEntry,
} from "./templates"

/** Session storage */
const sessions = new Map<string, PlanningSession>()

/** Error strike tracking per session and error key */
const errorStrikes = new Map<string, Map<string, number>>()

/**
 * Initialize a new planning session with the 3-file pattern
 */
export async function initializePlanningSession(
  sessionId: string,
  planName: string,
  goal: string,
  cwd: string,
  config: Partial<PlanningWithFilesConfig> = {}
): Promise<PlanningSession> {
  const fullConfig = { ...DEFAULT_PLANNING_CONFIG, ...config }
  const planningDir = path.join(cwd, ".sisyphus", fullConfig.directory, planName)

  // Create directory
  await fs.promises.mkdir(planningDir, { recursive: true })

  // Generate and write files
  const taskPlanPath = path.join(planningDir, "task_plan.md")
  const findingsPath = path.join(planningDir, "findings.md")
  const progressPath = path.join(planningDir, "progress.md")

  const taskPlanContent = generateTaskPlanTemplate({ goal, planName })
  const findingsContent = generateFindingsTemplate({ planName })
  const progressContent = generateProgressTemplate({ planName })

  await Promise.all([
    fs.promises.writeFile(taskPlanPath, taskPlanContent),
    fs.promises.writeFile(findingsPath, findingsContent),
    fs.promises.writeFile(progressPath, progressContent),
  ])

  const session: PlanningSession = {
    id: sessionId,
    planName,
    taskPlanPath,
    findingsPath,
    progressPath,
    actionCount: 0,
    lastFindingsUpdate: new Date(),
    errorStrikes: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  sessions.set(sessionId, session)
  errorStrikes.set(sessionId, new Map())

  return session
}

/**
 * Get an existing planning session
 */
export function getPlanningSession(sessionId: string): PlanningSession | undefined {
  return sessions.get(sessionId)
}

/**
 * Load a planning session from existing files
 */
export async function loadPlanningSession(
  sessionId: string,
  planName: string,
  cwd: string,
  config: Partial<PlanningWithFilesConfig> = {}
): Promise<PlanningSession | null> {
  const fullConfig = { ...DEFAULT_PLANNING_CONFIG, ...config }
  const planningDir = path.join(cwd, ".sisyphus", fullConfig.directory, planName)

  const taskPlanPath = path.join(planningDir, "task_plan.md")
  const findingsPath = path.join(planningDir, "findings.md")
  const progressPath = path.join(planningDir, "progress.md")

  // Check if files exist
  try {
    await Promise.all([
      fs.promises.access(taskPlanPath),
      fs.promises.access(findingsPath),
      fs.promises.access(progressPath),
    ])
  } catch {
    return null
  }

  // Load action count from findings
  const findingsContent = await fs.promises.readFile(findingsPath, "utf-8")
  const actionCount = getFindingsActionCount(findingsContent)

  const session: PlanningSession = {
    id: sessionId,
    planName,
    taskPlanPath,
    findingsPath,
    progressPath,
    actionCount,
    lastFindingsUpdate: new Date(),
    errorStrikes: new Map(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  sessions.set(sessionId, session)
  errorStrikes.set(sessionId, new Map())

  return session
}

/**
 * Read the task plan content
 */
export async function readTaskPlan(session: PlanningSession): Promise<string> {
  return fs.promises.readFile(session.taskPlanPath, "utf-8")
}

/**
 * Read the findings content
 */
export async function readFindings(session: PlanningSession): Promise<string> {
  return fs.promises.readFile(session.findingsPath, "utf-8")
}

/**
 * Read the progress content
 */
export async function readProgress(session: PlanningSession): Promise<string> {
  return fs.promises.readFile(session.progressPath, "utf-8")
}

/**
 * Increment action count and check if findings update is needed
 * Returns true if the 2-action threshold is reached
 */
export async function incrementActionCount(session: PlanningSession): Promise<boolean> {
  session.actionCount++
  session.updatedAt = new Date()

  // Update findings file with new count
  const content = await readFindings(session)
  const updatedContent = updateFindingsActionCount(content, session.actionCount)
  await fs.promises.writeFile(session.findingsPath, updatedContent)

  // Return true if 2-action threshold reached
  return session.actionCount >= 2
}

/**
 * Reset action count after findings update
 */
export async function resetActionCount(session: PlanningSession): Promise<void> {
  session.actionCount = 0
  session.lastFindingsUpdate = new Date()
  session.updatedAt = new Date()

  const content = await readFindings(session)
  const updatedContent = resetFindingsActionCount(content)
  await fs.promises.writeFile(session.findingsPath, updatedContent)
}

/**
 * Record an error and increment strike count
 * Returns the current strike count for this error
 */
export function recordErrorStrike(sessionId: string, errorKey: string): number {
  const sessionStrikes = errorStrikes.get(sessionId) || new Map()
  const currentStrikes = sessionStrikes.get(errorKey) || 0
  const newStrikes = currentStrikes + 1
  sessionStrikes.set(errorKey, newStrikes)
  errorStrikes.set(sessionId, sessionStrikes)
  return newStrikes
}

/**
 * Get current strike count for an error
 */
export function getErrorStrikes(sessionId: string, errorKey: string): number {
  const sessionStrikes = errorStrikes.get(sessionId)
  return sessionStrikes?.get(errorKey) || 0
}

/**
 * Clear strikes for an error (after resolution)
 */
export function clearErrorStrikes(sessionId: string, errorKey: string): void {
  const sessionStrikes = errorStrikes.get(sessionId)
  if (sessionStrikes) {
    sessionStrikes.delete(errorKey)
  }
}

/**
 * Get 3-strike protocol guidance based on strike count
 */
export function getStrikeGuidance(strikeCount: number): string {
  switch (strikeCount) {
    case 1:
      return "Strike 1: Diagnose the root cause. Analyze error messages and context carefully."
    case 2:
      return "Strike 2: Try alternative approaches. The current method isn't working."
    case 3:
      return "Strike 3: Rethink your assumptions. Something fundamental may be wrong."
    default:
      return "Strike 4+: ESCALATE. Ask for help, block the phase, or reconsider the entire approach."
  }
}

/**
 * Update phase status in the task plan
 */
export async function updatePhaseStatus(
  session: PlanningSession,
  phase: number,
  status: PhaseStatus
): Promise<void> {
  // Update task_plan.md
  const taskPlanContent = await readTaskPlan(session)
  const statusRegex = new RegExp(
    `(\\|\\s*${phase}\\s*\\|[^|]+\\|\\s*)(pending|in_progress|complete|blocked)(\\s*\\|)`,
    "m"
  )
  const updatedTaskPlan = taskPlanContent.replace(statusRegex, `$1${status}$3`)
  await fs.promises.writeFile(session.taskPlanPath, updatedTaskPlan)

  // Update progress.md
  const progressContent = await readProgress(session)
  const updatedProgress = updateProgressPhaseStatus(progressContent, phase, status)
  await fs.promises.writeFile(session.progressPath, updatedProgress)

  session.updatedAt = new Date()
}

/**
 * Add an action log entry to progress
 */
export async function logAction(
  session: PlanningSession,
  phase: number,
  action: string,
  filesModified?: string[]
): Promise<void> {
  const content = await readProgress(session)
  let updatedContent = addPhaseLogEntry(content, phase, action, filesModified)
  updatedContent = updateLastActivity(updatedContent)
  await fs.promises.writeFile(session.progressPath, updatedContent)
  session.updatedAt = new Date()
}

/**
 * Add a decision to the task plan
 */
export async function addDecision(
  session: PlanningSession,
  decision: string,
  rationale: string,
  phase: number
): Promise<void> {
  const content = await readTaskPlan(session)

  // Find the decisions table and add a new row
  const tableEndRegex = /(\| - \| \(none yet\) \| - \| - \|)/
  const existingRowsRegex = /(\| \d+ \| [^|]+ \| [^|]+ \| [^|]+ \|)\s*$/m

  // Get next decision number
  const decisionMatches = content.match(/\| (\d+) \| [^|]+ \| [^|]+ \| [^|]+ \|/g) || []
  const nextId = decisionMatches.length > 0
    ? Math.max(...decisionMatches.map(m => parseInt(m.match(/\| (\d+)/)?.[1] || "0", 10))) + 1
    : 1

  const newRow = `| ${nextId} | ${decision} | ${rationale} | ${phase} |`

  let updatedContent: string
  if (tableEndRegex.test(content)) {
    // Replace placeholder row
    updatedContent = content.replace(tableEndRegex, newRow)
  } else {
    // Add to existing rows
    updatedContent = content.replace(existingRowsRegex, `$1\n${newRow}`)
  }

  await fs.promises.writeFile(session.taskPlanPath, updatedContent)
  session.updatedAt = new Date()
}

/**
 * Add an error to the task plan
 */
export async function addError(
  session: PlanningSession,
  error: string,
  attempt: number,
  action: string,
  resolution?: string
): Promise<void> {
  const content = await readTaskPlan(session)

  // Find the errors table and add a new row
  const tableEndRegex = /(\| - \| \(none yet\) \| - \| - \| - \|)/
  const existingRowsRegex = /(\| \d+ \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \|)\s*$/m

  // Get next error number
  const errorMatches = content.match(/\| (\d+) \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \|/g) || []
  const nextId = errorMatches.length > 0
    ? Math.max(...errorMatches.map(m => parseInt(m.match(/\| (\d+)/)?.[1] || "0", 10))) + 1
    : 1

  const newRow = `| ${nextId} | ${error.slice(0, 50)}${error.length > 50 ? "..." : ""} | ${attempt} | ${action} | ${resolution || "-"} |`

  let updatedContent: string
  if (tableEndRegex.test(content)) {
    // Replace placeholder row
    updatedContent = content.replace(tableEndRegex, newRow)
  } else {
    // Add to existing rows
    updatedContent = content.replace(existingRowsRegex, `$1\n${newRow}`)
  }

  await fs.promises.writeFile(session.taskPlanPath, updatedContent)
  session.updatedAt = new Date()
}

/**
 * Check if all phases are complete
 */
export async function areAllPhasesComplete(session: PlanningSession): Promise<boolean> {
  const content = await readTaskPlan(session)
  const parsed = parseTaskPlan(content)

  return parsed.phases.length > 0 && parsed.phases.every(p => p.status === "complete")
}

/**
 * Get incomplete phases
 */
export async function getIncompletePhases(session: PlanningSession): Promise<string[]> {
  const content = await readTaskPlan(session)
  const parsed = parseTaskPlan(content)

  return parsed.phases
    .filter(p => p.status !== "complete")
    .map(p => `Phase ${p.id}: ${p.name} (${p.status})`)
}

/**
 * Generate a context summary for re-reading before tool use
 */
export async function generateRereadContext(session: PlanningSession): Promise<string> {
  const [taskPlan, findings] = await Promise.all([
    readTaskPlan(session),
    readFindings(session),
  ])

  const parsed = parseTaskPlan(taskPlan)
  const currentPhase = parsed.phases.find(p => p.status === "in_progress")
  const pendingPhases = parsed.phases.filter(p => p.status === "pending")
  const completedPhases = parsed.phases.filter(p => p.status === "complete")

  return `<planning-context plan="${session.planName}">
## Goal
${parsed.goal}

## Current Status
- Completed: ${completedPhases.length}/${parsed.phases.length} phases
- Current Phase: ${currentPhase ? `${currentPhase.id}. ${currentPhase.name}` : "None in progress"}
- Pending: ${pendingPhases.length} phases

## Recent Decisions
${parsed.decisions.slice(-3).map(d => `- ${d.decision}`).join("\n") || "- None yet"}

## Active Errors
${parsed.errors.filter(e => !e.resolution || e.resolution === "-").slice(-3).map(e => `- ${e.error} (attempt ${e.attempt})`).join("\n") || "- None"}

## Reminder
Stay focused on the goal. Check task_plan.md if you need more context.
</planning-context>`
}

/**
 * Clean up session
 */
export function cleanupSession(sessionId: string): void {
  sessions.delete(sessionId)
  errorStrikes.delete(sessionId)
}
