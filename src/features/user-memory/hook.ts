import type { PluginInput } from "@opencode-ai/plugin"
import type { UserMemoryConfig, PatternStats, HierarchicalMemoryConfig } from "./types"
import type {
  ToolExecuteInput,
  ToolExecuteOutput,
  EventInput,
  MessageInput,
} from "../../shared/hook-types"
import { DEFAULT_CONFIG, DEFAULT_PATTERN_STATS, DEFAULT_HIERARCHICAL_CONFIG } from "./types"
import {
  getMemorySummary,
  addWorkHistoryEntry,
  addExplicitMemory,
  loadPatternStats,
  savePatternStats,
  recordToolUsage,
  aggregateFrequentPatterns,
  loadUserMemory,
  saveUserMemory,
} from "./storage"
import {
  performAggregations,
  initializeAggregationTimestamps,
  type SummarizeFunction,
} from "./aggregation"
import { log } from "../../shared/logger"

/**
 * Extended config including hierarchical memory settings
 */
export interface UserMemoryHookConfig extends UserMemoryConfig {
  hierarchical_memory?: Partial<HierarchicalMemoryConfig>
}

/**
 * Creates a hook that injects user memory context into sessions
 * and captures explicit "remember" requests.
 *
 * Supports RAPTOR-style hierarchical memory aggregation:
 * - L0: Raw work history entries
 * - L1: Weekly summaries (aggregated when crossing week boundaries)
 * - L2: Monthly summaries (aggregated when crossing month boundaries)
 * - L3: Long-term knowledge (extracted quarterly)
 */
export function createUserMemoryHook(ctx: PluginInput, userConfig?: Partial<UserMemoryHookConfig>) {
  const config: UserMemoryConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const hierarchicalConfig: HierarchicalMemoryConfig = {
    ...DEFAULT_HIERARCHICAL_CONFIG,
    ...userConfig?.hierarchical_memory,
  }
  const injectedSessions = new Set<string>()

  // Flag to prevent concurrent aggregations
  let aggregationInProgress = false

  // In-memory pattern stats accumulator (persisted on session end)
  let patternStats: PatternStats = loadPatternStats()

  // Patterns to detect "remember" requests
  // More precise to avoid matching imperative commands like "remember to run tests"
  const REMEMBER_PATTERNS = [
    // "remember that X" - declarative statement
    /\bremember\s+that\s+(.+)/i,
    // "remember: X" or "remember this: X" - explicit memory marker
    /\bremember(?:\s+this)?\s*:\s*(.+)/i,
    // "please save/note X" with explicit marker
    /\b(?:please\s+)?(?:save|note)\s*:\s*(.+)/i,
    // "note that X" - declarative statement
    /\bnote\s+that\s+(.+)/i,
    // "keep in mind that X" - must have "that" to be declarative
    /\bkeep\s+in\s+mind\s+that\s+(.+)/i,
    // "I prefer X" / "I always X" / "I like X" - preference statements
    /\bi\s+(?:prefer|always|like|use|want)\s+(.+)/i,
  ]

  async function injectMemory(sessionID: string, output: ToolExecuteOutput): Promise<void> {
    if (!config.enabled || !config.auto_inject) return
    if (injectedSessions.has(sessionID)) return

    const memorySummary = getMemorySummary()
    if (memorySummary) {
      output.output += `\n\n${memorySummary}`
      log("[user-memory] injected memory context", { sessionID })
    }

    injectedSessions.add(sessionID)
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    // Inject memory on first tool use in session
    if (!injectedSessions.has(input.sessionID)) {
      await injectMemory(input.sessionID, output)
    }

    // Track tool usage patterns
    if (config.enabled) {
      const args = (output.metadata as { args?: unknown })?.args
      recordToolUsage(input.tool, args, input.sessionID, patternStats)
    }
  }

  const userPromptSubmit = async (input: MessageInput) => {
    if (!config.enabled) return

    const content = input.message.content

    // Check for "remember" patterns
    for (const pattern of REMEMBER_PATTERNS) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const toRemember = match[1].trim()
        if (toRemember.length > 5) { // Avoid saving tiny fragments
          addExplicitMemory(toRemember)
          log("[user-memory] captured explicit memory", { content: toRemember.substring(0, 50) })
        }
        break
      }
    }
  }

  /**
   * Create a fallback summarization function that doesn't require LLM
   * This can be replaced with an LLM-based implementation when available
   */
  const createFallbackSummarizer = (): SummarizeFunction => {
    return async (_prompt: string) => {
      // For now, return a basic response
      // The aggregation functions will use the metadata-based fallback
      return {
        summary: "",
        achievements: [],
        lessons: [],
      }
    }
  }

  /**
   * Trigger hierarchical memory aggregation if needed
   */
  const triggerAggregation = async () => {
    if (!hierarchicalConfig.enabled || !hierarchicalConfig.auto_aggregate) return
    if (aggregationInProgress) return

    try {
      aggregationInProgress = true
      const memory = loadUserMemory()
      const now = Date.now()

      // Initialize timestamps if this is a new user
      if (!memory.lastWeeklyAggregation && memory.workHistory.length > 0) {
        const initialized = initializeAggregationTimestamps(memory, now)
        saveUserMemory(initialized)
        log("[user-memory] initialized aggregation timestamps")
        return
      }

      // Perform aggregations using fallback summarizer
      const summarizer = createFallbackSummarizer()
      const updated = await performAggregations(memory, now, summarizer, hierarchicalConfig)

      // Check if anything changed (including timestamps and workHistory cleanup)
      const hasChanges =
        updated.weeklySummaries?.length !== memory.weeklySummaries?.length ||
        updated.monthlySummaries?.length !== memory.monthlySummaries?.length ||
        updated.longTermKnowledge?.length !== memory.longTermKnowledge?.length ||
        updated.workHistory.length !== memory.workHistory.length ||
        updated.lastWeeklyAggregation !== memory.lastWeeklyAggregation ||
        updated.lastMonthlyAggregation !== memory.lastMonthlyAggregation ||
        updated.lastKnowledgeExtraction !== memory.lastKnowledgeExtraction

      if (hasChanges) {
        saveUserMemory(updated)
        log("[user-memory] completed hierarchical aggregation", {
          weeklySummaries: updated.weeklySummaries?.length ?? 0,
          monthlySummaries: updated.monthlySummaries?.length ?? 0,
          longTermKnowledge: updated.longTermKnowledge?.length ?? 0,
          workHistoryCleaned: memory.workHistory.length - updated.workHistory.length,
        })
      }
    } catch (error) {
      log("[user-memory] aggregation failed", { error: String(error) })
    } finally {
      aggregationInProgress = false
    }
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Clear session state on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        injectedSessions.delete(sessionInfo.id)
      }

      // Persist pattern stats and aggregate on session end
      savePatternStats(patternStats)
      aggregateFrequentPatterns()

      // Trigger hierarchical memory aggregation
      await triggerAggregation()
    }

    // Clear session state on compaction (will re-inject on next tool use)
    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        injectedSessions.delete(sessionID)
      }

      // Persist pattern stats and aggregate on compaction
      savePatternStats(patternStats)
      aggregateFrequentPatterns()

      // Trigger hierarchical memory aggregation
      await triggerAggregation()
    }

    // Capture work summary on session end/summarize
    if (event.type === "session.summarized" && config.persist_work_history) {
      const summary = props?.summary as string | undefined
      const sessionID = props?.sessionID as string | undefined

      if (summary && sessionID) {
        // Extract a brief summary from the compaction summary
        const briefSummary = extractBriefSummary(summary)
        if (briefSummary) {
          addWorkHistoryEntry(
            {
              summary: briefSummary,
              project: ctx.directory.split("/").pop(),
            },
            config
          )
          log("[user-memory] captured work history", { summary: briefSummary.substring(0, 50) })

          // Trigger hierarchical memory aggregation after adding work history
          await triggerAggregation()
        }
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "user.prompt.submit": userPromptSubmit,
    event: eventHandler,
  }
}

/**
 * Extract a brief summary from a longer compaction summary
 */
function extractBriefSummary(fullSummary: string): string | null {
  // Try to find "Work Completed" section
  const workCompletedMatch = fullSummary.match(/##\s*(?:Work Completed|Completed|Done)[\s\S]*?(?=##|$)/i)
  if (workCompletedMatch) {
    const section = workCompletedMatch[0]
    // Extract first bullet point or first line
    const bulletMatch = section.match(/[-*]\s*(.+)/)
    if (bulletMatch) return bulletMatch[1].trim().substring(0, 200)
  }

  // Try to find "Final Goal" section
  const goalMatch = fullSummary.match(/##\s*(?:Final Goal|Goal|Objective)[\s\S]*?(?=##|$)/i)
  if (goalMatch) {
    const section = goalMatch[0]
    const bulletMatch = section.match(/[-*]\s*(.+)/)
    if (bulletMatch) return bulletMatch[1].trim().substring(0, 200)
  }

  // Fallback: first meaningful line
  const lines = fullSummary.split("\n").filter(l => l.trim() && !l.startsWith("#"))
  if (lines.length > 0) {
    return lines[0].trim().substring(0, 200)
  }

  return null
}
