import { existsSync, watch, type FSWatcher } from "fs"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { readUnread, type InboxMessage } from "./reader"
import { markAsRead, getInboxDir, pruneOldMessages } from "./writer"

/**
 * Disposable interface for stopping watchers
 */
export interface Disposable {
  dispose(): void
}

/**
 * Message handler callback
 */
export type MessageHandler = (message: InboxMessage) => void | Promise<void>

/**
 * Error handler callback
 */
export type ErrorHandler = (error: Error) => void

/**
 * Watcher options
 */
export interface WatcherOptions {
  /** Polling interval in milliseconds (default: 1000) */
  intervalMs?: number
  /** Auto-mark messages as read after handling (default: true) */
  autoMarkRead?: boolean
  /** Auto-prune old messages every N polls (default: 100, 0 to disable) */
  autoPruneInterval?: number
  /** Max age of read messages before pruning in ms (default: 1 hour) */
  pruneMaxAgeMs?: number
  /** Error handler callback */
  onError?: ErrorHandler
  /** Called when watcher starts */
  onStart?: () => void
  /** Called when watcher stops */
  onStop?: () => void
}

/**
 * Start polling an inbox for new messages
 *
 * @param teamName - Team name
 * @param agentId - Agent ID to watch
 * @param handler - Callback for each new message
 * @param config - OpenCode config
 * @param options - Watcher options
 * @returns Disposable to stop polling
 */
export function startPolling(
  teamName: string,
  agentId: string,
  handler: MessageHandler,
  config: Partial<OhMyOpenCodeConfig>,
  options?: WatcherOptions
): Disposable {
  const intervalMs = options?.intervalMs ?? 1000
  const autoMarkRead = options?.autoMarkRead ?? true
  const autoPruneInterval = options?.autoPruneInterval ?? 100
  const pruneMaxAgeMs = options?.pruneMaxAgeMs ?? 60 * 60 * 1000 // 1 hour default
  const onError = options?.onError ?? console.error

  let stopped = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pollCount = 0

  const poll = async () => {
    if (stopped) return

    try {
      const messages = readUnread(teamName, agentId, config)

      for (const message of messages) {
        try {
          await handler(message)

          if (autoMarkRead) {
            markAsRead(teamName, agentId, [message.id], config)
          }
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
        }
      }

      // Auto-prune old messages periodically
      pollCount++
      if (autoPruneInterval > 0 && pollCount % autoPruneInterval === 0) {
        try {
          pruneOldMessages(teamName, agentId, config, { maxAge: pruneMaxAgeMs })
        } catch {
          // Ignore prune errors - not critical
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }

    if (!stopped) {
      timeoutId = setTimeout(poll, intervalMs)
    }
  }

  // Start polling
  options?.onStart?.()
  timeoutId = setTimeout(poll, 0) // Start immediately

  return {
    dispose() {
      stopped = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      options?.onStop?.()
    },
  }
}

/**
 * Start watching an inbox using file system watcher (more efficient but platform-dependent)
 *
 * Note: Falls back to polling if file watching is not supported
 *
 * @param teamName - Team name
 * @param agentId - Agent ID to watch
 * @param handler - Callback for each new message
 * @param config - OpenCode config
 * @param options - Watcher options
 * @returns Disposable to stop watching
 */
export function startWatching(
  teamName: string,
  agentId: string,
  handler: MessageHandler,
  config: Partial<OhMyOpenCodeConfig>,
  options?: WatcherOptions
): Disposable {
  const inboxDir = getInboxDir(teamName, agentId, config)
  const autoMarkRead = options?.autoMarkRead ?? true
  const onError = options?.onError ?? console.error

  // If inbox directory doesn't exist, fall back to polling
  if (!existsSync(inboxDir)) {
    return startPolling(teamName, agentId, handler, config, options)
  }

  let stopped = false
  let fsWatcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastProcessedIds = new Set<string>()
  let pollingFallback: Disposable | null = null
  let started = false

  // If we switch from watching → polling fallback, we must ensure:
  // - The polling loop is disposed when the caller disposes
  // - onStart/onStop are called exactly once
  const pollingOptions: WatcherOptions | undefined = options
    ? { ...options, onStart: undefined, onStop: undefined }
    : options

  const processNewMessages = async () => {
    if (stopped) return

    try {
      const messages = readUnread(teamName, agentId, config)

      for (const message of messages) {
        // Skip if we've already processed this message in this session
        if (lastProcessedIds.has(message.id)) continue

        try {
          await handler(message)
          lastProcessedIds.add(message.id)

          if (autoMarkRead) {
            markAsRead(teamName, agentId, [message.id], config)
          }
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
        }
      }

      // Limit memory usage of processed IDs set
      if (lastProcessedIds.size > 1000) {
        const recent = Array.from(lastProcessedIds).slice(-500)
        lastProcessedIds = new Set(recent)
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const onFileChange = () => {
    // Debounce rapid file changes
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(processNewMessages, 50)
  }

  try {
    // Watch the inbox directory for new message files
    fsWatcher = watch(inboxDir, { persistent: true }, onFileChange)

    fsWatcher.on("error", (err) => {
      onError(err instanceof Error ? err : new Error(String(err)))
      // Fall back to polling on watcher errors.
      // IMPORTANT: this must remain disposable via the original return value.
      if (stopped) return
      try {
        fsWatcher?.close()
      } catch {
        // ignore close failures
      }
      fsWatcher = null

      if (!pollingFallback) {
        pollingFallback = startPolling(teamName, agentId, handler, config, pollingOptions)
      }
    })

    if (!started) {
      options?.onStart?.()
      started = true
    }

    // Process any existing unread messages
    processNewMessages()
  } catch {
    // Fall back to polling if watch setup fails
    return startPolling(teamName, agentId, handler, config, options)
  }

  return {
    dispose() {
      stopped = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (fsWatcher) {
        fsWatcher.close()
        fsWatcher = null
      }
      if (pollingFallback) {
        pollingFallback.dispose()
        pollingFallback = null
      }
      options?.onStop?.()
    },
  }
}

/**
 * Wait for a specific message type with timeout
 *
 * @param teamName - Team name
 * @param agentId - Agent ID to watch
 * @param messageType - Type of message to wait for
 * @param config - OpenCode config
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns Promise that resolves with the message or rejects on timeout
 */
export function waitForMessage<T extends InboxMessage["payload"]["type"]>(
  teamName: string,
  agentId: string,
  messageType: T,
  config: Partial<OhMyOpenCodeConfig>,
  timeoutMs = 30000
): Promise<InboxMessage> {
  return new Promise((resolve, reject) => {
    let disposed = false
    // Avoid repeatedly re-processing unrelated unread messages while waiting.
    const seenIds = new Set<string>()

    const timeout = setTimeout(() => {
      if (!disposed) {
        disposed = true
        watcher.dispose()
        reject(new Error(`Timeout waiting for message type: ${messageType}`))
      }
    }, timeoutMs)

    const watcher = startPolling(
      teamName,
      agentId,
      (message) => {
        if (disposed) return

        // Ignore already-seen messages to avoid busy re-processing loops
        if (seenIds.has(message.id)) return
        seenIds.add(message.id)

        if (message.payload.type === messageType) {
          disposed = true
          clearTimeout(timeout)
          // Mark ONLY the matched message as read so other message types
          // remain available for the caller to handle (critical for join/shutdown flows).
          try {
            markAsRead(teamName, agentId, [message.id], config)
          } catch {
            // Ignore mark failures; caller can still proceed
          }
          watcher.dispose()
          resolve(message)
        }
      },
      config,
      {
        intervalMs: 100, // Fast polling for waiting
        autoMarkRead: false, // Do not consume unrelated messages
      }
    )
  })
}

/**
 * Create a message queue that buffers incoming messages
 */
export class MessageQueue {
  private queue: InboxMessage[] = []
  private watcher: Disposable | null = null
  private waiters: Array<(message: InboxMessage) => void> = []

  constructor(
    private teamName: string,
    private agentId: string,
    private config: Partial<OhMyOpenCodeConfig>,
    private options?: WatcherOptions
  ) {}

  /**
   * Start the message queue
   */
  start(): void {
    if (this.watcher) return

    this.watcher = startPolling(
      this.teamName,
      this.agentId,
      (message) => {
        // If someone is waiting, deliver directly
        const waiter = this.waiters.shift()
        if (waiter) {
          waiter(message)
        } else {
          this.queue.push(message)
        }
      },
      this.config,
      this.options
    )
  }

  /**
   * Stop the message queue
   */
  stop(): void {
    this.watcher?.dispose()
    this.watcher = null
  }

  /**
   * Get next message from queue (blocking)
   */
  async next(timeoutMs = 30000): Promise<InboxMessage> {
    // Check if we have a queued message
    const queued = this.queue.shift()
    if (queued) {
      return queued
    }

    // Wait for next message
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(resolve)
        if (index !== -1) {
          this.waiters.splice(index, 1)
        }
        reject(new Error("Timeout waiting for message"))
      }, timeoutMs)

      this.waiters.push((message) => {
        clearTimeout(timeout)
        resolve(message)
      })
    })
  }

  /**
   * Get all currently queued messages
   */
  drain(): InboxMessage[] {
    const messages = this.queue
    this.queue = []
    return messages
  }

  /**
   * Check if there are queued messages
   */
  get pending(): number {
    return this.queue.length
  }
}
