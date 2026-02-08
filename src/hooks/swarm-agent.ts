/**
 * Swarm Agent Hook
 *
 * Automatically initializes the swarm worker/coordinator when running
 * with swarm environment variables set.
 *
 * Key design: Decoupled task completion detection
 * 1. onTaskAssigned prompts the session and returns true (task accepted)
 * 2. Worker stays in "working" state
 * 3. Hook monitors session events to detect when work is done
 * 4. Calls worker.reportTaskComplete() when task is finished
 */

import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config/schema"
import {
  isSwarmAgent,
  getSwarmEnvContext,
} from "../features/sisyphus-swarm/tmux"
import {
  WorkerAgent,
  createWorker,
  CoordinatorAgent,
  createCoordinator,
  type TaskInfo,
} from "../features/sisyphus-swarm/agent"
import type { SwarmRuntimeService } from "../features/sisyphus-swarm/runtime"
import { log } from "../shared/logger"

export interface SwarmAgentHookOptions {
  config: Partial<OhMyOpenCodeConfig>
  runtime: SwarmRuntimeService
}

export interface SwarmAgentHook {
  getWorker(): WorkerAgent | null
  getCoordinator(): CoordinatorAgent | null
  isSwarmMode(): boolean
  event(input: { event: { type: string; properties?: unknown } }): Promise<void>
  "tool.execute.before"?(
    input: { sessionID: string; tool: string; callID: string },
    output: { args: unknown }
  ): Promise<void>
  "tool.execute.after"?(
    input: { sessionID: string; tool: string; callID: string },
    output: { output: string; metadata?: Record<string, unknown> }
  ): Promise<void>
}

// Task completion detection settings
const IDLE_TIMEOUT_MS = 5000 // Consider task complete after 5s of no activity
const COMPLETION_TOOL_PATTERNS = [
  /task_transition.*completed/i,
  /task_transition.*done/i,
]

/**
 * Create the swarm agent hook
 */
export function createSwarmAgentHook(
  ctx: PluginInput,
  options: SwarmAgentHookOptions
): SwarmAgentHook {
  const { config, runtime } = options

  let worker: WorkerAgent | null = null
  let coordinator: CoordinatorAgent | null = null
  let currentSessionId: string | null = null

  // Idle detection state
  let lastActivityTime = 0
  let idleCheckTimer: ReturnType<typeof setTimeout> | null = null

  const swarmContext = getSwarmEnvContext()

  if (swarmContext) {
    log("[swarm-agent] Detected swarm mode", {
      team: swarmContext.teamName,
      name: swarmContext.agentName,
      role: swarmContext.role,
    })
  }

  /**
   * Record activity (resets idle timer)
   */
  function recordActivity(): void {
    lastActivityTime = Date.now()
  }

  /**
   * Start idle detection for task completion
   */
  function startIdleDetection(): void {
    stopIdleDetection()

    const checkIdle = () => {
      if (!worker?.isWorking()) {
        return
      }

      const idleTime = Date.now() - lastActivityTime
      if (idleTime >= IDLE_TIMEOUT_MS) {
        // Session has been idle long enough - task is likely complete
        log("[swarm-agent] Task completion detected via idle timeout", {
          idleTime,
          taskId: worker.getCurrentTask()?.id,
        })
        worker.reportTaskComplete()
      } else {
        // Check again after remaining time
        idleCheckTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS - idleTime + 100)
      }
    }

    // Start checking
    idleCheckTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS)
  }

  /**
   * Stop idle detection
   */
  function stopIdleDetection(): void {
    if (idleCheckTimer) {
      clearTimeout(idleCheckTimer)
      idleCheckTimer = null
    }
  }

  /**
   * Check if tool output indicates task completion
   */
  function isCompletionSignal(toolName: string, output: string): boolean {
    const combined = `${toolName} ${output}`
    return COMPLETION_TOOL_PATTERNS.some(pattern => pattern.test(combined))
  }

  /**
   * Initialize worker agent
   */
  async function initializeWorker(sessionId: string): Promise<void> {
    if (!swarmContext || swarmContext.role !== "worker") {
      return
    }

    if (worker) {
      log("[swarm-agent] Worker already initialized")
      return
    }

    currentSessionId = sessionId

    log("[swarm-agent] Initializing worker agent", {
      team: swarmContext.teamName,
      name: swarmContext.agentName,
      sessionId,
    })

    try {
      worker = await createWorker(
        {
          teamName: swarmContext.teamName,
          name: swarmContext.agentName,
          sessionId: swarmContext.sessionId || sessionId,
          capabilities: ["code"],
          worktreePath: ctx.directory,
          taskTimeoutMs: 30 * 60 * 1000, // 30 minute timeout

          onTaskAssigned: async (task: TaskInfo) => {
            log("[swarm-agent] Task assigned", {
              taskId: task.id,
              title: task.title,
            })

            // Prompt the OpenCode session with the task
            try {
              const planMode = worker?.getCurrentMode?.() === "plan"

              // Build prompt parts dynamically based on available metadata
              const promptParts: string[] = [
                `# Swarm Task Assignment`,
                ``,
                `**Task ID:** ${task.id}`,
                `**Title:** ${task.title}`,
              ]

              // Add priority if specified
              if (task.priority !== undefined) {
                promptParts.push(`**Priority:** ${task.priority}`)
              }

              // Add required capabilities if specified
              if (task.requiredCapabilities?.length) {
                promptParts.push(`**Required Capabilities:** ${task.requiredCapabilities.join(", ")}`)
              }

              promptParts.push(``)

              // Retry context - helps worker understand previous attempts
              if (task.parentContext && task.parentContext.previousAttempts > 0) {
                promptParts.push(
                  `## Retry Context`,
                  ``,
                  `This task has been attempted **${task.parentContext.previousAttempts}** time(s) before.`
                )
                if (task.parentContext.lastError) {
                  promptParts.push(`**Previous Error:** ${task.parentContext.lastError}`)
                }
                if (task.parentContext.lastWorkerId) {
                  promptParts.push(`**Previous Worker:** ${task.parentContext.lastWorkerId}`)
                }
                promptParts.push(
                  ``,
                  `Please review what went wrong and try a different approach.`,
                  ``
                )
              }

              // Context summary from coordinator
              if (task.contextSummary) {
                promptParts.push(`## Context Summary`, ``, task.contextSummary, ``)
              }

              // Relevant files
              if (task.relevantFiles?.length) {
                promptParts.push(`## Relevant Files`, ``)
                task.relevantFiles.forEach(f => promptParts.push(`- \`${f}\``))
                promptParts.push(``)
              }

              // Plan mode instructions
              if (planMode) {
                promptParts.push(
                  `## PLAN MODE (Approval Required)`,
                  ``,
                  `You are in **plan mode**. Before editing files or running commands, you must:`,
                  `1) Write a clear step-by-step plan`,
                  `2) Submit it for approval using:`,
                  `   /swarm plan submit <your plan text>`,
                  ``,
                  `Until the plan is approved, high-impact tools (Edit/Write/Bash/etc.) are blocked.`,
                  ``
                )
              }

              // Main instructions
              promptParts.push(
                `## Instructions`,
                ``,
                task.description,
                ``,
                `---`,
                ``,
                `Work autonomously until complete. When finished:`,
                `- Use task_transition to mark related tasks as completed, OR`,
                `- Simply finish your work and the task will auto-complete after idle`
              )

              await ctx.client.session.prompt({
                path: { id: sessionId },
                body: {
                  parts: [
                    {
                      type: "text",
                      text: promptParts.join("\n"),
                    },
                  ],
                },
                query: { directory: ctx.directory },
              })

              // Task accepted - start activity tracking
              recordActivity()
              startIdleDetection()

              return true // Accept the task
            } catch (err) {
              log("[swarm-agent] Failed to prompt session", {
                error: err instanceof Error ? err.message : String(err),
              })
              return false // Reject the task
            }
          },

          onStateChange: (state) => {
            log("[swarm-agent] State change", { status: state.status })

            // Stop idle detection when no longer working
            if (state.status !== "working") {
              stopIdleDetection()
            }
          },

          onError: (err) => {
            log("[swarm-agent] Worker error", { error: err.message })
          },
        },
        config
      )

      if (worker) {
        runtime.registerWorker(sessionId, worker)
        log("[swarm-agent] Worker started successfully", {
          agentId: worker.getIdentity().id,
        })
      } else {
        log("[swarm-agent] Failed to start worker")
      }
    } catch (err) {
      log("[swarm-agent] Error initializing worker", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Initialize coordinator agent
   */
  async function initializeCoordinator(sessionId: string): Promise<void> {
    if (!swarmContext || swarmContext.role !== "coordinator") {
      return
    }

    if (coordinator) {
      log("[swarm-agent] Coordinator already initialized")
      return
    }

    currentSessionId = sessionId

    log("[swarm-agent] Initializing coordinator agent", {
      team: swarmContext.teamName,
      name: swarmContext.agentName,
      sessionId,
    })

    try {
      coordinator = await createCoordinator(
        {
          teamName: swarmContext.teamName,
          name: swarmContext.agentName,
          sessionId: swarmContext.sessionId || sessionId,
          autoApprove: true,
          loopIntervalMs: 2000,

          onStateChange: (state) => {
            log("[swarm-agent] Coordinator state change", { status: state.status })
          },

          onTaskCompleted: (taskId, agentId) => {
            log("[swarm-agent] Task completed", { taskId, agentId })
          },

          onError: (err) => {
            log("[swarm-agent] Coordinator error", { error: err.message })
          },
        },
        config
      )

      if (coordinator) {
        runtime.registerCoordinator(sessionId, coordinator)
        log("[swarm-agent] Coordinator started successfully", {
          agentId: coordinator.getIdentity().id,
        })
      } else {
        log("[swarm-agent] Failed to start coordinator")
      }
    } catch (err) {
      log("[swarm-agent] Error initializing coordinator", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Shutdown worker agent
   */
  async function shutdownWorker(): Promise<void> {
    if (!worker) return

    stopIdleDetection()

    log("[swarm-agent] Shutting down worker")
    try {
      await worker.stop({ force: true })
    } catch (err) {
      log("[swarm-agent] Error stopping worker", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (currentSessionId) {
      runtime.unregisterWorker(currentSessionId)
    }
    worker = null
    currentSessionId = null
  }

  /**
   * Shutdown coordinator agent
   */
  async function shutdownCoordinator(): Promise<void> {
    if (!coordinator) return

    log("[swarm-agent] Shutting down coordinator")
    try {
      await coordinator.stop()
    } catch (err) {
      log("[swarm-agent] Error stopping coordinator", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (currentSessionId) {
      runtime.unregisterCoordinator(currentSessionId)
    }
    coordinator = null
    currentSessionId = null
  }

  return {
    getWorker() {
      return worker
    },

    getCoordinator() {
      return coordinator
    },

    isSwarmMode() {
      return isSwarmAgent()
    },

    async event(input) {
      const { event } = input
      const props = event.properties as Record<string, unknown> | undefined

      // Track activity on any event
      if (worker?.isWorking()) {
        recordActivity()
      }

      if (event.type === "session.created") {
        const sessionInfo = props?.info as
          | { id?: string; parentID?: string }
          | undefined

        // Only initialize for main session (no parentID)
        if (sessionInfo?.id && !sessionInfo.parentID && swarmContext) {
          if (swarmContext.role === "worker") {
            await initializeWorker(sessionInfo.id)
          } else if (swarmContext.role === "coordinator") {
            await initializeCoordinator(sessionInfo.id)
          }
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined

        // Shutdown agent when main session is deleted
        if (sessionInfo?.id === currentSessionId) {
          if (worker) {
            await shutdownWorker()
          }
          if (coordinator) {
            await shutdownCoordinator()
          }
        }
      }

      // Detect session becoming idle (message stream ended)
      if (event.type === "message.updated") {
        const info = props?.info as { role?: string; streaming?: boolean } | undefined
        if (info?.role === "assistant" && info?.streaming === false) {
          // Assistant finished responding - this is activity
          recordActivity()
        }
      }
    },

    /**
     * Plan-mode gate and permission flow: block risky tools until approved.
     */
    async "tool.execute.before"(input, output) {
      if (!worker) return
      if (!worker.isWorking()) return

      const toolName = input.tool
      const currentMode = worker.getCurrentMode()

      // Plan mode gate
      if (currentMode === "plan" && !worker.isPlanApprovedForCurrentTask()) {
        // Always allow submitting plans via the swarm tool
        if (toolName === "swarm") {
          const args = output.args as { command?: string } | undefined
          const cmd = args?.command?.trim().toLowerCase() ?? ""
          if (cmd.startsWith("plan submit")) return
          if (cmd.startsWith("plan list")) return
        }

        // Allow safe read-only discovery tools in plan mode
        const allowInPlan = new Set([
          "Read",
          "Glob",
          "Grep",
          "WebFetch",
          "WebSearch",
          "task_get",
          "task_list",
          "task_create",
          "task_update",
          "task_transition",
          "glob",
          "grep",
          "session_read",
          "session_search",
          "session_info",
          "lsp_goto_definition",
          "lsp_find_references",
          "lsp_symbols",
          "lsp_diagnostics",
          "look_at",
          "slashcommand",
        ])

        if (!allowInPlan.has(toolName) && !toolName.startsWith("lsp_")) {
          throw new Error(
            [
              "Plan mode: plan approval required before running this tool.",
              "",
              "Submit your plan first:",
              "  /swarm plan submit <plan text>",
              "",
              "Then wait for approval (coordinator can run /swarm plan list/approve).",
            ].join("\n")
          )
        }
      }

      // Permission flow for high-risk tools
      const highRiskTools = new Set(["Bash", "Write", "Edit", "NotebookEdit"])

      // Skip permission check in bypassPermissions mode
      if (currentMode === "bypassPermissions") return

      // In acceptEdits mode, allow edit tools without permission
      if (currentMode === "acceptEdits" && ["Edit", "Write", "NotebookEdit"].includes(toolName)) {
        return
      }

      // Request coordinator permission for high-risk tools
      if (highRiskTools.has(toolName)) {
        try {
          const result = await worker.requestPermission(toolName, output.args, {
            timeoutMs: 30000,
          })

          if (!result.approved) {
            throw new Error(`Permission denied for ${toolName}: ${result.reason ?? "Coordinator rejected"}`)
          }

          // Apply updated input if coordinator modified it
          if (result.updatedInput !== undefined) {
            output.args = result.updatedInput
          }
        } catch (err) {
          // Re-throw permission errors
          if (err instanceof Error && err.message.startsWith("Permission denied")) {
            throw err
          }
          // For timeout/communication errors, log and allow (graceful degradation)
          log("[swarm-agent] Permission request failed, allowing tool", {
            tool: toolName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },

    /**
     * Monitor tool executions for completion signals
     */
    async "tool.execute.after"(input, output) {
      if (!worker?.isWorking()) {
        return
      }

      // Record activity
      recordActivity()

      // Check for explicit completion signals
      if (isCompletionSignal(input.tool, output.output)) {
        log("[swarm-agent] Task completion detected via tool signal", {
          tool: input.tool,
          taskId: worker.getCurrentTask()?.id,
        })
        worker.reportTaskComplete()
      }
    },
  }
}
