import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs"
import { join, basename, dirname } from "node:path"

/**
 * Check if we're running inside a tmux session
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX
}

/**
 * Check if tmux binary is available
 */
export function hasTmuxBinary(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Check if inside a git repository
 */
export function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Get current tmux session name
 */
export function getCurrentSession(): string | null {
  if (!isInsideTmux()) return null
  try {
    return execSync("tmux display-message -p '#S'", { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

/**
 * Get current tmux window index
 */
export function getCurrentWindow(): string | null {
  if (!isInsideTmux()) return null
  try {
    return execSync("tmux display-message -p '#I'", { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}

/**
 * Create a slug from text for window/branch naming
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
}

/**
 * Status detection patterns
 */
export const STATUS_PATTERNS = {
  error: /(error|exception|traceback|FAILED|Permission denied)/i,
  paused: /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|approve|confirm|AskUserQuestion)/i,
  working: /(Reading|Writing|Bash\(|executing|processing|Searching)/i,
}

/**
 * Detect agent status from pane content
 */
export function detectStatus(content: string): "error" | "paused" | "working" | "done" | "idle" {
  const promptRe = /^[A-Za-z0-9_@:/~._ -]*[$>]\s*$/

  if (STATUS_PATTERNS.error.test(content)) return "error"
  if (STATUS_PATTERNS.paused.test(content)) return "paused"
  if (STATUS_PATTERNS.working.test(content)) return "working"

  const lines = content.split("\n").filter((l) => l.trim())
  const lastLine = lines[lines.length - 1] || ""
  if (promptRe.test(lastLine)) return "done"

  return "idle"
}

/**
 * Capture pane content
 */
export function capturePaneContent(target: string, lines = 50): string | null {
  try {
    return execSync(`tmux capture-pane -t "${target}" -p -S -${lines}`, {
      encoding: "utf8",
      timeout: 5000,
    })
  } catch {
    return null
  }
}

/**
 * Send keys to a tmux pane
 */
export function sendKeys(target: string, keys: string): boolean {
  try {
    execSync(`tmux send-keys -t "${target}" "${keys}"`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Create a new tmux window
 */
export function createTmuxWindow(options: {
  sessionName: string
  windowName: string
  workDir?: string
  command?: string
}): { windowIndex: string; paneTarget: string } | null {
  const { sessionName, windowName, workDir, command } = options

  try {
    // Build command parts
    let tmuxCmd = `tmux new-window -n "${windowName}"`
    if (workDir) {
      tmuxCmd += ` -c "${workDir}"`
    }
    tmuxCmd += " -d -P -F '#I'"

    // Create window and get index
    const windowIndex = execSync(tmuxCmd, { encoding: "utf8", timeout: 5000 }).trim()
    const paneTarget = `${sessionName}:${windowIndex}.0`

    // Run command if provided
    if (command) {
      execSync(`tmux send-keys -t "${paneTarget}" "${command}" Enter`, { timeout: 5000 })
    }

    return { windowIndex, paneTarget }
  } catch {
    return null
  }
}

/**
 * Close a tmux window by index
 * Sends Ctrl+C first to allow graceful process termination and prevent orphaned processes
 */
export function closeTmuxWindow(sessionName: string, windowIndex: string): boolean {
  const target = `${sessionName}:${windowIndex}`
  try {
    // Send Ctrl+C to trigger graceful exit of running processes
    execSync(`tmux send-keys -t "${target}" C-c`, { timeout: 5000, stdio: "ignore" })
    // Brief delay for graceful shutdown
    execSync("sleep 0.25", { timeout: 1000 })
    // Kill the window
    execSync(`tmux kill-window -t "${target}" 2>/dev/null`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Rename a tmux window
 */
export function renameTmuxWindow(target: string, newName: string): boolean {
  try {
    execSync(`tmux rename-window -t "${target}" "${newName}"`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Set tmux window option
 */
export function setWindowOption(target: string, option: string, value: string): boolean {
  try {
    // Be explicit about window scope to match show-options -w usage.
    execSync(`tmux set-option -w -t "${target}" ${option} "${value}"`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * List all tmux windows in a session
 */
export function listTmuxWindows(sessionName: string): Array<{ index: string; name: string }> {
  try {
    const output = execSync(`tmux list-windows -t "${sessionName}" -F '#I:#W'`, {
      encoding: "utf8",
      timeout: 5000,
    })

    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [index, name] = line.split(":")
        return { index, name }
      })
  } catch {
    return []
  }
}

/**
 * Read a tmux window option value.
 */
export function getTmuxWindowOption(target: string, option: string): string | null {
  try {
    const value = execSync(`tmux show-options -w -v -t "${target}" ${option}`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: "pipe",
    }).trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

export interface SwarmWindowRecoverySummary {
  attempted: number
  closed: number
  matchedByOption: number
  matchedByPane: number
}

export interface SwarmWindowInspectionSummary {
  scanned: number
  matched: number
  matchedByOption: number
  matchedByPane: number
  windowIndexes: string[]
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function getSwarmWindowBaseName(windowName: string): string {
  const trimmed = windowName.trim()
  // Orchestrator prefixes an icon token (e.g. "○ swarm-worker-a") when updating status.
  // If there is no prefix token, this keeps the original window name.
  return trimmed.replace(/^[^\s]+\s+/, "")
}

function isLikelySwarmWindow(windowName: string): boolean {
  return getSwarmWindowBaseName(windowName).startsWith("swarm-")
}

type SwarmRecoveryOverrides = Partial<{
  listTmuxWindows: typeof listTmuxWindows
  getTmuxWindowOption: typeof getTmuxWindowOption
  capturePaneContent: typeof capturePaneContent
  closeTmuxWindow: typeof closeTmuxWindow
}>

/**
 * Inspect tmux windows and find ones that belong to a specific swarm team.
 *
 * Match priority:
 * 1) tmux window option @swarm_team (authoritative)
 * 2) pane content containing OPENCODE_SWARM_TEAM=<teamName> (fallback for legacy windows)
 */
export function inspectSwarmWindowsByTeam(
  sessionName: string,
  teamName: string,
  overrides: SwarmRecoveryOverrides = {}
): SwarmWindowInspectionSummary {
  const listWindows = overrides.listTmuxWindows ?? listTmuxWindows
  const getWindowOption = overrides.getTmuxWindowOption ?? getTmuxWindowOption
  const capturePane = overrides.capturePaneContent ?? capturePaneContent

  const windows = listWindows(sessionName)
  const teamPatternQuoted = new RegExp(`${SWARM_ENV.TEAM}\\s*=\\s*["']${escapeRegExp(teamName)}["']`)
  const teamPatternBare = new RegExp(`${SWARM_ENV.TEAM}\\s*=\\s*${escapeRegExp(teamName)}(?:\\s|$)`)

  const windowIndexes: string[] = []
  let matchedByOption = 0
  let matchedByPane = 0

  for (const window of windows) {
    const target = `${sessionName}:${window.index}`
    const byOption = getWindowOption(target, "@swarm_team")
    if (byOption === teamName) {
      windowIndexes.push(window.index)
      matchedByOption += 1
      continue
    }

    // Fallback only scans swarm-prefixed windows to reduce false positives.
    if (!isLikelySwarmWindow(window.name)) {
      continue
    }

    const paneTarget = `${target}.0`
    const content = capturePane(paneTarget, 200)
    if (!content) {
      continue
    }

    if (teamPatternQuoted.test(content) || teamPatternBare.test(content)) {
      windowIndexes.push(window.index)
      matchedByPane += 1
    }
  }

  return {
    scanned: windows.length,
    matched: windowIndexes.length,
    matchedByOption,
    matchedByPane,
    windowIndexes,
  }
}

/**
 * Best-effort recovery cleanup for swarm windows belonging to a specific team.
 *
 * Match priority:
 * 1) tmux window option @swarm_team (authoritative)
 * 2) pane content containing OPENCODE_SWARM_TEAM=<teamName> (fallback for legacy windows)
 */
export function closeSwarmWindowsByTeam(
  sessionName: string,
  teamName: string,
  overrides: SwarmRecoveryOverrides = {}
): SwarmWindowRecoverySummary {
  const closeWindow = overrides.closeTmuxWindow ?? closeTmuxWindow
  const inspection = inspectSwarmWindowsByTeam(sessionName, teamName, overrides)

  let closed = 0

  for (const windowIndex of inspection.windowIndexes) {
    if (closeWindow(sessionName, windowIndex)) {
      closed += 1
    }
  }

  return {
    attempted: inspection.matched,
    closed,
    matchedByOption: inspection.matchedByOption,
    matchedByPane: inspection.matchedByPane,
  }
}

/**
 * Create a git worktree for isolated development
 */
export function createGitWorktree(options: {
  projectDir: string
  branchName: string
  baseDir: string
  copyFiles?: string[]
  symlinkPaths?: string[]
}): string | null {
  const { projectDir, branchName, baseDir, copyFiles = [], symlinkPaths = [] } = options

  if (!isGitRepo(projectDir)) {
    return null
  }

  const worktreePath = join(baseDir, branchName)

  try {
    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
    // Ensure intermediate directories exist when branchName contains slashes
    const worktreeParent = dirname(worktreePath)
    if (!existsSync(worktreeParent)) {
      mkdirSync(worktreeParent, { recursive: true })
    }

    // Create worktree with new branch
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: projectDir,
      timeout: 30000,
      stdio: "pipe",
    })

    // Copy files
    for (const file of copyFiles) {
      const src = join(projectDir, file)
      const dest = join(worktreePath, file)
      if (existsSync(src)) {
        try {
          copyFileSync(src, dest)
        } catch {
          // Ignore copy errors
        }
      }
    }

    // Create symlinks
    for (const path of symlinkPaths) {
      const src = join(projectDir, path)
      const dest = join(worktreePath, path)
      if (existsSync(src) && !existsSync(dest)) {
        try {
          symlinkSync(src, dest)
        } catch {
          // Ignore symlink errors
        }
      }
    }

    return worktreePath
  } catch {
    return null
  }
}

/**
 * Remove a git worktree
 */
export function removeGitWorktree(
  projectDir: string,
  branchName: string,
  worktreePath: string
): boolean {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: projectDir,
      timeout: 30000,
      stdio: "pipe",
    })

    execSync(`git branch -D "${branchName}"`, {
      cwd: projectDir,
      timeout: 5000,
      stdio: "pipe",
    })

    return true
  } catch {
    return false
  }
}

/**
 * Run a command in a new tmux window and return immediately
 */
export function runInNewWindow(options: {
  sessionName: string
  windowName: string
  command: string
  workDir?: string
}): { windowIndex: string; paneTarget: string } | null {
  return createTmuxWindow({
    sessionName: options.sessionName,
    windowName: options.windowName,
    workDir: options.workDir,
    command: options.command,
  })
}

/**
 * Swarm environment variable names
 */
export const SWARM_ENV = {
  TEAM: "OPENCODE_SWARM_TEAM",
  NAME: "OPENCODE_SWARM_NAME",
  ROLE: "OPENCODE_SWARM_ROLE",
  SESSION: "OPENCODE_SWARM_SESSION",
  AGENT_ID: "OPENCODE_SWARM_AGENT_ID",
  /** Project root for worktree mode - ensures all agents share the same .sisyphus */
  PROJECT_ROOT: "SISYPHUS_PROJECT_ROOT",
} as const

/**
 * Get swarm context from environment variables
 */
export function getSwarmEnvContext(): {
  teamName: string
  agentName: string
  role: "coordinator" | "worker"
  sessionId?: string
  agentId?: string
} | null {
  const teamName = process.env[SWARM_ENV.TEAM]
  const agentName = process.env[SWARM_ENV.NAME]
  const role = process.env[SWARM_ENV.ROLE] as "coordinator" | "worker" | undefined

  if (!teamName || !agentName || !role) {
    return null
  }

  if (role !== "coordinator" && role !== "worker") {
    return null
  }

  return {
    teamName,
    agentName,
    role,
    sessionId: process.env[SWARM_ENV.SESSION],
    agentId: process.env[SWARM_ENV.AGENT_ID],
  }
}

/**
 * Check if running as a swarm agent (via environment variables)
 */
export function isSwarmAgent(): boolean {
  return getSwarmEnvContext() !== null
}

/**
 * Get the CLI command to run opencode with swarm args
 * Uses environment variables so the plugin can detect swarm mode on startup
 */
export function getOpenCodeSwarmCommand(options: {
  teamName: string
  agentName: string
  role: "coordinator" | "worker"
  sessionId?: string
  agentId?: string
  /** Project root for worktree mode - ensures all agents share the same .sisyphus */
  projectRoot?: string
}): string {
  const { teamName, agentName, role, sessionId, agentId, projectRoot } = options

  // Use environment variables for swarm context
  const envVars = [
    `${SWARM_ENV.TEAM}="${teamName}"`,
    `${SWARM_ENV.NAME}="${agentName}"`,
    `${SWARM_ENV.ROLE}="${role}"`,
  ]
  if (sessionId) {
    envVars.push(`${SWARM_ENV.SESSION}="${sessionId}"`)
  }
  if (agentId) {
    envVars.push(`${SWARM_ENV.AGENT_ID}="${agentId}"`)
  }
  if (projectRoot) {
    envVars.push(`${SWARM_ENV.PROJECT_ROOT}="${projectRoot}"`)
  }

  return `${envVars.join(" ")} opencode`
}
