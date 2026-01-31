/**
 * Handoff Prompt Builder
 *
 * Constructs the initial prompt for a new session from handoff context.
 * Delegates to the unified renderer for actual formatting.
 */

import type { HandoffPackage, HandoffPayload } from "./types"
import {
  renderHandoffPrompt,
  renderHandoffSummary,
  type RenderOptions,
} from "./renderer"

// ============================================================================
// Types (Re-exported for backward compatibility)
// ============================================================================

export interface PromptBuilderOptions {
  /** Whether to include preamble explaining the handoff */
  includePreamble?: boolean

  /** Whether to include file listing */
  includeFiles?: boolean

  /** Whether to include remaining tasks section */
  includeRemainingTasks?: boolean

  /** Maximum line length for wrapping (deprecated, not used) */
  maxLineLength?: number
}

// ============================================================================
// Main Builder (Delegates to Renderer)
// ============================================================================

/**
 * Build a handoff prompt for starting a new session
 */
export function buildHandoffPrompt(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage,
  options: PromptBuilderOptions = {}
): string {
  return renderHandoffPrompt(goal, payload, sourcePackage, {
    includePreamble: options.includePreamble,
    includeFiles: options.includeFiles,
    includeRemainingTasks: options.includeRemainingTasks,
  })
}

/**
 * Build a compact summary for display (not for prompt injection)
 */
export function buildHandoffSummary(
  goal: string,
  payload: HandoffPayload,
  sourcePackage: HandoffPackage
): string {
  return renderHandoffSummary(goal, payload, sourcePackage)
}
