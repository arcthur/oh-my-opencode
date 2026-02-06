import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { MultiPlanPipelineConfig } from "../../config/schema"
import { MultiPlanOrchestrator, MultiPlanError, normalizePlanningConfig, type NormalizedPlanningModel } from "../../features/multi-plan"
import type { MultiPlanResult, StartMultiPlanInput } from "../../features/multi-plan"
import { log } from "../../shared/logger"
import { sanitizePathSegment } from "../../shared/path-sanitizer"

interface MultiPlanArgs {
  planId: string
  context: string
  debate?: boolean
}

/**
 * Validate model names for path safety and uniqueness.
 * Returns error message if invalid, null if valid.
 */
function validateModelNames(models: NormalizedPlanningModel[]): string | null {
  const sanitizedToOriginal = new Map<string, string>()
  for (const model of models) {
    const sanitizedName = sanitizePathSegment(model.name)
    if (!sanitizedName) {
      return `Invalid model name in config: "${model.name}". Model names must be safe for file paths.`
    }
    const existingOriginal = sanitizedToOriginal.get(sanitizedName)
    if (existingOriginal) {
      return `Duplicate model name: "${existingOriginal}" and "${model.name}" both resolve to "${sanitizedName}".`
    }
    sanitizedToOriginal.set(sanitizedName, model.name)
  }
  return null
}

type MultiPlanOrchestratorLike = {
  start: (input: StartMultiPlanInput) => Promise<MultiPlanResult>
}

type CreateMultiPlanOrchestrator = (
  ctx: PluginInput,
  backgroundManager: BackgroundManager,
  model: string | string[] | undefined
) => MultiPlanOrchestratorLike

/**
 * Tool for Prometheus to explicitly invoke multi-model planning.
 *
 * This replaces the fragile regex-based trigger detection with an explicit
 * tool call, giving Prometheus control over when to use multi-model planning.
 */
export function createMultiPlanTool(options: {
  ctx: PluginInput
  backgroundManager: BackgroundManager
  /** Model config from agents.prometheus.model - string for single, array for multi-plan */
  model: string | string[] | undefined
  pipelineConfig?: MultiPlanPipelineConfig | undefined
  createOrchestrator?: CreateMultiPlanOrchestrator
}): ToolDefinition {
  const { ctx, backgroundManager, model, pipelineConfig, createOrchestrator } = options
  const models = normalizePlanningConfig(model)

  // Validate model names at tool creation time (config is static)
  // This catches config errors early, before any tool execution
  const modelValidationError = validateModelNames(models)
  const hasModelConfigError = modelValidationError !== null

  return tool({
    description: `Orchestrate multi-model planning where multiple AI models generate plans in parallel, followed by Plan Synthesizer review and conflict resolution.

**When to use this tool:**
- User has requested to generate a work plan AND 2+ models are configured in \`agents.prometheus.model\`
- You want diverse perspectives from different AI models
- The task is complex enough to benefit from multiple viewpoints

**What this tool does:**
1. Launches N models in parallel to generate plans (each writes to .sisyphus/plans/{name}-{model}.md)
2. Runs Plan Synthesizer (ruthless critique + decisive conflict resolution) to:
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

**IMPORTANT:** Only call this tool if 2+ models are configured. Check for the system context that indicates this capability is available.`,
    args: {
      planId: tool.schema.string().describe("Name for the plan (used in file paths). Example: 'auth-system', 'dark-mode'"),
      context: tool.schema.string().describe("Complete context from the interview including: user requirements, decisions made, research findings, scope boundaries, and any draft content. This is passed to each model for plan generation."),
      debate: tool.schema.boolean().optional().describe("Enable debate mode. When true, rejected models can submit rebuttals, and the Synthesizer will review them before finalizing. Use for complex/high-stakes plans where you want maximum scrutiny. Default: false"),
    },
    async execute(args: MultiPlanArgs, execCtx) {
      // Config validation (detected at tool creation time)
      if (hasModelConfigError) {
        const safePlanName = sanitizePathSegment(args.planId) ?? "work-plan"
        return `❌ ${modelValidationError}

Check your oh-my-opencode.json configuration.
Fallback path: \`.sisyphus/plans/${safePlanName}.md\``
      }

      // Multi-plan requires at least 2 models
      if (models.length < 2) {
        const safePlanName = sanitizePathSegment(args.planId) ?? "work-plan"
        const configHint = `Current configuration has ${models.length} model(s).`
        return `❌ Multi-model planning requires at least 2 models configured.

${configHint}
For single-model planning, generate the plan directly using the Write tool.

Fallback path: \`.sisyphus/plans/${safePlanName}.md\``
      }

      // Validate planId (user input, varies per execution)
      const sanitizedPlanName = sanitizePathSegment(args.planId)
      if (!sanitizedPlanName) {
        return `❌ Invalid plan name: "${args.planId}".

Plan names must be safe for use in file paths. Avoid special characters like: < > : " / \\ | ? *`
      }

      // Note: Model names are validated at tool creation time (see hasModelConfigError above)
      // Orchestrator.start() also validates as a defense layer

      const { context } = args
      const planId = sanitizedPlanName
      const sessionID = execCtx.sessionID || ""

      log("[multi_plan] Starting multi-model planning", {
        planId,
        modelCount: models.length,
        sessionID,
      })

      try {
        const orchestrator = createOrchestrator
          ? createOrchestrator(ctx, backgroundManager, model)
          : new MultiPlanOrchestrator(ctx, backgroundManager, model)

        const result = await orchestrator.start({
          planId,
          requestContext: context,
          parentSessionId: sessionID,
          config: { models },
          debateEnabled: args.debate ?? false,
          pipelineConfig,
        })

        log("[multi_plan] Multi-model planning completed", {
          planId,
          finalPlanPath: result.finalPlanPath,
          comparisonReportPath: result.comparisonReportPath,
        })

        const individualPlans = result.session.tasks
          .map((t) => `- ${t.status === "completed" ? "✓" : "✗"} \`${t.outputPath}\` (${t.modelName})`)
          .join("\n")

        const debateInfo = result.session.debateEnabled && result.session.rebuttals?.length
          ? `\n**Debate Round:** ${result.session.rebuttals.length} rebuttal(s) reviewed`
          : ""

        // Include structured result for machine parsing (used by planning-with-files hook)
        const structuredResult = JSON.stringify({
          status: "success",
          planId,
          finalPlanPath: result.finalPlanPath,
          comparisonReportPath: result.comparisonReportPath,
        })

        return `✅ Multi-model planning completed successfully!
[MULTI_PLAN_RESULT]${structuredResult}[/MULTI_PLAN_RESULT]

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

Fallback path: \`.sisyphus/plans/${planId}.md\``
        }

        log("[multi_plan] Multi-model planning failed", { error: errorMessage })

        return `❌ Multi-model planning failed: ${errorMessage}

You may need to generate the plan directly using the Write tool.
Fallback path: \`.sisyphus/plans/${planId}.md\``
      }
    },
  })
}
