/**
 * Active Handoff Launcher
 *
 * Executes goal-oriented handoffs by:
 * 1. Extracting context from current session
 * 2. Filtering by goal relevance
 * 3. Building handoff prompt
 * 4. Creating new session (or returning preview)
 */

import type {
  ActiveHandoffRequest,
  ActiveHandoffResult,
  HandoffPackage,
  SessionHandoffConfig,
  ExtractionContext,
  TrackedMessage,
  TrackedToolCall,
} from "./types"
import type { ExtractorDependencies } from "./extractor"
import { createHandoffPackage, buildExtractionContext } from "./extractor"
import { filterPayloadByGoal } from "./goal-extractor"
import { buildHandoffPrompt, buildHandoffSummary } from "./prompt-builder"
import { saveHandoff } from "./storage"
import { log } from "../../shared/logger"

// ============================================================================
// Types
// ============================================================================

/**
 * Session state input for launcher functions.
 * Only includes fields needed for handoff creation - no runtime tracking flags.
 */
export interface LauncherSessionInput {
  projectPath: string
  startTime: number
  messages: TrackedMessage[]
  toolCalls: TrackedToolCall[]
  /** File changes - accepts Set (from runtime) or array (from snapshot) */
  fileChanges: Set<string> | string[]
}

export interface LauncherDependencies extends ExtractorDependencies {
  /** Function to create a new session (optional - if not provided, runs in preview mode) */
  createSession?: () => Promise<string>

  /** Function to send prompt to a session (optional - if not provided, runs in preview mode) */
  sendPrompt?: (sessionId: string, prompt: string) => Promise<void>
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Execute an active (goal-oriented) handoff
 *
 * This function:
 * 1. Creates a handoff package from the current session
 * 2. Filters the payload based on the goal
 * 3. Builds a prompt for the new session
 * 4. Either creates a new session or returns the prompt for preview
 */
export async function executeActiveHandoff(
  request: ActiveHandoffRequest,
  deps: LauncherDependencies,
  sessionState: LauncherSessionInput,
  config: SessionHandoffConfig
): Promise<ActiveHandoffResult> {
  const { goal, sourceSessionId, projectPath, launchMode } = request

  // Normalize fileChanges to array
  const fileChangesArray = Array.isArray(sessionState.fileChanges)
    ? sessionState.fileChanges
    : [...sessionState.fileChanges]

  log("[session-handoff] executing active handoff", {
    goal,
    sourceSessionId,
    launchMode,
    messageCount: sessionState.messages.length,
    fileChangeCount: fileChangesArray.length,
  })

  // Step 1: Build extraction context from session state
  const context: ExtractionContext = buildExtractionContext(
    sourceSessionId,
    projectPath,
    sessionState.messages,
    sessionState.toolCalls,
    fileChangesArray,
    sessionState.startTime,
    Date.now()
  )

  // Step 2: Create handoff package
  const handoffPackage = await createHandoffPackage(context, config, deps, goal)

  // Step 3: Filter payload by goal relevance
  const filtered = filterPayloadByGoal(handoffPackage.payload, {
    goal,
    minRelevance: 0.15,
    maxDecisions: 8,
    maxArtifacts: 12,
    maxDomainContext: 6,
  })

  log("[session-handoff] filtered payload by goal", {
    goal,
    stats: filtered.stats,
  })

  // Step 4: Build handoff prompt using FILTERED payload (goal-relevant subset)
  const prompt = buildHandoffPrompt(goal, filtered.payload, handoffPackage)

  // Step 5: Save the FULL package (not filtered) for future sessions
  // Rationale: The full payload is stored so that automatic injection can use
  // complete context. The filtered prompt is for this specific goal transfer.
  const storedPackage: HandoffPackage = {
    ...handoffPackage,
    metadata: {
      ...handoffPackage.metadata,
      targetIntent: goal,
    },
  }

  saveHandoff(storedPackage)

  // Step 6: Launch new session or return preview
  let newSessionId: string | undefined
  let message: string

  if (launchMode === "auto" && deps.createSession && deps.sendPrompt) {
    try {
      newSessionId = await deps.createSession()
      await deps.sendPrompt(newSessionId, prompt)
      message = `Handoff initiated.\n\n${buildHandoffSummary(goal, filtered.payload, storedPackage)}\n\nThe new session has started.`
    } catch (error) {
      log("[session-handoff] failed to launch new session", { error: String(error) })
      message = `Handoff package created but failed to launch new session: ${String(error)}\n\n${buildHandoffSummary(goal, filtered.payload, storedPackage)}\n\nUse the prompt below to start manually.`
    }
  } else {
    message = `Handoff initiated.\n\n${buildHandoffSummary(goal, filtered.payload, storedPackage)}\n\nStart a new session to continue with the transferred context.`
  }

  return {
    handoffPackage: storedPackage,
    prompt,
    newSessionId,
    message,
    decisionsTransferred: filtered.payload.decisions.length,
    antiPatternsTransferred: filtered.payload.antiPatterns.length,
    keyFiles: filtered.payload.artifacts.map((a) => a.path),
  }
}

/**
 * Build a quick handoff without full LLM extraction.
 *
 * Use this when:
 * - Session has minimal tracked state
 * - Quick handoff is needed without extraction overhead
 */
export function buildQuickHandoff(
  goal: string,
  sessionState: LauncherSessionInput,
  sourceSessionId: string
): { prompt: string; summary: string } {
  // Normalize fileChanges to array
  const fileChanges = Array.isArray(sessionState.fileChanges)
    ? sessionState.fileChanges
    : [...sessionState.fileChanges]

  const minimalPayload = {
    decisions: [],
    artifacts: fileChanges.map((path) => ({
      path,
      changeType: "modified" as const,
      summary: "Modified during session",
    })),
    antiPatterns: [],
    domainContext: [],
    remainingTasks: [goal],
  }

  const minimalPackage: HandoffPackage = {
    id: `ho_quick_${Date.now()}`,
    sourceSessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    metadata: {
      originalGoal: goal,
      durationMs: Date.now() - sessionState.startTime,
      projectPath: sessionState.projectPath,
      keyFiles: fileChanges,
      outcome: "partial",
      targetIntent: goal,
    },
    payload: minimalPayload,
  }

  const prompt = buildHandoffPrompt(goal, minimalPayload, minimalPackage, {
    includePreamble: true,
    includeFiles: true,
    includeRemainingTasks: true,
  })

  const summary = buildHandoffSummary(goal, minimalPayload, minimalPackage)

  return { prompt, summary }
}
