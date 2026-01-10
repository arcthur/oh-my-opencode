/**
 * Planning with Files - Multi-Plan Integration
 *
 * Integrates the 3-file planning pattern with the multi-model planning system.
 * When multi-plan generates a unified plan, this module can optionally
 * create the full planning file structure for execution tracking.
 */

import * as fs from "fs"
import * as path from "path"
import type { MultiPlanSession, MultiPlanResult } from "../multi-plan/types"
import type { PlanningSession, PlanningWithFilesConfig } from "./types"
import { DEFAULT_PLANNING_CONFIG } from "./types"
import {
  generateTaskPlanTemplate,
  generateFindingsTemplate,
  generateProgressTemplate,
} from "./templates"
import { getPlanningSession, cleanupSession } from "./manager"

/** Result of initializing planning files from a multi-plan result */
export interface PlanningFilesFromMultiPlan {
  taskPlanPath: string
  findingsPath: string
  progressPath: string
  session: PlanningSession
}

/**
 * Create the 3-file planning structure from a completed multi-plan session.
 *
 * This extracts the goal and phases from the unified plan and creates:
 * - task_plan.md with phases from the multi-plan output
 * - findings.md with research from all model plans
 * - progress.md for execution tracking
 */
export async function createPlanningFilesFromMultiPlan(
  result: MultiPlanResult,
  cwd: string,
  config: Partial<PlanningWithFilesConfig> = {}
): Promise<PlanningFilesFromMultiPlan> {
  const fullConfig = { ...DEFAULT_PLANNING_CONFIG, ...config }
  const planName = result.session.planName

  // Read the final unified plan
  const finalPlanPath = path.resolve(cwd, result.finalPlanPath)
  const finalPlanContent = await fs.promises.readFile(finalPlanPath, "utf-8")

  // Extract goal from the unified plan
  const goalMatch = finalPlanContent.match(/##\s*(?:Goal|Objective|Context)[:\s]*\n([^\n]+)/) ||
    finalPlanContent.match(/>\s*\*\*Goal\*\*:\s*(.+)/)
  const goal = goalMatch ? goalMatch[1].trim() : `Execute plan: ${planName}`

  // Extract phases/TODOs from the unified plan
  const phases = extractPhasesFromPlan(finalPlanContent)

  // Extract key questions and research findings
  const { keyQuestions, requirements, findings } = extractResearchFromMultiPlan(result, cwd)

  // Create planning directory
  const planningDir = path.join(cwd, ".sisyphus", fullConfig.directory, planName)
  await fs.promises.mkdir(planningDir, { recursive: true })

  // Generate files
  const taskPlanPath = path.join(planningDir, "task_plan.md")
  const findingsPath = path.join(planningDir, "findings.md")
  const progressPath = path.join(planningDir, "progress.md")

  const taskPlanContent = generateTaskPlanTemplate({
    goal,
    planName,
    phases: phases.map(p => ({ name: p.name, description: p.description })),
    keyQuestions,
  })

  const findingsContent = generateFindingsWithResearch({
    planName,
    requirements,
    findings,
    resources: extractResourcesFromPlan(finalPlanContent),
  })

  const progressContent = generateProgressTemplate({
    planName,
    phases: phases.map(p => ({ name: p.name })),
  })

  // Write files
  await Promise.all([
    fs.promises.writeFile(taskPlanPath, taskPlanContent),
    fs.promises.writeFile(findingsPath, findingsContent),
    fs.promises.writeFile(progressPath, progressContent),
  ])

  // Create session object
  const session: PlanningSession = {
    id: result.session.id,
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

  return {
    taskPlanPath,
    findingsPath,
    progressPath,
    session,
  }
}

/**
 * Extract phases from a unified plan
 */
function extractPhasesFromPlan(content: string): Array<{ name: string; description: string }> {
  const phases: Array<{ name: string; description: string }> = []

  // Try to find TODOs section
  const todoMatch = content.match(/##\s*TODOs?[\s\S]*?(?=##|$)/i)
  if (todoMatch) {
    // Match numbered items or checkbox items
    const itemRegex = /(?:\d+\.|[-*]\s*\[[ x]\])\s*([^\n]+)/gi
    let match
    while ((match = itemRegex.exec(todoMatch[0])) !== null) {
      const item = match[1].trim()
      // Skip reference lines
      if (item.startsWith("→") || item.startsWith("Ref:")) continue

      phases.push({
        name: item.slice(0, 50) + (item.length > 50 ? "..." : ""),
        description: item,
      })
    }
  }

  // Try phase headers if no TODOs found
  if (phases.length === 0) {
    const phaseRegex = /###\s*(?:Phase\s*\d+[:.]?\s*)?([^\n]+)/gi
    let match
    while ((match = phaseRegex.exec(content)) !== null) {
      const name = match[1].trim()
      if (!name.toLowerCase().includes("conflict") &&
          !name.toLowerCase().includes("comparison")) {
        phases.push({ name, description: name })
      }
    }
  }

  // Default phases if nothing found
  if (phases.length === 0) {
    return [
      { name: "Setup & Preparation", description: "Initial setup and environment preparation" },
      { name: "Core Implementation", description: "Implement the main functionality" },
      { name: "Testing & Verification", description: "Test and verify the implementation" },
      { name: "Finalization", description: "Final touches and documentation" },
    ]
  }

  return phases.slice(0, 10) // Max 10 phases
}

/**
 * Extract research findings from all model plans in a multi-plan session
 */
function extractResearchFromMultiPlan(
  result: MultiPlanResult,
  cwd: string
): { keyQuestions: string[]; requirements: string[]; findings: string[] } {
  const keyQuestions: string[] = []
  const requirements: string[] = []
  const findings: string[] = []

  // Read comparison report for synthesized findings
  try {
    const comparisonPath = path.resolve(cwd, result.comparisonReportPath)
    const comparisonContent = fs.readFileSync(comparisonPath, "utf-8")

    // Extract key insights from conflicts
    const conflictMatches = comparisonContent.match(/### CONFLICT:([^\n]+)/g)
    if (conflictMatches) {
      keyQuestions.push(...conflictMatches.map(m =>
        `How to handle: ${m.replace("### CONFLICT:", "").trim()}?`
      ).slice(0, 5))
    }

    // Extract recommendations
    const recommendationMatches = comparisonContent.match(/\*\*RECOMMENDATION\*\*:([^\n]+)/g)
    if (recommendationMatches) {
      findings.push(...recommendationMatches.map(m =>
        m.replace("**RECOMMENDATION**:", "").trim()
      ))
    }
  } catch {
    // Comparison report not available
  }

  // Read individual plans for requirements and findings
  for (const task of result.session.tasks) {
    if (task.status !== "completed") continue

    try {
      const planPath = path.resolve(cwd, task.outputPath)
      const planContent = fs.readFileSync(planPath, "utf-8")

      // Extract requirements
      const reqMatch = planContent.match(/##\s*Requirements?[\s\S]*?(?=##|$)/i)
      if (reqMatch) {
        const reqItems = reqMatch[0].match(/[-*]\s*([^\n]+)/g)
        if (reqItems) {
          requirements.push(...reqItems.map(r =>
            r.replace(/^[-*]\s*/, "").trim()
          ).filter(r => !requirements.includes(r)))
        }
      }

      // Extract key findings
      const findingsMatch = planContent.match(/##\s*(?:Key\s*)?Findings?[\s\S]*?(?=##|$)/i)
      if (findingsMatch) {
        const findingItems = findingsMatch[0].match(/[-*]\s*([^\n]+)/g)
        if (findingItems) {
          findings.push(...findingItems.map(f =>
            `[${task.modelName}] ${f.replace(/^[-*]\s*/, "").trim()}`
          ))
        }
      }
    } catch {
      // Plan not available
    }
  }

  return {
    keyQuestions: keyQuestions.slice(0, 5),
    requirements: [...new Set(requirements)].slice(0, 10),
    findings: findings.slice(0, 10),
  }
}

/**
 * Extract resource URLs from a plan
 */
function extractResourcesFromPlan(content: string): Array<{ name: string; url: string }> {
  const resources: Array<{ name: string; url: string }> = []

  // Match markdown links
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g
  let match
  while ((match = linkRegex.exec(content)) !== null) {
    resources.push({
      name: match[1].trim(),
      url: match[2].trim(),
    })
  }

  // Match bare URLs
  const urlRegex = /(?:^|\s)(https?:\/\/[^\s\)]+)/gm
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[1].trim()
    if (!resources.some(r => r.url === url)) {
      resources.push({
        name: new URL(url).hostname,
        url,
      })
    }
  }

  return resources.slice(0, 10)
}

/**
 * Generate findings content with research from multi-plan
 */
function generateFindingsWithResearch(options: {
  planName: string
  requirements: string[]
  findings: string[]
  resources: Array<{ name: string; url: string }>
}): string {
  const { planName, requirements, findings, resources } = options

  const requirementsList = requirements.length > 0
    ? requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "1. (Pending discovery)"

  const findingsList = findings.length > 0
    ? findings.map((f, i) => `| ${i + 1} | Multi-Plan | ${f} | From synthesis |`).join("\n")
    : "| - | (none yet) | - | - |"

  const resourcesList = resources.length > 0
    ? resources.map(r => `| ${r.name} | ${r.url} | From plan |`).join("\n")
    : "| - | - | - |"

  return `# Findings & Decisions: ${planName}

> **Source**: Generated from Multi-Model Planning synthesis
> **2-Action Rule**: Update this document after every 2 view/search operations.

---

## Requirements

${requirementsList}

---

## Research Findings

| # | Source | Finding | Relevance |
|---|--------|---------|-----------|
${findingsList}

---

## Technical Decisions

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| - | (from unified plan) | - | - |

---

## Issues Encountered

| # | Issue | Root Cause | Resolution |
|---|-------|------------|------------|
| - | (none yet) | - | - |

---

## Resources

| Name | URL | Notes |
|------|-----|-------|
${resourcesList}

---

## Visual/Browser Findings

> **Important**: Multimodal content doesn't persist in context. Capture as text immediately.

| Source | Description | Timestamp |
|--------|-------------|-----------|
| - | - | - |

---

## Notes

- Created: ${new Date().toISOString().split("T")[0]}
- Last Updated: ${new Date().toISOString().split("T")[0]}
- Action Count Since Last Update: 0
- Source: Multi-Model Planning (${planName})

---

> **Reminder**: The 2-Action Rule ensures you never lose important discoveries.
`
}

/**
 * Check if a planning session exists for a given plan name
 */
export function hasPlanningSession(planName: string, cwd: string): boolean {
  const planningDir = path.join(cwd, ".sisyphus", "planning", planName)
  const taskPlanPath = path.join(planningDir, "task_plan.md")
  return fs.existsSync(taskPlanPath)
}

/**
 * Get the planning directory path for a plan
 */
export function getPlanningDirectory(planName: string, cwd: string): string {
  return path.join(cwd, ".sisyphus", "planning", planName)
}

/**
 * Cleanup planning files for a completed or abandoned plan
 */
export async function cleanupPlanningFiles(
  sessionId: string,
  planName: string,
  cwd: string
): Promise<void> {
  // Clean up in-memory session
  cleanupSession(sessionId)

  // Optionally archive or remove files (keeping for now)
  const planningDir = getPlanningDirectory(planName, cwd)
  if (fs.existsSync(planningDir)) {
    // Could move to .sisyphus/archive/ instead of deleting
    // For now, just leave the files for reference
  }
}
