import type { MultiPlanPipelineConfig } from "../../config/schema"
import { normalizePlanningConfig, type NormalizedPlanningModel } from "../../features/multi-plan"
import { analyzeClarity, getInterviewRecommendation } from "../../features/multi-plan/clarity-detector"
import {
  analyzeComplexity,
  getRecommendedAction,
  isMultiModelAvailable,
} from "../../features/multi-plan/complexity-detector"
import { log } from "../../shared/logger"

export const HOOK_NAME = "multi-plan-trigger"

const DEFAULT_PIPELINE_CONFIG: MultiPlanPipelineConfig = {
  auto_complexity_detection: true,
  smart_skip_interview: true,
  deep_verification: true,
  adhd_detection: true,
}

/**
 * Complexity-based trigger table for multi-model planning
 *
 * This table guides Prometheus on when to use multi-model planning:
 * - TRIVIAL/SIMPLE: Use single model (direct generation)
 * - COMPLEX: Use multi-model pipeline for diverse perspectives
 */
const COMPLEXITY_TRIGGER_TABLE = `
| Complexity | Signals | Action |
|------------|---------|--------|
| **TRIVIAL** | Typo fix, rename, single line change | Single model (direct) |
| **SIMPLE** | 1-2 files, clear scope, config change | Single model (direct) |
| **COMPLEX** | 3+ files, new feature, architecture, integration | **Use multi_plan** |
`

/**
 * Signals that indicate complex tasks requiring multi-model planning
 */
const COMPLEX_TASK_SIGNALS = `
**Complex Task Signals** (trigger multi-model):
- "add feature", "add system", "add module"
- "refactor entire/whole"
- "design", "architect"
- "authentication", "authorization"
- "database", "migration"
- "integrate with", "API integration"
- Request > 50 words with technical detail
- 3+ files mentioned or implied
`

/**
 * Hook options
 */
export interface MultiPlanTriggerHookOptions {
  /** Model config from agents.Prometheus.model - string for single, array for multi-plan */
  model: string | string[] | undefined
  pipelineConfig?: MultiPlanPipelineConfig | undefined
}

/** Track sessions that have already received capability injection */
const injectedSessions = new Set<string>()
/** Track last message text we routed (per session) to avoid duplicate routing blocks */
const lastRoutedMessageText = new Map<string, string>()

/**
 * Builds capability context for Prometheus to know about multi-plan
 *
 * Includes complexity-based trigger logic to determine when to use
 * multi-model planning vs single-model direct generation.
 */
function buildCapabilityContext(models: NormalizedPlanningModel[]): string {
  const modelList = models
    .map((m) => `  - **${m.name}**: ${m.model}`)
    .join("\n")

  return `
<multi-plan-capability>
## Multi-Model Planning Available

You have access to multi-model planning via the \`multi_plan\` tool.

### Configured Models
${modelList}

### Complexity-Based Trigger Decision

**FIRST**: Assess task complexity before deciding whether to use multi-model planning:

${COMPLEXITY_TRIGGER_TABLE}

${COMPLEX_TASK_SIGNALS}

### Decision Flow

1. **Assess Complexity** during interview (Step -1 and Step 0)
2. **For TRIVIAL/SIMPLE tasks**: Generate plan directly (single model)
3. **For COMPLEX tasks**: Use \`multi_plan\` tool for diverse perspectives

### When to Use multi_plan (COMPLEX tasks only)

When user requests plan generation for a COMPLEX task:
1. Complete your normal pre-generation steps (interview, clarifications)
2. Call the \`multi_plan\` tool:
   \`\`\`
   multi_plan({
     planName: "{plan-name}",
     context: "{complete interview context, decisions, research findings}",
     debate: true  // Optional: enable for high-stakes or controversial planning
   })
   \`\`\`
3. The tool will:
   - Launch ${models.length} models in parallel
   - Each generates their perspective on the plan
   - Plan Synthesizer reviews and resolves conflicts
   - Produces a unified final plan

### Why Multi-Model Planning (for COMPLEX tasks)
- Diverse perspectives catch blind spots
- Conflicts are explicitly identified and resolved
- Deep verification validates file references and implementation feasibility
- ADHD-omission detection catches implicit assumptions
- Final plan is more robust than single-model output

### Output Files
- Individual plans: \`.sisyphus/plans/{name}-{model}.md\`
- Comparison report: \`.sisyphus/plan-reviews/{name}-comparison.md\`
- Final unified plan: \`.sisyphus/plans/{name}.md\`

### Single Model Generation (for TRIVIAL/SIMPLE tasks)
For straightforward tasks, generate the plan directly without multi-model overhead:
- Faster turnaround
- Appropriate for well-bounded, low-risk changes
- Use standard plan format in \`.sisyphus/plans/{name}.md\`

**DECISION RULE**: Use multi_plan for COMPLEX tasks, generate directly for TRIVIAL/SIMPLE tasks.
</multi-plan-capability>
`
}

function buildRoutingContext(input: {
  messageText: string
  modelsCount: number
  pipeline: MultiPlanPipelineConfig
}): string | null {
  const { messageText, modelsCount, pipeline } = input

  const enableClarity = pipeline.smart_skip_interview
  const enableComplexity = pipeline.auto_complexity_detection

  if (!enableClarity && !enableComplexity) return null

  const multiAvailable = isMultiModelAvailable(modelsCount)

  const lines: string[] = []
  lines.push("<multi-plan-routing>")

  if (enableClarity) {
    const clarity = analyzeClarity(messageText)
    const interview = getInterviewRecommendation(clarity)
    lines.push(`Clarity: ${clarity.level} → interview: ${interview.action} (${clarity.reason})`)
  }

  if (enableComplexity) {
    const complexity = analyzeComplexity(messageText)
    const action = getRecommendedAction(complexity, multiAvailable)
    lines.push(`Complexity: ${complexity.level} → route: ${action} (signals: ${complexity.signals.length})`)
  }

  lines.push("</multi-plan-routing>")
  return lines.join("\n")
}

/**
 * Creates the multi-plan trigger hook
 *
 * This hook injects multi-plan capability information into the context
 * so that Prometheus (or other planners) know to use the multi_plan tool.
 *
 * The hook is only active when 2+ models are configured in `agents.Prometheus.model`.
 * With 0-1 models, Prometheus handles plan generation directly.
 *
 * Capability is injected once per session to avoid redundant context.
 */
export function createMultiPlanTriggerHook(options: MultiPlanTriggerHookOptions) {
  const { model, pipelineConfig } = options
  const models = normalizePlanningConfig(model)
  const pipeline = pipelineConfig ?? DEFAULT_PIPELINE_CONFIG

  // Only activate when 2+ models configured (multi-plan mode)
  if (models.length < 2) {
    log(`[${HOOK_NAME}] Less than 2 models configured (${models.length}), hook inactive`)
    return {}
  }

  log(`[${HOOK_NAME}] Multi-plan active with ${models.length} models`)

  const capabilityContext = buildCapabilityContext(models)

  return {
    /**
     * Inject multi-plan capability context into chat messages
     * This lets Prometheus know about the multi_plan tool
     *
     * Injection is done once per session to avoid redundant context/token waste.
     */
    "chat.message": async (
      input: { sessionID: string; messageID?: string },
      output: { parts: Array<{ type: string; text?: string }> }
    ): Promise<void> => {
      // Find the text part and append capability/routing context
      const textPartIndex = output.parts.findIndex(
        (p) => p.type === "text" && p.text
      )

      if (textPartIndex >= 0 && output.parts[textPartIndex].text) {
        const currentText = output.parts[textPartIndex].text

        // 1) Capability injection: once per session
        if (!injectedSessions.has(input.sessionID)) {
          // Double-check for capability context (belt and suspenders)
          if (!currentText?.includes("<multi-plan-capability>")) {
            output.parts[textPartIndex].text += `\n\n${capabilityContext}`
            injectedSessions.add(input.sessionID)

            log(`[${HOOK_NAME}] Injected multi-plan capability context`, {
              sessionID: input.sessionID,
            })
          }
        }

        // 2) Routing injection: per message (lightweight), dedup by exact message text per session
        const rawMessageText = output.parts[textPartIndex].text ?? ""
        const alreadyHasRouting = rawMessageText.includes("<multi-plan-routing>")
        const last = lastRoutedMessageText.get(input.sessionID)
        if (!alreadyHasRouting && last !== currentText) {
          const routing = buildRoutingContext({
            messageText: currentText,
            modelsCount: models.length,
            pipeline,
          })
          if (routing) {
            output.parts[textPartIndex].text += `\n\n${routing}`
          }
          lastRoutedMessageText.set(input.sessionID, currentText)
        }
      }
    },

    /**
     * Clean up session tracking on session deletion
     * Prevents unbounded growth of injectedSessions Set
     */
    event: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          injectedSessions.delete(sessionInfo.id)
          lastRoutedMessageText.delete(sessionInfo.id)
        }
      }

      // Also allow re-injection after session compaction (context was compressed)
      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          injectedSessions.delete(sessionID)
          lastRoutedMessageText.delete(sessionID)
        }
      }
    },
  }
}

/**
 * Clear injection tracking for a session (useful for testing)
 */
export function clearInjectedSession(sessionID: string): void {
  injectedSessions.delete(sessionID)
  lastRoutedMessageText.delete(sessionID)
}

/**
 * Clear all injection tracking (useful for testing)
 */
export function clearAllInjectedSessions(): void {
  injectedSessions.clear()
  lastRoutedMessageText.clear()
}
