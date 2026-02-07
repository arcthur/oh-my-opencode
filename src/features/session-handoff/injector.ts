/**
 * Session Handoff Injector
 *
 * Injects relevant handoff context into new sessions.
 * Handles handoff selection and content formatting for injection.
 *
 * Delegates all formatting to the unified renderer.
 */

import type {
  HandoffPackage,
  SessionHandoffConfig,
  ScoredHandoff,
  ScoringWeights,
  HalfLifeConfig,
} from "./types"
import { DEFAULT_HALF_LIFE_CONFIG, DEFAULT_SCORING_WEIGHTS } from "./types"
import { findHandoffsForProject, loadHandoff } from "./storage"
import { log } from "../../shared/logger"
import { renderMultipleHandoffsForInjection } from "./renderer"
import {
  scoreAndRankHandoffs,
  filterByMinScore,
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
} from "./scoring"

// Re-export reference resolver for backward compatibility
export { resolveSessionReference, type ResolveSessionReferenceOptions } from "./reference-resolver"

// ============================================================================
// Scoring Configuration
// ============================================================================

export interface InjectorScoringConfig {
  /** Enable authority-based scoring (default: true) */
  enabled?: boolean
  /** Scoring weights */
  weights?: Partial<ScoringWeights>
  /** Half-life configuration */
  halfLife?: Partial<HalfLifeConfig>
  /** Minimum score for injection (default: 0.25) */
  minScore?: number
}


// ============================================================================
// Handoff Selection
// ============================================================================

/**
 * Build scoring config from injector config
 */
function buildScoringConfig(injectorConfig?: InjectorScoringConfig): ScoringConfig {
  if (!injectorConfig?.enabled) {
    return DEFAULT_SCORING_CONFIG
  }

  return {
    weights: {
      ...DEFAULT_SCORING_WEIGHTS,
      ...injectorConfig.weights,
    },
    halfLife: {
      ...DEFAULT_HALF_LIFE_CONFIG,
      ...injectorConfig.halfLife,
    },
    minScore: injectorConfig.minScore ?? DEFAULT_SCORING_CONFIG.minScore,
  }
}

/**
 * Select handoffs to inject based on project and optional prompt
 *
 * Uses the new multi-factor scoring system when enabled:
 * - Semantic relevance (keyword matching)
 * - Temporal freshness (half-life decay)
 * - Authority score (citation success rate)
 */
export function selectHandoffsForInjection(
  projectPath: string,
  config: SessionHandoffConfig,
  initialPrompt?: string,
  scoringConfig?: InjectorScoringConfig
): HandoffPackage[] {
  const indexEntries = findHandoffsForProject(projectPath)

  if (indexEntries.length === 0) {
    return []
  }

  // Load full packages for top candidates
  const maxCandidates = Math.min(indexEntries.length, config.max_inject_count * 3)
  const candidates: HandoffPackage[] = []

  for (const entry of indexEntries.slice(0, maxCandidates)) {
    const pkg = loadHandoff(entry.id)
    if (pkg) {
      candidates.push(pkg)
    }
  }

  if (candidates.length === 0) {
    return []
  }

  const query = initialPrompt || ""

  if (query) {
    const builtConfig = buildScoringConfig(scoringConfig)
    const scored = scoreAndRankHandoffs(candidates, query, builtConfig)
    const filtered = filterByMinScore(scored, builtConfig.minScore)

    log("[session-handoff] Scored handoffs for injection", {
      total: candidates.length,
      aboveThreshold: filtered.length,
      topScores: filtered.slice(0, 3).map((s) => ({
        id: s.handoff.id.slice(0, 15),
        score: s.score.toFixed(2),
        components: {
          r: s.components.relevance.toFixed(2),
          f: s.components.freshness.toFixed(2),
          a: s.components.authority.toFixed(2),
        },
      })),
    })

    return filtered.slice(0, config.max_inject_count).map((s) => s.handoff)
  }

  // No prompt — return most recent
  return candidates.slice(0, config.max_inject_count)
}

/**
 * Select handoffs with detailed scoring information
 * Returns ScoredHandoff[] for inspection/debugging
 */
export function selectHandoffsWithScores(
  projectPath: string,
  config: SessionHandoffConfig,
  initialPrompt: string,
  scoringConfig?: InjectorScoringConfig
): ScoredHandoff[] {
  const indexEntries = findHandoffsForProject(projectPath)

  if (indexEntries.length === 0) {
    return []
  }

  const maxCandidates = Math.min(indexEntries.length, config.max_inject_count * 3)
  const candidates: HandoffPackage[] = []

  for (const entry of indexEntries.slice(0, maxCandidates)) {
    const pkg = loadHandoff(entry.id)
    if (pkg) {
      candidates.push(pkg)
    }
  }

  const builtConfig = buildScoringConfig(scoringConfig)
  return scoreAndRankHandoffs(candidates, initialPrompt, builtConfig)
}

// ============================================================================
// Main Injection
// ============================================================================

/**
 * Format pre-selected handoff packages into injection content
 * Use this when you already have selected packages (avoids duplicate selection)
 *
 * Delegates to the unified renderer for consistent formatting.
 */
export function formatInjectionContent(
  packages: HandoffPackage[],
  projectPath: string
): string | null {
  if (packages.length === 0) {
    return null
  }

  const content = renderMultipleHandoffsForInjection(packages, projectPath)

  log("[session-handoff] Generated injection content", {
    handoffCount: packages.length,
    contentLength: content.length,
  })

  return content || null
}

/**
 * Generate injection content for a session
 * Convenience function that selects and formats in one call
 */
export function generateInjectionContent(
  projectPath: string,
  config: SessionHandoffConfig,
  initialPrompt?: string,
  scoringConfig?: InjectorScoringConfig
): string | null {
  if (!config.enabled || !config.auto_inject) {
    return null
  }

  const packages = selectHandoffsForInjection(projectPath, config, initialPrompt, scoringConfig)
  return formatInjectionContent(packages, projectPath)
}
