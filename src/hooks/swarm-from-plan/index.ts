import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { createWorkStateManager } from "../../features/work-state"
import { createCoordinator } from "../../features/sisyphus-swarm/agent"
import { getCoordinator, registerCoordinator } from "../../features/sisyphus-swarm/runtime/registry"
import { createSwarmOrchestrator } from "../../features/sisyphus-swarm/tmux"
import { getStaleMembers, readManifest, teamExists } from "../../features/sisyphus-swarm/team"
import { getContextManifestPath } from "../../features/context-manifests"
import { syncPlanTodosToTaskPool } from "../../features/sisyphus-swarm/plan-sync"
import { getSwarmOrchestrator, setSessionTeam, setSwarmOrchestrator } from "../../tools/swarm"
import { log } from "../../shared/logger"

export const HOOK_NAME = "swarm-from-plan"

interface HookInput {
  sessionID: string
  messageID?: string
}

interface HookOutput {
  parts: Array<{ type: string; text?: string }>
}

function isStartWorkCommand(promptText: string): boolean {
  return promptText.includes("<session-context>")
}

function getPromptText(parts: HookOutput["parts"]): string {
  return (
    parts
      ?.filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n")
      .trim() || ""
  )
}

function normalizeTeamName(input: string): string {
  const sanitized = input
    .trim()
    .replace(/["'\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  return sanitized.length > 0 ? sanitized.slice(0, 64) : "swarm"
}

function shortHash(value: string, length = 8): string {
  return createHash("sha1").update(value).digest("hex").slice(0, Math.max(4, length))
}

function buildTeamId(planName: string, planPath: string): string {
  const base = normalizeTeamName(planName)
  const suffix = shortHash(planPath, 8)
  const maxBaseLength = Math.max(1, 64 - suffix.length - 1)
  const baseTrimmed = base.slice(0, maxBaseLength)
  return `${baseTrimmed}-${suffix}`
}

function appendText(output: HookOutput, extra: string): void {
  const part = output.parts.find((p) => p.type === "text")
  if (part) {
    part.text = `${part.text ?? ""}\n${extra}`.trimEnd()
    return
  }
  output.parts.push({ type: "text", text: extra.trimEnd() })
}

export function createSwarmFromPlanHook(
  ctx: PluginInput,
  config: Partial<OhMyOpenCodeConfig>
) {
  const workStateManager = createWorkStateManager(ctx.directory)
  // In-memory guard prevents double-bootstrap within a single process lifetime.
  // On crash recovery (new process, same session ID), this guard is lost; we fall
  // through to the filesystem-based team existence check below (idempotent).
  const startedBySession = new Set<string>()

  return {
    "chat.message": async (input: HookInput, output: HookOutput): Promise<void> => {
      const swarmEnabled = config.sisyphus?.swarm?.enabled ?? false
      const swarmFirst = config.sisyphus?.swarm?.swarm_first ?? false
      const tasksEnabled = config.sisyphus?.tasks?.enabled ?? false

      if (!swarmEnabled || !swarmFirst || !tasksEnabled) return

      const promptText = getPromptText(output.parts)
      if (!isStartWorkCommand(promptText)) return
      if (startedBySession.has(input.sessionID)) return

      const state = workStateManager.load()
      const planName = state?.plan_name?.trim()
      const planPathRaw = state?.active_plan?.trim()
      if (!planName || !planPathRaw) return

      const planPath = planPathRaw.startsWith("/")
        ? planPathRaw
        : join(ctx.directory, planPathRaw)
      const teamName = buildTeamId(planName, planPath)

      // Crash-safe idempotency: if the team already exists with active (non-stale)
      // workers, skip the full bootstrap.  Only ensure the in-process coordinator
      // instance is running so that coordination continues.
      if (teamExists(teamName, config)) {
        const existingManifest = readManifest(teamName, config)
        const staleIds = new Set(getStaleMembers(teamName, config).map((m) => m.id))
        const activeWorkers = existingManifest?.members.filter(
          (m) => m.id !== existingManifest.coordinatorId && !staleIds.has(m.id)
        ) ?? []

        if (activeWorkers.length > 0) {
          // Team is still alive from a previous (crashed) process run.
          // Re-attach coordinator in-process and mark session.
          if (!getCoordinator(input.sessionID)) {
            const recovered = await createCoordinator(
              {
                teamName,
                name: "coordinator",
                sessionId: input.sessionID,
                autoApprove: true,
                loopIntervalMs: 2000,
                onError: (err) => log(`[${HOOK_NAME}] Coordinator error (recovery)`, { error: err.message }),
              },
              config
            )
            if (recovered) {
              registerCoordinator(input.sessionID, recovered)
            }
          }
          setSessionTeam(input.sessionID, teamName)
          startedBySession.add(input.sessionID)

          appendText(output, [
            "",
            "## Swarm-first Execution (recovered)",
            "",
            `Team: ${teamName} (existing team with ${activeWorkers.length} active workers)`,
            `Monitor: /swarm status ${teamName}`,
          ].join("\n"))
          return
        }
      }

      if (!existsSync(planPath)) {
        log(`[${HOOK_NAME}] Plan file missing`, { planName, planPath })
        return
      }

      let planMarkdown: string
      try {
        planMarkdown = readFileSync(planPath, "utf-8")
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to read plan`, { planName, planPath, error: String(err) })
        return
      }

      const manifestPath = join(ctx.directory, getContextManifestPath(planName))
      const manifestMarkdown = existsSync(manifestPath)
        ? (() => {
            try {
              return readFileSync(manifestPath, "utf-8")
            } catch {
              return undefined
            }
          })()
        : undefined

      // Ensure coordinator exists (in-process)
      const existing = getCoordinator(input.sessionID)
      const coordinator =
        existing ??
        (await createCoordinator(
          {
            teamName,
            name: "coordinator",
            sessionId: input.sessionID,
            autoApprove: true,
            loopIntervalMs: 2000,
            onError: (err) => log(`[${HOOK_NAME}] Coordinator error`, { error: err.message }),
          },
          config
        ))

      if (!coordinator) {
        log(`[${HOOK_NAME}] Failed to start coordinator`, { teamName, planName })
        return
      }

      if (!existing) {
        registerCoordinator(input.sessionID, coordinator)
      }

      setSessionTeam(input.sessionID, teamName)

      // Sync plan TODOs to task pool (idempotent)
      const sync = syncPlanTodosToTaskPool({
        config,
        listId: teamName,
        planName,
        planMarkdown,
        manifestMarkdown,
      })

      // Spawn workers (tmux/worktree) if available
      const targetWorkers = Math.max(0, Math.min(10, config.sisyphus?.swarm?.worker_count ?? 3))
      let spawned = 0
      let workerNote: string | null = null

      if (targetWorkers > 0 && config.tmux_parallel_agents?.enabled) {
        let orchestrator = getSwarmOrchestrator(ctx.directory)
        if (!orchestrator) {
          const created = createSwarmOrchestrator(ctx.directory, config)
          if (created) {
            orchestrator = created
            setSwarmOrchestrator(ctx.directory, created)
          }
        }

        if (orchestrator) {
          const manifest = readManifest(teamName, config)
          const staleMembers = new Set(getStaleMembers(teamName, config).map((m) => m.id))
          const existingWorkers =
            manifest?.members.filter(
              (m) => m.id !== manifest.coordinatorId && !staleMembers.has(m.id)
            ).length ?? 0
          const need = Math.max(0, targetWorkers - existingWorkers)
          if (need > 0) {
            const windows = orchestrator.spawnWorkers({
              teamName,
              count: need,
              namePrefix: "worker",
            })
            spawned = windows.length
          }

          if (config.tmux_parallel_agents?.auto_rescue) {
            orchestrator.startAutoRescue()
          }
        } else {
          workerNote = "tmux not available — run inside tmux to auto-spawn workers."
        }
      } else if (targetWorkers > 0) {
        workerNote = "tmux_parallel_agents.enabled=false — workers were not auto-spawned."
      }

      const summaryLines = [
        "",
        "## Swarm-first Execution",
        "",
        `Team: ${teamName}`,
        `Plan: ${planName}`,
        `Tasks synced: created ${sync.created.length}, skipped ${sync.skipped.length}`,
        targetWorkers > 0 ? `Workers: spawned ${spawned} (target ${targetWorkers})` : "Workers: disabled (worker_count=0)",
        "",
        `Monitor: /swarm status ${teamName}`,
        `Stop: /swarm stop --cleanup`,
        workerNote ? `Note: ${workerNote}` : "",
      ].filter(Boolean)

      appendText(output, summaryLines.join("\n"))
      startedBySession.add(input.sessionID)
    },
  }
}
