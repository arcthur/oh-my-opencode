import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type {
  UserMemoryConfig,
  PatternStats,
  HierarchicalMemoryConfig,
  EntityMemoryConfig,
  TemporalValidityConfig,
  ConsolidationConfig,
  SemanticClusteringConfig,
} from "./types"
import type {
  ToolExecuteInput,
  ToolExecuteOutput,
  EventInput,
  MessageInput,
} from "../../shared/hook-types"
import type { ContextCollector } from "../context-injector/collector"
import {
  DEFAULT_CONFIG,
  DEFAULT_HIERARCHICAL_CONFIG,
  DEFAULT_ENTITY_MEMORY_CONFIG,
  DEFAULT_ENTITY_GRAPH,
  DEFAULT_TEMPORAL_VALIDITY_CONFIG,
  DEFAULT_CONSOLIDATION_CONFIG,
  DEFAULT_SEMANTIC_CLUSTERING_CONFIG,
} from "./types"
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
  mergeKnowledge,
} from "./aggregation"
import { extractEntitiesFromWorkHistory, extractEntitiesFromWeeklySummary } from "./entity-extraction"
import { addEntitiesAndCooccurrenceRelationships, pruneEntityGraph } from "./entity-reconciliation"
import { buildKnowledgeExtractionPrompt } from "./prompts"
import {
  PROMPT_TAGS,
  parseKnowledgeExtraction,
  parseMonthToTimestamp,
  type PromptKind,
} from "./schemas"
import {
  createUserMemorySummarizer,
  createAggregationSummarizer,
  CircuitOpenError,
  type UserMemorySummarizer,
} from "./summarizer"
import { log } from "../../shared/logger"
import { generateKnowledgeId, inferStalenessCategory } from "./temporal-validity"

// ============================================================================
// Types
// ============================================================================

/**
 * Extended config including hierarchical memory and entity memory settings
 */
export interface UserMemoryHookConfig extends UserMemoryConfig {
  hierarchical_memory?: Partial<HierarchicalMemoryConfig>
  entity_memory?: Partial<EntityMemoryConfig>
  temporal_validity?: Partial<TemporalValidityConfig>
  consolidation?: Partial<ConsolidationConfig>
  semantic_clustering?: Partial<SemanticClusteringConfig>
  disclosure_level?: "minimal" | "standard" | "full"
}

// Re-export types
export type { UserMemorySummarizer, PromptKind as UserMemoryPromptKind }

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create default summarizer using session API
 */
export function createDefaultUserMemorySummarizer(
  ctx: PluginInput,
  _config?: Partial<UserMemoryHookConfig>,
  options?: { categories?: CategoriesConfig; systemDefaultModel?: string }
): UserMemorySummarizer | undefined {
  return createUserMemorySummarizer(ctx, options)
}

// ============================================================================
// Hook Factory
// ============================================================================

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
export function createUserMemoryHook(
  ctx: PluginInput,
  userConfig?: Partial<UserMemoryHookConfig>,
  deps?: { summarizer?: UserMemorySummarizer; collector?: ContextCollector }
) {
  const config: UserMemoryConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const hierarchicalConfig: HierarchicalMemoryConfig = {
    ...DEFAULT_HIERARCHICAL_CONFIG,
    ...userConfig?.hierarchical_memory,
  }
  const entityConfig: EntityMemoryConfig = {
    ...DEFAULT_ENTITY_MEMORY_CONFIG,
    ...userConfig?.entity_memory,
  }
  const temporalConfig: TemporalValidityConfig = {
    ...DEFAULT_TEMPORAL_VALIDITY_CONFIG,
    ...userConfig?.temporal_validity,
  }
  const consolidationConfig: ConsolidationConfig = {
    ...DEFAULT_CONSOLIDATION_CONFIG,
    ...userConfig?.consolidation,
  }
  const semanticClusteringConfig: SemanticClusteringConfig = {
    ...DEFAULT_SEMANTIC_CLUSTERING_CONFIG,
    ...userConfig?.semantic_clustering,
  }
  const disclosureLevel = userConfig?.disclosure_level ?? "standard"
  const collector = deps?.collector

  // Flag to prevent concurrent aggregations
  let aggregationInProgress = false

  // In-memory pattern stats accumulator (persisted on session end)
  let patternStats: PatternStats = loadPatternStats()

  // Patterns to detect "remember" requests
  const REMEMBER_PATTERNS = [
    /\bremember\s+that\s+(.+)/i,
    /\bremember(?:\s+this)?\s*:\s*(.+)/i,
    /\b(?:please\s+)?(?:save|note)\s*:\s*(.+)/i,
    /\bnote\s+that\s+(.+)/i,
    /\bkeep\s+in\s+mind\s+that\s+(.+)/i,
    /\bi\s+(?:prefer|always|like|use|want)\s+(.+)/i,
  ]

  // Create aggregation summarizer with circuit breaker support
  const aggregationSummarizer = createAggregationSummarizer(deps?.summarizer, {
    aggregation_model: hierarchicalConfig.aggregation_model,
  })

  /**
   * Register user memory context with the collector (once per session)
   */
  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    _output: unknown
  ) => {
    if (!config.enabled || !config.auto_inject || !collector) return

    const memorySummary = getMemorySummary(temporalConfig, disclosureLevel, entityConfig)
    if (!memorySummary) return

    collector.register(input.sessionID, {
      id: "user-memory-context",
      source: "user-memory",
      priority: "normal",
      content: memorySummary,
      oncePerSession: true,
      estimatedTokens: Math.ceil(memorySummary.length / 4),
      metadata: {
        disclosureLevel,
      },
    })

    log("[user-memory] registered context for injection", { sessionID: input.sessionID })
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
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
      if (match?.[1]) {
        const toRemember = match[1].trim()
        if (toRemember.length > 5) {
          addExplicitMemory(toRemember)
          log("[user-memory] captured explicit memory", { content: toRemember.substring(0, 50) })
        }
        break
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
      const previousWeekStarts = new Set((memory.weeklySummaries ?? []).map((w) => w.weekStart))

      // Initialize timestamps if this is a new user
      if (!memory.lastWeeklyAggregation && memory.workHistory.length > 0) {
        const initialized = initializeAggregationTimestamps(memory, now)
        saveUserMemory(initialized)
        log("[user-memory] initialized aggregation timestamps")
        return
      }

      // Perform aggregations
      const updated = await performAggregations(
        memory,
        now,
        aggregationSummarizer,
        hierarchicalConfig,
        consolidationConfig,
        semanticClusteringConfig
      )

      let entityGraphChanged = false

      // L1 entity extraction for newly added weekly summaries
      if (entityConfig.enabled) {
        const newWeeklySummaries =
          updated.weeklySummaries?.filter((w) => !previousWeekStarts.has(w.weekStart)) ?? []

        if (newWeeklySummaries.length > 0) {
          let graph = updated.entityGraph
            ? {
                ...DEFAULT_ENTITY_GRAPH,
                ...updated.entityGraph,
                nodes: updated.entityGraph.nodes ?? {},
                relationships: updated.entityGraph.relationships ?? [],
                aliasIndex: updated.entityGraph.aliasIndex ?? {},
              }
            : {
                ...DEFAULT_ENTITY_GRAPH,
                nodes: {},
                relationships: [],
                aliasIndex: {},
              }

          for (const weeklySummary of newWeeklySummaries) {
            const entities = extractEntitiesFromWeeklySummary(weeklySummary)
            if (entities.length > 0) {
              graph = addEntitiesAndCooccurrenceRelationships(graph, entities, {
                timestamp: weeklySummary.weekStart,
                context: `Weekly summary - ${weeklySummary.summary.slice(0, 160)}`,
              })
              entityGraphChanged = true
            }
          }

          if (entityGraphChanged) {
            graph = pruneEntityGraph(
              graph,
              entityConfig.max_entities,
              entityConfig.max_relationships,
              entityConfig.min_mentions
            )
            updated.entityGraph = graph
            updated.lastEntityExtraction = now
          }
        }
      }

      // Optional: LLM-based knowledge extraction (augment L2->L3)
      if (
        deps?.summarizer &&
        semanticClusteringConfig.enabled &&
        semanticClusteringConfig.max_llm_calls > 0 &&
        updated.lastKnowledgeExtraction !== memory.lastKnowledgeExtraction &&
        (updated.monthlySummaries?.length ?? 0) > 0
      ) {
        try {
          const knowledgePrompt = buildKnowledgeExtractionPrompt(updated.monthlySummaries ?? [])
          const raw = await deps.summarizer.summarize(knowledgePrompt, {
            kind: "knowledge",
            model: hierarchicalConfig.aggregation_model,
          })
          const parsed = parseKnowledgeExtraction(raw)

          if (parsed.knowledge.length > 0) {
            const enriched = parsed.knowledge
              .filter((k) => k.content?.trim().length > 0)
              .map((k) => {
                const months = k.sourceMonths.filter(Boolean)
                const firstMonth = months[0] ?? ""
                const lastMonth = months[months.length - 1] ?? ""
                return {
                  id: generateKnowledgeId(k.content),
                  category: k.category,
                  content: k.content,
                  confidence: Math.min(Math.max(k.confidence, 0), 1),
                  firstSeen: parseMonthToTimestamp(firstMonth) ?? Date.now(),
                  lastReinforced: parseMonthToTimestamp(lastMonth) ?? Date.now(),
                  sourceMonths: months,
                  staleness_category: inferStalenessCategory({
                    category: k.category,
                    content: k.content,
                  }),
                }
              })

            if (enriched.length > 0) {
              updated.longTermKnowledge = mergeKnowledge(
                updated.longTermKnowledge ?? [],
                enriched,
                hierarchicalConfig.long_term_knowledge_limit
              )
            }
          }
        } catch (error) {
          if (error instanceof CircuitOpenError) {
            log("[user-memory] knowledge extraction skipped (circuit open)")
          } else {
            log("[user-memory] knowledge extraction failed", { error: String(error) })
          }
        }
      }

      // Check if anything changed
      const hasChanges =
        updated.weeklySummaries?.length !== memory.weeklySummaries?.length ||
        updated.monthlySummaries?.length !== memory.monthlySummaries?.length ||
        updated.longTermKnowledge?.length !== memory.longTermKnowledge?.length ||
        updated.workHistory.length !== memory.workHistory.length ||
        updated.lastWeeklyAggregation !== memory.lastWeeklyAggregation ||
        updated.lastMonthlyAggregation !== memory.lastMonthlyAggregation ||
        updated.lastKnowledgeExtraction !== memory.lastKnowledgeExtraction ||
        entityGraphChanged

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

    // Persist and aggregate on session deletion
    // (Collector cleanup is handled by SessionStateCoordinator)
    if (event.type === "session.deleted") {
      savePatternStats(patternStats)
      aggregateFrequentPatterns()
      await triggerAggregation()
    }

    // Persist and aggregate on compaction
    // (Collector resetOncePerSession is handled by SessionStateCoordinator)
    if (event.type === "session.compacted") {
      savePatternStats(patternStats)
      aggregateFrequentPatterns()
      await triggerAggregation()
    }

    // Capture work summary on session end/summarize
    if (event.type === "session.summarized" && config.persist_work_history) {
      const summary = props?.summary as string | undefined
      const sessionID = props?.sessionID as string | undefined

      if (summary && sessionID) {
        const briefSummary = extractBriefSummary(summary)
        if (briefSummary) {
          const project = ctx.directory.split("/").pop()
          const now = Date.now()

          addWorkHistoryEntry(
            {
              summary: briefSummary,
              project,
            },
            config
          )
          log("[user-memory] captured work history", { summary: briefSummary.substring(0, 50) })

          // Extract entities if enabled
          if (entityConfig.enabled) {
            const memory = loadUserMemory()
            let graph = memory.entityGraph
              ? {
                  ...DEFAULT_ENTITY_GRAPH,
                  ...memory.entityGraph,
                  nodes: memory.entityGraph.nodes ?? {},
                  relationships: memory.entityGraph.relationships ?? [],
                  aliasIndex: memory.entityGraph.aliasIndex ?? {},
                }
              : {
                  ...DEFAULT_ENTITY_GRAPH,
                  nodes: {},
                  relationships: [],
                  aliasIndex: {},
                }

            const allEntities = extractEntitiesFromWorkHistory({
              summary: briefSummary,
              project,
              timestamp: now,
            })
            const entities = allEntities.filter((e) => entityConfig.extract_types.includes(e.type))

            if (entities.length > 0) {
              graph = addEntitiesAndCooccurrenceRelationships(graph, entities, {
                timestamp: now,
                context: `${project ?? "unknown"} - ${briefSummary.slice(0, 120)}`,
              })
            }

            graph = pruneEntityGraph(
              graph,
              entityConfig.max_entities,
              entityConfig.max_relationships,
              entityConfig.min_mentions
            )

            memory.entityGraph = graph
            memory.lastEntityExtraction = now
            saveUserMemory(memory)

            if (entities.length > 0) {
              log("[user-memory] extracted entities", { count: entities.length })
            }
          }

          // Trigger hierarchical memory aggregation after adding work history
          await triggerAggregation()
        }
      }
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    "user.prompt.submit": userPromptSubmit,
    event: eventHandler,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract a brief summary from a longer compaction summary
 */
function extractBriefSummary(fullSummary: string): string | null {
  // Try to find "Work Completed" section
  const workCompletedMatch = fullSummary.match(/##\s*(?:Work Completed|Completed|Done)[\s\S]*?(?=##|$)/i)
  if (workCompletedMatch) {
    const section = workCompletedMatch[0]
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
  const lines = fullSummary.split("\n").filter((l) => l.trim() && !l.startsWith("#"))
  if (lines.length > 0) {
    return lines[0].trim().substring(0, 200)
  }

  return null
}
