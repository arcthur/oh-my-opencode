import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { MultiPlanConfig } from "../../config/schema"
import { MultiPlanOrchestrator, MultiPlanError } from "../../features/multi-plan"
import { log } from "../../shared/logger"
import { sanitizePathSegment } from "../../shared/path-sanitizer"

interface MultiPlanArgs {
  planName: string
  context: string
  debate?: boolean
}

/**
 * Tool for Prometheus to explicitly invoke multi-model planning.
 *
 * This replaces the fragile regex-based trigger detection with an explicit
 * tool call, giving Prometheus control over when to use multi-model planning.
 */
export function createMultiPlanTool(options: {
  ctx: PluginInput
  backgroundManager: BackgroundManager
  config: MultiPlanConfig | undefined
}): ToolDefinition {
  const { ctx, backgroundManager, config } = options

  return tool({
    description: `Orchestrate multi-model planning where multiple AI models generate plans in parallel, followed by Plan Synthesizer review and conflict resolution.

**When to use this tool:**
- User has requested to generate a work plan AND multi-model planning is enabled
- You want diverse perspectives from different AI models
- The task is complex enough to benefit from multiple viewpoints

**What this tool does:**
1. Launches N models in parallel to generate plans (each writes to .sisyphus/plans/{name}-{model}.md)
2. Runs Plan Synthesizer (Momus-style) to:
   - Compare all generated plans with structured 4-criterion evaluation
   - Analyze assumption conflicts and risk coverage
   - Identify and analyze approach conflicts
   - Make harsh, decisive verdicts on each conflict
   - Synthesize a unified final plan
3. (Optional) Debate round if enabled:
   - Rejected models generate rebuttals
   - Synthesizer reviews rebuttals
   - May revise final plan based on convincing arguments
4. Produces:
   - Comparison report: .sisyphus/plan-reviews/{name}-comparison.md
   - Final unified plan: .sisyphus/plans/{name}.md

**IMPORTANT:** Only call this tool if multi-model planning is enabled in configuration. Check for the system context that indicates this capability is available.`,
    args: {
      planName: tool.schema.string().describe("Name for the plan (used in file paths). Example: 'auth-system', 'dark-mode'"),
      context: tool.schema.string().describe("Complete context from the interview including: user requirements, decisions made, research findings, scope boundaries, and any draft content. This is passed to each model for plan generation."),
      debate: tool.schema.boolean().optional().describe("Enable debate mode. When true, rejected models can submit rebuttals, and the Synthesizer will review them before finalizing. Use for complex/high-stakes plans where you want maximum scrutiny. Default: false"),
    },
    async execute(args: MultiPlanArgs, execCtx) {
      // Check if multi-plan is enabled
      if (!config?.enabled) {
        return `❌ Multi-model planning is not enabled.

Generate the plan directly instead using the Write tool to create .sisyphus/plans/${args.planName}.md`
      }

      if (!config.models || config.models.length < 2) {
        return `❌ Multi-model planning requires at least 2 models configured.

Configure models in oh-my-opencode.json under multi_plan.models`
      }

      // Sanitize planName to prevent path traversal
      const sanitizedPlanName = sanitizePathSegment(args.planName)
      if (!sanitizedPlanName) {
        return `❌ Invalid plan name: "${args.planName}".

Plan names must be safe for use in file paths. Avoid special characters like: < > : " / \\ | ? *`
      }

      // Validate model names in config
      const sanitizedToOriginal = new Map<string, string>()
      for (const model of config.models) {
        const sanitizedModelName = sanitizePathSegment(model.name)
        if (!sanitizedModelName) {
          return `❌ Invalid model name in config: "${model.name}".

Model names must be safe for use in file paths. Check your oh-my-opencode.json configuration.`
        }
        const existingOriginal = sanitizedToOriginal.get(sanitizedModelName)
        if (existingOriginal) {
          return `❌ Duplicate model name after sanitization.

Both "${existingOriginal}" and "${model.name}" resolve to "${sanitizedModelName}".

Multiple models would write to the same output file. Ensure each model has a unique name in oh-my-opencode.json.`
        }
        sanitizedToOriginal.set(sanitizedModelName, model.name)
      }

      const { context } = args
      const planName = sanitizedPlanName
      const sessionID = execCtx.sessionID || ""

      log("[multi_plan] Starting multi-model planning", {
        planName,
        modelCount: config.models.length,
        sessionID,
      })

      try {
        const orchestrator = new MultiPlanOrchestrator(ctx, backgroundManager, config)

        const result = await orchestrator.start({
          planName,
          requestContext: context,
          parentSessionId: sessionID,
          config,
          debateEnabled: args.debate ?? false,
        })

        log("[multi_plan] Multi-model planning completed", {
          planName,
          finalPlanPath: result.finalPlanPath,
          comparisonReportPath: result.comparisonReportPath,
        })

        const individualPlans = result.session.tasks
          .map((t) => `- ${t.status === "completed" ? "✓" : "✗"} \`${t.outputPath}\` (${t.modelName})`)
          .join("\n")

        const debateInfo = result.session.debateEnabled && result.session.rebuttals?.length
          ? `\n**Debate Round:** ${result.session.rebuttals.length} rebuttal(s) reviewed`
          : ""

        return `✅ Multi-model planning completed successfully!

${result.summary}${debateInfo}

**Individual Plans:**
${individualPlans}

**Generated Files:**
- Comparison Report: \`${result.comparisonReportPath}\`
- Final Unified Plan: \`${result.finalPlanPath}\`

**Next Step:** Tell the user the plan is ready and guide them to run \`/start-work\``
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Handle MultiPlanError with intermediate files
        if (error instanceof MultiPlanError && error.intermediateFiles.length > 0) {
          log("[multi_plan] Multi-model planning failed with intermediate results", {
            error: errorMessage,
            intermediateFiles: error.intermediateFiles,
          })

          const fileList = error.intermediateFiles
            .map((f) => `- \`${f}\``)
            .join("\n")

          return `❌ Multi-model planning failed: ${errorMessage}

**However, some intermediate files were generated successfully:**
${fileList}

You can:
1. Read these files to see what each model produced
2. Use the best one as a starting point
3. Generate the final plan manually using the Write tool

Fallback path: \`.sisyphus/plans/${planName}.md\``
        }

        log("[multi_plan] Multi-model planning failed", { error: errorMessage })

        return `❌ Multi-model planning failed: ${errorMessage}

You may need to generate the plan directly using the Write tool.
Fallback path: \`.sisyphus/plans/${planName}.md\``
      }
    },
  })
}
