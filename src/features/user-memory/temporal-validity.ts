/**
 * Temporal Validity System
 *
 * Implements staleness calculation and temporal filtering for memory facts.
 * Facts decay based on their staleness category and time since last reinforcement.
 *
 * Key concepts:
 * - Staleness: 0.0 (fresh) to 1.0 (completely stale)
 * - Effective confidence: base confidence * (1 - staleness * decay_factor)
 * - Validity period: [valid_from, valid_until] for each fact
 */

import {
  type LongTermKnowledge,
  type StalenessCategory,
  type TemporalValidityConfig,
  type WorkHistoryEntry,
  type FactsValidRange,
  STALENESS_HALF_LIFE_MS,
  DEFAULT_TEMPORAL_VALIDITY_CONFIG,
} from "./types"

// ============================================================================
// Staleness Calculation
// ============================================================================

/**
 * Calculate staleness score for a fact at a given query time.
 *
 * Uses half-life based exponential decay:
 * staleness = 1 - exp(-ln(2) * t / halfLife)
 *
 * Properties:
 * - At t=halfLife, staleness = 0.5
 * - At t=2*halfLife, staleness = 0.75
 * - At t=3*halfLife, staleness = 0.875
 *
 * @param fact - The fact with temporal validity
 * @param queryTime - The time point to evaluate at (default: now)
 * @returns Staleness score 0.0 (fresh) to 1.0 (completely stale)
 */
export function calculateStaleness(
  fact: {
    valid_from?: number
    valid_until?: number | null
    staleness_category?: StalenessCategory
    lastReinforced?: number
    timestamp?: number
    firstSeen?: number
  },
  queryTime: number = Date.now()
): number {
  // Determine valid_from (fallback chain: valid_from -> timestamp -> firstSeen -> now)
  const validFrom =
    fact.valid_from ?? fact.timestamp ?? fact.firstSeen ?? queryTime

  // If query time is before valid_from, fact doesn't exist yet
  if (queryTime < validFrom) {
    return 1.0 // Not valid at this time
  }

  // Get half-life based on staleness category
  const category = fact.staleness_category ?? "medium-term"
  const halfLifeMs = STALENESS_HALF_LIFE_MS[category]

  // For permanent facts, no decay
  if (!Number.isFinite(halfLifeMs)) {
    return 0.0
  }

  // Time since last reinforcement (or valid_from if never reinforced)
  const lastActive = fact.lastReinforced ?? validFrom
  const timeSinceActive = queryTime - lastActive

  if (timeSinceActive <= 0) {
    return 0.0 // Fresh
  }

  // Half-life based decay:
  // staleness = 1 - exp(-ln(2) * t / halfLife)
  const staleness = 1 - Math.exp(-Math.LN2 * timeSinceActive / halfLifeMs)

  return Math.min(staleness, 1.0)
}

// ============================================================================
// Effective Confidence
// ============================================================================

/**
 * Calculate effective confidence considering staleness.
 *
 * Effective confidence decays with staleness:
 * effective = base_confidence * (1 - staleness * decay_factor)
 *
 * @param knowledge - The knowledge item
 * @param queryTime - The time point to evaluate at (default: now)
 * @param decayFactor - How much staleness affects confidence (default: 0.5)
 */
export function calculateEffectiveConfidence(
  knowledge: LongTermKnowledge,
  queryTime: number = Date.now(),
  decayFactor: number = DEFAULT_TEMPORAL_VALIDITY_CONFIG.decay_factor
): number {
  const staleness = calculateStaleness(
    {
      valid_from: knowledge.valid_from ?? knowledge.firstSeen,
      valid_until: knowledge.valid_until,
      staleness_category: knowledge.staleness_category ?? "medium-term",
      lastReinforced: knowledge.lastReinforced,
    },
    queryTime
  )

  // Apply staleness penalty
  const effective = knowledge.confidence * (1 - staleness * decayFactor)

  return Math.max(0, Math.min(1, effective))
}

// ============================================================================
// Staleness Category Inference
// ============================================================================

/**
 * Infer staleness category from knowledge content.
 * Can be overridden by explicit user specification.
 *
 * @param knowledge - The knowledge item to classify
 */
export function inferStalenessCategory(knowledge: {
  category: string
  content: string
}): StalenessCategory {
  const content = knowledge.content.toLowerCase()

  // Ephemeral: current task, active debugging
  if (
    content.includes("currently") ||
    content.includes("right now") ||
    content.includes("today") ||
    content.includes("this session")
  ) {
    return "ephemeral"
  }

  // Short-term: project-specific, version-specific
  if (
    content.match(/v\d+\.\d+/) || // Version numbers
    content.includes("this project") ||
    content.includes("this week") ||
    content.includes("this sprint")
  ) {
    return "short-term"
  }

  // Permanent: explicit rules, identity statements
  if (
    content.includes("always") ||
    content.includes("never") ||
    content.includes("rule:") ||
    content.includes("must")
  ) {
    return "permanent"
  }

  // Skills: long-term by default
  if (knowledge.category === "skill") {
    return "long-term"
  }

  // Preferences without version = long-term
  if (
    knowledge.category === "preference" &&
    !content.match(/v\d+/) &&
    !content.match(/\d{4}/) // No year mentions
  ) {
    return "long-term"
  }

  // Patterns and lessons: medium-term by default
  return "medium-term"
}

// ============================================================================
// Validity Status
// ============================================================================

/**
 * Validity status at a query time
 */
export type ValidityStatus = "valid" | "expired" | "future" | "stale"

/**
 * Result of a temporal query
 */
export interface TemporalQueryResult<T> {
  /** The fact/knowledge item */
  item: T
  /** Staleness score at query time */
  staleness: number
  /** Whether item is ongoing (no valid_until) */
  isOngoing: boolean
  /** Validity status at query time */
  validityStatus: ValidityStatus
  /** Effective confidence (for knowledge items) */
  effectiveConfidence?: number
}

/**
 * Determine validity status of a fact at a query time.
 *
 * @param fact - The fact to check
 * @param queryTime - The time point to evaluate at
 * @param stalenessThreshold - Threshold for considering stale (default: 0.7)
 */
export function getValidityStatus(
  fact: Parameters<typeof calculateStaleness>[0],
  queryTime: number = Date.now(),
  stalenessThreshold: number = DEFAULT_TEMPORAL_VALIDITY_CONFIG.staleness_threshold
): ValidityStatus {
  const validFrom =
    fact.valid_from ?? fact.timestamp ?? fact.firstSeen ?? queryTime

  if (queryTime < validFrom) {
    return "future"
  }

  if (
    fact.valid_until !== null &&
    fact.valid_until !== undefined &&
    queryTime >= fact.valid_until
  ) {
    return "expired"
  }

  const staleness = calculateStaleness(fact, queryTime)
  if (staleness >= stalenessThreshold) {
    return "stale"
  }

  return "valid"
}

// ============================================================================
// Temporal Queries
// ============================================================================

/**
 * Query knowledge valid at a specific time point.
 * "What did I know/prefer at time T?"
 *
 * @param knowledge - Array of knowledge items to query
 * @param config - Temporal validity configuration
 * @param queryTime - The time point to evaluate at (default: now)
 */
export function queryKnowledgeAtTime(
  knowledge: LongTermKnowledge[],
  config: TemporalValidityConfig = DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  queryTime: number = Date.now()
): TemporalQueryResult<LongTermKnowledge>[] {
  return knowledge
    .map((k) => {
      const staleness = calculateStaleness(
        {
          valid_from: k.valid_from ?? k.firstSeen,
          valid_until: k.valid_until,
          staleness_category: k.staleness_category ?? "medium-term",
          lastReinforced: k.lastReinforced,
        },
        queryTime
      )

      const validityStatus = getValidityStatus(
        {
          valid_from: k.valid_from ?? k.firstSeen,
          valid_until: k.valid_until,
          staleness_category: k.staleness_category,
          lastReinforced: k.lastReinforced,
        },
        queryTime,
        config.staleness_threshold
      )

      const effectiveConfidence = calculateEffectiveConfidence(
        k,
        queryTime,
        config.decay_factor
      )

      return {
        item: k,
        staleness,
        isOngoing: k.valid_until === null || k.valid_until === undefined,
        validityStatus,
        effectiveConfidence,
      }
    })
    .filter((r) => {
      // Filter by validity status
      if (!config.include_expired && r.validityStatus === "expired") {
        return false
      }
      if (r.validityStatus === "future") {
        return false
      }
      if (r.staleness > config.staleness_threshold) {
        return false
      }
      return true
    })
    .sort((a, b) => a.staleness - b.staleness) // Freshest first
}

// ============================================================================
// Validity Range Calculation
// ============================================================================

/**
 * Calculate the union validity range from multiple entries.
 * Used when aggregating L0 -> L1 or L1 -> L2.
 *
 * @param entries - Array of entries with temporal validity
 */
export function calculateValidityRange(
  entries: Array<{
    timestamp: number
    valid_from?: number
    valid_until?: number | null
  }>
): FactsValidRange | undefined {
  if (entries.length === 0) {
    return undefined
  }

  let earliest_valid_from = Infinity
  let latest_valid_until: number | null = null
  let hasOngoing = false

  for (const entry of entries) {
    const valid_from = entry.valid_from ?? entry.timestamp
    earliest_valid_from = Math.min(earliest_valid_from, valid_from)

    if (entry.valid_until === null || entry.valid_until === undefined) {
      hasOngoing = true
    } else if (!hasOngoing) {
      latest_valid_until = Math.max(latest_valid_until ?? 0, entry.valid_until)
    }
  }

  return {
    earliest_valid_from,
    latest_valid_until: hasOngoing ? null : latest_valid_until,
  }
}

// ============================================================================
// Knowledge ID Generation
// ============================================================================

/**
 * Generate unique ID for knowledge item.
 * Format: "k_{hash}_{timestamp_base36}"
 *
 * @param content - Knowledge content to hash
 */
export function generateKnowledgeId(content: string): string {
  // Simple hash-like ID from content
  const hash = content
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join("-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 30)

  return `k_${hash}_${Date.now().toString(36)}`
}

// ============================================================================
// Filter Functions for Memory Injection
// ============================================================================

/**
 * Filter long-term knowledge for injection based on temporal validity.
 *
 * @param knowledge - Array of knowledge items
 * @param config - Temporal validity configuration
 * @param limit - Maximum items to return (default: 5)
 * @param queryTime - The time point to evaluate at (default: now)
 */
export function filterKnowledgeForInjection(
  knowledge: LongTermKnowledge[],
  config: TemporalValidityConfig = DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  limit: number = 5,
  queryTime: number = Date.now()
): LongTermKnowledge[] {
  if (!config.enabled) {
    // Fallback to original behavior: filter by base confidence
    return knowledge.filter((k) => k.confidence >= 0.6).slice(0, limit)
  }

  return queryKnowledgeAtTime(knowledge, config, queryTime)
    .filter((r) => r.effectiveConfidence !== undefined && r.effectiveConfidence >= 0.5)
    .slice(0, limit)
    .map((r) => r.item)
}

/**
 * Filter work history entries for injection based on temporal validity.
 *
 * @param entries - Array of work history entries
 * @param config - Temporal validity configuration
 * @param limit - Maximum items to return (default: 3)
 * @param queryTime - The time point to evaluate at (default: now)
 */
export function filterWorkHistoryForInjection(
  entries: WorkHistoryEntry[],
  config: TemporalValidityConfig = DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  limit: number = 3,
  queryTime: number = Date.now()
): WorkHistoryEntry[] {
  if (!config.enabled) {
    // Fallback to original behavior: most recent entries
    return entries.slice(0, limit)
  }

  return entries
    .map((entry) => ({
      entry,
      staleness: calculateStaleness(
        {
          timestamp: entry.timestamp,
          valid_from: entry.valid_from,
          valid_until: entry.valid_until,
          staleness_category: entry.staleness_category ?? "short-term",
        },
        queryTime
      ),
      validityStatus: getValidityStatus(
        {
          timestamp: entry.timestamp,
          valid_from: entry.valid_from,
          valid_until: entry.valid_until,
          staleness_category: entry.staleness_category ?? "short-term",
        },
        queryTime,
        config.staleness_threshold
      ),
    }))
    .filter((r) => {
      if (r.validityStatus === "future") return false
      if (!config.include_expired && r.validityStatus === "expired") return false
      return r.staleness < config.staleness_threshold
    })
    .sort((a, b) => a.staleness - b.staleness)
    .slice(0, limit)
    .map((r) => r.entry)
}
