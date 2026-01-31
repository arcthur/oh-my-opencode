import * as fs from "fs"
import * as path from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../background-agent"
import type {
  NormalizedPlanningConfig,
  NormalizedPlanningModel,
  MultiPlanSession,
  MultiPlanResult,
  StartMultiPlanInput,
  PlanRebuttal,
} from "./types"
import { PlanGenerator, type MultiPlanProgressCallback } from "./plan-generator"
import { parseRejectedModels } from "./parser"
import { log } from "../../shared/logger"
import { sanitizePathSegment } from "../../shared/path-sanitizer"
import { getTaskToastManager } from "../task-toast-manager"

const DEFAULT_PIPELINE_CONFIG = {
  auto_complexity_detection: true,
  smart_skip_interview: true,
  deep_verification: true,
  adhd_detection: true,
} as const

/**
 * Derive a display name from a model ID
 * e.g., "google/antigravity-gemini-3-pro" → "gemini-3-pro"
 *       "anthropic/claude-opus-4-5" → "claude-opus-4-5"
 */
function deriveNameFromModel(model: string): string {
  // Take the part after the last slash
  const lastSlash = model.lastIndexOf("/")
  const baseName = lastSlash >= 0 ? model.slice(lastSlash + 1) : model

  // Remove common prefixes like "antigravity-gemini-"
  return baseName
    .replace(/^antigravity-gemini-/, "")
    .replace(/^antigravity-/, "")
}

/**
 * Normalize planning model config to standard format
 * Supports:
 * - "xxx" → single model
 * - ["xxx", "yyy"] → multiple models (names auto-derived)
 * - undefined → empty array
 */
export function normalizePlanningConfig(
  model: string | string[] | undefined
): NormalizedPlanningModel[] {
  if (!model) return []

  // Single model string
  if (typeof model === "string") {
    return [{ name: deriveNameFromModel(model), model }]
  }

  // Array of model strings
  return model.map((m): NormalizedPlanningModel => ({
    name: deriveNameFromModel(m),
    model: m,
  }))
}

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
  private generator: PlanGenerator
  private activeSessions: Map<string, MultiPlanSession> = new Map()

  constructor(
    ctx: PluginInput,
    manager: BackgroundManager,
    _model?: string | string[]  // Validation done by caller; kept for API compatibility
  ) {
    this.ctx = ctx
    this.manager = manager
    this.generator = new PlanGenerator(ctx, manager)
  }

  /**
   * Start a new multi-plan session
   *
   * @throws {MultiPlanError} if planName or modelNames are invalid or duplicated
   */
  async start(input: StartMultiPlanInput): Promise<MultiPlanResult> {
    const sessionId = `mp_${crypto.randomUUID().slice(0, 8)}`
    const models = input.config.models ?? []
    const pipelineConfig = input.pipelineConfig ?? DEFAULT_PIPELINE_CONFIG

    // === Centralized validation (single source of truth) ===
    // Validate planName
    const safePlanName = sanitizePathSegment(input.planName)
    if (!safePlanName) {
      throw new MultiPlanError(
        `Invalid plan name: "${input.planName}". Plan names must be safe for file paths.`,
        [],
        { id: sessionId, planName: input.planName, requestContext: input.requestContext, models, tasks: [], status: "error", startedAt: new Date(), error: "Invalid plan name" }
      )
    }

    // Validate modelNames and check for duplicates after sanitization
    const sanitizedToOriginal = new Map<string, string>()
    for (const model of models) {
      const sanitizedName = sanitizePathSegment(model.name)
      if (!sanitizedName) {
        throw new MultiPlanError(
          `Invalid model name: "${model.name}". Model names must be safe for file paths.`,
          [],
          { id: sessionId, planName: input.planName, requestContext: input.requestContext, models, tasks: [], status: "error", startedAt: new Date(), error: "Invalid model name" }
        )
      }
      const existingOriginal = sanitizedToOriginal.get(sanitizedName)
      if (existingOriginal) {
        throw new MultiPlanError(
          `Duplicate model name after sanitization: "${existingOriginal}" and "${model.name}" both resolve to "${sanitizedName}".`,
          [],
          { id: sessionId, planName: input.planName, requestContext: input.requestContext, models, tasks: [], status: "error", startedAt: new Date(), error: "Duplicate model name" }
        )
      }
      sanitizedToOriginal.set(sanitizedName, model.name)
    }

    log("[multi-plan] Starting multi-plan session", {
      sessionId,
      planName: safePlanName,
      modelCount: models.length,
    })

    // Create session
    const session: MultiPlanSession = {
      id: sessionId,
      planName: safePlanName,
      requestContext: input.requestContext,
      models,
      tasks: [],
      status: "generating",
      startedAt: new Date(),
      debateEnabled: input.debateEnabled ?? false,
      rebuttals: [],
      pipelineConfig,
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
      const comparisonReportPath = `.sisyphus/plan-reviews/${safePlanName}-comparison.md`
      await this.runPlanSynthesis(session, input.parentSessionId)

      // Phase 3: Debate round (if enabled)
      if (session.debateEnabled) {
        session.status = "debating"
        const rebuttals = await this.runDebateRound(session, comparisonReportPath, input.parentSessionId)

        if (rebuttals.length > 0) {
          session.rebuttals = rebuttals
          session.status = "finalizing"
          await this.runFinalSynthesis(session, rebuttals, input.parentSessionId)
        }
      }

      // Phase 4: Verify output files exist
      const finalPlanPath = `.sisyphus/plans/${safePlanName}.md`

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

      // Phase 5: Mark complete
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
        planName: safePlanName,
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
      .map((m) => `- **${m.name}**: ${m.model}`)
      .join("\n")

    const pipeline = session.pipelineConfig ?? DEFAULT_PIPELINE_CONFIG
    const pipelineBlock = `<multi-plan-pipeline>
deep_verification: ${pipeline.deep_verification}
adhd_detection: ${pipeline.adhd_detection}
</multi-plan-pipeline>`

    return `## Multi-Model Plan Synthesis Request

### Plan Name
${session.planName}

### Pipeline Flags (Single Source of Truth)

${pipelineBlock}

**Rule**: If \`deep_verification: false\`, you MUST skip Phase 3 (Deep Verification).
If \`adhd_detection: false\`, you MUST skip the ADHD-omission scan portion (even if you do other verification).

### Models Participating
${modelList}

### Plan Files to Review
${fileList}

### Original Context
${session.requestContext}

### Your Task

1. Read ALL plan files listed above using the Read tool
2. Apply your Phase 1-7 process:
   - Phase 1: Read all plans
   - Phase 2: Critique each plan (ruthless, specific, evidence-based)
   - Phase 3: Deep Verification (if enabled)
   - Phase 4: Analyze assumptions and risks
   - Phase 5: Detect conflicts section by section
   - Phase 6: Resolve each conflict with harsh verdicts
   - Phase 7: Synthesize the final unified plan

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

Plan Synthesizer will:
• Compare all plans section by section
• Identify and resolve conflicts
• Generate unified final plan`

    const tuiClient = this.ctx.client as unknown as {
      tui?: { showToast: (payload: { body: object }) => Promise<unknown> }
    }
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

  private getSafePathSegment(label: string, value: string): string {
    const sanitized = sanitizePathSegment(value)
    if (!sanitized) {
      throw new Error(`Invalid ${label} name for file path: "${value}"`)
    }
    return sanitized
  }

  private getRebuttalOutputPath(planName: string, modelName: string): string {
    const safePlanName = this.getSafePathSegment("plan", planName)
    const safeModelName = this.getSafePathSegment("model", modelName)
    return `.sisyphus/rebuttals/${safePlanName}-${safeModelName}.md`
  }

  private getIndividualPlanPath(planName: string, modelName: string): string {
    const safePlanName = this.getSafePathSegment("plan", planName)
    const safeModelName = this.getSafePathSegment("model", modelName)
    return `.sisyphus/plans/${safePlanName}-${safeModelName}.md`
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
    const modelNames = session.models.map((m) => m.name)
    const rejectedModels = parseRejectedModels(reportContent, modelNames)
    if (rejectedModels.length === 0) {
      log("[multi-plan] No rejected models found, skipping debate")
      return []
    }

    const rejectionsByModel = new Map<
      string,
      Array<{ conflictId: string; criticism: string }>
    >()
    for (const rejection of rejectedModels) {
      const existing = rejectionsByModel.get(rejection.modelName) ?? []
      existing.push({ conflictId: rejection.conflictId, criticism: rejection.criticism })
      rejectionsByModel.set(rejection.modelName, existing)
    }

    const groupedRejections = Array.from(rejectionsByModel.entries()).map(
      ([modelName, conflicts]) => ({ modelName, conflicts })
    )

    log("[multi-plan] Generating rebuttals", {
      rejectedModels: groupedRejections.map((r) => ({
        modelName: r.modelName,
        conflictCount: r.conflicts.length,
      })),
    })
    this.showDebateToast(session, "Debate Round Started", groupedRejections.length)

    // Generate rebuttals in parallel
    const rebuttals: PlanRebuttal[] = []
    const rebuttalPromises = groupedRejections.map(async (rejection) => {
      const conflictIds = Array.from(
        new Set(rejection.conflicts.map((c) => c.conflictId).filter(Boolean))
      )
      const rebuttal: PlanRebuttal = {
        modelName: rejection.modelName,
        conflictIds,
        content: "",
        status: "generating",
      }
      rebuttals.push(rebuttal)

      try {
        const prompt = this.buildRebuttalPrompt(rejection, session)

        const modelConfig = session.models.find((m) => m.name === rejection.modelName)
        const resolvedModelConfig = modelConfig ? this.generator.resolveModelConfig(modelConfig) : {}

        // Use Sisyphus-Junior: executor agent for direct rebuttal generation
        const task = await this.manager.launch({
          description: `Rebuttal: ${rejection.modelName}`,
          prompt,
          agent: "sisyphus-junior",
          parentSessionID: parentSessionId,
          parentMessageID: "",
          model: resolvedModelConfig.model,
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
        const rebuttalPath = this.getRebuttalOutputPath(session.planName, rejection.modelName)
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
   * Build rebuttal prompt for a rejected model
   */
  private buildRebuttalPrompt(
    rejection: { modelName: string; conflicts: Array<{ conflictId: string; criticism: string }> },
    session: MultiPlanSession
  ): string {
    const outputPath = this.getRebuttalOutputPath(session.planName, rejection.modelName)
    const planPath = this.getIndividualPlanPath(session.planName, rejection.modelName)
    const conflictsBlock = rejection.conflicts
      .map(
        (c, idx) =>
          `#### ${idx + 1}. ${c.conflictId}\n\n**Synthesizer's Criticism**:\n${c.criticism}\n`
      )
      .join("\n")

    return `## Rebuttal Request

You are the "${rejection.modelName}" model. Your plan was partially rejected by the Plan Synthesizer.

### Conflicts You Lost (and Why)

${conflictsBlock}

### Your Task

Write ONE rebuttal that addresses EACH conflict above. Be specific and provide evidence.

**Output**: Write to \`${outputPath}\`

**Format**:
\`\`\`markdown
## Rebuttal from ${rejection.modelName}

### Conflict: <conflict-id>
**Original Verdict**: [summarize what the Synthesizer decided]
**Synthesizer Criticism**: [quote or summarize the criticism you are responding to]

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
4. If the Synthesizer was right for a conflict, say so and concede
5. Be concise - focus on high-signal technical arguments

**CONTEXT**: This is a REBUTTAL GENERATION task. You are writing to the rebuttals directory, not modifying any plan files. Use the Write tool to create the rebuttal file.

Read your original plan at \`${planPath}\` for context.
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
A single rebuttal may cover multiple conflicts (look for multiple "### Conflict:" sections).

### Rebuttals to Review

${rebuttalSummary}

### Your Task

1. Use the Read tool to load the existing files listed below before making any changes
2. Read each rebuttal carefully
3. For each rebuttal, apply your Phase 8 (Rebuttal Review) process
4. If any rebuttal is convincing (provides NEW evidence, addresses your criticism technically), REVISE the final plan
5. Update the comparison report with your rebuttal review decisions
6. If you revise, add a "Revised after rebuttal" note to the affected section

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

    const tuiClient = this.ctx.client as unknown as {
      tui?: { showToast: (payload: { body: object }) => Promise<unknown> }
    }
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
