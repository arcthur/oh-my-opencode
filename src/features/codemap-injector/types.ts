/**
 * Codemap Injector Types
 */

import type { Codemap, CodemapMeta, CodemapInjectorConfig } from "../cartography/types"

/**
 * Query type classification for smart injection
 */
export type QueryType = "architecture" | "navigation" | "implementation" | "refactoring" | "unknown"

/**
 * Injection trigger information
 */
export interface InjectionTrigger {
  /** Query type detected */
  queryType: QueryType

  /** Keywords that triggered detection */
  triggerKeywords: string[]

  /** Directories relevant to the query */
  relevantDirs: string[]

  /** Whether to inject root atlas */
  injectRootAtlas: boolean
}

/**
 * Injected codemap context
 */
export interface InjectedContext {
  /** Directory the codemap is for */
  directory: string

  /** Codemap content (may be truncated) */
  content: string

  /** Whether content was truncated */
  truncated: boolean

  /** Original line count */
  originalLines: number

  /** Injected line count */
  injectedLines: number
}

/**
 * Session injection state
 */
export interface SessionInjectionState {
  /** Directories already injected in this session */
  injectedDirs: Set<string>

  /** Whether root atlas was injected */
  rootAtlasInjected: boolean

  /** Total tokens injected */
  tokensInjected: number

  /** Last injection timestamp */
  lastInjection: number
}

/**
 * Staleness check result
 */
export interface StalenessCheck {
  /** Whether the codemap is stale */
  isStale: boolean

  /** Reason for staleness */
  reason?: string

  /** Files that have changed */
  affectedFiles: string[]

  /** Change ratio (0-1) */
  changeRatio: number
}

/**
 * Codemap cache entry
 */
export interface CodemapCacheEntry {
  /** Parsed codemap */
  codemap: Codemap

  /** Metadata */
  meta: CodemapMeta

  /** Summary for quick injection */
  summary: string

  /** Cache timestamp */
  cachedAt: number

  /** Staleness status */
  staleness?: StalenessCheck
}

/**
 * Configuration for injection behavior
 */
export interface InjectionConfig extends CodemapInjectorConfig {
  /** Whether to check staleness before injection */
  checkStaleness?: boolean

  /** Staleness threshold (0-1, default 0.3) */
  stalenessThreshold?: number

  /** Cache duration in milliseconds */
  cacheDurationMs?: number
}
