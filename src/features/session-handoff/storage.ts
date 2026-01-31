/**
 * Session Handoff Storage
 *
 * Manages persistence of handoff packages and their index.
 * Storage location: ~/.config/opencode/oh-my-opencode/handoffs/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type {
  HandoffPackage,
  HandoffIndex,
  HandoffIndexEntry,
  SessionHandoffConfig,
  HandoffMetrics,
  HandoffMetricsSummary,
} from "./types"
import { DEFAULT_HANDOFF_CONFIG, DEFAULT_HANDOFF_METRICS } from "./types"
import { log } from "../../shared/logger"
import { checkL3Promotion, createMetricsSummary } from "./citation-tracker"

// ============================================================================
// Storage Paths
// ============================================================================

const CONFIG_BASE = join(homedir(), ".config", "opencode", "oh-my-opencode")
const HANDOFFS_DIR = join(CONFIG_BASE, "handoffs")
const INDEX_FILE = join(HANDOFFS_DIR, "index.json")
const EMBEDDINGS_DIR = join(HANDOFFS_DIR, "embeddings")

function isSafeHandoffId(id: string): boolean {
  if (!id || typeof id !== "string") return false
  if (!id.startsWith("ho_")) return false
  if (id.includes("\0")) return false
  if (id.includes("/") || id.includes("\\")) return false
  if (id.includes("..")) return false
  return true
}

/**
 * Ensure storage directories exist
 */
function ensureDirectories(): void {
  if (!existsSync(HANDOFFS_DIR)) {
    mkdirSync(HANDOFFS_DIR, { recursive: true })
  }
  if (!existsSync(EMBEDDINGS_DIR)) {
    mkdirSync(EMBEDDINGS_DIR, { recursive: true })
  }
}

// ============================================================================
// Index Management
// ============================================================================

/**
 * Load handoff index
 */
export function loadIndex(): HandoffIndex {
  ensureDirectories()

  if (!existsSync(INDEX_FILE)) {
    return {
      version: 1,
      handoffs: [],
      lastCleanup: Date.now(),
    }
  }

  try {
    const content = readFileSync(INDEX_FILE, "utf-8")
    return JSON.parse(content) as HandoffIndex
  } catch (error) {
    log("[session-handoff] Failed to load index, returning empty", {
      error: String(error),
    })
    return {
      version: 1,
      handoffs: [],
      lastCleanup: Date.now(),
    }
  }
}

/**
 * Save handoff index
 */
export function saveIndex(index: HandoffIndex): void {
  ensureDirectories()

  try {
    // Atomic write using temp file
    const tempPath = INDEX_FILE + ".tmp"
    writeFileSync(tempPath, JSON.stringify(index, null, 2), "utf-8")

    // Rename is atomic on most filesystems
    renameSync(tempPath, INDEX_FILE)
  } catch (error) {
    log("[session-handoff] Failed to save index", {
      error: String(error),
    })
    throw error
  }
}

/**
 * Create index entry from handoff package
 */
function createIndexEntry(pkg: HandoffPackage): HandoffIndexEntry {
  const entry: HandoffIndexEntry = {
    id: pkg.id,
    sourceSessionId: pkg.sourceSessionId,
    projectPath: pkg.metadata.projectPath,
    originalGoal: pkg.metadata.originalGoal,
    createdAt: pkg.createdAt,
    expiresAt: pkg.expiresAt,
    outcome: pkg.metadata.outcome,
    decisionCount: pkg.payload.decisions.length,
    artifactCount: pkg.payload.artifacts.length,
  }

  // Add metrics summary if available
  if (pkg.metrics) {
    entry.metricsSummary = createMetricsSummary(pkg.metrics)
  }

  // Add recovery pattern count if available
  if (pkg.payload.recoveryPatterns && pkg.payload.recoveryPatterns.length > 0) {
    entry.recoveryPatternCount = pkg.payload.recoveryPatterns.length
  }

  return entry
}

// ============================================================================
// Package Storage
// ============================================================================

/**
 * Generate handoff ID
 */
export function generateHandoffId(): string {
  const timestamp = Date.now()
  const hash = Math.random().toString(36).substring(2, 8)
  return `ho_${timestamp}_${hash}`
}

/**
 * Get handoff file path
 */
function getHandoffPath(id: string): string | null {
  if (!isSafeHandoffId(id)) return null
  return join(HANDOFFS_DIR, `${id}.json`)
}

/**
 * Save a handoff package
 */
export function saveHandoff(pkg: HandoffPackage): void {
  ensureDirectories()

  const filePath = getHandoffPath(pkg.id)
  if (!filePath) {
    log("[session-handoff] Refusing to save handoff with unsafe id", { id: pkg.id })
    throw new Error("Unsafe handoff id")
  }

  try {
    // Atomic write
    const tempPath = filePath + ".tmp"
    writeFileSync(tempPath, JSON.stringify(pkg, null, 2), "utf-8")

    renameSync(tempPath, filePath)

    // Update index
    const index = loadIndex()
    const existingIdx = index.handoffs.findIndex((h) => h.id === pkg.id)
    const entry = createIndexEntry(pkg)

    if (existingIdx >= 0) {
      index.handoffs[existingIdx] = entry
    } else {
      index.handoffs.push(entry)
    }

    saveIndex(index)

    log("[session-handoff] Saved handoff", {
      id: pkg.id,
      decisions: pkg.payload.decisions.length,
      artifacts: pkg.payload.artifacts.length,
      antiPatterns: pkg.payload.antiPatterns.length,
    })
  } catch (error) {
    log("[session-handoff] Failed to save handoff", {
      id: pkg.id,
      error: String(error),
    })
    throw error
  }
}

/**
 * Load a handoff package by ID
 */
export function loadHandoff(id: string): HandoffPackage | null {
  const filePath = getHandoffPath(id)
  if (!filePath) return null

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as HandoffPackage
  } catch (error) {
    log("[session-handoff] Failed to load handoff", {
      id,
      error: String(error),
    })
    return null
  }
}

/**
 * Delete a handoff package
 */
export function deleteHandoff(id: string): boolean {
  const filePath = getHandoffPath(id)
  if (!filePath) return false
  const embeddingPath = isSafeHandoffId(id) ? join(EMBEDDINGS_DIR, `${id}.bin`) : null

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    if (embeddingPath && existsSync(embeddingPath)) {
      unlinkSync(embeddingPath)
    }

    // Update index
    const index = loadIndex()
    index.handoffs = index.handoffs.filter((h) => h.id !== id)
    saveIndex(index)

    log("[session-handoff] Deleted handoff", { id })
    return true
  } catch (error) {
    log("[session-handoff] Failed to delete handoff", {
      id,
      error: String(error),
    })
    return false
  }
}

// ============================================================================
// Metrics Update
// ============================================================================

/**
 * Update handoff metrics with an updater function
 * Handles L3 promotion check and index update
 */
export function updateHandoffMetrics(
  id: string,
  updater: (metrics: HandoffMetrics) => HandoffMetrics
): boolean {
  const pkg = loadHandoff(id)
  if (!pkg) {
    log("[session-handoff] Cannot update metrics: handoff not found", { id })
    return false
  }

  // Initialize metrics if not present
  const currentMetrics = pkg.metrics ?? { ...DEFAULT_HANDOFF_METRICS }

  // Apply updater
  const updatedMetrics = updater(currentMetrics)
  pkg.metrics = updatedMetrics

  // Check for L3 promotion
  const promotionReason = checkL3Promotion(pkg)
  if (promotionReason) {
    const index = loadIndex()
    if (!index.l3Promoted) {
      index.l3Promoted = []
    }
    if (!index.l3Promoted.includes(id)) {
      index.l3Promoted.push(id)
      log("[session-handoff] Handoff promoted to L3", { id, reason: promotionReason })
    }
    saveIndex(index)
  }

  // Save updated package (this also updates index entry)
  try {
    saveHandoff(pkg)
    log("[session-handoff] Updated handoff metrics", {
      id,
      citationCount: updatedMetrics.citationCount,
      authorityScore: updatedMetrics.authorityScore.toFixed(2),
    })
    return true
  } catch (error) {
    log("[session-handoff] Failed to save updated metrics", {
      id,
      error: String(error),
    })
    return false
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Find handoffs for a specific project
 */
export function findHandoffsForProject(projectPath: string): HandoffIndexEntry[] {
  const index = loadIndex()
  const now = Date.now()

  return index.handoffs
    .filter((h) => h.projectPath === projectPath && h.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Find recent handoffs (regardless of project)
 */
export function findRecentHandoffs(limit = 10): HandoffIndexEntry[] {
  const index = loadIndex()
  const now = Date.now()

  return index.handoffs
    .filter((h) => h.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/**
 * Find handoff by session ID
 */
export function findHandoffBySessionId(sessionId: string): HandoffIndexEntry | null {
  const index = loadIndex()
  return index.handoffs.find((h) => h.sourceSessionId === sessionId) ?? null
}

/**
 * Get N most recent sessions for a project (for relative references like ~1, ~2)
 */
export function getRecentSessionHandoffs(projectPath: string, count = 5): HandoffIndexEntry[] {
  return findHandoffsForProject(projectPath).slice(0, count)
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Remove expired handoffs (excluding L3 promoted)
 */
export function cleanupExpired(config: SessionHandoffConfig = DEFAULT_HANDOFF_CONFIG): number {
  const index = loadIndex()
  const now = Date.now()

  // L3 promoted handoffs are exempt from expiration
  const l3Set = new Set(index.l3Promoted ?? [])

  const expiredIds = index.handoffs
    .filter((h) => h.expiresAt <= now && !l3Set.has(h.id))
    .map((h) => h.id)

  let removed = 0
  for (const id of expiredIds) {
    if (deleteHandoff(id)) {
      removed++
    }
  }

  if (removed > 0) {
    const newIndex = loadIndex()
    newIndex.lastCleanup = now
    saveIndex(newIndex)

    log("[session-handoff] Cleanup completed", {
      removed,
      remaining: newIndex.handoffs.length,
    })
  }

  return removed
}

/**
 * Check if cleanup is needed (once per day)
 */
export function shouldRunCleanup(): boolean {
  const index = loadIndex()
  const oneDay = 24 * 60 * 60 * 1000
  return Date.now() - index.lastCleanup > oneDay
}

// ============================================================================
// Embeddings Storage (optional)
// ============================================================================

/**
 * Save embeddings for a handoff
 */
export function saveEmbeddings(id: string, vectors: Float32Array[]): void {
  ensureDirectories()

  if (!isSafeHandoffId(id)) {
    log("[session-handoff] Refusing to save embeddings with unsafe id", { id })
    return
  }

  const filePath = join(EMBEDDINGS_DIR, `${id}.bin`)

  try {
    // Simple format: count (4 bytes) + [length (4 bytes) + data (length * 4 bytes)]...
    const totalSize = 4 + vectors.reduce((sum, v) => sum + 4 + v.length * 4, 0)
    const buffer = Buffer.alloc(totalSize)
    let offset = 0

    buffer.writeUInt32LE(vectors.length, offset)
    offset += 4

    for (const vector of vectors) {
      buffer.writeUInt32LE(vector.length, offset)
      offset += 4
      for (let i = 0; i < vector.length; i++) {
        buffer.writeFloatLE(vector[i], offset)
        offset += 4
      }
    }

    writeFileSync(filePath, buffer)
  } catch (error) {
    log("[session-handoff] Failed to save embeddings", {
      id,
      error: String(error),
    })
  }
}

/**
 * Load embeddings for a handoff
 */
export function loadEmbeddings(id: string): Float32Array[] | null {
  if (!isSafeHandoffId(id)) return null
  const filePath = join(EMBEDDINGS_DIR, `${id}.bin`)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const buffer = readFileSync(filePath)
    let offset = 0

    const count = buffer.readUInt32LE(offset)
    offset += 4

    const vectors: Float32Array[] = []
    for (let i = 0; i < count; i++) {
      const length = buffer.readUInt32LE(offset)
      offset += 4
      const vector = new Float32Array(length)
      for (let j = 0; j < length; j++) {
        vector[j] = buffer.readFloatLE(offset)
        offset += 4
      }
      vectors.push(vector)
    }

    return vectors
  } catch (error) {
    log("[session-handoff] Failed to load embeddings", {
      id,
      error: String(error),
    })
    return null
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  HANDOFFS_DIR,
  INDEX_FILE,
  EMBEDDINGS_DIR,
  ensureDirectories,
}
