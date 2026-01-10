import * as fs from "fs"
import * as path from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../background-agent"
import type {
  MultiPlanConfig,
  MultiPlanSession,
  MultiPlanResult,
  StartMultiPlanInput,
  PlanRebuttal,
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
      debateEnabled: input.debateEnabled ?? false,
      rebuttals: [],
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

      // Phase 2: Plan Synthesizer initial review
      session.status = "reviewing"
      const comparisonReportPath = `.sisyphus/plan-reviews/${input.planName}-comparison.md`
      await this.runPlanSynthesis(session, input.parentSessionId)

      // Phase 2.5: Debate round (if enabled)
      if (session.debateEnabled) {
        session.status = "debating"
        const rebuttals = await this.runDebateRound(session, comparisonReportPath, input.parentSessionId)

        if (rebuttals.length > 0) {
          session.rebuttals = rebuttals
          session.status = "finalizing"
          await this.runFinalSynthesis(session, rebuttals, input.parentSessionId)
        }
      }

      // Phase 3: Verify output files exist
      const finalPlanPath = `.sisyphus/plans/${input.planName}.md`

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

  /**
   * Run debate round - generate rebuttals from rejected models
   */
  private async runDebateRound(
    session: MultiPlanSession,
    comparisonReportPath: string,
    parentSessionId: string
  ): Promise<PlanRebuttal[]> {
    log("[multi-plan] Starting debate round")

    // Read comparison report to find rejections
    const absReportPath = path.resolve(this.ctx.directory, comparisonReportPath)
    if (!fs.existsSync(absReportPath)) {
      log("[multi-plan] Comparison report not found, skipping debate")
      return []
    }

    const reportContent = fs.readFileSync(absReportPath, "utf-8")

    // Parse which models were rejected in conflicts
    const rejectedModels = this.parseRejectedModels(reportContent, session)
    if (rejectedModels.length === 0) {
      log("[multi-plan] No rejected models found, skipping debate")
      return []
    }

    log("[multi-plan] Generating rebuttals", { rejectedModels: rejectedModels.map(r => r.modelName) })
    this.showDebateToast(session, "Debate Round Started", rejectedModels.length)

    // Generate rebuttals in parallel
    const rebuttals: PlanRebuttal[] = []
    const rebuttalPromises = rejectedModels.map(async (rejection) => {
      const rebuttal: PlanRebuttal = {
        modelName: rejection.modelName,
        conflictId: rejection.conflictId,
        content: "",
        status: "generating",
      }
      rebuttals.push(rebuttal)

      try {
        const prompt = this.buildRebuttalPrompt(rejection, session)
        const task = await this.manager.launch({
          description: `Rebuttal: ${rejection.modelName}`,
          prompt,
          agent: "Sisyphus",
          parentSessionID: parentSessionId,
          parentMessageID: "",
          silent: true,
        })

        rebuttal.taskId = task.id

        // Wait for completion (max 5 minutes per rebuttal)
        const maxWait = 5 * 60 * 1000
        const startTime = Date.now()
        while (true) {
          const bgTask = this.manager.getTask(task.id)
          if (!bgTask || bgTask.status === "completed") break
          if (bgTask.status === "error" || bgTask.status === "cancelled") {
            rebuttal.status = "error"
            rebuttal.error = bgTask.error || "Rebuttal generation failed"
            break
          }
          if (Date.now() - startTime > maxWait) {
            rebuttal.status = "error"
            rebuttal.error = "Timeout"
            break
          }
          await new Promise(r => setTimeout(r, 2000))
        }

        // Read rebuttal content from output
        const rebuttalPath = `.sisyphus/rebuttals/${session.planName}-${rejection.modelName}.md`
        const absRebuttalPath = path.resolve(this.ctx.directory, rebuttalPath)
        if (fs.existsSync(absRebuttalPath)) {
          rebuttal.content = fs.readFileSync(absRebuttalPath, "utf-8")
          rebuttal.status = "completed"
        } else if (rebuttal.status !== "error") {
          rebuttal.status = "error"
          rebuttal.error = "Rebuttal file not created"
        }
      } catch (error) {
        rebuttal.status = "error"
        rebuttal.error = error instanceof Error ? error.message : String(error)
      }

      return rebuttal
    })

    await Promise.all(rebuttalPromises)

    const successfulRebuttals = rebuttals.filter(r => r.status === "completed")
    log("[multi-plan] Debate round completed", {
      total: rebuttals.length,
      successful: successfulRebuttals.length,
    })

    return successfulRebuttals
  }

  /**
   * Parse comparison report to find rejected models
   */
  private parseRejectedModels(
    reportContent: string,
    session: MultiPlanSession
  ): Array<{ modelName: string; conflictId: string; criticism: string }> {
    const rejections: Array<{ modelName: string; conflictId: string; criticism: string }> = []

    // Find all CONFLICT sections
    const conflictSections = reportContent.split(/### CONFLICT:/).slice(1)

    for (const section of conflictSections) {
      const conflictIdMatch = section.match(/^([^\n]+)/)
      const conflictId = conflictIdMatch ? conflictIdMatch[1].trim() : "general"

      // Find the VERDICT to know which model won
      const verdictMatch = section.match(/\*\*VERDICT\*\*:\s*`?(?:ACCEPT\s+)?(\w+)`?/i)
      const winnerModel = verdictMatch ? verdictMatch[1].toLowerCase() : null

      // For each model, check if it was criticized and NOT the winner
      for (const model of session.models) {
        const modelNameLower = model.name.toLowerCase()

        // Skip if this model won this conflict
        if (winnerModel && modelNameLower === winnerModel) continue

        // Match "Why {model} is WRONG:" pattern (case insensitive)
        const wrongPattern = new RegExp(
          `\\*\\*Why\\s+(?:\\{)?${model.name}(?:\\})?\\s+is\\s+WRONG\\*\\*:([\\s\\S]*?)(?=\\*\\*Why|\\*\\*VERDICT|---|\n\n)`,
          "i"
        )
        const wrongMatch = wrongPattern.exec(section)

        if (wrongMatch) {
          // Check if this model-conflict pair is already added
          const alreadyAdded = rejections.some(
            r => r.modelName === model.name && r.conflictId === conflictId
          )
          if (!alreadyAdded) {
            rejections.push({
              modelName: model.name,
              conflictId,
              criticism: wrongMatch[1].trim(),
            })
          }
        }
      }
    }

    return rejections
  }

  /**
   * Build rebuttal prompt for a rejected model
   */
  private buildRebuttalPrompt(
    rejection: { modelName: string; conflictId: string; criticism: string },
    session: MultiPlanSession
  ): string {
    const outputPath = `.sisyphus/rebuttals/${session.planName}-${rejection.modelName}.md`

    return `## Rebuttal Request

You are the "${rejection.modelName}" model. Your plan was partially rejected by the Plan Synthesizer.

### The Criticism Against You

**Conflict**: ${rejection.conflictId}

**Synthesizer's Criticism**:
${rejection.criticism}

### Your Task

Write a rebuttal arguing why your approach should be reconsidered. Be specific and provide evidence.

**Output**: Write to \`${outputPath}\`

**Format**:
\`\`\`markdown
## Rebuttal from ${rejection.modelName}

**Conflict**: ${rejection.conflictId}
**Original Verdict**: [summarize what Synthesizer decided]

**My Counter-Argument**:
[Why your approach should be reconsidered - be SPECIFIC]

**Evidence**:
- [Specific code references]
- [Technical reasoning]
- [What the Synthesizer missed or got wrong]

**Proposed Revision**:
[What specifically should change in the final plan]
\`\`\`

**Rules**:
1. Do NOT just repeat your original argument
2. Provide NEW evidence or perspective
3. Address the SPECIFIC criticism made
4. Be concise - this is your one chance to argue back
5. If the Synthesizer was right, say so and concede

Read your original plan at \`.sisyphus/plans/${session.planName}-${rejection.modelName}.md\` for context.
`
  }

  /**
   * Run final synthesis with rebuttals
   */
  private async runFinalSynthesis(
    session: MultiPlanSession,
    rebuttals: PlanRebuttal[],
    parentSessionId: string
  ): Promise<void> {
    if (rebuttals.length === 0) return

    log("[multi-plan] Running final synthesis with rebuttals", {
      rebuttalCount: rebuttals.length,
    })

    this.showDebateToast(session, "Reviewing Rebuttals", rebuttals.length)

    const rebuttalSummary = rebuttals.map(r =>
      `### Rebuttal from ${r.modelName}\n\n${r.content}`
    ).join("\n\n---\n\n")

    const prompt = `## Final Synthesis with Rebuttals

The rejected models have submitted rebuttals. Review them and update the final plan if warranted.

### Rebuttals to Review

${rebuttalSummary}

### Your Task

1. Read each rebuttal carefully
2. For each rebuttal, apply your Phase 6 (Rebuttal Review) process
3. If any rebuttal is convincing (provides NEW evidence, addresses your criticism technically), REVISE the final plan
4. Update the comparison report with your rebuttal review decisions
5. If you revise, add a "Revised after rebuttal" note to the affected section

### Files to Update (if needed)

- Final plan: \`.sisyphus/plans/${session.planName}.md\`
- Comparison report: \`.sisyphus/plan-reviews/${session.planName}-comparison.md\`

### Important

- Give rebuttals FAIR consideration
- But don't change your mind without NEW evidence
- Document your reasoning for MAINTAIN or REVISE decisions
`

    const task = await this.manager.launch({
      description: `Final Synthesis: ${session.planName}`,
      prompt,
      agent: "plan-synthesizer",
      parentSessionID: parentSessionId,
      parentMessageID: "",
      silent: true,
    })

    // Wait for completion (max 10 minutes)
    const maxWait = 10 * 60 * 1000
    const startTime = Date.now()
    while (true) {
      const bgTask = this.manager.getTask(task.id)
      if (!bgTask || bgTask.status === "completed") break
      if (bgTask.status === "error" || bgTask.status === "cancelled") {
        log("[multi-plan] Final synthesis failed", { error: bgTask?.error })
        break
      }
      if (Date.now() - startTime > maxWait) {
        log("[multi-plan] Final synthesis timed out")
        break
      }
      await new Promise(r => setTimeout(r, 3000))
    }

    log("[multi-plan] Final synthesis completed")
  }

  /**
   * Show debate phase toast
   */
  private showDebateToast(
    session: MultiPlanSession,
    title: string,
    count: number
  ): void {
    const toastManager = getTaskToastManager()
    if (!toastManager) return

    const message = title.includes("Started")
      ? `${count} rejected model(s) are preparing rebuttals...`
      : `Synthesizer is reviewing ${count} rebuttal(s)...`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.ctx.client as any
    if (tuiClient.tui?.showToast) {
      tuiClient.tui.showToast({
        body: {
          title: `⚔️ ${title}`,
          message,
          variant: "info",
          duration: 4000,
        },
      }).catch(() => {})
    }
  }
}
