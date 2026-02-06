/**
 * Codemap Cache
 *
 * Caches parsed codemaps for efficient injection.
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import type { CodemapCacheEntry, StalenessCheck } from "./types"
import type { Codemap, CodemapMeta } from "../cartography/types"
import { parseCodemap, extractCodemapSummary } from "../cartography/generator"
import { CODEMAP_FILE_NAME, ROOT_PROJECT_MAP_FILE_NAME, STALENESS_THRESHOLD } from "../cartography/constants"
import { log } from "../../shared"

/**
 * Default cache duration: 5 minutes
 */
const DEFAULT_CACHE_DURATION_MS = 5 * 60 * 1000

/**
 * Codemap cache manager
 */
export class CodemapCache {
  private projectRoot: string
  private cache: Map<string, CodemapCacheEntry> = new Map()
  private cacheDurationMs: number
  private directoryAccessCounts: Map<string, number> = new Map()

  constructor(projectRoot: string, cacheDurationMs: number = DEFAULT_CACHE_DURATION_MS) {
    this.projectRoot = projectRoot
    this.cacheDurationMs = cacheDurationMs
  }

  /**
   * Find codemap for a directory (searches up the tree)
   */
  findForDirectory(dir: string): CodemapCacheEntry | null {
    // Track directory access
    this.trackDirectoryAccess(dir)

    // Search up the directory tree
    let current = dir
    while (current.startsWith(this.projectRoot)) {
      // Check cache for this directory
      const cached = this.getCached(current)
      if (cached) {
        return cached
      }

      const codemapPath = join(current, CODEMAP_FILE_NAME)

      if (existsSync(codemapPath)) {
        const entry = this.loadAndCache(current, codemapPath)
        if (entry) {
          return entry
        }
      }

      // Move up one level
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }

    return null
  }

  /**
   * Get root project map
   */
  getRootProjectMap(): string | null {
    const projectMapPath = join(this.projectRoot, ROOT_PROJECT_MAP_FILE_NAME)

    if (!existsSync(projectMapPath)) {
      return null
    }

    try {
      return readFileSync(projectMapPath, "utf8")
    } catch {
      return null
    }
  }

  /**
   * Get cached entry if still valid
   */
  private getCached(dir: string): CodemapCacheEntry | null {
    const relativePath = relative(this.projectRoot, dir) || "."
    const entry = this.cache.get(relativePath)

    if (!entry) return null

    // Check if cache is still valid
    const now = Date.now()
    if (now - entry.cachedAt > this.cacheDurationMs) {
      this.cache.delete(relativePath)
      return null
    }

    return entry
  }

  /**
   * Load and cache a codemap
   */
  private loadAndCache(dir: string, codemapPath: string): CodemapCacheEntry | null {
    try {
      const codemap = parseCodemap(codemapPath)
      if (!codemap) return null

      const relativePath = relative(this.projectRoot, dir) || "."

      const entry: CodemapCacheEntry = {
        codemap,
        meta: {
          directory: dir,
          filePath: codemapPath,
          generatedAt: codemap.generatedAt,
          sourceHash: "",
          lineCount: readFileSync(codemapPath, "utf8").split("\n").length,
          isRoot: relativePath === ".",
        },
        summary: extractCodemapSummary(codemap),
        cachedAt: Date.now(),
      }

      this.cache.set(relativePath, entry)
      return entry
    } catch (error) {
      log("[codemap-cache] Failed to load codemap:", error)
      return null
    }
  }

  /**
   * Track directory access for cartography suggestions
   */
  private trackDirectoryAccess(dir: string): void {
    const relativePath = relative(this.projectRoot, dir) || "."
    const count = this.directoryAccessCounts.get(relativePath) ?? 0
    this.directoryAccessCounts.set(relativePath, count + 1)
  }

  /**
   * Get directory access count
   */
  getDirectoryAccessCount(dir: string): number {
    const relativePath = relative(this.projectRoot, dir) || "."
    return this.directoryAccessCounts.get(relativePath) ?? 0
  }

  /**
   * Check if project has any codemaps
   */
  hasAnyCodemaps(): boolean {
    // Check root codemap
    if (existsSync(join(this.projectRoot, CODEMAP_FILE_NAME))) {
      return true
    }

    // Check root project map
    if (existsSync(join(this.projectRoot, ROOT_PROJECT_MAP_FILE_NAME))) {
      return true
    }

    return false
  }

  /**
   * Check staleness of a codemap
   */
  checkStaleness(entry: CodemapCacheEntry): StalenessCheck {
    const dir = entry.meta.directory

    try {
      // Compare with stored hash (simplified - would need state access for full check)
      // For now, check file modification times
      const codemapMtime = statSync(entry.meta.filePath).mtime.getTime()

      // Check if any source files are newer than codemap
      const affectedFiles: string[] = []
      const entries = require("node:fs").readdirSync(dir, { withFileTypes: true })

      for (const e of entries) {
        if (!e.isFile()) continue
        if (e.name === CODEMAP_FILE_NAME) continue

        const filePath = join(dir, e.name)
        try {
          const fileMtime = statSync(filePath).mtime.getTime()
          if (fileMtime > codemapMtime) {
            affectedFiles.push(e.name)
          }
        } catch {
          // Skip unreadable files
        }
      }

      const changeRatio = affectedFiles.length / Math.max(1, entries.length - 1)
      const isStale = changeRatio >= STALENESS_THRESHOLD

      return {
        isStale,
        reason: isStale ? `${affectedFiles.length} files changed since codemap generation` : undefined,
        affectedFiles,
        changeRatio,
      }
    } catch (error) {
      log("[codemap-cache] Staleness check failed:", error)
      return {
        isStale: false,
        affectedFiles: [],
        changeRatio: 0,
      }
    }
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear()
    this.directoryAccessCounts.clear()
  }

  /**
   * Clear cache for a specific directory
   */
  clearDirectory(dir: string): void {
    const relativePath = relative(this.projectRoot, dir) || "."
    this.cache.delete(relativePath)
  }

  /**
   * Get all cached directories
   */
  getCachedDirectories(): string[] {
    return [...this.cache.keys()]
  }
}

/**
 * Create a codemap cache instance
 */
export function createCodemapCache(
  projectRoot: string,
  cacheDurationMs?: number
): CodemapCache {
  return new CodemapCache(projectRoot, cacheDurationMs)
}
