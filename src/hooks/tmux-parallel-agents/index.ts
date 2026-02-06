import type { PluginInput } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import { existsSync, copyFileSync, symlinkSync, mkdirSync, rmSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { log } from "../../shared/logger"

export const HOOK_NAME = "tmux-parallel-agents"

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
    execSync("which tmux", { stdio: "ignore" })
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
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "ignore" })
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
    return execSync("tmux display-message -p '#S'", { encoding: "utf8" }).trim()
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
function sendKeys(target: string, keys: string): boolean {
  try {
    execSync(`tmux send-keys -t "${target}" "${keys}"`, { timeout: 5000 })
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
  windowName: string
  paneTarget: string
  taskId: string
  sessionID: string
  branchName: string
  worktreePath: string | null
  createdAt: Date
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
  config?: TmuxParallelAgentsConfig
) {
  // Skip if not in tmux or tmux not available
  if (!isInsideTmux() || !hasTmuxBinary()) {
    log(`[${HOOK_NAME}] Disabled: not in tmux or tmux binary not found`)
    return {
      "tool.execute.before": async () => {},
      event: async () => {},
    }
  }

  const sessionName = getCurrentSession()
  if (!sessionName) {
    log(`[${HOOK_NAME}] Disabled: could not determine tmux session`)
    return {
      "tool.execute.before": async () => {},
      event: async () => {},
    }
  }

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
      execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
        cwd: projectDir,
        timeout: 30000,
        stdio: "pipe",
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
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: projectDir,
        timeout: 30000,
        stdio: "pipe",
      })

      // Delete branch
      execSync(`git branch -D "${branchName}"`, {
        cwd: projectDir,
        timeout: 5000,
        stdio: "pipe",
      })

      log(`[${HOOK_NAME}] Removed worktree and branch`, { branchName, worktreePath })
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to remove worktree`, { branchName, error })
    }
  }

  /**
   * Create a tmux window for a background task
   */
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

    try {
      // Create new window in the appropriate directory
      execSync(`tmux new-window -n "${windowName}" -c "${workDir}" -d`, { timeout: 5000 })

      // Get window index
      const windowIndex = execSync(
        `tmux list-windows -F '#I:#W' | grep '${windowName}' | cut -d: -f1`,
        { encoding: "utf8", timeout: 5000 }
      ).trim()

      const paneTarget = `${sessionName}:${windowIndex}.1`

      // Set status icon window option
      execSync(
        `tmux set-option -t "${sessionName}:${windowName}" @workmux_status "${statusIcons.working}"`,
        { timeout: 5000 }
      )

      // Display task info in the pane
      execSync(`tmux send-keys -t "${paneTarget}" "# Task: ${description}" Enter`, { timeout: 5000 })
      execSync(`tmux send-keys -t "${paneTarget}" "# Session: ${agentSessionID}" Enter`, { timeout: 5000 })
      if (worktreePath) {
        execSync(`tmux send-keys -t "${paneTarget}" "# Branch: ${branchName}" Enter`, { timeout: 5000 })
        execSync(`tmux send-keys -t "${paneTarget}" "# Worktree: ${worktreePath}" Enter`, { timeout: 5000 })
      }
      execSync(`tmux send-keys -t "${paneTarget}" "# Waiting for agent output..." Enter`, { timeout: 5000 })

      const info: SessionInfo = {
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
      execSync(
        `tmux set-option -t "${sessionName}:${info.windowName}" @workmux_status "${icon}"`,
        { timeout: 5000 }
      )
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
      execSync(`tmux kill-window -t "${sessionName}:${info.windowName}" 2>/dev/null`, { timeout: 5000 })
    } catch {
      // Window may already be closed
    }

    // Cleanup worktree if auto_cleanup enabled
    if (info.worktreePath && autoCleanup) {
      removeWorktree(info.branchName, info.worktreePath)
    }

    activeWindows.delete(taskId)
    log(`[${HOOK_NAME}] Closed window`, { windowName: info.windowName, taskId })
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
    branchName: string
    worktreePath: string | null
    description: string
    createdAt: number
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
      queue.push({ branchName, worktreePath, description, createdAt: Date.now() })
      pendingWorktrees.set(sessionIdHint, queue)

      // If worktree was created, modify the working directory in args
      if (worktreePath) {
        // Store worktree info in args for the delegate_task to use
        ;(output.args as Record<string, unknown>).__worktree_path = worktreePath
        ;(output.args as Record<string, unknown>).__worktree_branch = branchName
      }

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
        const taskId = sessionInfo.id.slice(0, 8)

        // Check for pending worktree from tool.execute.before
        let worktreePath: string | null = null
        let branchName = `wm/${slugify(title)}-${taskId}`

        // Consume queued pending worktree entry by parent session first.
        const parentQueue = pendingWorktrees.get(sessionInfo.parentID)
        if (parentQueue && parentQueue.length > 0) {
          const pending = parentQueue.shift()!
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
            const index = queue.findIndex((pending) => pending.description === title)
            if (index === -1) continue
            const pending = queue[index]!
            queue.splice(index, 1)
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

        for (const [taskId, info] of activeWindows) {
          if (info.sessionID === sessionInfo.id) {
            // Keep window for a bit to show final status
            setTimeout(() => closeWindow(taskId), 5000)
            break
          }
        }

        // Stop polling if no active windows
        if (activeWindows.size === 0) {
          stopRescuePolling()
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
