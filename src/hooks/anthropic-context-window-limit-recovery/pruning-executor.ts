import type { DynamicContextPruningConfig } from "../../config"
import type { PruningState, PruningResult } from "./pruning-types"
import { executeDeduplication } from "./pruning-deduplication"
import { executeSupersedeWrites } from "./pruning-supersede"
import { executePurgeErrors } from "./pruning-purge-errors"
import { executeClearResults } from "./pruning-clear-results"
import { applyPruning } from "./pruning-storage"
import { log } from "../../shared/logger"

const DEFAULT_PROTECTED_TOOLS = new Set([
  "task",
  "todowrite",
  "todoread",
  "lsp_rename",
  "lsp_code_action_resolve",
  "session_read",
  "session_write",
  "session_search",
])

function createPruningState(): PruningState {
  return {
    toolIdsToPrune: new Set<string>(),
    currentTurn: 0,
    fileOperations: new Map(),
    toolSignatures: new Map(),
    erroredTools: new Map(),
  }
}

export async function executeDynamicContextPruning(
  sessionID: string,
  config: DynamicContextPruningConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
): Promise<PruningResult> {
  const state = createPruningState()
  
  const protectedTools = new Set([
    ...DEFAULT_PROTECTED_TOOLS,
    ...(config.protected_tools || []),
  ])
  
  log("[pruning-executor] starting DCP", {
    sessionID,
    notification: config.notification,
    turnProtection: config.turn_protection,
  })
  
  let dedupCount = 0
  let supersedeCount = 0
  let purgeCount = 0
  let clearResultsCount = 0

  // Strategy execution order: lowest risk → highest risk
  // 1. Deduplication: Safe - identical calls, agent can re-fetch
  if (config.strategies?.deduplication?.enabled !== false) {
    dedupCount = executeDeduplication(
      sessionID,
      state,
      { enabled: true },
      protectedTools
    )
  }

  // 2. Clear tool results: Safe - old results from deep history, agent can re-fetch
  if (config.strategies?.clear_tool_results?.enabled !== false) {
    clearResultsCount = executeClearResults(
      sessionID,
      state,
      {
        enabled: true,
        keep_recent_turns: config.strategies?.clear_tool_results?.keep_recent_turns || 5,
      },
      protectedTools
    )
  }

  // 3. Supersede writes: Medium risk - writes that have been re-read
  if (config.strategies?.supersede_writes?.enabled !== false) {
    supersedeCount = executeSupersedeWrites(
      sessionID,
      state,
      {
        enabled: true,
        aggressive: config.strategies?.supersede_writes?.aggressive || false,
      },
      protectedTools
    )
  }

  // 4. Purge errors: Lower priority - old errors might still be informative
  if (config.strategies?.purge_errors?.enabled !== false) {
    purgeCount = executePurgeErrors(
      sessionID,
      state,
      {
        enabled: true,
        turns: config.strategies?.purge_errors?.turns || 5,
      },
      protectedTools
    )
  }

  const totalPruned = state.toolIdsToPrune.size
  const tokensSaved = await applyPruning(sessionID, state)

  log("[pruning-executor] DCP complete", {
    totalPruned,
    tokensSaved,
    deduplication: dedupCount,
    supersede: supersedeCount,
    purge: purgeCount,
    clearResults: clearResultsCount,
  })

  const result: PruningResult = {
    itemsPruned: totalPruned,
    totalTokensSaved: tokensSaved,
    strategies: {
      deduplication: dedupCount,
      supersedeWrites: supersedeCount,
      purgeErrors: purgeCount,
      clearToolResults: clearResultsCount,
    },
  }

  if (config.notification !== "off" && totalPruned > 0) {
    const message =
      config.notification === "detailed"
        ? `Pruned ${totalPruned} tool outputs (~${Math.round(tokensSaved / 1000)}k tokens). Dedup: ${dedupCount}, Supersede: ${supersedeCount}, Purge: ${purgeCount}, ClearResults: ${clearResultsCount}`
        : `Pruned ${totalPruned} tool outputs (~${Math.round(tokensSaved / 1000)}k tokens)`
    
    await client.tui
      .showToast({
        body: {
          title: "Dynamic Context Pruning",
          message,
          variant: "success",
          duration: 3000,
        },
      })
      .catch(() => {})
  }
  
  return result
}
