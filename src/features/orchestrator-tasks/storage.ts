import { join, dirname, isAbsolute } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "fs"
import type { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../config/schema"

/**
 * Environment variable for project root (used in worktree mode)
 *
 * When running in git worktree mode, each worker has a different cwd.
 * To ensure all agents share the same .orchestrator directory, the orchestrator
 * sets this environment variable to the main project directory.
 */
export const ORCHESTRATOR_PROJECT_ROOT_ENV = "ORCHESTRATOR_PROJECT_ROOT"

/**
 * Get the project root directory
 *
 * Priority:
 * 1. ORCHESTRATOR_PROJECT_ROOT environment variable (worktree mode)
 * 2. process.cwd() (default)
 */
export function getProjectRoot(): string {
  return process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] || process.cwd()
}

export function getTeamDir(teamName: string, config: Partial<OhMyOpenCodeConfig>): string {
  const swarmConfig = config.orchestrator?.swarm

  const storagePath = swarmConfig?.storage_path ?? ".orchestrator/teams"

  // Support both absolute and relative paths
  if (isAbsolute(storagePath)) {
    return join(storagePath, teamName)
  }
  return join(getProjectRoot(), storagePath, teamName)
}

export function getInboxPath(teamName: string, agentName: string, config: Partial<OhMyOpenCodeConfig>): string {
  return join(getTeamDir(teamName, config), "inboxes", `${agentName}.json`)
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function readJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    const result = schema.safeParse(parsed)

    if (!result.success) {
      return null
    }

    return result.data
  } catch {
    return null
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  ensureDir(dir)

  // Use a high-uniqueness temp suffix to avoid collisions when multiple
  // atomic writes occur within the same millisecond (can happen in tight loops
  // or across processes on fast filesystems).
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}`

  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}
