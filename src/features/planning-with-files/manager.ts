/**
 * Planning with Files Manager
 *
 * Canonical layout (single plan directory model):
 * .orchestrator/plans/{planId}/plan.md
 * .orchestrator/plans/{planId}/ledger.yaml
 * .orchestrator/plans/{planId}/findings.md
 * .orchestrator/plans/{planId}/progress.md
 *
 * Note: TaskGraph is the execution source of truth.
 * plan.md is a human-readable artifact and should not be treated as SSOT.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as yaml from "js-yaml"
import { createWorkStateManager } from "../work-state"
import type { PlanningWithFilesConfig } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"

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

export function getPlanDir(
  cwd: string,
  planId: string,
  _config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): string {
  return path.join(cwd, ".orchestrator", "plans", planId)
}

export function getExecutionPlanPath(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): string {
  return path.join(getPlanDir(cwd, planId, config), "plan.md")
}

export function getLedgerPath(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): string {
  return path.join(getPlanDir(cwd, planId, config), "ledger.yaml")
}

function getFindingsPath(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): string {
  return path.join(getPlanDir(cwd, planId, config), "findings.md")
}

function getProgressPath(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): string {
  return path.join(getPlanDir(cwd, planId, config), "progress.md")
}

export async function readPlan(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
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
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): Promise<void> {
  const planPath = getExecutionPlanPath(cwd, planId, config)
  await fs.promises.writeFile(planPath, content, "utf-8")
}

export async function readLedger(
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): Promise<LedgerState | null> {
  const ledgerPath = getLedgerPath(cwd, planId, config)
  try {
    const raw = await fs.promises.readFile(ledgerPath, "utf-8")
    const parsed = yaml.load(raw) as Partial<LedgerState> | null
    if (!parsed || typeof parsed !== "object") return null

    return {
      schema_version: Number(parsed.schema_version ?? DEFAULT_LEDGER_SCHEMA_VERSION),
      plan_id: String(parsed.plan_id ?? planId),
      errors: Array.isArray(parsed.errors) ? (parsed.errors as LedgerErrorRecord[]) : [],
      blockers: Array.isArray(parsed.blockers) ? (parsed.blockers as Array<Record<string, unknown>>) : [],
      decisions: Array.isArray(parsed.decisions) ? (parsed.decisions as Array<Record<string, unknown>>) : [],
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
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
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
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): Promise<string | null> {
  const workState = createWorkStateManager(cwd).load()
  const activePlanId = workState?.plan_id
  if (activePlanId) {
    const activePlanPath = getExecutionPlanPath(cwd, activePlanId, config)
    if (fs.existsSync(activePlanPath)) return activePlanId
  }

  const plansDir = path.join(cwd, ".orchestrator", "plans")
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
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
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

## Tasks

- 1. Discovery
- 2. Implementation
- 3. Verification

## Notes

- Keep task numbers stable.
- Track execution state in TaskGraph (scope=plan, container_id=${planId}).
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

export async function isErrorRecorded(
  cwd: string,
  planId: string,
  errorKey: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
): Promise<boolean> {
  const ledger = await readLedger(cwd, planId, config)
  if (!ledger) return false
  const normalizedError = errorKey.slice(0, 80).toLowerCase()
  return ledger.errors.some((entry) => entry.key.toLowerCase().includes(normalizedError))
}

export const readFindings = async (
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
) => fs.promises.readFile(getFindingsPath(cwd, planId, config), "utf-8")

export const readProgress = async (
  cwd: string,
  planId: string,
  config: PlanningWithFilesConfig = DEFAULT_PLANNING_CONFIG
) => fs.promises.readFile(getProgressPath(cwd, planId, config), "utf-8")
