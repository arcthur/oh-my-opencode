/**
 * Planning with Files Hook Types
 */

import type { PlanningWithFilesConfig } from "../../features/planning-with-files/types"

/** Hook configuration extending the base planning config */
export interface PlanningHookConfig extends PlanningWithFilesConfig {
  /** Session ID for tracking */
  sessionId?: string
  /** Current working directory */
  cwd?: string
  /** Active plan name (if any) */
  activePlanName?: string
}

/** State stored per session */
export interface PlanningHookState {
  sessionId: string
  activePlanName: string | null
  actionCount: number
  lastRereadTime: number
  twoActionWarningShown: boolean
  errorStrikes: Map<string, number>
}

/** Result from pre-tool-use hook */
export interface PreToolUseHookResult {
  /** Whether to allow the tool use */
  allow: boolean
  /** System message to inject (the re-read context) */
  systemMessage?: string
  /** Reason for blocking (if blocked) */
  reason?: string
}

/** Result from post-tool-use hook */
export interface PostToolUseHookResult {
  /** System message to inject (2-action reminder) */
  systemMessage?: string
  /** Whether findings update is needed */
  needsFindingsUpdate: boolean
}

/** Result from stop hook */
export interface StopHookResult {
  /** Whether to block stopping */
  block: boolean
  /** Reason for blocking */
  reason?: string
  /** Incomplete phases if any */
  incompletePhases?: string[]
}
