import type { PluginInput } from "@opencode-ai/plugin"
import { execFileSync } from "node:child_process"
import { existsSync, copyFileSync, symlinkSync, mkdirSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { log } from "../../shared/logger"

export const HOOK_NAME = "tmux-parallel-agents"

interface CommandOptions {
  cwd?: string
  timeout?: number
  stdio?: "ignore" | "pipe" | "inherit"
}

function runCommand(command: string, args: string[], options?: CommandOptions): string {
  const output = execFileSync(command, args, {
    cwd: options?.cwd,
    timeout: options?.timeout,
    stdio: options?.stdio ?? "pipe",
    encoding: "utf8",
  })
  return typeof output === "string" ? output.trim() : ""
}

function runTmux(args: string[], options?: CommandOptions): string {
  return runCommand("tmux", args, options)
}

function runGit(args: string[], options?: CommandOptions): string {
  return runCommand("git", args, options)
}

/**
 * Check if we're running inside a tmux session
 */
function isInsideTmux(): boolean {
  return !!process.env.TMUX
}

/**
 * Check if tmux binary is available
 */
function hasTmuxBinary(): boolean {
  try {
    runCommand("which", ["tmux"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Check if inside a git repository
 */
function isGitRepo(dir: string): boolean {
  try {
    runGit(["rev-parse", "--git-dir"], { cwd: dir, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Get current tmux session name
 */
function getCurrentSession(): string | null {
  if (!isInsideTmux()) return null
  try {
    return runTmux(["display-message", "-p", "#S"])
  } catch {
    return null
  }
}

/**
 * Create a slug from task description for window/branch naming
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
}

/**
 * Status detection patterns from parallel-agents skill
 */
const STATUS_PATTERNS = {
  error: /(error|exception|traceback|FAILED|Permission denied)/i,
  waiting: /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|approve|confirm|AskUserQuestion)/i,
  working: /(Reading|Writing|Bash\(|executing|processing|Searching)/i,
}

/**
 * Detect agent status from pane content
 */
function detectStatus(content: string): "error" | "waiting" | "working" | "done" | "idle" {
  const promptRe = /^[A-Za-z0-9_@:/~._ -]*[$>]\s*$/

  // Priority: error > waiting > working > done > idle
  if (STATUS_PATTERNS.error.test(content)) return "error"
  if (STATUS_PATTERNS.waiting.test(content)) return "waiting"
  if (STATUS_PATTERNS.working.test(content)) return "working"

  // Check if last non-empty line matches shell prompt
  const lines = content.split("\n").filter((l) => l.trim())
  const lastLine = lines[lines.length - 1] || ""
  if (promptRe.test(lastLine)) return "done"

  return "idle"
}

/**
 * Capture pane content
 */
function capturePaneContent(target: string, lines = 50): string | null {
  try {
    return runTmux(["capture-pane", "-t", target, "-p", "-S", `-${lines}`], {
      timeout: 5000,
    })
  } catch {
    return null
  }
}

/**
 * Send keys to a tmux pane
 */
function sendKeys(target: string, keys: string): boolean {
  try {
    runTmux(["send-keys", "-t", target, keys], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export interface TmuxParallelAgentsConfig {
  enabled?: boolean
  layout?: "main-vertical" | "main-horizontal" | "tiled" | "even-horizontal" | "even-vertical"
  auto_rescue?: boolean
  rescue_interval_ms?: number
  status_icons?: {
    waiting?: string
    working?: string
    done?: string
    error?: string
    idle?: string
  }
  // Worktree settings
  worktree?: {
    enabled?: boolean
    /** Directory pattern for worktrees, {project} replaced with project name */
    dir_pattern?: string
    /** Files to copy to worktree (e.g., .env, .env.local) */
    copy_files?: string[]
    /** Files/dirs to symlink (e.g., node_modules, vendor) */
    symlink?: string[]
    /** Auto-cleanup worktree on session end (false = keep for manual merge) */
    auto_cleanup?: boolean
  }
}

interface SessionInfo {
  windowId: string
  windowIndex: string
  windowName: string
  paneTarget: string
  taskId: string
  sessionID: string
  branchName: string
  worktreePath: string | null
  createdAt: Date
}

export interface TmuxParallelAgentsHook {
  "tool.execute.before": (
    input: { tool: string; sessionID?: string },
    output: { args: Record<string, unknown> }
  ) => Promise<void>
  event: (input: {
    type?: string
    event?: { type: string; properties?: Record<string, unknown> }
  }) => Promise<void>
  getActiveWindows: () => Map<string, SessionInfo>
  triggerRescue: () => void
  cleanup: () => void
  listWorktrees: () => Array<{ taskId: string; branch: string; path: string | null }>
}

export interface TmuxParallelAgentsDependencies {
  resolveTaskIdBySessionID?: (sessionID: string) => string | undefined
}

function createDisabledHook(): TmuxParallelAgentsHook {
  return {
    "tool.execute.before": async () => {},
    event: async () => {},
    getActiveWindows: () => new Map(),
    triggerRescue: () => {},
    cleanup: () => {},
    listWorktrees: () => [],
  }
}

/**
 * Tmux Parallel Agents Hook
 *
 * Automatically creates tmux windows and git worktrees for background agent sessions.
 * Integrates with BackgroundManager lifecycle.
 *
 * **Concurrency note**: This hook is a pure infrastructure layer for tmux windows and
 * git worktrees.  It does NOT acquire parallel-runtime slots itself because the
 * underlying BackgroundManager already does so for every background task it launches.
 * Manual "Option A" worktrees (user-created outside of /start-work or delegate_task)
 * are intentionally uncontrolled — they bypass global slot limits by design so that
 * power users retain full manual control.
 *
 * Features:
 * - Auto-create git worktree for file system isolation
 * - Auto-create tmux window (wm-* naming convention)
 * - Status detection (waiting/working/done/error/idle)
 * - Optional auto-rescue for stuck agents
 * - Configurable cleanup on session end
 */
export function createTmuxParallelAgentsHook(
  ctx: PluginInput,
  config?: TmuxParallelAgentsConfig,
  dependencies?: TmuxParallelAgentsDependencies
): TmuxParallelAgentsHook {
  // Skip if not in tmux or tmux not available
  if (!isInsideTmux() || !hasTmuxBinary()) {
    log(`[${HOOK_NAME}] Disabled: not in tmux or tmux binary not found`)
    return createDisabledHook()
  }

  const detectedSessionName = getCurrentSession()
  if (!detectedSessionName) {
    log(`[${HOOK_NAME}] Disabled: could not determine tmux session`)
    return createDisabledHook()
  }
  const sessionName: string = detectedSessionName

  const projectDir = ctx.directory
  const projectName = basename(projectDir)
  const worktreeEnabled = config?.worktree?.enabled ?? false
  const worktreeDirPattern = config?.worktree?.dir_pattern ?? "../{project}__worktrees"
  const copyFiles = config?.worktree?.copy_files ?? [".env", ".env.local"]
  const symlinkPaths = config?.worktree?.symlink ?? ["node_modules", ".sisyphus"]
  const autoCleanup = config?.worktree?.auto_cleanup ?? false

  // Track active windows
  const activeWindows = new Map<string, SessionInfo>()

  // Rescue interval
  let rescueInterval: ReturnType<typeof setInterval> | undefined
  const rescueIntervalMs = config?.rescue_interval_ms ?? 10000

  const statusIcons = {
    waiting: config?.status_icons?.waiting ?? "...",
    working: config?.status_icons?.working ?? ">>>",
    done: config?.status_icons?.done ?? "OK",
    error: config?.status_icons?.error ?? "ERR",
    idle: config?.status_icons?.idle ?? "",
  }

  /**
   * Get worktree base directory
   */
  function getWorktreeBaseDir(): string {
    const pattern = worktreeDirPattern.replace("{project}", projectName)
    return join(dirname(projectDir), pattern.replace(/^\.\.\//, ""))
  }

  /**
   * Create a git worktree for isolated development
   */
  function createWorktree(branchName: string): string | null {
    if (!worktreeEnabled || !isGitRepo(projectDir)) {
      return null
    }

    const baseDir = getWorktreeBaseDir()
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
      runGit(["worktree", "add", "-b", branchName, worktreePath], {
        cwd: projectDir,
        timeout: 30000,
      })

      log(`[${HOOK_NAME}] Created worktree`, { branchName, worktreePath })

      // Copy files
      for (const file of copyFiles) {
        const src = join(projectDir, file)
        const dest = join(worktreePath, file)
        if (existsSync(src)) {
          try {
            copyFileSync(src, dest)
            log(`[${HOOK_NAME}] Copied file`, { file })
          } catch (err) {
            log(`[${HOOK_NAME}] Failed to copy file`, { file, error: err })
          }
        }
      }

      // Create symlinks
      for (const path of symlinkPaths) {
        const src = join(projectDir, path)
        const dest = join(worktreePath, path)
        const shouldLinkEvenIfMissing = path === ".sisyphus"
        if (!existsSync(dest) && (shouldLinkEvenIfMissing || existsSync(src))) {
          try {
            const destParent = dirname(dest)
            if (!existsSync(destParent)) {
              mkdirSync(destParent, { recursive: true })
            }
            symlinkSync(src, dest)
            log(`[${HOOK_NAME}] Created symlink`, { path })
          } catch (err) {
            log(`[${HOOK_NAME}] Failed to create symlink`, { path, error: err })
          }
        }
      }

      return worktreePath
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to create worktree`, { branchName, error })
      return null
    }
  }

  /**
   * Remove a git worktree
   */
  function removeWorktree(branchName: string, worktreePath: string): void {
    if (!worktreeEnabled || !autoCleanup) return

    try {
      // Remove worktree
      runGit(["worktree", "remove", worktreePath, "--force"], {
        cwd: projectDir,
        timeout: 30000,
      })

      // Delete branch
      runGit(["branch", "-D", branchName], {
        cwd: projectDir,
        timeout: 5000,
      })

      log(`[${HOOK_NAME}] Removed worktree and branch`, { branchName, worktreePath })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to remove worktree`, { branchName, error })
    }
  }

  /**
   * Create a tmux window for a background task
   */
  function listTmuxWindows(): Array<{ id: string; index: string; name: string }> {
    try {
      const output = runTmux(["list-windows", "-t", sessionName, "-F", "#{window_id}:#I:#W"], {
        timeout: 5000,
      })
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const firstSeparator = line.indexOf(":")
          if (firstSeparator === -1) return null
          const secondSeparator = line.indexOf(":", firstSeparator + 1)
          if (secondSeparator === -1) return null
          return {
            id: line.slice(0, firstSeparator),
            index: line.slice(firstSeparator + 1, secondSeparator),
            name: line.slice(secondSeparator + 1),
          }
        })
        .filter((window): window is { id: string; index: string; name: string } => window !== null)
    } catch {
      return []
    }
  }

  function setWindowOption(target: string, option: string, value: string): void {
    runTmux(["set-option", "-w", "-t", target, option, value], {
      timeout: 5000,
      stdio: "ignore",
    })
  }

  function getWindowOption(target: string, option: string): string | null {
    try {
      const output = runTmux(["show-options", "-w", "-v", "-t", target, option], {
        timeout: 5000,
      })
      return output.length > 0 ? output : null
    } catch {
      return null
    }
  }

  function findWindowBySessionId(sessionID: string): { id: string; index: string; name: string } | null {
    const windows = listTmuxWindows()
    for (const window of windows) {
      const optionValue = getWindowOption(window.id, "@omo_session_id")
      if (optionValue === sessionID) {
        return window
      }
    }
    return null
  }

  function createWindow(
    taskId: string,
    description: string,
    agentSessionID: string,
    worktreePath: string | null,
    branchName: string
  ): SessionInfo | null {
    const slug = slugify(description)
    const windowName = `wm-${slug}-${taskId.slice(0, 6)}`
    const workDir = worktreePath || projectDir
    let createdWindowId: string | null = null

    try {
      // Create new window in the appropriate directory
      const createdWindowInfo = runTmux(
        [
          "new-window",
          "-t",
          sessionName,
          "-n",
          windowName,
          "-c",
          workDir,
          "-d",
          "-P",
          "-F",
          "#{window_id}:#I:#{pane_id}",
        ],
        {
          timeout: 5000,
          stdio: "pipe",
        }
      )

      const [windowId, windowIndex, paneId] = createdWindowInfo.split(":")
      if (!windowId || !windowIndex || !paneId) {
        throw new Error(`Invalid tmux new-window output: ${createdWindowInfo}`)
      }
      createdWindowId = windowId
      const windowTarget = windowId
      const paneTarget = paneId

      // Set status/metadata options for robust recovery and observability.
      setWindowOption(windowTarget, "@workmux_status", statusIcons.working)
      setWindowOption(windowTarget, "@omo_task_id", taskId)
      setWindowOption(windowTarget, "@omo_session_id", agentSessionID)
      setWindowOption(windowTarget, "@omo_branch", branchName)
      if (worktreePath) {
        setWindowOption(windowTarget, "@omo_worktree", worktreePath)
      }

      // Display task info in the pane
      runTmux(["send-keys", "-t", paneTarget, `# Task: ${description}`, "Enter"], { timeout: 5000 })
      runTmux(["send-keys", "-t", paneTarget, `# Session: ${agentSessionID}`, "Enter"], { timeout: 5000 })
      if (worktreePath) {
        runTmux(["send-keys", "-t", paneTarget, `# Branch: ${branchName}`, "Enter"], { timeout: 5000 })
        runTmux(["send-keys", "-t", paneTarget, `# Worktree: ${worktreePath}`, "Enter"], { timeout: 5000 })
      }
      runTmux(["send-keys", "-t", paneTarget, "# Waiting for agent output...", "Enter"], {
        timeout: 5000,
      })

      const info: SessionInfo = {
        windowId,
        windowIndex,
        windowName,
        paneTarget,
        taskId,
        sessionID: agentSessionID,
        branchName,
        worktreePath,
        createdAt: new Date(),
      }

      activeWindows.set(taskId, info)

      log(`[${HOOK_NAME}] Created window`, { windowName, paneTarget, taskId, worktreePath })
      return info
    } catch (error) {
      if (createdWindowId) {
        try {
          runTmux(["kill-window", "-t", createdWindowId], {
            timeout: 5000,
            stdio: "ignore",
          })
        } catch {
          // Best-effort rollback; ignore secondary cleanup failure.
        }
      }
      log(`[${HOOK_NAME}] Failed to create window`, { error, taskId })
      return null
    }
  }

  /**
   * Update window status icon
   */
  function updateWindowStatus(info: SessionInfo, status: string): void {
    const icon = statusIcons[status as keyof typeof statusIcons] ?? ""
    try {
      setWindowOption(info.windowId, "@workmux_status", icon)
    } catch {
      // Window may have been closed
    }
  }

  /**
   * Close a tmux window and optionally cleanup worktree
   */
  function closeWindow(taskId: string): void {
    const info = activeWindows.get(taskId)
    if (!info) return

    try {
      runTmux(["kill-window", "-t", info.windowId], {
        timeout: 5000,
        stdio: "ignore",
      })
    } catch {
      // Window may already be closed
    }

    // Cleanup worktree if auto_cleanup enabled
    if (info.worktreePath && autoCleanup) {
      removeWorktree(info.branchName, info.worktreePath)
    }

    activeWindows.delete(taskId)
    log(`[${HOOK_NAME}] Closed window`, { windowName: info.windowName, taskId })

    if (activeWindows.size === 0) {
      stopRescuePolling()
    }
  }

  /**
   * Check and rescue stuck agents
   */
  function checkAndRescue(): void {
    if (!config?.auto_rescue) return

    for (const [taskId, info] of activeWindows) {
      const content = capturePaneContent(info.paneTarget, 30)
      if (!content) continue

      const status = detectStatus(content)
      updateWindowStatus(info, status)

      if (status === "waiting") {
        if (STATUS_PATTERNS.waiting.test(content)) {
          log(`[${HOOK_NAME}] Auto-rescuing stuck task`, { taskId, windowName: info.windowName })
          sendKeys(info.paneTarget, "y")
          sendKeys(info.paneTarget, "Enter")
        }
      }
    }
  }

  /**
   * Start rescue polling if auto_rescue enabled
   */
  function startRescuePolling(): void {
    if (rescueInterval || !config?.auto_rescue) return
    rescueInterval = setInterval(checkAndRescue, rescueIntervalMs)
    rescueInterval.unref()
  }

  /**
   * Stop rescue polling
   */
  function stopRescuePolling(): void {
    if (rescueInterval) {
      clearInterval(rescueInterval)
      rescueInterval = undefined
    }
  }

  type PendingWorktreeInfo = {
    taskId: string
    branchName: string
    worktreePath: string | null
    description: string
    createdAt: number
  }

  function matchesPendingTitle(pendingDescription: string, sessionTitle: string): boolean {
    const normalizedDescription = pendingDescription.trim()
    const normalizedTitle = sessionTitle.trim()
    return (
      normalizedDescription === normalizedTitle ||
      `Background: ${normalizedDescription}` === normalizedTitle
    )
  }

  // Store pending worktree info for session.created mapping.
  // Use queue per parent session to avoid overwriting when multiple
  // background tasks are launched concurrently from one parent.
  const pendingWorktrees = new Map<string, PendingWorktreeInfo[]>()
  const PENDING_WORKTREE_TTL_MS = 60000 // 1 minute TTL for pending entries

  /**
   * Clean up stale pending worktree entries
   */
  function cleanupStalePendingWorktrees(): void {
    const now = Date.now()
    for (const [key, queue] of pendingWorktrees) {
      const activeQueue: PendingWorktreeInfo[] = []
      for (const pending of queue) {
        if (now - pending.createdAt > PENDING_WORKTREE_TTL_MS) {
          log(`[${HOOK_NAME}] Cleaning up stale pending worktree`, { key, branchName: pending.branchName })
          if (pending.worktreePath && autoCleanup) {
            removeWorktree(pending.branchName, pending.worktreePath)
          }
          continue
        }
        activeQueue.push(pending)
      }

      if (activeQueue.length === 0) {
        pendingWorktrees.delete(key)
      } else {
        pendingWorktrees.set(key, activeQueue)
      }
    }
  }

  function consumePendingWorktreeByTaskId(taskId: string): PendingWorktreeInfo | null {
    for (const [key, queue] of pendingWorktrees) {
      const index = queue.findIndex((pending) => pending.taskId === taskId)
      if (index === -1) continue
      const pending = queue[index]!
      queue.splice(index, 1)
      if (queue.length === 0) {
        pendingWorktrees.delete(key)
      } else {
        pendingWorktrees.set(key, queue)
      }
      return pending
    }
    return null
  }

  return {
    /**
     * Hook into delegate_task to create worktree for background tasks
     */
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      // Only handle delegate_task with run_in_background=true
      if (input.tool !== "delegate_task") return

      const args = output.args
      const runInBackground = args.run_in_background as boolean | undefined
      if (!runInBackground) return

      const description = (args.description as string) || "background-task"
      const slug = slugify(description)
      const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const branchName = `wm/${slug}-${taskId.slice(0, 8)}`

      // Create worktree if enabled
      const worktreePath = createWorktree(branchName)

      // Store for session.created mapping (with timestamp for TTL cleanup)
      const sessionIdHint = input.sessionID || "unknown"
      const queue = pendingWorktrees.get(sessionIdHint) ?? []
      queue.push({ taskId, branchName, worktreePath, description, createdAt: Date.now() })
      pendingWorktrees.set(sessionIdHint, queue)

      // If worktree was created, modify the working directory in args
      if (worktreePath) {
        // Store worktree info in args for the delegate_task to use
        ;(output.args as Record<string, unknown>).__worktree_path = worktreePath
        ;(output.args as Record<string, unknown>).__worktree_branch = branchName
      }
      ;(output.args as Record<string, unknown>).__tmux_task_id = taskId

      log(`[${HOOK_NAME}] Prepared background task`, {
        taskId,
        branchName,
        worktreePath,
        description,
      })
    },

    /**
     * Handle session lifecycle events
     */
    event: async (input: {
      type?: string
      event?: { type: string; properties?: Record<string, unknown> }
    }): Promise<void> => {
      const eventType = input.event?.type || input.type
      const props = input.event?.properties

      // Handle session.created - create window for subagent sessions
      if (eventType === "session.created") {
        // Clean up stale pending entries first
        cleanupStalePendingWorktrees()

        const sessionInfo = props?.info as { id?: string; parentID?: string; title?: string } | undefined
        if (!sessionInfo?.id || !sessionInfo.parentID) return // Only for subagents

        const title = sessionInfo.title || "Background task"
        const resolvedTaskId = dependencies?.resolveTaskIdBySessionID?.(sessionInfo.id)
        let taskId = resolvedTaskId || sessionInfo.id.slice(0, 8)

        // Check for pending worktree from tool.execute.before
        let worktreePath: string | null = null
        let branchName = `wm/${slugify(title)}-${taskId}`
        const pendingByTaskId =
          resolvedTaskId && resolvedTaskId.length > 0
            ? consumePendingWorktreeByTaskId(resolvedTaskId)
            : null

        if (pendingByTaskId) {
          taskId = pendingByTaskId.taskId
          worktreePath = pendingByTaskId.worktreePath
          branchName = pendingByTaskId.branchName
        }

        if (!pendingByTaskId) {
          // Consume queued pending worktree entry by parent session first.
          const parentQueue = pendingWorktrees.get(sessionInfo.parentID)
          if (parentQueue && parentQueue.length > 0) {
            const matchedIndex = parentQueue.findIndex((pending) =>
              matchesPendingTitle(pending.description, title)
            )
            const pending =
              matchedIndex >= 0
                ? parentQueue.splice(matchedIndex, 1)[0]!
                : parentQueue.shift()!
            taskId = pending.taskId
            worktreePath = pending.worktreePath
            branchName = pending.branchName
            if (parentQueue.length === 0) {
              pendingWorktrees.delete(sessionInfo.parentID)
            } else {
              pendingWorktrees.set(sessionInfo.parentID, parentQueue)
            }
          } else {
            // Fallback by description for legacy/best-effort matching.
            for (const [key, queue] of pendingWorktrees) {
              const index = queue.findIndex((pending) => matchesPendingTitle(pending.description, title))
              if (index === -1) continue
              const pending = queue[index]!
              queue.splice(index, 1)
              taskId = pending.taskId
              worktreePath = pending.worktreePath
              branchName = pending.branchName
              if (queue.length === 0) {
                pendingWorktrees.delete(key)
              } else {
                pendingWorktrees.set(key, queue)
              }
              break
            }
          }
        }

        createWindow(taskId, title, sessionInfo.id, worktreePath, branchName)
        startRescuePolling()
      }

      // Handle session.idle - update status
      if (eventType === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        for (const [taskId, info] of activeWindows) {
          if (info.sessionID === sessionID) {
            const content = capturePaneContent(info.paneTarget, 30)
            if (content) {
              const status = detectStatus(content)
              updateWindowStatus(info, status === "idle" ? "done" : status)
            }
            break
          }
        }
      }

      // Handle session.deleted - cleanup window
      if (eventType === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (!sessionInfo?.id) return

        let scheduledCleanup = false
        for (const [taskId, info] of activeWindows) {
          if (info.sessionID === sessionInfo.id) {
            // Keep window for a bit to show final status
            const delayedClose = setTimeout(() => closeWindow(taskId), 5000)
            delayedClose.unref?.()
            scheduledCleanup = true
            break
          }
        }

        if (!scheduledCleanup) {
          const recoveredWindow = findWindowBySessionId(sessionInfo.id)
          if (recoveredWindow) {
            try {
              runTmux(["kill-window", "-t", recoveredWindow.id], {
                timeout: 5000,
                stdio: "ignore",
              })
              log(`[${HOOK_NAME}] Recovered orphan tmux window by session id`, {
                sessionID: sessionInfo.id,
                windowIndex: recoveredWindow.index,
                windowId: recoveredWindow.id,
              })
            } catch (error) {
              log(`[${HOOK_NAME}] Failed to recover orphan tmux window`, {
                sessionID: sessionInfo.id,
                error,
              })
            }
          }
        }
      }
    },

    /**
     * Get status of all active windows (for debugging/inspection)
     */
    getActiveWindows(): Map<string, SessionInfo> {
      return new Map(activeWindows)
    },

    /**
     * Manually trigger rescue check
     */
    triggerRescue(): void {
      checkAndRescue()
    },

    /**
     * Cleanup all windows and pending worktrees (for shutdown)
     */
    cleanup(): void {
      stopRescuePolling()
      for (const taskId of activeWindows.keys()) {
        closeWindow(taskId)
      }
      // Clean up any remaining pending worktrees
      for (const [key, queue] of pendingWorktrees) {
        for (const pending of queue) {
          if (pending.worktreePath && autoCleanup) {
            removeWorktree(pending.branchName, pending.worktreePath)
          }
        }
        pendingWorktrees.delete(key)
      }
      pendingWorktrees.clear()
    },

    /**
     * List all worktrees (for inspection)
     */
    listWorktrees(): Array<{ taskId: string; branch: string; path: string | null }> {
      return Array.from(activeWindows.entries()).map(([taskId, info]) => ({
        taskId,
        branch: info.branchName,
        path: info.worktreePath,
      }))
    },
  }
}
