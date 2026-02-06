/**
 * Planning with Files Manager
 *
 * Canonical layout (single plan directory model):
 * .sisyphus/plans/{planId}/plan.md
 * .sisyphus/plans/{planId}/ledger.yaml
 * .sisyphus/plans/{planId}/findings.md
 * .sisyphus/plans/{planId}/progress.md
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as yaml from "js-yaml"
import { createWorkStateManager } from "../work-state"
import type { PlanningWithFilesConfig } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"

export type TodoStatus = "pending" | "complete"

export interface PlanTodo {
  id: number
  title: string
  status: TodoStatus
}

interface LedgerErrorRecord {
  key: string
  strikes?: number
  phase?: string
  root_cause?: string
  resolution?: string
  recorded_at?: string
}

interface LedgerState {
  schema_version: number
  plan_id: string
  errors: LedgerErrorRecord[]
  blockers: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  updated_at: string
}

const DEFAULT_LEDGER_SCHEMA_VERSION = 1

/** Track last known todo statuses for reflection detection */
const todoStatusCache = new Map<string, Map<number, TodoStatus>>()

function getTodoCacheKey(cwd: string, planId: string): string {
  return `${cwd}:${planId}`
}

export function getPlanDir(cwd: string, planId: string, _config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(cwd, ".sisyphus", "plans", planId)
}

export function getExecutionPlanPath(cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(getPlanDir(cwd, planId, config), "plan.md")
}

export function getLedgerPath(cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(getPlanDir(cwd, planId, config), "ledger.yaml")
}

function getFindingsPath(cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(getPlanDir(cwd, planId, config), "findings.md")
}

function getProgressPath(cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG): string {
  return path.join(getPlanDir(cwd, planId, config), "progress.md")
}

export async function readPlan(
  cwd: string,
  planId: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<string | null> {
  const planPath = getExecutionPlanPath(cwd, planId, config)
  try {
    return await fs.promises.readFile(planPath, "utf-8")
  } catch {
    return null
  }
}

export async function writePlan(
  cwd: string,
  planId: string,
  content: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<void> {
  const planPath = getExecutionPlanPath(cwd, planId, config)
  await fs.promises.writeFile(planPath, content, "utf-8")
}

export async function readLedger(
  cwd: string,
  planId: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<LedgerState | null> {
  const ledgerPath = getLedgerPath(cwd, planId, config)
  try {
    const raw = await fs.promises.readFile(ledgerPath, "utf-8")
    const parsed = yaml.load(raw) as Partial<LedgerState> | null
    if (!parsed || typeof parsed !== "object") return null

    return {
      schema_version: Number(parsed.schema_version ?? DEFAULT_LEDGER_SCHEMA_VERSION),
      plan_id: String(parsed.plan_id ?? planId),
      errors: Array.isArray(parsed.errors) ? parsed.errors as LedgerErrorRecord[] : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers as Array<Record<string, unknown>> : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions as Array<Record<string, unknown>> : [],
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function writeLedger(
  cwd: string,
  planId: string,
  ledger: LedgerState,
  config = DEFAULT_PLANNING_CONFIG
): Promise<void> {
  const ledgerPath = getLedgerPath(cwd, planId, config)
  const normalized: LedgerState = {
    ...ledger,
    schema_version: DEFAULT_LEDGER_SCHEMA_VERSION,
    plan_id: planId,
    updated_at: new Date().toISOString(),
  }
  await fs.promises.writeFile(ledgerPath, yaml.dump(normalized, { indent: 2 }), "utf-8")
}

function getPlanMtime(planPath: string): number {
  try {
    return fs.statSync(planPath).mtimeMs
  } catch {
    return 0
  }
}

export async function detectActivePlan(
  cwd: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<string | null> {
  const workState = createWorkStateManager(cwd).load()
  const activePlanId = workState?.plan_id
  if (activePlanId) {
    const activePlanPath = getExecutionPlanPath(cwd, activePlanId, config)
    if (fs.existsSync(activePlanPath)) return activePlanId
  }

  const plansDir = path.join(cwd, ".sisyphus", "plans")
  try {
    const entries = await fs.promises.readdir(plansDir, { withFileTypes: true })
    let latestPlanId: string | null = null
    let latestMtime = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const planPath = path.join(plansDir, entry.name, "plan.md")
      if (!fs.existsSync(planPath)) continue

      const mtime = getPlanMtime(planPath)
      if (mtime > latestMtime) {
        latestMtime = mtime
        latestPlanId = entry.name
      }
    }

    return latestPlanId
  } catch {
    return null
  }
}

export async function initializePlan(
  cwd: string,
  planId: string,
  goal: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<{ planPath: string; ledgerPath: string; findingsPath: string; progressPath: string }> {
  const planDir = getPlanDir(cwd, planId, config)
  await fs.promises.mkdir(planDir, { recursive: true })

  const planPath = getExecutionPlanPath(cwd, planId, config)
  const ledgerPath = getLedgerPath(cwd, planId, config)
  const findingsPath = getFindingsPath(cwd, planId, config)
  const progressPath = getProgressPath(cwd, planId, config)

  const nowIso = new Date().toISOString()
  const today = nowIso.split("T")[0]

  const planTemplate = `# Plan: ${planId}

> **Goal**: ${goal}

## TODOs

- [ ] 1. Discovery
- [ ] 2. Implementation
- [ ] 3. Verification

## Notes

- Keep TODO numbering stable.
- Use \`ledger.yaml\` for runtime error/blocker tracking.

---
*Created: ${today}*
`

  const ledgerTemplate: LedgerState = {
    schema_version: DEFAULT_LEDGER_SCHEMA_VERSION,
    plan_id: planId,
    errors: [],
    blockers: [],
    decisions: [],
    updated_at: nowIso,
  }

  const findingsTemplate = `# Findings: ${planId}

## Research

| Source | Finding |
|--------|---------|
| - | (update after 2 actions) |

## Resources

| Name | URL |
|------|-----|
| - | - |

---
*Last updated: ${today}*
`

  const progressTemplate = `# Progress: ${planId}

## Session Log

| Time | Action | Files |
|------|--------|-------|
| ${nowIso.split("T")[1]?.slice(0, 5)} | Session started | - |
`

  const writes: Array<Promise<void>> = []
  if (!fs.existsSync(planPath)) {
    writes.push(fs.promises.writeFile(planPath, planTemplate, "utf-8"))
  }
  if (!fs.existsSync(ledgerPath)) {
    writes.push(fs.promises.writeFile(ledgerPath, yaml.dump(ledgerTemplate, { indent: 2 }), "utf-8"))
  }
  if (!fs.existsSync(findingsPath)) {
    writes.push(fs.promises.writeFile(findingsPath, findingsTemplate, "utf-8"))
  }
  if (!fs.existsSync(progressPath)) {
    writes.push(fs.promises.writeFile(progressPath, progressTemplate, "utf-8"))
  }

  await Promise.all(writes)
  return { planPath, ledgerPath, findingsPath, progressPath }
}

function findTodoSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/g)
  const start = lines.findIndex((line) => /^##\s+TODOs\b/i.test(line.trim()))
  if (start === -1) return markdown

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]?.trim() ?? "")) {
      end = i
      break
    }
  }

  return lines.slice(start + 1, end).join("\n")
}

export function parsePlanTodos(content: string): PlanTodo[] {
  const section = findTodoSection(content)
  const lines = section.split(/\r?\n/g)
  const todos: PlanTodo[] = []

  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(\d+)\.\s*(.+?)\s*$/)
    if (!match) continue

    todos.push({
      id: Number.parseInt(match[2] ?? "", 10),
      title: (match[3] ?? "").trim(),
      status: (match[1] ?? "").toLowerCase() === "x" ? "complete" : "pending",
    })
  }

  return todos.filter((todo) => Number.isFinite(todo.id) && todo.title.length > 0)
}

export function detectTodoCompletion(
  cwd: string,
  planId: string,
  currentTodos: PlanTodo[]
): Array<{ id: number; name: string }> {
  const cacheKey = getTodoCacheKey(cwd, planId)
  const previousStatuses = todoStatusCache.get(cacheKey)

  if (!previousStatuses) {
    const initialCache = new Map<number, TodoStatus>()
    for (const todo of currentTodos) {
      initialCache.set(todo.id, todo.status)
    }
    todoStatusCache.set(cacheKey, initialCache)
    return []
  }

  const completed: Array<{ id: number; name: string }> = []
  for (const todo of currentTodos) {
    const previous = previousStatuses.get(todo.id)
    if (todo.status === "complete" && previous !== "complete") {
      completed.push({ id: todo.id, name: todo.title })
    }
  }

  const nextCache = new Map<number, TodoStatus>()
  for (const todo of currentTodos) {
    nextCache.set(todo.id, todo.status)
  }
  todoStatusCache.set(cacheKey, nextCache)

  return completed
}

export function getStrikeGuidance(strikes: number, requiresRecording: boolean): string {
  const recordingNote = requiresRecording
    ? "\n\n**REQUIRED**: Record this error in ledger.yaml before continuing."
    : ""

  switch (strikes) {
    case 1:
      return "**Strike 1/3**: Diagnose - Read error carefully, check context"
    case 2:
      return `**Strike 2/3**: Pivot - Try alternative approach${recordingNote}`
    case 3:
      return `**Strike 3/3**: Reassess - Review assumptions, consider blocking task${recordingNote}`
    default:
      return `**Strike ${strikes}/3**: ESCALATE - Add to ledger.yaml blockers and ask for help${recordingNote}`
  }
}

export function generateReflectionPrompt(
  completedTodo: { id: number; name: string },
  allTodos: PlanTodo[]
): string {
  const remainingTodos = allTodos
    .filter((todo) => todo.status === "pending")
    .map((todo) => `  - TODO ${todo.id}: ${todo.title} (${todo.status})`)
    .join("\n")

  return `<phase-reflection>
## TODO ${completedTodo.id} Complete: ${completedTodo.name}

**Before proceeding, reflect on:**

1. **Discoveries**: Did you learn anything that affects the remaining plan?
2. **Assumptions**: Were any assumptions proven wrong?
3. **Remaining TODOs**: Do they still make sense?
${remainingTodos ? `\n**Remaining:**\n${remainingTodos}` : ""}

**Actions you can take:**
- Add new TODOs if needed
- Remove TODOs that are no longer relevant
- Reorder TODOs based on new understanding
- Update TODO descriptions with new context

**Update plan.md if any changes are needed, then continue.**
</phase-reflection>`
}

export function generateErrorRecordingPrompt(
  errorKey: string,
  strikes: number,
  currentTodo: number | null
): string {
  const todoNote = currentTodo ? `TODO ${currentTodo}` : "Current TODO"

  return `<error-recording-required>
## Record Error Before Continuing

This error has occurred ${strikes} times. You MUST record it in ledger.yaml before retrying.

**Add under \`errors\` in \`ledger.yaml\`:**
- key: ${errorKey.slice(0, 80)}
- todo: ${todoNote}
- attempts: ${strikes}
- root_cause: [ANALYZE]
- resolution: [PLAN]

**Required fields:**
- **Root Cause**: Why is this happening? (not just "it failed")
- **Resolution**: What different approach will you try?

${strikes >= 3 ? `
**Consider adding to \`blockers\` if:**
- The error requires external input (credentials, permissions)
- Multiple approaches have failed
- The issue is outside your control
` : ""}
</error-recording-required>`
}

export function generateBlockerPrompt(issue: string, todoId: number | null): string {
  return `<blocker-detected>
## Blocker Identified

This issue requires escalation. Record it in ledger.yaml blockers:

- blocker: ${issue.slice(0, 80)}
- todo: ${todoId ?? "?"}
- impact: [DESCRIBE]
- status: open
- escalation: [WHAT NEEDED]

**Then:**
1. Mark the affected TODO as \`blocked\` in plan.md
2. Consider if other TODOs can proceed in parallel
3. Communicate the blocker to the user

</blocker-detected>`
}

export async function isErrorRecorded(
  cwd: string,
  planId: string,
  errorKey: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<boolean> {
  const ledger = await readLedger(cwd, planId, config)
  if (!ledger) return false
  const normalizedError = errorKey.slice(0, 80).toLowerCase()
  return ledger.errors.some((entry) => entry.key.toLowerCase().includes(normalizedError))
}

export function getCurrentTodo(todos: PlanTodo[]): number | null {
  const pending = todos.find((todo) => todo.status === "pending")
  return pending ? pending.id : null
}

export function cleanupSession(cwd: string, planId: string): void {
  todoStatusCache.delete(getTodoCacheKey(cwd, planId))
}

export const readFindings = async (cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG) =>
  fs.promises.readFile(getFindingsPath(cwd, planId, config), "utf-8")

export const readProgress = async (cwd: string, planId: string, config = DEFAULT_PLANNING_CONFIG) =>
  fs.promises.readFile(getProgressPath(cwd, planId, config), "utf-8")

export const areAllTodosComplete = async (
  cwd: string,
  planId: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<boolean> => {
  const content = await readPlan(cwd, planId, config)
  if (!content) return false
  const todos = parsePlanTodos(content)
  return todos.length > 0 && todos.every((todo) => todo.status === "complete")
}

export const getIncompleteTodos = async (
  cwd: string,
  planId: string,
  config = DEFAULT_PLANNING_CONFIG
): Promise<string[]> => {
  const content = await readPlan(cwd, planId, config)
  if (!content) return []
  return parsePlanTodos(content)
    .filter((todo) => todo.status !== "complete")
    .map((todo) => `TODO ${todo.id}: ${todo.title} (${todo.status})`)
}
