import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import type {
  OrgMemory,
  OrgMemoryConfig,
  CodingConvention,
  ArchitecturalDecision,
  ProjectPattern,
} from "./types"
import { DEFAULT_ORG_MEMORY, DEFAULT_CONFIG } from "./types"
import { log } from "../../shared/logger"

const ORG_MEMORY_DIR = ".opencode/memory"
const ORG_MEMORY_FILE = "org.json"

function getOrgMemoryPath(projectDir: string): string {
  return join(projectDir, ORG_MEMORY_DIR, ORG_MEMORY_FILE)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load org memory from project directory
 */
export function loadOrgMemory(projectDir: string): OrgMemory {
  const memoryPath = getOrgMemoryPath(projectDir)

  try {
    if (!existsSync(memoryPath)) {
      return {
        ...DEFAULT_ORG_MEMORY,
        projectName: projectDir.split("/").pop() || "unknown",
      }
    }

    const data = JSON.parse(readFileSync(memoryPath, "utf-8"))
    return { ...DEFAULT_ORG_MEMORY, ...data }
  } catch (error) {
    log("[org-memory] failed to load", { error: String(error) })
    return {
      ...DEFAULT_ORG_MEMORY,
      projectName: projectDir.split("/").pop() || "unknown",
    }
  }
}

/**
 * Save org memory to project directory
 */
export function saveOrgMemory(projectDir: string, memory: OrgMemory): void {
  const memoryPath = getOrgMemoryPath(projectDir)

  try {
    ensureDir(memoryPath)
    memory.updatedAt = Date.now()
    writeFileSync(memoryPath, JSON.stringify(memory, null, 2), "utf-8")
    log("[org-memory] saved", { projectDir })
  } catch (error) {
    log("[org-memory] failed to save", { error: String(error) })
  }
}

/**
 * Add a coding convention
 */
export function addConvention(
  projectDir: string,
  convention: Omit<CodingConvention, "addedAt">
): void {
  const memory = loadOrgMemory(projectDir)

  // Check for duplicates
  const existing = memory.conventions.find(c => c.name === convention.name)
  if (existing) {
    // Update existing
    Object.assign(existing, convention)
  } else {
    memory.conventions.push({
      ...convention,
      addedAt: Date.now(),
    })
  }

  saveOrgMemory(projectDir, memory)
}

/**
 * Add an architectural decision
 */
export function addArchitecturalDecision(
  projectDir: string,
  decision: Omit<ArchitecturalDecision, "decidedAt">
): void {
  const memory = loadOrgMemory(projectDir)

  memory.architecturalDecisions.push({
    ...decision,
    decidedAt: Date.now(),
  })

  saveOrgMemory(projectDir, memory)
}

/**
 * Add a project pattern
 */
export function addPattern(
  projectDir: string,
  pattern: ProjectPattern
): void {
  const memory = loadOrgMemory(projectDir)

  const existing = memory.patterns.find(p => p.name === pattern.name)
  if (existing) {
    Object.assign(existing, pattern)
  } else {
    memory.patterns.push(pattern)
  }

  saveOrgMemory(projectDir, memory)
}

/**
 * Add terminology
 */
export function addTerminology(
  projectDir: string,
  term: string,
  definition: string
): void {
  const memory = loadOrgMemory(projectDir)
  memory.terminology[term] = definition
  saveOrgMemory(projectDir, memory)
}

/**
 * Add a protected path
 */
export function addProtectedPath(projectDir: string, path: string): void {
  const memory = loadOrgMemory(projectDir)

  if (!memory.protectedPaths.includes(path)) {
    memory.protectedPaths.push(path)
    saveOrgMemory(projectDir, memory)
  }
}

/**
 * Add a custom rule (from "remember for project" command)
 */
export function addCustomRule(projectDir: string, rule: string): void {
  const memory = loadOrgMemory(projectDir)

  if (!memory.customRules.includes(rule)) {
    memory.customRules.push(rule)
    saveOrgMemory(projectDir, memory)
    log("[org-memory] added custom rule", { rule: rule.substring(0, 50) })
  }
}

/**
 * Get a formatted summary for context injection
 */
export function getOrgMemorySummary(
  projectDir: string,
  config: OrgMemoryConfig = DEFAULT_CONFIG
): string | null {
  const memory = loadOrgMemory(projectDir)

  const sections: string[] = []

  // Conventions
  if (memory.conventions.length > 0) {
    const conventions = memory.conventions
      .slice(-config.max_conventions)
      .map(c => `- **${c.name}**: ${c.description}`)
      .join("\n")
    sections.push(`### Coding Conventions\n${conventions}`)
  }

  // Architectural Decisions
  if (memory.architecturalDecisions.length > 0) {
    const decisions = memory.architecturalDecisions
      .slice(-config.max_decisions)
      .map(d => `- **${d.title}**: ${d.rationale}`)
      .join("\n")
    sections.push(`### Architectural Decisions\n${decisions}`)
  }

  // Patterns
  if (memory.patterns.length > 0) {
    const patterns = memory.patterns
      .slice(-config.max_patterns)
      .map(p => `- **${p.name}**: ${p.description}`)
      .join("\n")
    sections.push(`### Project Patterns\n${patterns}`)
  }

  // Terminology
  const terms = Object.entries(memory.terminology)
  if (terms.length > 0) {
    const termList = terms
      .slice(0, config.max_terminology)
      .map(([term, def]) => `- **${term}**: ${def}`)
      .join("\n")
    sections.push(`### Project Terminology\n${termList}`)
  }

  // Protected paths
  if (memory.protectedPaths.length > 0) {
    const paths = memory.protectedPaths.map(p => `- ${p}`).join("\n")
    sections.push(`### Protected Paths (DO NOT MODIFY)\n${paths}`)
  }

  // Custom rules
  if (memory.customRules.length > 0) {
    const rules = memory.customRules
      .slice(-config.max_custom_rules)
      .map(r => `- ${r}`)
      .join("\n")
    sections.push(`### Project Rules\n${rules}`)
  }

  if (sections.length === 0) {
    return null
  }

  return `[Project Memory - ${memory.projectName}]\n${sections.join("\n\n")}\n[End Project Memory]`
}
