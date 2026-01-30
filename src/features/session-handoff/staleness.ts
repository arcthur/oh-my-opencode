/**
 * Staleness Detection for Session Handoffs
 *
 * Detects whether handoff context is stale by comparing file modification times
 * against the handoff creation timestamp.
 */

import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"
import type { HandoffPackage } from "./types"

// ============================================================================
// Types
// ============================================================================

export interface StalenessInfo {
  /** Total files checked */
  totalFiles: number
  /** Files modified after handoff creation */
  modifiedFiles: string[]
  /** Staleness percentage (0-100) */
  stalenessPercent: number
  /** Whether the handoff should be considered stale */
  isStale: boolean
}

// ============================================================================
// Safety Validation
// ============================================================================

/**
 * Check if a file path is safe for project-relative access
 */
export function isSafeProjectRelativePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") return false
  if (filePath.includes("\0")) return false

  // Disallow absolute paths (POSIX + Windows) and drive-letter paths
  if (filePath.startsWith("/") || filePath.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return false
  }

  const parts = filePath.split(/[\\/]+/)
  if (parts.some((p) => p === "..")) return false

  return true
}

// ============================================================================
// Staleness Detection
// ============================================================================

/**
 * Check handoff staleness by comparing file modification times
 */
export function checkHandoffStaleness(pkg: HandoffPackage, projectPath: string): StalenessInfo {
  const handoffTime = pkg.createdAt
  const keyFiles = pkg.metadata.keyFiles
  const artifactFiles = pkg.payload.artifacts.map((a) => a.path)

  // Combine and dedupe files to check
  const filesToCheck = [...new Set([...keyFiles, ...artifactFiles])]

  if (filesToCheck.length === 0) {
    return { totalFiles: 0, modifiedFiles: [], stalenessPercent: 0, isStale: false }
  }

  const modifiedFiles: string[] = []

  for (const file of filesToCheck) {
    if (!isSafeProjectRelativePath(file)) {
      modifiedFiles.push(file)
      continue
    }

    try {
      const fullPath = join(projectPath, file)

      // First, try git to get the last modification time (more accurate for version control)
      const gitTime = getGitFileModTime(projectPath, file)
      if (gitTime && gitTime > handoffTime) {
        modifiedFiles.push(file)
        continue
      }

      // Fallback to filesystem mtime
      const stats = statSync(fullPath)
      if (stats.mtimeMs > handoffTime) {
        modifiedFiles.push(file)
      }
    } catch {
      // File doesn't exist or can't be accessed - consider it modified
      modifiedFiles.push(file)
    }
  }

  const stalenessPercent = (modifiedFiles.length / filesToCheck.length) * 100
  // Consider stale if >50% of files modified or handoff is old (>3 days) with any modifications
  const ageMs = Date.now() - handoffTime
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const isStale = stalenessPercent > 50 || (ageDays > 3 && modifiedFiles.length > 0)

  return {
    totalFiles: filesToCheck.length,
    modifiedFiles,
    stalenessPercent: Math.round(stalenessPercent),
    isStale,
  }
}

/**
 * Get file modification time from git (last commit time)
 *
 * Note: This is synchronous and may be slow for many files.
 * Consider batching or caching for performance-critical paths.
 */
export function getGitFileModTime(projectPath: string, file: string): number | null {
  try {
    const result = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", file],
      { cwd: projectPath, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()

    if (result) {
      // Git returns Unix timestamp in seconds
      return parseInt(result, 10) * 1000
    }
  } catch {
    // Not a git repo or file not tracked
  }
  return null
}

/**
 * Format staleness warning for display
 */
export function formatStalenessWarning(staleness: StalenessInfo): string {
  if (!staleness.isStale) return ""

  const lines = [
    `⚠️ **Staleness Warning**: ${staleness.stalenessPercent}% of related files have been modified since this session.`,
  ]

  if (staleness.modifiedFiles.length <= 5) {
    lines.push(`Modified: ${staleness.modifiedFiles.join(", ")}`)
  } else {
    lines.push(`Modified: ${staleness.modifiedFiles.slice(0, 5).join(", ")} and ${staleness.modifiedFiles.length - 5} more`)
  }

  lines.push("*Some decisions or context may be outdated. Verify before applying.*\n")

  return lines.join("\n")
}
