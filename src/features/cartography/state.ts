/**
 * Cartography State Management
 *
 * Manages persistent state stored in .opencode/cartography.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import {
  type CartographyState,
  type CartographyStateConfig,
  type CodemapMeta,
  type ChangeReport,
  CARTOGRAPHY_STATE_VERSION,
  EMPTY_CARTOGRAPHY_STATE,
  DEFAULT_CARTOGRAPHY_CONFIG,
} from "./types"
import { getStateFilePath, CODEMAP_FILE_NAME } from "./constants"
import { hashDirectory } from "./hash-utils"
import { log } from "../../shared"

/**
 * State manager for cartography
 */
export class CartographyStateManager {
  private projectRoot: string
  private statePath: string
  private state: CartographyState | null = null
  private dirty = false

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.statePath = getStateFilePath(projectRoot)
  }

  /**
   * Load state from disk
   */
  async load(): Promise<CartographyState> {
    if (this.state) return this.state

    if (!existsSync(this.statePath)) {
      this.state = this.createEmptyState()
      return this.state
    }

    try {
      const content = readFileSync(this.statePath, "utf8")
      const parsed = JSON.parse(content) as CartographyState

      // Migrate if needed
      this.state = this.migrateState(parsed)
      return this.state
    } catch (error) {
      log("[cartography] Failed to load state, creating new:", error)
      this.state = this.createEmptyState()
      return this.state
    }
  }

  /**
   * Save state to disk
   */
  async save(): Promise<void> {
    if (!this.state) return

    // Ensure directory exists
    const dir = dirname(this.statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Backup existing state before writing
    if (existsSync(this.statePath)) {
      const backupPath = `${this.statePath}.backup`
      try {
        copyFileSync(this.statePath, backupPath)
      } catch {
        // Backup failed, continue anyway
      }
    }

    try {
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), "utf8")
      this.dirty = false
    } catch (error) {
      log("[cartography] Failed to save state:", error)
      throw error
    }
  }

  /**
   * Create empty state
   */
  private createEmptyState(): CartographyState {
    return {
      ...EMPTY_CARTOGRAPHY_STATE,
      projectRoot: this.projectRoot,
      config: {
        includePatterns: DEFAULT_CARTOGRAPHY_CONFIG.include_patterns,
        excludePatterns: DEFAULT_CARTOGRAPHY_CONFIG.exclude_patterns,
        exceptions: [],
      },
    }
  }

  /**
   * Migrate state from older versions
   */
  private migrateState(state: CartographyState): CartographyState {
    if (state.version === CARTOGRAPHY_STATE_VERSION) {
      return state
    }

    log(`[cartography] Migrating state from v${state.version} to v${CARTOGRAPHY_STATE_VERSION}`)

    // Future migrations would go here
    // For now, just update version
    return {
      ...state,
      version: CARTOGRAPHY_STATE_VERSION,
    }
  }

  /**
   * Get current state (must call load first)
   */
  getState(): CartographyState {
    if (!this.state) {
      throw new Error("State not loaded. Call load() first.")
    }
    return this.state
  }

  /**
   * Update last run timestamp
   */
  updateLastRun(): void {
    if (!this.state) return
    this.state.lastRun = Date.now()
    this.dirty = true
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CartographyStateConfig>): void {
    if (!this.state) return
    this.state.config = { ...this.state.config, ...config }
    this.dirty = true
  }

  /**
   * Update file hash
   */
  updateFileHash(filePath: string, hash: string): void {
    if (!this.state) return
    const relativePath = relative(this.projectRoot, filePath)
    this.state.fileHashes[relativePath] = hash
    this.dirty = true
  }

  /**
   * Update folder hash
   */
  updateFolderHash(folderPath: string, hash: string): void {
    if (!this.state) return
    const relativePath = relative(this.projectRoot, folderPath) || "."
    this.state.folderHashes[relativePath] = hash
    this.dirty = true
  }

  /**
   * Update codemap metadata
   */
  updateCodemapMeta(meta: CodemapMeta): void {
    if (!this.state) return
    const relativePath = relative(this.projectRoot, meta.directory) || "."
    this.state.codemaps[relativePath] = meta
    this.dirty = true
  }

  /**
   * Remove codemap metadata
   */
  removeCodemapMeta(directory: string): void {
    if (!this.state) return
    const relativePath = relative(this.projectRoot, directory) || "."
    delete this.state.codemaps[relativePath]
    this.dirty = true
  }

  /**
   * Get codemap metadata for a directory
   */
  getCodemapMeta(directory: string): CodemapMeta | undefined {
    if (!this.state) return undefined
    const relativePath = relative(this.projectRoot, directory) || "."
    return this.state.codemaps[relativePath]
  }

  /**
   * Check if directory has changes since last run
   */
  hasDirectoryChanges(directory: string): boolean {
    if (!this.state) return true

    const relativePath = relative(this.projectRoot, directory) || "."
    const storedHash = this.state.folderHashes[relativePath]

    if (!storedHash) return true

    const currentHash = hashDirectory(directory, {
      includePatterns: new Set(this.state.config.includePatterns),
      excludePatterns: new Set(this.state.config.excludePatterns),
    })

    return storedHash !== currentHash
  }

  /**
   * Get change report for the project
   */
  async getChangeReport(): Promise<ChangeReport> {
    const state = await this.load()

    const changedDirs: string[] = []
    const newDirs: string[] = []
    const deletedDirs: string[] = []
    const staleCodemaps: string[] = []

    const includePatterns = new Set(state.config.includePatterns)
    const excludePatterns = new Set(state.config.excludePatterns)

    for (const relativePath of Object.keys(state.codemaps)) {
      const absDir = join(this.projectRoot, relativePath)

      if (!existsSync(absDir)) {
        deletedDirs.push(relativePath)
        continue
      }

      const codemapPath = join(absDir, CODEMAP_FILE_NAME)
      if (!existsSync(codemapPath)) {
        staleCodemaps.push(relativePath)
      }

      const storedHash = state.folderHashes[relativePath]
      const currentHash = hashDirectory(absDir, {
        includePatterns,
        excludePatterns,
      })

      if (!storedHash || storedHash !== currentHash) {
        changedDirs.push(relativePath)
      }
    }

    const totalDirs = Object.keys(state.codemaps).length
    const upToDateCount = Math.max(
      0,
      totalDirs - changedDirs.length - deletedDirs.length
    )

    return {
      changedDirs: [...new Set(changedDirs)].sort(),
      newDirs,
      deletedDirs: [...new Set(deletedDirs)].sort(),
      staleCodemaps: [...new Set(staleCodemaps)].sort(),
      stats: {
        totalDirs,
        changedCount: changedDirs.length,
        newCount: 0,
        deletedCount: deletedDirs.length,
        upToDateCount,
      },
    }
  }

  /**
   * Clear all stored data for a directory
   */
  clearDirectory(directory: string): void {
    if (!this.state) return

    const relativePath = relative(this.projectRoot, directory) || "."

    delete this.state.folderHashes[relativePath]
    delete this.state.codemaps[relativePath]

    // Clear file hashes within directory
    const prefix = relativePath === "." ? "" : `${relativePath}/`
    for (const key of Object.keys(this.state.fileHashes)) {
      if (key.startsWith(prefix)) {
        delete this.state.fileHashes[key]
      }
    }

    this.dirty = true
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.state = this.createEmptyState()
    this.dirty = true
  }

  /**
   * Check if state needs saving
   */
  isDirty(): boolean {
    return this.dirty
  }
}

/**
 * Create a state manager for a project
 */
export function createStateManager(projectRoot: string): CartographyStateManager {
  return new CartographyStateManager(projectRoot)
}
