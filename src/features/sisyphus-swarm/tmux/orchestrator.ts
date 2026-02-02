import { basename, dirname, join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  isInsideTmux,
  hasTmuxBinary,
  getCurrentSession,
  slugify,
  createTmuxWindow,
  closeTmuxWindow,
  renameTmuxWindow,
  setWindowOption,
  listTmuxWindows,
  capturePaneContent,
  detectStatus,
  sendKeys,
  createGitWorktree,
  removeGitWorktree,
  getOpenCodeSwarmCommand,
} from "./utils"
import { readManifest, getWorkers } from "../team"
import type { AgentIdentity, AgentStatus } from "../team/types"

/**
 * Window info tracked by orchestrator
 */
export interface SwarmWindowInfo {
  agentId: string
  agentName: string
  role: "coordinator" | "worker"
  windowIndex: string
  windowName: string
  paneTarget: string
  worktreePath: string | null
  branchName: string
  createdAt: number
  status: AgentStatus | "unknown"
}

/**
 * Swarm orchestrator configuration
 */
export interface SwarmOrchestratorConfig {
  /** Project directory */
  projectDir: string
  /** Enable git worktree isolation */
  worktreeEnabled?: boolean
  /** Worktree base directory pattern */
  worktreeDirPattern?: string
  /** Files to copy to worktree */
  copyFiles?: string[]
  /** Paths to symlink */
  symlinkPaths?: string[]
  /** Status icons for tmux windows */
  statusIcons?: {
    joining?: string
    idle?: string
    working?: string
    paused?: string
    leaving?: string
    dead?: string
  }
  /** Auto-rescue stuck agents */
  autoRescue?: boolean
  /** Rescue check interval in ms */
  rescueIntervalMs?: number
}

/**
 * Tmux orchestrator for Swarm
 *
 * Manages tmux windows and git worktrees for Swarm agents.
 */
export class SwarmOrchestrator {
  private config: Partial<OhMyOpenCodeConfig>
  private orchestratorConfig: SwarmOrchestratorConfig
  private sessionName: string
  private windows: Map<string, SwarmWindowInfo> = new Map()
  private rescueInterval: ReturnType<typeof setInterval> | null = null

  private statusIcons = {
    joining: "...",
    idle: "○",     // Ready/available (not paused)
    working: "▶",
    paused: "⏳",   // Paused waiting for input
    leaving: "←",
    dead: "✗",
    unknown: "?",
  }

  constructor(
    orchestratorConfig: SwarmOrchestratorConfig,
    config: Partial<OhMyOpenCodeConfig>
  ) {
    this.orchestratorConfig = orchestratorConfig
    this.config = config

    // Override status icons if provided
    if (orchestratorConfig.statusIcons) {
      this.statusIcons = { ...this.statusIcons, ...orchestratorConfig.statusIcons }
    }

    // Get tmux session name
    const session = getCurrentSession()
    if (!session) {
      throw new Error("Not running inside tmux")
    }
    this.sessionName = session
  }

  /**
   * Check if tmux is available
   */
  static isAvailable(): boolean {
    return isInsideTmux() && hasTmuxBinary()
  }

  /**
   * Get worktree base directory
   */
  private getWorktreeBaseDir(): string {
    const { projectDir, worktreeDirPattern } = this.orchestratorConfig
    const projectName = basename(projectDir)
    const pattern = (worktreeDirPattern ?? "../{project}__swarm").replace("{project}", projectName)
    return join(dirname(projectDir), pattern.replace(/^\.\.\//, ""))
  }

  /**
   * Create a tmux window for an agent
   */
  createAgentWindow(options: {
    teamName: string
    agentId: string
    agentName: string
    role: "coordinator" | "worker"
    command?: string
  }): SwarmWindowInfo | null {
    const { teamName, agentId, agentName, role, command } = options
    const { projectDir, worktreeEnabled, copyFiles, symlinkPaths } = this.orchestratorConfig

    // Generate names
    const slug = slugify(`${role}-${agentName}`)
    const windowName = `swarm-${slug}-${agentId.slice(-6)}`
    const branchName = `swarm/${teamName}/${slug}`

    // Create worktree if enabled
    let worktreePath: string | null = null
    if (worktreeEnabled) {
      worktreePath = createGitWorktree({
        projectDir,
        branchName,
        baseDir: this.getWorktreeBaseDir(),
        copyFiles: copyFiles ?? [".env", ".env.local"],
        symlinkPaths: symlinkPaths ?? ["node_modules"],
      })
    }

    const workDir = worktreePath || projectDir

    // Build command if not provided
    // Pass projectRoot for worktree mode so all agents share the same .sisyphus
    const agentCommand = command ?? getOpenCodeSwarmCommand({
      teamName,
      agentName,
      role,
      agentId,
      projectRoot: worktreeEnabled ? projectDir : undefined,
    })

    // Create tmux window
    const result = createTmuxWindow({
      sessionName: this.sessionName,
      windowName,
      workDir,
      command: agentCommand,
    })

    if (!result) {
      // Cleanup worktree if window creation failed
      if (worktreePath) {
        removeGitWorktree(projectDir, branchName, worktreePath)
      }
      return null
    }

    const info: SwarmWindowInfo = {
      agentId,
      agentName,
      role,
      windowIndex: result.windowIndex,
      windowName,
      paneTarget: result.paneTarget,
      worktreePath,
      branchName,
      createdAt: Date.now(),
      status: "joining",
    }

    // Set initial status icon
    this.updateWindowStatus(info, "joining")

    // Track window
    this.windows.set(agentId, info)

    return info
  }

  /**
   * Close an agent's window
   */
  closeAgentWindow(agentId: string, cleanup = false): boolean {
    const info = this.windows.get(agentId)
    if (!info) {
      return false
    }

    // Close tmux window by index (more reliable than by name)
    closeTmuxWindow(this.sessionName, info.windowIndex)

    // Cleanup worktree if requested
    if (cleanup && info.worktreePath) {
      removeGitWorktree(
        this.orchestratorConfig.projectDir,
        info.branchName,
        info.worktreePath
      )
    }

    this.windows.delete(agentId)
    return true
  }

  /**
   * Update window status icon
   */
  updateWindowStatus(info: SwarmWindowInfo, status: AgentStatus | "unknown"): void {
    info.status = status
    const icon = this.statusIcons[status] ?? "?"

    // Update window name with status
    const newName = `${icon} ${info.windowName.replace(/^[^\s]+ /, "")}`
    renameTmuxWindow(`${this.sessionName}:${info.windowIndex}`, newName)

    // Set tmux option for external tools
    setWindowOption(
      `${this.sessionName}:${info.windowIndex}`,
      "@swarm_status",
      status
    )
  }

  /**
   * Update all window statuses from pane content
   */
  updateAllStatuses(): void {
    for (const [agentId, info] of this.windows) {
      const content = capturePaneContent(info.paneTarget, 30)
      if (content) {
        const detected = detectStatus(content)
        const status = this.mapDetectedStatus(detected)
        if (status !== info.status) {
          this.updateWindowStatus(info, status)
        }
      }
    }
  }

  /**
   * Map detected status to agent status
   */
  private mapDetectedStatus(detected: ReturnType<typeof detectStatus>): AgentStatus {
    switch (detected) {
      case "error":
        return "dead"
      case "paused":
        return "paused"
      case "working":
        return "working"
      case "done":
        return "idle"
      case "idle":
        return "idle"
      default:
        return "idle"
    }
  }

  /**
   * Rescue stuck agents (send 'y' to y/n prompts)
   */
  rescueStuckAgents(): number {
    let rescued = 0

    for (const [agentId, info] of this.windows) {
      const content = capturePaneContent(info.paneTarget, 30)
      if (!content) continue

      // Check for y/n prompt
      if (/\(y\/n\)|\[Y\/n\]|\[y\/N\]/i.test(content)) {
        sendKeys(info.paneTarget, "y")
        sendKeys(info.paneTarget, "Enter")
        rescued++
      }
    }

    return rescued
  }

  /**
   * Start auto-rescue polling
   */
  startAutoRescue(): void {
    if (this.rescueInterval) return
    if (!this.orchestratorConfig.autoRescue) return

    const intervalMs = this.orchestratorConfig.rescueIntervalMs ?? 10000

    this.rescueInterval = setInterval(() => {
      this.updateAllStatuses()
      this.rescueStuckAgents()
    }, intervalMs)

    // Don't prevent process exit
    this.rescueInterval.unref()
  }

  /**
   * Stop auto-rescue polling
   */
  stopAutoRescue(): void {
    if (this.rescueInterval) {
      clearInterval(this.rescueInterval)
      this.rescueInterval = null
    }
  }

  /**
   * Get all tracked windows
   */
  getWindows(): SwarmWindowInfo[] {
    return Array.from(this.windows.values())
  }

  /**
   * Get window by agent ID
   */
  getWindow(agentId: string): SwarmWindowInfo | null {
    return this.windows.get(agentId) ?? null
  }

  /**
   * Spawn multiple worker windows
   */
  spawnWorkers(options: {
    teamName: string
    count: number
    namePrefix?: string
  }): SwarmWindowInfo[] {
    const { teamName, count, namePrefix = "worker" } = options
    const results: SwarmWindowInfo[] = []

    for (let i = 0; i < count; i++) {
      const agentId = `agent_spawn_${Date.now()}_${i}`
      const agentName = `${namePrefix}-${i + 1}`

      const info = this.createAgentWindow({
        teamName,
        agentId,
        agentName,
        role: "worker",
      })

      if (info) {
        results.push(info)
      }
    }

    return results
  }

  /**
   * Get team status summary for display
   */
  getStatusSummary(teamName: string): string {
    const manifest = readManifest(teamName, this.config)
    if (!manifest) {
      return `Team "${teamName}" not found`
    }

    const lines: string[] = [
      `Team: ${teamName}`,
      `Members: ${manifest.members.length}`,
      "",
      "Agents:",
    ]

    for (const member of manifest.members) {
      const window = this.windows.get(member.id)
      const status = window?.status ?? "unknown"
      const icon = this.statusIcons[status] ?? "?"
      const role = member.id === manifest.coordinatorId ? "[C]" : "[W]"

      lines.push(`  ${icon} ${role} ${member.name} (${member.id.slice(-6)})`)
    }

    return lines.join("\n")
  }

  /**
   * Cleanup all windows
   */
  cleanup(removeWorktrees = false): void {
    this.stopAutoRescue()

    for (const agentId of this.windows.keys()) {
      this.closeAgentWindow(agentId, removeWorktrees)
    }
  }
}

/**
 * Create a swarm orchestrator (factory function)
 */
export function createSwarmOrchestrator(
  projectDir: string,
  config: Partial<OhMyOpenCodeConfig>
): SwarmOrchestrator | null {
  if (!SwarmOrchestrator.isAvailable()) {
    return null
  }

  const tmuxConfig = config.tmux_parallel_agents

  return new SwarmOrchestrator(
    {
      projectDir,
      worktreeEnabled: tmuxConfig?.worktree?.enabled ?? false,
      worktreeDirPattern: tmuxConfig?.worktree?.dir_pattern,
      copyFiles: tmuxConfig?.worktree?.copy_files,
      symlinkPaths: tmuxConfig?.worktree?.symlink,
      autoRescue: tmuxConfig?.auto_rescue ?? false,
      rescueIntervalMs: tmuxConfig?.rescue_interval_ms,
      statusIcons: tmuxConfig?.status_icons as SwarmOrchestratorConfig["statusIcons"],
    },
    config
  )
}
