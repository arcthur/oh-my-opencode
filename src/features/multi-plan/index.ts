import * as fs from "fs"
import * as path from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../background-agent"
import type {
  MultiPlanConfig,
  MultiPlanSession,
  MultiPlanResult,
  StartMultiPlanInput,
} from "./types"
import { PlanGenerator, type MultiPlanProgressCallback } from "./plan-generator"
import { log } from "../../shared/logger"
import { getTaskToastManager } from "../task-toast-manager"

/**
 * Error thrown when multi-plan fails but intermediate results exist
 */
export class MultiPlanError extends Error {
  constructor(
    message: string,
    public readonly intermediateFiles: string[],
    public readonly session: MultiPlanSession
  ) {
    super(message)
    this.name = "MultiPlanError"
  }
}

export * from "./types"
export { PlanGenerator, type MultiPlanProgressCallback } from "./plan-generator"

/**
 * Orchestrates the multi-model planning workflow:
 * 1. Parallel plan generation by multiple models
 * 2. Plan Synthesizer review and conflict resolution
 * 3. Final unified plan creation
 */
export class MultiPlanOrchestrator {
  private ctx: PluginInput
  private manager: BackgroundManager
  private config: MultiPlanConfig
  private generator: PlanGenerator
  private activeSessions: Map<string, MultiPlanSession> = new Map()

  constructor(
    ctx: PluginInput,
    manager: BackgroundManager,
    config: MultiPlanConfig
  ) {
    this.ctx = ctx
    this.manager = manager
    this.config = config
    this.generator = new PlanGenerator(ctx, manager)
  }

  /**
   * Start a new multi-plan session
   */
  async start(input: StartMultiPlanInput): Promise<MultiPlanResult> {
    const sessionId = `mp_${crypto.randomUUID().slice(0, 8)}`

    log("[multi-plan] Starting multi-plan session", {
      sessionId,
      planName: input.planName,
      modelCount: input.config.models.length,
    })

    // Create session
    const session: MultiPlanSession = {
      id: sessionId,
      planName: input.planName,
      requestContext: input.requestContext,
      models: input.config.models,
      tasks: [],
      status: "generating",
      startedAt: new Date(),
    }

    this.activeSessions.set(sessionId, session)

    try {
      // Phase 1: Parallel plan generation
      session.tasks = await this.generator.generatePlans(
        session,
        input.parentSessionId
      )

      // Wait for all plans to complete
      await this.generator.waitForCompletion(session.tasks)

      // Check if we have enough successful plans
      const successfulTasks = session.tasks.filter(
        (t) => t.status === "completed"
      )
      if (successfulTasks.length < 2) {
        throw new Error(
          `Not enough plans generated successfully. Need at least 2, got ${successfulTasks.length}`
        )
      }

      // Phase 2: Plan Synthesizer review
      session.status = "reviewing"
      await this.runPlanSynthesis(session, input.parentSessionId)

      // Phase 3: Verify output files exist
      const finalPlanPath = `.sisyphus/plans/${input.planName}.md`
      const comparisonReportPath = `.sisyphus/plan-reviews/${input.planName}-comparison.md`

      const verification = this.verifyOutputFiles(finalPlanPath, comparisonReportPath)
      if (!verification.valid) {
        const intermediateFiles = this.collectIntermediateFiles(session)
        log("[multi-plan] Output files missing after synthesis", {
          missing: verification.missing,
          intermediateFiles,
        })

        throw new MultiPlanError(
          `Plan Synthesizer completed but output files missing: ${verification.missing.join(", ")}`,
          intermediateFiles,
          session
        )
      }

      // Phase 4: Mark complete
      session.status = "complete"
      session.completedAt = new Date()
      session.finalPlanPath = finalPlanPath
      session.comparisonReportPath = comparisonReportPath

      const result: MultiPlanResult = {
        session,
        comparisonReportPath: session.comparisonReportPath,
        finalPlanPath: session.finalPlanPath,
        summary: this.buildSummary(session),
      }

      log("[multi-plan] Multi-plan session completed", {
        sessionId,
        planName: input.planName,
        successfulPlans: successfulTasks.length,
      })

      return result
    } catch (error) {
      session.status = "error"
      session.completedAt = new Date()

      // Collect intermediate files for error context
      const intermediateFiles = this.collectIntermediateFiles(session)
      const errorMessage = error instanceof Error ? error.message : String(error)
      session.error = errorMessage

      log("[multi-plan] Multi-plan session failed", {
        sessionId,
        error: errorMessage,
        intermediateFiles,
      })

      // Re-throw MultiPlanError as-is, wrap other errors
      if (error instanceof MultiPlanError) {
        throw error
      }

      throw new MultiPlanError(errorMessage, intermediateFiles, session)
    } finally {
      this.activeSessions.delete(sessionId)
    }
  }

  /**
   * Run the Plan Synthesizer to review and merge plans
   */
  private async runPlanSynthesis(
    session: MultiPlanSession,
    parentSessionId: string
  ): Promise<void> {
    const planFiles = session.tasks
      .filter((t) => t.status === "completed")
      .map((t) => t.outputPath)

    const synthesisPrompt = this.buildSynthesisPrompt(session, planFiles)

    log("[multi-plan] Starting Plan Synthesizer", {
      planCount: planFiles.length,
    })

    // Show synthesis started toast
    this.showSynthesisToast(session, "Plan Synthesizer Started", planFiles.length)

    // Launch Plan Synthesizer as a background task (silent to avoid notification spam)
    const synthTask = await this.manager.launch({
      description: `Plan Synthesis: ${session.planName}`,
      prompt: synthesisPrompt,
      agent: "plan-synthesizer",
      parentSessionID: parentSessionId,
      parentMessageID: "",
      silent: true, // Suppress notification - multi_plan tool will report final result
    })

    // Wait for synthesis to complete
    const maxWaitMs = 15 * 60 * 1000 // 15 minutes for synthesis
    const startTime = Date.now()
    const pollInterval = 3000

    while (true) {
      const task = this.manager.getTask(synthTask.id)
      if (!task) break

      if (task.status === "completed") {
        log("[multi-plan] Plan Synthesizer completed")
        break
      }

      if (task.status === "error" || task.status === "cancelled") {
        throw new Error(`Plan Synthesizer failed: ${task.error || "Unknown error"}`)
      }

      if (Date.now() - startTime > maxWaitMs) {
        throw new Error("Plan Synthesizer timed out")
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }

  /**
   * Build the prompt for Plan Synthesizer
   */
  private buildSynthesisPrompt(
    session: MultiPlanSession,
    planFiles: string[]
  ): string {
    const fileList = planFiles.map((f) => `- \`${f}\``).join("\n")
    const modelList = session.models
      .map((m) => `- **${m.name}**: ${m.category || m.model}`)
      .join("\n")

    return `## Multi-Model Plan Synthesis Request

### Plan Name
${session.planName}

### Models Participating
${modelList}

### Plan Files to Review
${fileList}

### Original Context
${session.requestContext}

### Your Task

1. Read ALL plan files listed above using the Read tool
2. Apply your Phase 1-5 process:
   - Phase 1: Read all plans
   - Phase 2: Critique each plan (Momus style)
   - Phase 3: Detect conflicts section by section
   - Phase 4: Resolve each conflict with harsh verdicts
   - Phase 5: Synthesize the final unified plan

3. Generate TWO files:
   - Comparison report: \`.sisyphus/plan-reviews/${session.planName}-comparison.md\`
   - Final unified plan: \`.sisyphus/plans/${session.planName}.md\`

### IMPORTANT

- Be RUTHLESS in your critique. One approach must WIN each conflict.
- The final plan must be ACTIONABLE, not a watered-down compromise.
- Preserve unique insights from any model.
- Call out AI slop explicitly.

Begin by reading all the plan files.
`
  }

  /**
   * Build a summary message for the result
   */
  private buildSummary(session: MultiPlanSession): string {
    const successCount = session.tasks.filter(
      (t) => t.status === "completed"
    ).length
    const failCount = session.tasks.filter((t) => t.status === "error").length

    const lines: string[] = [
      `## Multi-Model Planning Complete: ${session.planName}`,
      "",
      `**Models**: ${session.models.map((m) => m.name).join(", ")}`,
      `**Successful Plans**: ${successCount}/${session.models.length}`,
    ]

    if (failCount > 0) {
      lines.push(`**Failed Plans**: ${failCount}`)
    }

    lines.push(
      "",
      `**Files Generated**:`,
      `- Comparison Report: \`.sisyphus/plan-reviews/${session.planName}-comparison.md\``,
      `- Final Plan: \`.sisyphus/plans/${session.planName}.md\``,
      "",
      `Individual plans:`,
      ...session.tasks.map((t) => {
        const status = t.status === "completed" ? "✓" : "✗"
        return `- ${status} \`${t.outputPath}\` (${t.modelName})`
      })
    )

    return lines.join("\n")
  }

  /**
   * Show synthesis phase toast notification
   */
  private showSynthesisToast(
    session: MultiPlanSession,
    title: string,
    planCount: number
  ): void {
    const toastManager = getTaskToastManager()
    if (!toastManager) return

    const completedModels = session.tasks
      .filter((t) => t.status === "completed")
      .map((t) => t.modelName)
      .join(", ")

    const message = `Reviewing ${planCount} plans from: ${completedModels}

Plan Synthesizer (Momus-style) will:
• Compare all plans section by section
• Identify and resolve conflicts
• Generate unified final plan`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.ctx.client as any
    if (tuiClient.tui?.showToast) {
      tuiClient.tui.showToast({
        body: {
          title: `🔬 ${title}`,
          message,
          variant: "info",
          duration: 5000,
        },
      }).catch(() => {})
    }
  }

  /**
   * Get an active session by ID
   */
  getSession(sessionId: string): MultiPlanSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Check if multi-plan is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Verify that expected output files exist
   */
  private verifyOutputFiles(
    finalPlanPath: string,
    comparisonReportPath: string
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = []
    const directory = this.ctx.directory

    const finalAbsPath = path.resolve(directory, finalPlanPath)
    const comparisonAbsPath = path.resolve(directory, comparisonReportPath)

    if (!fs.existsSync(finalAbsPath)) {
      missing.push(finalPlanPath)
    }
    if (!fs.existsSync(comparisonAbsPath)) {
      missing.push(comparisonReportPath)
    }

    return { valid: missing.length === 0, missing }
  }

  /**
   * Collect paths of successfully generated intermediate files
   */
  private collectIntermediateFiles(session: MultiPlanSession): string[] {
    const files: string[] = []
    const directory = this.ctx.directory

    for (const task of session.tasks) {
      if (task.status === "completed") {
        const absPath = path.resolve(directory, task.outputPath)
        if (fs.existsSync(absPath)) {
          files.push(task.outputPath)
        }
      }
    }

    return files
  }
}
