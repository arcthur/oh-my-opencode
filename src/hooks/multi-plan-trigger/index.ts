import type { PlanningAgentConfig } from "../../config/schema"
import { normalizePlanningConfig, type NormalizedPlanningModel } from "../../features/multi-plan"
import { log } from "../../shared/logger"

export const HOOK_NAME = "multi-plan-trigger"

/**
 * Hook options
 */
export interface MultiPlanTriggerHookOptions {
  config: PlanningAgentConfig | undefined
}

/** Track sessions that have already received capability injection */
const injectedSessions = new Set<string>()

/**
 * Builds capability context for Prometheus to know about multi-plan
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

### When to Use
When user requests plan generation ("Generate the plan", "Make it into a work plan", etc.):
1. Complete your normal pre-generation steps (Metis consultation, final questions)
2. Instead of writing the plan yourself, call the \`multi_plan\` tool:
   \`\`\`
   multi_plan({
     planName: "{plan-name}",
     context: "{complete interview context, decisions, research findings}",
     debate: true  // Optional: enable for high-stakes planning
   })
   \`\`\`
3. The tool will:
   - Launch ${models.length} models in parallel
   - Each generates their perspective on the plan
   - Plan Synthesizer reviews and resolves conflicts
   - Produces a unified final plan

### Why Multi-Model Planning
- Diverse perspectives catch blind spots
- Conflicts are explicitly identified and resolved
- Final plan is more robust than single-model output

### Output Files
- Individual plans: \`.sisyphus/plans/{name}-{model}.md\`
- Comparison report: \`.sisyphus/plan-reviews/{name}-comparison.md\`
- Final unified plan: \`.sisyphus/plans/{name}.md\`

**IMPORTANT**: Always use the \`multi_plan\` tool for plan generation when this capability is enabled.
</multi-plan-capability>
`
}

/**
 * Creates the multi-plan trigger hook
 *
 * This hook injects multi-plan capability information into the context
 * so that Prometheus (or other planners) know to use the multi_plan tool.
 *
 * The hook is only active when 2+ models are configured in planning.models.
 * With 0-1 models, Prometheus handles plan generation directly.
 *
 * Capability is injected once per session to avoid redundant context.
 */
export function createMultiPlanTriggerHook(options: MultiPlanTriggerHookOptions) {
  const { config } = options
  const models = normalizePlanningConfig(config)

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
      // Only inject once per session to avoid redundant context
      if (injectedSessions.has(input.sessionID)) {
        return
      }

      // Find the text part and append capability context
      const textPartIndex = output.parts.findIndex(
        (p) => p.type === "text" && p.text
      )

      if (textPartIndex >= 0 && output.parts[textPartIndex].text) {
        // Double-check for capability context (belt and suspenders)
        if (!output.parts[textPartIndex].text?.includes("<multi-plan-capability>")) {
          output.parts[textPartIndex].text += `\n\n${capabilityContext}`
          injectedSessions.add(input.sessionID)

          log(`[${HOOK_NAME}] Injected multi-plan capability context`, {
            sessionID: input.sessionID,
          })
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
        }
      }

      // Also allow re-injection after session compaction (context was compressed)
      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          injectedSessions.delete(sessionID)
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
}

/**
 * Clear all injection tracking (useful for testing)
 */
export function clearAllInjectedSessions(): void {
  injectedSessions.clear()
}
