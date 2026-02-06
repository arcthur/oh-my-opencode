import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"
import type { BackgroundManager } from "../background-agent"
import type { NormalizedPlanningModel, PlanGenerationTask, MultiPlanSession } from "./types"
import { log } from "../../shared/logger"
import { getTaskToastManager } from "../task-toast-manager"
import { sanitizePathSegment } from "../../shared/path-sanitizer"
import { buildIntentClassificationPrompt, buildAISlopGuardrails } from "./intent-classifier"

type OpencodeClient = PluginInput["client"]

/**
 * Progress callback for multi-plan generation
 */
export interface MultiPlanProgressCallback {
  onTaskStarted?: (task: PlanGenerationTask) => void
  onTaskCompleted?: (task: PlanGenerationTask) => void
  onTaskFailed?: (task: PlanGenerationTask) => void
  onAllTasksStarted?: (tasks: PlanGenerationTask[]) => void
  onSynthesisStarted?: () => void
}

/**
 * Generates plans in parallel using multiple AI models
 */
export class PlanGenerator {
  private manager: BackgroundManager
  private client: OpencodeClient
  private directory: string

  constructor(ctx: PluginInput, manager: BackgroundManager) {
    this.manager = manager
    this.client = ctx.client
    this.directory = ctx.directory
  }

  /**
   * Generate plans in parallel using multiple models
   */
  async generatePlans(
    session: MultiPlanSession,
    parentSessionID: string
  ): Promise<PlanGenerationTask[]> {
    const tasks: PlanGenerationTask[] = []
    const basePrompt = this.buildPlanningPrompt(session.planId, session.requestContext)

    log("[multi-plan] Starting parallel plan generation", {
      planId: session.planId,
      modelCount: session.models.length,
    })

    // Launch all tasks in parallel
    const launchPromises = session.models.map(async (model) => {
      // model.name is validated by Orchestrator.start() - sanitize for path safety only
      const safeModelName = sanitizePathSegment(model.name)
      if (!safeModelName) {
        // This should never happen if Orchestrator validation is correct
        throw new Error(`Invalid model name for path: "${model.name}" - validation should have caught this`)
      }
      const outputPath = `.sisyphus/plans/${session.planId}-${safeModelName}.md`

      const task: PlanGenerationTask = {
        modelName: model.name,
        taskId: "",
        sessionId: "",
        status: "pending",
        outputPath,
      }
      tasks.push(task)

      try {
        const modelConfig = this.resolveModelConfig(model)
        const prompt = this.buildModelSpecificPrompt(basePrompt, model, outputPath)

        // Launch as background task (silent to avoid notification spam)
        // Use Sisyphus-Junior: focused executor without delegation capability.
        // Sisyphus is an orchestrator ("NEVER work alone") - wrong for direct plan generation.
        const bgTask = await this.manager.launch({
          description: `Multi-Plan: ${model.name}`,
          prompt,
          agent: "sisyphus-junior", // Executor agent - generates plan directly without delegation
          parentSessionID,
          parentMessageID: "",
          model: modelConfig.model,
          silent: true, // Suppress individual task notifications for multi-plan
        })

        task.taskId = bgTask.id
        task.sessionId = bgTask.sessionID
        task.status = "running"
        task.startedAt = new Date()

        log("[multi-plan] Launched plan generation", {
          modelName: model.name,
          taskId: bgTask.id,
          outputPath,
        })
      } catch (error) {
        task.status = "error"
        task.error = error instanceof Error ? error.message : String(error)
        log("[multi-plan] Failed to launch plan generation", {
          modelName: model.name,
          error: task.error,
        })
      }

      return task
    })

    await Promise.all(launchPromises)
    return tasks
  }

  /**
   * Wait for all tasks to complete with progress reporting
   */
  async waitForCompletion(
    tasks: PlanGenerationTask[],
    timeoutMs: number = 10 * 60 * 1000, // 10 minutes default
    progressCallback?: MultiPlanProgressCallback
  ): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 3000 // 3 seconds
    const toastManager = getTaskToastManager()
    const completedTaskIds = new Set<string>()

    // Notify all tasks started
    progressCallback?.onAllTasksStarted?.(tasks)
    this.showProgressToast(tasks, "Multi-Plan Generation Started", toastManager)

    while (true) {
      const pendingTasks = tasks.filter(
        (t) => t.status === "pending" || t.status === "running"
      )

      if (pendingTasks.length === 0) {
        log("[multi-plan] All plan generation tasks completed")
        break
      }

      if (Date.now() - startTime > timeoutMs) {
        // Mark remaining tasks as error
        for (const task of pendingTasks) {
          task.status = "error"
          task.error = "Timeout waiting for plan generation"
          progressCallback?.onTaskFailed?.(task)
        }
        log("[multi-plan] Plan generation timed out", {
          pendingCount: pendingTasks.length,
        })
        this.showProgressToast(tasks, "Multi-Plan Generation (Timeout)", toastManager)
        break
      }

      // Check task status
      for (const task of pendingTasks) {
        const bgTask = this.manager.getTask(task.taskId)
        if (!bgTask && task.taskId && !completedTaskIds.has(task.taskId)) {
          const absOutputPath = path.resolve(this.directory, task.outputPath)
          // BackgroundManager may evict tasks quickly after completion; fall back to file existence.
          if (fs.existsSync(absOutputPath)) {
            task.status = "completed"
            task.completedAt = new Date()
            completedTaskIds.add(task.taskId)
            progressCallback?.onTaskCompleted?.(task)
            this.showProgressToast(tasks, `Model '${task.modelName}' completed`, toastManager)
          } else {
            task.status = "error"
            task.error = `Task finished but output file missing: ${task.outputPath}`
            task.completedAt = new Date()
            completedTaskIds.add(task.taskId)
            progressCallback?.onTaskFailed?.(task)
            this.showProgressToast(tasks, `Model '${task.modelName}' failed`, toastManager)
          }
          continue
        }
        if (bgTask) {
          if (bgTask.status === "completed" && !completedTaskIds.has(task.taskId)) {
            task.status = "completed"
            task.completedAt = new Date()
            completedTaskIds.add(task.taskId)
            progressCallback?.onTaskCompleted?.(task)
            this.showProgressToast(tasks, `Model '${task.modelName}' completed`, toastManager)
          } else if ((bgTask.status === "error" || bgTask.status === "cancelled") && !completedTaskIds.has(task.taskId)) {
            task.status = "error"
            task.error = bgTask.error || "Task failed"
            task.completedAt = new Date()
            completedTaskIds.add(task.taskId)
            progressCallback?.onTaskFailed?.(task)
            this.showProgressToast(tasks, `Model '${task.modelName}' failed`, toastManager)
          }
        }
      }

      // If all tasks have transitioned out of pending/running, exit without waiting for another poll.
      if (
        tasks.every((t) => t.status !== "pending" && t.status !== "running")
      ) {
        log("[multi-plan] All plan generation tasks completed")
        break
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }

  /**
   * Show progress toast with current status of all tasks
   */
  private showProgressToast(
    tasks: PlanGenerationTask[],
    title: string,
    toastManager: ReturnType<typeof getTaskToastManager>
  ): void {
    if (!toastManager) return

    const lines: string[] = []
    for (const task of tasks) {
      const icon = task.status === "completed" ? "✅" :
                   task.status === "error" ? "❌" :
                   task.status === "running" ? "⏳" : "⏸️"
      const duration = task.startedAt
        ? this.formatDuration(task.startedAt, task.completedAt)
        : ""
      lines.push(`${icon} ${task.modelName}${duration ? ` (${duration})` : ""}`)
    }

    const completed = tasks.filter(t => t.status === "completed").length
    const failed = tasks.filter(t => t.status === "error").length
    const running = tasks.filter(t => t.status === "running" || t.status === "pending").length

    const summary = `Completed: ${completed}/${tasks.length}${failed > 0 ? ` | Failed: ${failed}` : ""}${running > 0 ? ` | Running: ${running}` : ""}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tuiClient = this.client as any
    if (tuiClient.tui?.showToast) {
      tuiClient.tui.showToast({
        body: {
          title: `🔀 ${title}`,
          message: `${lines.join("\n")}\n\n${summary}`,
          variant: "info",
          duration: 4000,
        },
      }).catch(() => {})
    }
  }

  /**
   * Format duration between two dates
   */
  private formatDuration(start: Date, end?: Date): string {
    const duration = (end ?? new Date()).getTime() - start.getTime()
    const seconds = Math.floor(duration / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  /**
   * Resolve model configuration from model ID
   */
  resolveModelConfig(model: NormalizedPlanningModel): {
    model?: { providerID: string; modelID: string }
  } {
    if (!model.model) return {}

    const [providerID, ...rest] = model.model.split("/")
    return {
      model: { providerID, modelID: rest.join("/") },
    }
  }

  /**
   * Build the base planning prompt with embedded Metis capabilities
   * (intent classification + AI-slop guardrails)
   */
  private buildPlanningPrompt(planId: string, context: string): string {
    const intentClassification = buildIntentClassificationPrompt()
    const slopGuardrails = buildAISlopGuardrails()

    return `You are generating a work plan for a multi-model planning session.

${intentClassification}

---

## Plan Name
${planId}

## Context from Interview
${context}

---

${slopGuardrails}

---

## Plan Format Instructions

Generate a comprehensive work plan following the standard .sisyphus/plans/*.md format.

**Required Sections**:

1. **Intent Classification** (from Phase 0 above)
   - Type, Confidence, Primary Focus

2. **Context**
   - Original Request
   - Interview Summary (key discussions and decisions)
   - Any research findings

3. **Work Objectives**
   - Core Objective (1-2 sentences)
   - Concrete Deliverables (specific files, endpoints, features)
   - Definition of Done (checkboxes)
   - Must Have / Must NOT Have

4. **Context Manifests (REQUIRED)**
   - Context Manifest path: \`.sisyphus/context-manifests/${planId}.md\`
   - Define 3–8 stable pack IDs (e.g., \`global\`, \`tooling\`, \`work-state\`)
   - Each pack should list items (docs/code/index) and why they matter
  - The context manifest file MUST include a valid JSON payload between markers:

    \`\`\`text
    [CONTEXT_MANIFEST]
    { ...json... }
    [/CONTEXT_MANIFEST]
    \`\`\`

  - Pack IDs MUST match: \`/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/\`

5. **Assumptions (REQUIRED)**
   List ALL assumptions with confidence levels:
   | # | Assumption | Confidence (High/Med/Low) | If Wrong, Impact |
   - High = verified via code/user confirmation
   - Medium = reasonable inference
   - Low = educated guess, needs validation

6. **Risks (REQUIRED)**
   Identify what could go wrong:
   | # | Risk | Probability | Impact | Mitigation |
   Categories: Technical, Integration, Scope, Testing

7. **Verification Strategy**
   - Test infrastructure decision
   - Framework choice

8. **TODOs** (numbered, with checkboxes)
   Each TODO must have:
   - What to do (clear steps)
   - Must NOT do (guardrails specific to this TODO)
   - Parallelizable: YES/NO
   - Context Packs: \`pack-a, pack-b\` (comma-separated; must match your Context Manifests section)
   - References (CRITICAL - specific file paths and line numbers)
   - Acceptance Criteria (checkboxes)

9. **Success Criteria**
   - Verification commands with expected output

**Quality Requirements**:
- Be SPECIFIC - no vague "add feature" or "improve X"
- Every claim must have a file reference
- Every TODO must have concrete acceptance criteria
- Apply AI-slop guardrails from above
- Include intent-specific directives in your TODOs
`
  }

  /**
   * Build model-specific prompt with role guidance
   */
  private buildModelSpecificPrompt(
    basePrompt: string,
    model: NormalizedPlanningModel,
    outputPath: string
  ): string {
    const roleGuidance = this.getModelRoleGuidance(model.name)

    return `${basePrompt}

## Your Role: ${model.name}

You are the "${model.name}" perspective in a multi-model planning session.
Multiple AI models are generating plans in parallel. Your plan will be compared against others.

${roleGuidance}

## Output

Write your plan to: \`${outputPath}\`

Use the Write tool to create the file. Ensure the plan is complete and follows all format requirements.

**CONTEXT OVERRIDE**: This is a PLAN GENERATION task, not a plan execution task.
The "NEVER MODIFY THE PLAN FILE" constraint does NOT apply here - you are CREATING a new plan, not modifying an existing one.
Your job is to WRITE the plan file, not execute it.

**IMPORTANT**: Your plan will be reviewed and compared against other models. Make it your BEST work - be thorough, specific, and actionable.
`
  }

  /**
   * Get guidance text for a model in multi-plan context
   *
   * Since model names are auto-derived from model IDs (e.g., "claude-opus-4-5"),
   * we provide generic guidance that encourages diverse perspectives.
   */
  private getModelRoleGuidance(modelName: string): string {
    return `As "${modelName}", bring your unique perspective to this plan:
- What approaches would you prioritize?
- What edge cases or risks might other models miss?
- Where can you add specific, actionable detail?

Your plan will be compared against others - make it your strongest work.`
  }
}
