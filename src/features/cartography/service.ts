/**
 * Cartography Service
 *
 * Main orchestration layer for cartography operations.
 * Coordinates discovery, analysis, and generation phases.
 */

import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type {
  CartographyOptions,
  CartographyResult,
  CartographyConfig,
  DirectoryInfo,
  DirectoryScore,
  AnalysisResult,
  ChangeReport,
} from "./types"
import { DEFAULT_CARTOGRAPHY_CONFIG } from "./types"
import { CartographyStateManager, createStateManager } from "./state"
import { discoverDirectories, scoreDirectory, createAnalyzer, mergeAnalysisResults } from "./analyzer"
import { generateCodemap, writeCodemap, generateProjectMap } from "./generator"
import { getCodemapPath, CODEMAP_FILE_NAME, getProjectMapPath } from "./constants"
import { hashDirectory } from "./hash-utils"
import { log } from "../../shared"
import { invalidateRepoOverviewCache } from "../../shared/repo-overview-cache"

/**
 * Cartography service options
 */
export interface CartographyServiceOptions {
  /** Plugin context for API access */
  ctx?: PluginInput

  /** Custom configuration */
  config?: Partial<CartographyConfig>

  /** Progress callback */
  onProgress?: (phase: string, message: string) => void
}

/**
 * Main cartography service
 */
export class CartographyService {
  private projectRoot: string
  private config: CartographyConfig
  private stateManager: CartographyStateManager
  private ctx?: PluginInput
  private onProgress?: (phase: string, message: string) => void

  constructor(projectRoot: string, options: CartographyServiceOptions = {}) {
    this.projectRoot = projectRoot
    this.config = { ...DEFAULT_CARTOGRAPHY_CONFIG, ...options.config }
    this.stateManager = createStateManager(projectRoot)
    this.ctx = options.ctx
    this.onProgress = options.onProgress
  }

  private async computeChangeReport(config: CartographyConfig, forceRegenerate: boolean = false): Promise<{
    report: ChangeReport
    directoryMap: Map<string, DirectoryInfo>
  }> {
    // Load state and align stored config for hashing
    await this.stateManager.load()
    this.stateManager.updateConfig({
      includePatterns: config.include_patterns,
      excludePatterns: config.exclude_patterns,
    })

    const state = this.stateManager.getState()
    const trackedDirs = new Set(Object.keys(state.codemaps))
    const directoryMap = new Map<string, DirectoryInfo>()

    // Discover and score all directories (including root) to find new candidates
    const directories = await discoverDirectories(this.projectRoot, config)
    for (const dir of directories) {
      directoryMap.set(dir.relativePath, dir)
    }

    const scores = await this.scoreDirectories(directories)
    const qualifyingDirs = scores
      .filter((s) => s.shouldGenerate)
      .map((s) => directories.find((d) => d.path === s.path))
      .filter((d): d is DirectoryInfo => Boolean(d))

    const changedDirs: string[] = []
    const newDirs: string[] = []
    const deletedDirs: string[] = []
    const staleCodemaps: string[] = []

    const includePatterns = new Set(config.include_patterns)
    const excludePatterns = new Set(config.exclude_patterns)

    // Deleted + stale detection for tracked codemaps
    for (const relPath of trackedDirs) {
      const absDir = join(this.projectRoot, relPath)
      if (!existsSync(absDir)) {
        deletedDirs.push(relPath)
        continue
      }

      const codemapPath = getCodemapPath(absDir)
      if (!existsSync(codemapPath)) {
        staleCodemaps.push(relPath)
      }
    }

    // Changed/new detection for qualifying dirs
    for (const dir of qualifyingDirs) {
      const relPath = dir.relativePath

      if (!trackedDirs.has(relPath)) {
        newDirs.push(relPath)
        continue
      }

      const storedHash = state.folderHashes[relPath]
      const currentHash = hashDirectory(dir.path, {
        includePatterns,
        excludePatterns,
        maxDepth: Math.max(0, config.max_depth - dir.depth),
      })

      if (forceRegenerate || !storedHash || storedHash !== currentHash) {
        changedDirs.push(relPath)
      }
    }

    const totalDirs = qualifyingDirs.length
    const upToDateCount = Math.max(0, totalDirs - changedDirs.length - newDirs.length)

    return {
      directoryMap,
      report: {
        changedDirs: [...new Set(changedDirs)].sort(),
        newDirs: [...new Set(newDirs)].sort(),
        deletedDirs: [...new Set(deletedDirs)].sort(),
        staleCodemaps: [...new Set(staleCodemaps)].sort(),
        stats: {
          totalDirs,
          changedCount: changedDirs.length,
          newCount: newDirs.length,
          deletedCount: deletedDirs.length,
          upToDateCount,
        },
      },
    }
  }

  /**
   * Initialize cartography for the project (full generation)
   */
  async init(options: Partial<CartographyOptions> = {}): Promise<CartographyResult> {
    const startTime = Date.now()
    const result: CartographyResult = {
      mode: "init",
      analyzedDirs: [],
      createdCodemaps: [],
      updatedCodemaps: [],
      skippedDirs: [],
      errors: [],
      durationMs: 0,
    }

    try {
      this.progress("discovery", "Discovering directories...")

      // Load or create state
      await this.stateManager.load()

      // Apply options to config
      const effectiveConfig = this.mergeOptions(options)
      this.config = effectiveConfig
      this.stateManager.updateConfig({
        includePatterns: effectiveConfig.include_patterns,
        excludePatterns: effectiveConfig.exclude_patterns,
      })

      // Discover all directories
      const directories = await discoverDirectories(this.projectRoot, effectiveConfig)
      this.progress("discovery", `Found ${directories.length} directories`)

      // Score directories
      this.progress("scoring", "Scoring directories...")
      const scores = await this.scoreDirectories(directories)
      const toGenerate = scores.filter(s => s.shouldGenerate)
      this.progress("scoring", `${toGenerate.length} directories qualify for codemaps`)

      // Analyze and generate
      this.progress("analysis", "Analyzing directories...")
      for (const score of toGenerate) {
        const dir = directories.find(d => d.path === score.path)
        if (!dir) continue

        try {
          result.analyzedDirs.push(dir.relativePath)

          const analysisResults = await this.analyzeDirectory(dir)
          const { content, meta } = generateCodemap(dir, analysisResults, this.projectRoot, {
            includePatterns: effectiveConfig.include_patterns,
            excludePatterns: effectiveConfig.exclude_patterns,
            maxDepth: Math.max(0, effectiveConfig.max_depth - dir.depth),
          })

          const codemapPath = getCodemapPath(dir.path)
          const existedBeforeWrite = existsSync(codemapPath)

          // Write codemap
          writeCodemap(content, meta)
          if (existedBeforeWrite) {
            result.updatedCodemaps.push(dir.relativePath)
          } else {
            result.createdCodemaps.push(dir.relativePath)
          }

          // Update state
          this.stateManager.updateCodemapMeta(meta)
          this.stateManager.updateFolderHash(dir.path, meta.sourceHash)

          this.progress("generation", `Generated: ${dir.relativePath}`)
        } catch (error) {
          result.errors.push({
            directory: dir.relativePath,
            message: error instanceof Error ? error.message : String(error),
            phase: "generation",
          })
        }
      }

      // Generate project map
      this.progress("project-map", "Generating project map...")
      const state = this.stateManager.getState()
      const codemaps = Object.values(state.codemaps)
      if (codemaps.length > 0) {
        const projectMapContent = generateProjectMap(this.projectRoot, codemaps)
        const projectMapPath = getProjectMapPath(this.projectRoot)
        require("node:fs").writeFileSync(projectMapPath, projectMapContent, "utf8")
        this.progress("project-map", "Project map generated")
      }

      // Update state
      this.stateManager.updateLastRun()
      await this.stateManager.save()
      this.invalidateRepoOverviewCacheIfNeeded(
        result.createdCodemaps.length + result.updatedCodemaps.length > 0
      )

      result.durationMs = Date.now() - startTime
      this.progress("complete", `Completed in ${result.durationMs}ms`)

    } catch (error) {
      result.errors.push({
        directory: ".",
        message: error instanceof Error ? error.message : String(error),
        phase: "discovery",
      })
    }

    return result
  }

  /**
   * Update only changed directories
   */
  async update(options: Partial<CartographyOptions> = {}): Promise<CartographyResult> {
    const startTime = Date.now()
    const result: CartographyResult = {
      mode: "update",
      analyzedDirs: [],
      createdCodemaps: [],
      updatedCodemaps: [],
      skippedDirs: [],
      errors: [],
      durationMs: 0,
    }

    try {
      this.progress("discovery", "Loading state and checking changes...")

      // Load state
      await this.stateManager.load()

      // Apply options to config
      const effectiveConfig = this.mergeOptions(options)
      this.config = effectiveConfig

      // Get full change report (includes new dirs)
      const { report: changeReport, directoryMap } = await this.computeChangeReport(
        effectiveConfig,
        options.force === true
      )
      const dirsToUpdate = [
        ...changeReport.changedDirs,
        ...changeReport.newDirs,
        ...changeReport.staleCodemaps,
      ]
      this.progress(
        "discovery",
        `Found ${changeReport.changedDirs.length} changed, ${changeReport.newDirs.length} new, ${changeReport.staleCodemaps.length} stale directories`
      )

      if (dirsToUpdate.length === 0 && changeReport.deletedDirs.length === 0) {
        this.progress("complete", "No changes detected")
        result.durationMs = Date.now() - startTime
        return result
      }

      const dirsToProcess = dirsToUpdate
        .map((p) => directoryMap.get(p))
        .filter((d): d is DirectoryInfo => Boolean(d))

      // Score and filter
      const scores = await this.scoreDirectories(dirsToProcess)
      const toGenerate = scores.filter((s) => s.shouldGenerate)

      // Analyze and generate
      this.progress("analysis", `Updating ${toGenerate.length} codemaps...`)
      for (const score of toGenerate) {
        const dir = dirsToProcess.find(d => d.path === score.path)
        if (!dir) continue

        try {
          result.analyzedDirs.push(dir.relativePath)

          const analysisResults = await this.analyzeDirectory(dir)
          const { content, meta } = generateCodemap(dir, analysisResults, this.projectRoot, {
            includePatterns: effectiveConfig.include_patterns,
            excludePatterns: effectiveConfig.exclude_patterns,
            maxDepth: Math.max(0, effectiveConfig.max_depth - dir.depth),
          })

          const codemapPath = getCodemapPath(dir.path)
          const existedBeforeWrite = existsSync(codemapPath)

          writeCodemap(content, meta)
          if (existedBeforeWrite) {
            result.updatedCodemaps.push(dir.relativePath)
          } else {
            result.createdCodemaps.push(dir.relativePath)
          }
          this.stateManager.updateCodemapMeta(meta)
          this.stateManager.updateFolderHash(dir.path, meta.sourceHash)

          this.progress("generation", `Updated: ${dir.relativePath}`)
        } catch (error) {
          result.errors.push({
            directory: dir.relativePath,
            message: error instanceof Error ? error.message : String(error),
            phase: "generation",
          })
        }
      }

      // Handle deleted directories
      for (const deletedDir of changeReport.deletedDirs) {
        const codemapPath = join(this.projectRoot, deletedDir, CODEMAP_FILE_NAME)
        if (existsSync(codemapPath)) {
          try {
            unlinkSync(codemapPath)
            this.stateManager.removeCodemapMeta(join(this.projectRoot, deletedDir))
          } catch {
            // Ignore deletion errors
          }
        }
      }

      // Regenerate project map
      const state = this.stateManager.getState()
      const codemaps = Object.values(state.codemaps)
      if (codemaps.length > 0) {
        const projectMapContent = generateProjectMap(this.projectRoot, codemaps)
        const projectMapPath = getProjectMapPath(this.projectRoot)
        require("node:fs").writeFileSync(projectMapPath, projectMapContent, "utf8")
      }

      // Save state
      this.stateManager.updateLastRun()
      await this.stateManager.save()
      this.invalidateRepoOverviewCacheIfNeeded(
        result.createdCodemaps.length + result.updatedCodemaps.length + changeReport.deletedDirs.length > 0
      )

      result.durationMs = Date.now() - startTime
      this.progress("complete", `Update completed in ${result.durationMs}ms`)

    } catch (error) {
      result.errors.push({
        directory: ".",
        message: error instanceof Error ? error.message : String(error),
        phase: "discovery",
      })
    }

    return result
  }

  /**
   * Report changes without generating
   */
  async changes(): Promise<ChangeReport> {
    const { report } = await this.computeChangeReport(this.config)
    return report
  }

  /**
   * Score directories for codemap generation
   */
  private async scoreDirectories(directories: DirectoryInfo[]): Promise<DirectoryScore[]> {
    const scores: DirectoryScore[] = []

    for (const dir of directories) {
      // Quick static scoring first
      const score = scoreDirectory(dir)
      scores.push(score)
    }

    return scores
  }

  /**
   * Analyze a single directory
   */
  private async analyzeDirectory(dir: DirectoryInfo): Promise<AnalysisResult[]> {
    const analyzer = createAnalyzer(this.projectRoot, this.config, this.ctx)
    const results = await analyzer.analyze(dir)

    // Merge all results
    if (results.length > 1) {
      return [mergeAnalysisResults(results)]
    }

    return results
  }

  /**
   * Merge options with config
   */
  private mergeOptions(options: Partial<CartographyOptions>): CartographyConfig {
    return {
      ...this.config,
      max_depth: options.maxDepth ?? this.config.max_depth,
      max_parallel_explorers: options.parallelExplorers ?? this.config.max_parallel_explorers,
      include_patterns: options.includePatterns ?? this.config.include_patterns,
      exclude_patterns: options.excludePatterns ?? this.config.exclude_patterns,
      min_files: options.minFiles ?? this.config.min_files,
    }
  }

  private invalidateRepoOverviewCacheIfNeeded(hasChanges: boolean): void {
    if (!hasChanges) {
      return
    }

    const invalidated = invalidateRepoOverviewCache(this.projectRoot)
    if (invalidated) {
      this.progress(
        "coordination",
        "Invalidated repo-overview cache due to cartography artifact changes"
      )
    }
  }

  /**
   * Report progress
   */
  private progress(phase: string, message: string): void {
    log(`[cartography] [${phase}] ${message}`)
    this.onProgress?.(phase, message)
  }
}

/**
 * Create a cartography service instance
 */
export function createCartographyService(
  projectRoot: string,
  options?: CartographyServiceOptions
): CartographyService {
  return new CartographyService(projectRoot, options)
}

/**
 * Run cartography operation
 */
export async function runCartography(
  projectRoot: string,
  mode: "init" | "update" | "changes",
  options?: CartographyServiceOptions & Partial<CartographyOptions>
): Promise<CartographyResult | ChangeReport> {
  const service = createCartographyService(projectRoot, options)

  switch (mode) {
    case "init":
      return service.init(options)
    case "update":
      return service.update(options)
    case "changes":
      return service.changes()
  }
}
