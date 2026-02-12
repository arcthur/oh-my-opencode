import { existsSync, watch, type FSWatcher } from "fs"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { InboxMessage } from "./reader"
import {
  deleteMessages,
  ackProcessedMessage,
  claimPendingMessages,
  getInboxPendingDir,
  pruneOldMessages,
  requeueClaimedMessage,
  requeueExpiredProcessing,
} from "./writer"

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
  /** Claim limit per cycle in rename queue mode */
  claimLimit?: number
  /** Requeue processing timeout in ms */
  processingTimeoutMs?: number
  /** Error handler callback */
  onError?: ErrorHandler
  /** Called when watcher starts */
  onStart?: () => void
  /** Called when watcher stops */
  onStop?: () => void
}

async function processMessagesOnce(
  teamName: string,
  agentId: string,
  handler: MessageHandler,
  config: Partial<OhMyOpenCodeConfig>,
  options: {
    autoMarkRead: boolean
    claimLimit: number
    processingTimeoutMs: number
    onError: ErrorHandler
  }
): Promise<void> {
  requeueExpiredProcessing(teamName, agentId, config, {
    maxAgeMs: options.processingTimeoutMs,
  })

  const claimed = claimPendingMessages(teamName, agentId, config, {
    limit: options.claimLimit,
  })

  for (const message of claimed) {
    let handled = false
    try {
      await handler(message)
      handled = true
    } catch (err) {
      options.onError(err instanceof Error ? err : new Error(String(err)))
    }

    if (options.autoMarkRead && handled) {
      ackProcessedMessage(teamName, agentId, message.id, config)
    } else {
      requeueClaimedMessage(teamName, agentId, message.id, config)
    }
  }
}

/**
 * Start polling an inbox for new messages
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
  const pruneMaxAgeMs = options?.pruneMaxAgeMs ?? 60 * 60 * 1000
  const claimLimit = options?.claimLimit ?? 200
  const processingTimeoutMs = options?.processingTimeoutMs ?? 30_000
  const onError = options?.onError ?? console.error

  let stopped = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pollCount = 0

  const poll = async () => {
    if (stopped) return

    try {
      await processMessagesOnce(teamName, agentId, handler, config, {
        autoMarkRead,
        claimLimit,
        processingTimeoutMs,
        onError,
      })

      pollCount++
      if (autoPruneInterval > 0 && pollCount % autoPruneInterval === 0) {
        try {
          pruneOldMessages(teamName, agentId, config, { maxAge: pruneMaxAgeMs })
        } catch {
          // Ignore prune errors
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }

    if (!stopped) {
      timeoutId = setTimeout(poll, intervalMs)
    }
  }

  options?.onStart?.()
  timeoutId = setTimeout(poll, 0)

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
 * Start watching an inbox using file system watcher.
 */
export function startWatching(
  teamName: string,
  agentId: string,
  handler: MessageHandler,
  config: Partial<OhMyOpenCodeConfig>,
  options?: WatcherOptions
): Disposable {
  const watchDir = getInboxPendingDir(teamName, agentId, config)

  if (!existsSync(watchDir)) {
    return startPolling(teamName, agentId, handler, config, options)
  }

  const autoMarkRead = options?.autoMarkRead ?? true
  const claimLimit = options?.claimLimit ?? 200
  const processingTimeoutMs = options?.processingTimeoutMs ?? 30_000
  const onError = options?.onError ?? console.error
  const fallbackPollMs = config.sisyphus?.swarm?.watch_fallback_poll_ms ?? 5000

  let stopped = false
  let fsWatcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackTimer: ReturnType<typeof setInterval> | null = null
  let fallbackPolling: Disposable | null = null
  let started = false

  const pollingOptions: WatcherOptions | undefined = options
    ? { ...options, onStart: undefined, onStop: undefined }
    : options

  const drain = async () => {
    if (stopped) return
    try {
      await processMessagesOnce(teamName, agentId, handler, config, {
        autoMarkRead,
        claimLimit,
        processingTimeoutMs,
        onError,
      })
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const scheduleDrain = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      void drain()
    }, 50)
  }

  try {
    fsWatcher = watch(watchDir, { persistent: true }, scheduleDrain)

    fsWatcher.on("error", (err) => {
      onError(err instanceof Error ? err : new Error(String(err)))
      if (stopped) return
      try {
        fsWatcher?.close()
      } catch {
        // ignore close failures
      }
      fsWatcher = null
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
      if (!fallbackPolling) {
        fallbackPolling = startPolling(teamName, agentId, handler, config, pollingOptions)
      }
    })

    if (!started) {
      options?.onStart?.()
      started = true
    }

    // Low-frequency fallback poll even when fs.watch is healthy.
    fallbackTimer = setInterval(() => {
      void drain()
    }, fallbackPollMs)

    // Initial drain
    void drain()
  } catch {
    return startPolling(teamName, agentId, handler, config, options)
  }

  return {
    dispose() {
      stopped = true
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
      if (fsWatcher) {
        fsWatcher.close()
        fsWatcher = null
      }
      if (fallbackPolling) {
        fallbackPolling.dispose()
        fallbackPolling = null
      }
      options?.onStop?.()
    },
  }
}

/**
 * Wait for a specific message type with timeout
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
        if (seenIds.has(message.id)) return
        seenIds.add(message.id)

        if (message.payload.type === messageType) {
          disposed = true
          clearTimeout(timeout)
          try {
            if (!ackProcessedMessage(teamName, agentId, message.id, config)) {
              deleteMessages(teamName, agentId, [message.id], config)
            }
          } catch {
            // Ignore mark failures
          }
          watcher.dispose()
          resolve(message)
        }
      },
      config,
      {
        intervalMs: 100,
        autoMarkRead: false,
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

  get pending(): number {
    return this.queue.length
  }

  /**
   * Start the message queue
   */
  start(): void {
    if (this.watcher) return

    this.watcher = startPolling(
      this.teamName,
      this.agentId,
      (message) => {
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
    const queued = this.queue.shift()
    if (queued) {
      return queued
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(resolve)
        if (index !== -1) {
          this.waiters.splice(index, 1)
        }
        reject(new Error("Message queue timeout"))
      }, timeoutMs)

      this.waiters.push((message) => {
        clearTimeout(timeout)
        resolve(message)
      })
    })
  }

  /**
   * Drain all queued messages
   */
  drain(): InboxMessage[] {
    const messages = [...this.queue]
    this.queue = []
    return messages
  }

  /**
   * Get queue length
   */
  size(): number {
    return this.queue.length
  }
}
