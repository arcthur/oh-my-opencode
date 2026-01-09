import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"
import type { BackgroundManager } from "../background-agent"
import type { MultiPlanModel, PlanGenerationTask, MultiPlanSession } from "./types"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS } from "../../tools/sisyphus-task/constants"
import { log } from "../../shared/logger"
import { getTaskToastManager } from "../task-toast-manager"
import { sanitizePathSegment } from "../../shared/path-sanitizer"

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
    const basePrompt = this.buildPlanningPrompt(session.planName, session.requestContext)

    log("[multi-plan] Starting parallel plan generation", {
      planName: session.planName,
      modelCount: session.models.length,
    })

    // Launch all tasks in parallel
    const launchPromises = session.models.map(async (model) => {
      // Defensive: ensure model.name is safe (should be validated at entry point)
      const safeModelName = sanitizePathSegment(model.name) || "unknown"
      const outputPath = `.sisyphus/plans/${session.planName}-${safeModelName}.md`

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
        const bgTask = await this.manager.launch({
          description: `Multi-Plan: ${model.name}`,
          prompt,
          agent: "Sisyphus", // Use Sisyphus for plan generation
          parentSessionID,
          parentMessageID: "",
          model: modelConfig.model,
          skillContent: modelConfig.systemPrompt,
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
   * Resolve model configuration from category or direct specification
   */
  private resolveModelConfig(model: MultiPlanModel): {
    model?: { providerID: string; modelID: string }
    systemPrompt?: string
  } {
    // Direct model specification takes priority
    if (model.model) {
      const [providerID, ...rest] = model.model.split("/")
      return {
        model: { providerID, modelID: rest.join("/") },
      }
    }

    // Use category configuration
    if (model.category) {
      const categoryConfig = DEFAULT_CATEGORIES[model.category as keyof typeof DEFAULT_CATEGORIES]
      if (categoryConfig) {
        const [providerID, ...rest] = categoryConfig.model.split("/")
        // Get prompt append from the correct location (CATEGORY_PROMPT_APPENDS, not categoryConfig)
        const promptAppend = CATEGORY_PROMPT_APPENDS[model.category]
        return {
          model: { providerID, modelID: rest.join("/") },
          systemPrompt: promptAppend,
        }
      }
    }

    return {}
  }

  /**
   * Build the base planning prompt
   */
  private buildPlanningPrompt(planName: string, context: string): string {
    return `You are generating a work plan for a multi-model planning session.

## Plan Name
${planName}

## Context from Interview
${context}

## Instructions

Generate a comprehensive work plan following the standard .sisyphus/plans/*.md format.

**Required Sections**:

1. **Context**
   - Original Request
   - Interview Summary (key discussions and decisions)
   - Any research findings

2. **Work Objectives**
   - Core Objective (1-2 sentences)
   - Concrete Deliverables (specific files, endpoints, features)
   - Definition of Done (checkboxes)
   - Must Have / Must NOT Have

3. **Verification Strategy**
   - Test infrastructure decision
   - Framework choice

4. **TODOs** (numbered, with checkboxes)
   Each TODO must have:
   - What to do (clear steps)
   - Must NOT do (guardrails)
   - Parallelizable: YES/NO
   - References (CRITICAL - specific file paths and line numbers)
   - Acceptance Criteria (checkboxes)

5. **Success Criteria**
   - Verification commands with expected output

**Quality Requirements**:
- Be SPECIFIC - no vague "add feature" or "improve X"
- Every claim must have a file reference
- Every TODO must have concrete acceptance criteria
- Avoid AI slop - no generic "best practices" without specifics
`
  }

  /**
   * Build model-specific prompt with role guidance
   */
  private buildModelSpecificPrompt(
    basePrompt: string,
    model: MultiPlanModel,
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

**IMPORTANT**: Your plan will be reviewed and compared against other models. Make it your BEST work - be thorough, specific, and actionable.
`
  }

  /**
   * Get role-specific guidance based on model name
   */
  private getModelRoleGuidance(roleName: string): string {
    const guidance: Record<string, string> = {
      strategist: `**Strategic Perspective**:
- Focus on high-level architecture decisions
- Consider long-term maintainability and scalability
- Identify potential risks and mitigation strategies
- Define clear boundaries and interfaces
- Think about the big picture before details`,

      creative: `**Creative Perspective**:
- Explore novel approaches and alternatives
- Consider edge cases others might miss
- Think about user experience implications
- Look for elegant solutions over complex ones
- Challenge conventional approaches when warranted`,

      practical: `**Practical Perspective**:
- Focus on immediate implementability
- Prefer minimal changes that achieve the goal
- Choose low-risk, incremental approaches
- Provide concrete, step-by-step verification
- Avoid over-engineering - YAGNI principle`,

      thorough: `**Thorough Perspective**:
- Cover all possible edge cases
- Provide comprehensive acceptance criteria
- Leave nothing undefined or ambiguous
- Document all assumptions explicitly
- Include detailed references for everything`,

      fast: `**Fast Execution Perspective**:
- Prioritize quick wins and MVP approach
- Identify the critical path to delivery
- Defer non-essential features
- Focus on the 80/20 - what delivers most value fastest
- Keep scope minimal`,

      quality: `**Quality-First Perspective**:
- Emphasize testing and verification
- Consider error handling comprehensively
- Focus on code quality and maintainability
- Include proper documentation
- Think about future developers`,
    }

    return guidance[roleName.toLowerCase()] ||
      `Bring your unique perspective as "${roleName}" to the plan. What would you prioritize? What might others miss?`
  }
}
