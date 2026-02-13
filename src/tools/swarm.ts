/**
 * Swarm Tool - Multi-Agent Coordination
 *
 * Provides /swarm commands for managing parallel agent teams.
 *
 * Commands:
 * - /swarm create <team> - Create a team, become coordinator
 * - /swarm spawn <count> - Spawn N workers in tmux windows
 * - /swarm task add <title> [desc] - Add task to graph
 * - /swarm plan submit <plan> - Submit plan for approval (worker)
 * - /swarm plan list|approve|reject|revise - Manage plan approvals (coordinator)
 * - /swarm status [team] - Show team status
 * - /swarm stop [--cleanup] - Stop workers for active team
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { OhMyOpenCodeConfig } from "../config/schema"
import {
  createTeam,
  readManifest,
  createAgentIdentity,
} from "../features/orchestrator-swarm/team"
import {
  createSwarmOrchestrator,
  SwarmOrchestrator,
  closeSwarmWindowsByTeam,
  getCurrentSession,
  inspectSwarmWindowsByTeam,
} from "../features/orchestrator-swarm/tmux"
import { createSwarmTask } from "../features/orchestrator-swarm/task-graph"
import type { SwarmRuntimeService } from "../features/orchestrator-swarm/runtime"
import { getRuntimeSnapshot, resolveParallelRuntimeConfig } from "../features/parallel-runtime"
import { log } from "../shared/logger"

interface SwarmToolContext {
  directory: string
  config: Partial<OhMyOpenCodeConfig>
  runtime: SwarmRuntimeService
  getSessionId?: () => string | undefined
}

/**
 * Parse swarm command arguments
 */
function parseSwarmCommand(input: string): {
  command: string
  args: string[]
  flags: Record<string, boolean | string>
} {
  const parts = input.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase() || "status"
  const args: string[] = []
  const flags: Record<string, boolean | string> = {}

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    if (part.startsWith("--")) {
      const [key, value] = part.slice(2).split("=")
      flags[key] = value ?? true
    } else {
      args.push(part)
    }
  }

  return { command, args, flags }
}

/**
 * Extract raw plan text for `plan submit ...` preserving whitespace/newlines.
 */
function extractPlanSubmitText(commandString: string): string {
  const trimmed = commandString.trim()
  const m = trimmed.match(/^plan\s+submit\s+/i)
  if (!m) return ""
  return trimmed.slice(m[0].length)
}

/**
 * Format team status as text
 */
async function formatTeamStatus(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>,
  orchestrator?: SwarmOrchestrator
): Promise<string> {
  const manifest = readManifest(teamName, config)
  if (!manifest) {
    return `Team "${teamName}" not found.`
  }

  const lines: string[] = [
    `Team: ${teamName}`,
    `Created: ${new Date(manifest.createdAt).toLocaleString()}`,
    `Members: ${manifest.members.length}`,
    "",
    "Agents:",
  ]

  const statusIcons: Record<string, string> = {
    joining: "...",
    idle: "○",    // Ready/available (not paused)
    working: "▶",
    waiting: "?",
    paused: "⏳",  // Paused waiting for input
    leaving: "←",
    dead: "✗",
    unknown: "?",
  }

  for (const member of manifest.members) {
    const isCoordinator = member.id === manifest.coordinatorId
    const role = isCoordinator ? "[C]" : "[W]"
    const window = orchestrator?.getWindow(member.id)
    const status = window?.status ?? "unknown"
    const icon = statusIcons[status] ?? "?"

    lines.push(`  ${icon} ${role} ${member.name} (${member.id.slice(-6)})`)
  }

  const runtimeConfig = resolveParallelRuntimeConfig(config.parallel_runtime)
  if (runtimeConfig.enabled) {
    const snapshot = await getRuntimeSnapshot(runtimeConfig)
    lines.push("")
    lines.push("Parallel Runtime:")
    lines.push(
      `  Slots: ${snapshot.activeLeases}/${snapshot.globalSlots} active (${snapshot.availableSlots} available)`
    )
    lines.push(`  Mode: ${snapshot.mode}`)
    lines.push(
      `  Active by subsystem: background=${snapshot.activeBySubsystem.background}, swarm=${snapshot.activeBySubsystem.swarm}`
    )
    if (snapshot.oversubscribed > 0) {
      lines.push(`  Oversubscribed: ${snapshot.oversubscribed}`)
    }
  }

  return lines.join("\n")
}

function formatTeamDiagnostics(
  diagnostics: TeamDiagnosticsSnapshot
): string {
  return diagnostics.lines.join("\n")
}

interface TeamDiagnosticsSnapshot {
  lines: string[]
  runtimeOrchestratorPresent: boolean
  tmuxSession: string | null
  tmuxMatched: number
  tmuxMatchedByOption: number
  driftDetected: boolean
}

function collectTeamDiagnostics(
  teamName: string,
  directory: string,
  sessionId: string | undefined,
  runtime: SwarmRuntimeService,
  orchestrator: SwarmOrchestrator | undefined
): TeamDiagnosticsSnapshot {
  const lines: string[] = ["Swarm Diagnostics:"]

  if (!sessionId) {
    lines.push("  Session binding: unavailable")
  } else {
    const binding = runtime.getSessionTeam(sessionId)
    if (!binding) {
      lines.push("  Session binding: none")
    } else if (binding.directory === directory && binding.teamName === teamName) {
      lines.push(`  Session binding: ${binding.teamName} (active)`)
    } else {
      lines.push(`  Session binding: ${binding.teamName} @ ${binding.directory} (different target)`)
    }
  }

  const runtimeOrchestratorPresent = !!orchestrator
  lines.push(`  Runtime orchestrator: ${runtimeOrchestratorPresent ? "present" : "missing"}`)

  const tmuxSessionName = getCurrentSession()
  if (!tmuxSessionName) {
    lines.push("  Tmux session: unavailable")
    return {
      lines,
      runtimeOrchestratorPresent,
      tmuxSession: null,
      tmuxMatched: 0,
      tmuxMatchedByOption: 0,
      driftDetected: false,
    }
  }

  const inspection = inspectSwarmWindowsByTeam(tmuxSessionName, teamName)
  lines.push(`  Tmux session: ${tmuxSessionName}`)
  lines.push(`  Tmux windows for team: ${inspection.matched} (option=${inspection.matchedByOption})`)

  const driftDetected = !runtimeOrchestratorPresent && inspection.matched > 0
  if (driftDetected) {
    lines.push(
      "  Drift detected: runtime handle missing while tmux team windows exist; run /swarm stop to recover."
    )
  }

  return {
    lines,
    runtimeOrchestratorPresent,
    tmuxSession: tmuxSessionName,
    tmuxMatched: inspection.matched,
    tmuxMatchedByOption: inspection.matchedByOption,
    driftDetected,
  }
}

/**
 * Execute swarm command
 */
async function executeSwarmCommand(
  commandString: string,
  ctx: SwarmToolContext
): Promise<string> {
  const { directory, config, runtime } = ctx
  const sessionId = ctx.getSessionId?.()
  const { command, args: cmdArgs, flags } = parseSwarmCommand(commandString)

  log("[swarm] Executing command", { command, args: cmdArgs, flags })

  switch (command) {
    case "create": {
      const teamName = cmdArgs[0]
      if (!teamName) {
        return "Usage: /swarm create <team-name>\n\nCreates a new team. You become the coordinator."
      }

      // Check if team exists
      const existing = readManifest(teamName, config)
      if (existing) {
        return `Team "${teamName}" already exists with ${existing.members.length} members.\n\nUse '/swarm status' to see details or choose a different name.`
      }

      // Create coordinator identity
      const coordinatorId = createAgentIdentity({
        name: "coordinator",
        sessionId: sessionId || `sess_${Date.now()}`,
        role: "coordinator",
        capabilities: ["code", "design", "review"],
      })

      // Create team
      const team = createTeam(teamName, coordinatorId, config)
      if (!team) {
        return `Failed to create team "${teamName}". Check permissions and try again.`
      }

      // Track team for this session
      if (sessionId) {
        runtime.bindSessionToTeam(sessionId, directory, teamName)
      }

      // Auto-spawn coordinator window if tmux is available
      let coordinatorSpawned = false
      if (SwarmOrchestrator.isAvailable()) {
        const orchestrator = runtime.ensureOrchestrator(directory, teamName, () =>
          createSwarmOrchestrator(directory, config)
        )

        if (orchestrator) {
          const coordWindow = orchestrator.createAgentWindow({
            teamName,
            agentId: coordinatorId.id,
            agentName: "coordinator",
            role: "coordinator",
          })
          coordinatorSpawned = !!coordWindow
        }
      }

      const coordMsg = coordinatorSpawned
        ? "Coordinator agent spawned in tmux window."
        : "Note: Run inside tmux to enable coordinator agent."

      return [
        `✓ Team "${teamName}" created.`,
        "",
        coordMsg,
        "",
        "Next steps:",
        "1. Add tasks: /swarm task add <title> [description]",
        "2. Spawn workers: /swarm spawn <count>",
        "3. Monitor: /swarm status",
      ].join("\n")
    }

    case "spawn": {
      const count = parseInt(cmdArgs[0] || "1", 10)
      if (isNaN(count) || count < 1 || count > 10) {
        return "Usage: /swarm spawn <count>\n\nSpawn 1-10 worker agents in tmux windows.\n\nRequires:\n- Be inside tmux\n- Have an active team (run 'create' first)"
      }

      // Get current team
      const teamName = sessionId ? runtime.getSessionTeam(sessionId)?.teamName : undefined
      if (!teamName) {
        return "No active team. Run '/swarm create <team>' first."
      }

      // Check tmux availability
      if (!SwarmOrchestrator.isAvailable()) {
        return [
          "Cannot spawn workers: tmux not available.",
          "",
          "Requirements:",
          "- Run inside a tmux session",
          "- tmux binary must be installed",
          "",
          "Start tmux first: tmux new -s opencode",
        ].join("\n")
      }

      // Get or create orchestrator
      const orchestrator = runtime.ensureOrchestrator(directory, teamName, () =>
        createSwarmOrchestrator(directory, config)
      )
      if (!orchestrator) {
        return "Failed to create orchestrator. Check tmux environment."
      }

      // Spawn workers
      const workers = orchestrator.spawnWorkers({
        teamName,
        count,
        namePrefix: "worker",
      })

      if (workers.length === 0) {
        return "Failed to spawn workers. Check tmux and git permissions."
      }

      // Start auto-rescue if configured
      if (config.tmux_parallel_agents?.auto_rescue) {
        orchestrator.startAutoRescue()
      }

      const workerList = workers
        .map((w) => `  - ${w.agentName} (window: ${w.windowName})`)
        .join("\n")

      return [
        `✓ Spawned ${workers.length} worker(s):`,
        workerList,
        "",
        "Workers are joining the team and will start polling for tasks.",
        "",
        "Use '/swarm status' to monitor progress.",
      ].join("\n")
    }

    case "status": {
      // Get current team
      const explicitTeamName = cmdArgs[0]
      const boundTeamName = sessionId ? runtime.getSessionTeam(sessionId)?.teamName : undefined
      const teamName = explicitTeamName || boundTeamName
      if (!teamName) {
        // List all teams if no active team
        return [
          "No active team in this session.",
          "",
          "Usage:",
          "  /swarm create <team> - Create a new team",
          "  /swarm status <team> - Check specific team status",
        ].join("\n")
      }

      const orchestrator = runtime.getOrchestrator(directory, teamName)
      const statusText = await formatTeamStatus(teamName, config, orchestrator ?? undefined)
      if (statusText === `Team "${teamName}" not found.`) {
        return statusText
      }

      const diagnostics = collectTeamDiagnostics(
        teamName,
        directory,
        sessionId,
        runtime,
        orchestrator ?? undefined
      )
      const diagnosticsText = formatTeamDiagnostics(diagnostics)
      const teamKey = runtime.toTeamKey(directory, teamName)
      const statusTimestamp = Date.now()

      log("[swarm.observability] status", {
        teamKey,
        sessionId: sessionId ?? null,
        timestamp: statusTimestamp,
        runtimeOrchestratorPresent: diagnostics.runtimeOrchestratorPresent,
        tmuxSession: diagnostics.tmuxSession,
        tmuxMatched: diagnostics.tmuxMatched,
        tmuxMatchedByOption: diagnostics.tmuxMatchedByOption,
        driftDetected: diagnostics.driftDetected,
      })

      if (diagnostics.driftDetected) {
        log("[swarm.observability] drift-detected", {
          teamKey,
          sessionId: sessionId ?? null,
          timestamp: statusTimestamp,
          runtimeOrchestratorPresent: diagnostics.runtimeOrchestratorPresent,
          tmuxSession: diagnostics.tmuxSession,
          tmuxMatched: diagnostics.tmuxMatched,
          tmuxMatchedByOption: diagnostics.tmuxMatchedByOption,
        })
      }

      return `${statusText}\n\n${diagnosticsText}`
    }

    case "stop": {
      const cleanup = flags.cleanup === true

      // Get current team
      const teamName = sessionId ? runtime.getSessionTeam(sessionId)?.teamName : undefined
      if (!teamName) {
        return "No active team to stop."
      }

      const orchestrator = runtime.getOrchestrator(directory, teamName)
      const coordinator = sessionId ? runtime.getCoordinator(sessionId) : undefined
      const hasOrchestratorHandle = !!orchestrator
      let recoveredTmuxSummary: ReturnType<typeof closeSwarmWindowsByTeam> | undefined
      let tmuxRecoverySkippedReason: string | undefined
      const teamKey = runtime.toTeamKey(directory, teamName)
      const stopTimestamp = Date.now()

      if (!hasOrchestratorHandle && coordinator) {
        try {
          await coordinator.stop()
        } catch (err) {
          log("[swarm] Failed to stop coordinator during stop fallback", {
            sessionId,
            teamName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      if (!hasOrchestratorHandle) {
        const sessionName = getCurrentSession()
        if (sessionName) {
          recoveredTmuxSummary = closeSwarmWindowsByTeam(sessionName, teamName)
        } else {
          tmuxRecoverySkippedReason = "not running inside tmux"
        }
      }

      const stopped = runtime.stopTeam(directory, teamName, cleanup)
      if (!stopped) {
        return `Team "${teamName}" is not active in runtime.`
      }

      const cleanupMsg = cleanup
        ? "\nWorktrees and branches have been removed."
        : "\nWorktrees preserved for manual merge."

      const fallbackMsg = hasOrchestratorHandle
        ? ""
        : [
            "\nNo in-memory orchestrator handle was found; cleared runtime bindings and attempted coordinator shutdown.",
            recoveredTmuxSummary
              ? `\nRecovered tmux windows: ${recoveredTmuxSummary.closed}/${recoveredTmuxSummary.attempted} (option=${recoveredTmuxSummary.matchedByOption}).`
              : "",
            !recoveredTmuxSummary && tmuxRecoverySkippedReason
              ? `\nSkipped tmux recovery: ${tmuxRecoverySkippedReason}.`
              : "",
          ].filter(Boolean).join("")

      log("[swarm.observability] stop-recovery", {
        teamKey,
        sessionId: sessionId ?? null,
        timestamp: stopTimestamp,
        cleanup,
        hasRuntimeOrchestrator: hasOrchestratorHandle,
        tmuxRecoveryAttempted: recoveredTmuxSummary?.attempted ?? 0,
        tmuxRecoveryClosed: recoveredTmuxSummary?.closed ?? 0,
        tmuxRecoveryMatchedByOption: recoveredTmuxSummary?.matchedByOption ?? 0,
        tmuxRecoverySkippedReason: tmuxRecoverySkippedReason ?? null,
      })

      return `✓ Stopped all workers for team "${teamName}".${cleanupMsg}${fallbackMsg}`
    }

    case "task": {
      const subCmd = cmdArgs[0]?.toLowerCase()

      if (subCmd === "add") {
        // /swarm task add "title" "description"
        const title = cmdArgs[1]
        const description = cmdArgs.slice(2).join(" ") || title

        if (!title) {
          return "Usage: /swarm task add <title> [description]\n\nAdd a task to the team's task graph."
        }

        // Get current team
        const teamName = sessionId ? runtime.getSessionTeam(sessionId)?.teamName : undefined
        if (!teamName) {
          return "No active team. Run '/swarm create <team>' first."
        }

        const manifest = readManifest(teamName, config)
        if (!manifest) {
          return `Team "${teamName}" not found.`
        }

        try {
          const task = createSwarmTask(teamName, {
            title,
            description,
          }, config)

          return [
            `✓ Task created: ${task.id}`,
            `  Title: ${title}`,
            "",
            "The coordinator will assign this task to an available worker.",
          ].join("\n")
        } catch (err) {
          return `Failed to create task: ${err instanceof Error ? err.message : String(err)}`
        }
      }

      return [
        "Task management commands:",
        "",
        "  /swarm task add <title> [description]",
        "    Add a task to the team's task graph",
        "",
        "Example:",
        '  /swarm task add "Refactor auth module" "Extract login logic into separate service"',
      ].join("\n")
    }

    case "plan": {
      const subCmd = cmdArgs[0]?.toLowerCase()

      // Worker: submit a plan for approval and wait for coordinator response
      if (subCmd === "submit") {
        if (!sessionId) {
          return "Plan submit requires a session context."
        }
        const worker = runtime.getWorker(sessionId)
        if (!worker) {
          return "No active Swarm worker found in this session."
        }

        const planText = extractPlanSubmitText(commandString)
        if (!planText) {
          return [
            "Usage:",
            "  /swarm plan submit <plan text>",
            "",
            "Example:",
            "  /swarm plan submit 1) ... 2) ... 3) ...",
          ].join("\n")
        }

        const timeoutMs = typeof flags.timeoutMs === "string" ? parseInt(flags.timeoutMs, 10) : undefined
        const planFile = typeof flags.planFile === "string" ? flags.planFile : undefined

        const result = await worker.requestPlanApproval(planText, { timeoutMs, planFile })
        return [
          `Plan approval decision: ${result.decision}`,
          result.feedback ? `Feedback: ${result.feedback}` : "",
        ].filter(Boolean).join("\n")
      }

      // Coordinator: list/approve/reject/revise pending plans
      if (!sessionId) {
        return "Plan management requires a session context."
      }
      const coordinator = runtime.getCoordinator(sessionId)
      if (!coordinator) {
        return "No active Swarm coordinator found in this session."
      }

      if (subCmd === "list") {
        const pending = coordinator.getPendingPlanApprovals()
        if (pending.length === 0) return "No pending plan approvals."
        return [
          "Pending plan approvals:",
          ...pending.map((p) => {
            const ageSec = Math.round((Date.now() - p.requestedAt) / 1000)
            return `- ${p.requestId} from ${p.from} (task: ${p.taskId ?? "n/a"}, age: ${ageSec}s)`
          }),
        ].join("\n")
      }

      if (subCmd === "approve") {
        const requestId = cmdArgs[1]
        const feedback = cmdArgs.slice(2).join(" ") || undefined
        if (!requestId) return "Usage: /swarm plan approve <requestId> [feedback]"
        return coordinator.approvePlan(requestId, feedback)
          ? `✓ Approved plan ${requestId}`
          : `Plan request not found: ${requestId}`
      }

      if (subCmd === "reject") {
        const requestId = cmdArgs[1]
        const feedback = cmdArgs.slice(2).join(" ") || undefined
        if (!requestId) return "Usage: /swarm plan reject <requestId> [feedback]"
        return coordinator.rejectPlan(requestId, feedback)
          ? `✓ Rejected plan ${requestId}`
          : `Plan request not found: ${requestId}`
      }

      if (subCmd === "revise") {
        const requestId = cmdArgs[1]
        const feedback = cmdArgs.slice(2).join(" ")
        if (!requestId || !feedback) {
          return "Usage: /swarm plan revise <requestId> <feedback>"
        }
        return coordinator.requestPlanRevision(requestId, feedback)
          ? `✓ Requested revision for plan ${requestId}`
          : `Plan request not found: ${requestId}`
      }

      return [
        "Plan approval commands:",
        "",
        "  /swarm plan submit <plan text> [--timeoutMs=60000] [--planFile=path]",
        "    Submit plan for coordinator approval (worker)",
        "",
        "  /swarm plan list",
        "    List pending approvals (coordinator)",
        "  /swarm plan approve <requestId> [feedback]",
        "  /swarm plan reject <requestId> [feedback]",
        "  /swarm plan revise <requestId> <feedback>",
      ].join("\n")
    }

    case "help":
    default: {
      return [
        "orchestrator Swarm - Multi-Agent Coordination",
        "",
        "Commands:",
        "  /swarm create <team>  - Create team, become coordinator",
        "  /swarm spawn <count>  - Spawn N workers (1-10)",
        "  /swarm task add <title> [desc] - Add task to graph",
        "  /swarm plan submit <plan> - Submit plan for approval (worker)",
        "  /swarm plan list|approve|reject|revise - Manage plan approvals (coordinator)",
        "  /swarm status [team]  - Show team status",
        "  /swarm stop [--cleanup] - Stop workers for active team",
        "",
        "Workflow:",
        "  1. /swarm create my-feature",
        "  2. /swarm task add 'Implement login' 'Add JWT auth'",
        "  3. /swarm spawn 3",
        "  4. Monitor with /swarm status",
        "  5. When done: /swarm stop --cleanup",
        "",
        "Requirements:",
        "  - Must run inside tmux",
        "  - Requires tmux_parallel_agents.enabled in config",
      ].join("\n")
    }
  }
}

/**
 * Create the swarm tool
 */
export function createSwarmTool(ctx: SwarmToolContext): ToolDefinition {
  return tool({
    description:
      "Multi-agent coordination via orchestrator Swarm. " +
      "Commands: 'create <team>' to create a team and become coordinator, " +
      "'spawn <count>' to spawn N workers in tmux windows, " +
      "'task add <title> [description]' to add a task to the graph, " +
      "'plan submit|list|approve|reject|revise' to manage plan approvals, " +
      "'status' to show team status, " +
      "'stop [--cleanup]' to stop workers for active team.",
    args: {
      command: tool.schema
        .string()
        .describe(
          "Swarm command: 'create <team>' | 'spawn <count>' | 'task ...' | 'plan ...' | 'status [team]' | 'stop [--cleanup]'"
        ),
    },
    execute: async (args) => {
      return executeSwarmCommand(args.command, ctx)
    },
  })
}
