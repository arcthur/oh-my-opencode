/**
 * Centralized context limit constants and helpers.
 *
 * This module provides a single source of truth for Anthropic context window limits,
 * eliminating duplicate definitions across the codebase.
 */

/** Default Anthropic context limit (200K tokens) */
export const DEFAULT_ANTHROPIC_CONTEXT_LIMIT = 200_000

/** Extended Anthropic context limit (1M tokens) */
export const ANTHROPIC_1M_CONTEXT_LIMIT = 1_000_000

/**
 * Check if 1M context is enabled via environment variables.
 */
export function isEnv1MContextEnabled(): boolean {
  return (
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
  )
}

/**
 * Get default Anthropic context limit based on environment variables.
 * This is a fallback when no runtime config is available.
 *
 * @returns 1M if env enabled, otherwise 200K
 */
export function getDefaultAnthropicContextLimit(): number {
  return isEnv1MContextEnabled()
    ? ANTHROPIC_1M_CONTEXT_LIMIT
    : DEFAULT_ANTHROPIC_CONTEXT_LIMIT
}

/**
 * Format context limit for display (e.g., "200K" or "1M")
 */
export function formatContextLimit(limit: number): string {
  if (limit >= ANTHROPIC_1M_CONTEXT_LIMIT) {
    return "1M"
  }
  return `${Math.round(limit / 1000)}K`
}
