import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, statSync } from "fs"
import { join } from "path"

/**
 * Default lock retry configuration
 */
const LOCK_RETRY_DELAY_MS = 50
const LOCK_MAX_RETRIES = 20 // Max wait ~1 second

/**
 * Lock metadata filename written inside the lock directory.
 *
 * We keep metadata in-band so stale locks left by crashed processes can be
 * detected and cleaned safely (PID liveness check).
 */
const LOCK_META_FILENAME = "_meta.json"

/**
 * Fallback staleness threshold when metadata is missing (legacy locks).
 * Conservative to avoid breaking legitimate long-running operations.
 */
const LEGACY_STALE_LOCK_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Lock options
 */
export interface LockOptions {
  /** Retry delay in milliseconds (default: 50) */
  retryDelayMs?: number
  /** Maximum number of retries (default: 20) */
  maxRetries?: number
  /** Timeout in milliseconds (alternative to maxRetries) */
  timeoutMs?: number
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    // Signal 0 performs existence/permission check without sending a real signal.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockMeta(lockDir: string): { pid?: number; createdAt?: number } | null {
  const metaPath = join(lockDir, LOCK_META_FILENAME)
  if (!existsSync(metaPath)) return null
  try {
    const raw = readFileSync(metaPath, "utf-8")
    const parsed = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown }
    const pid = typeof parsed.pid === "number" ? parsed.pid : undefined
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : undefined
    return { pid, createdAt }
  } catch {
    return null
  }
}

function isLegacyLockStale(lockDir: string): boolean {
  try {
    const st = statSync(lockDir)
    const age = Date.now() - st.mtimeMs
    return age > LEGACY_STALE_LOCK_MAX_AGE_MS
  } catch {
    return false
  }
}

/**
 * Best-effort cleanup for stale locks.
 *
 * Safe mode:
 * - If metadata exists and PID is NOT alive → consider lock stale and remove it.
 * - If metadata is missing → only remove if directory looks "old" (legacy fallback).
 */
function tryCleanupStaleLock(lockDir: string): boolean {
  if (!existsSync(lockDir)) return false

  const meta = readLockMeta(lockDir)
  if (meta?.pid !== undefined) {
    if (!isProcessAlive(meta.pid)) {
      try {
        rmSync(lockDir, { recursive: true, force: true })
        return true
      } catch {
        return false
      }
    }
    return false
  }

  // Legacy locks (no metadata): only clean if old enough.
  if (isLegacyLockStale(lockDir)) {
    try {
      rmSync(lockDir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  return false
}

/**
 * Acquire a lock using mkdir as atomic semaphore
 *
 * mkdir() is atomic on POSIX systems - only one process can successfully
 * create a directory. This makes it ideal for lightweight cross-process locking.
 *
 * @param lockDir Path to use as lock directory
 * @returns true if lock acquired, false if already locked
 */
export function acquireLock(lockDir: string): boolean {
  try {
    // recursive: false ensures atomicity - only one process can create
    mkdirSync(lockDir, { recursive: false })

    // Write lock metadata (best-effort). If this fails, the lock is still valid.
    try {
      writeFileSync(
        join(lockDir, LOCK_META_FILENAME),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }, null, 2),
        "utf-8"
      )
    } catch {
      // ignore metadata write errors
    }
    return true
  } catch (e: unknown) {
    const error = e as NodeJS.ErrnoException
    if (error.code === "EEXIST") {
      return false // Already locked by another process
    }
    throw e
  }
}

/**
 * Release a lock by removing the lock directory
 *
 * @param lockDir Path to the lock directory
 */
export function releaseLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true })
  } catch {
    // Ignore release failures (may have been cleaned up externally)
  }
}

/**
 * Check if a lock is currently held
 *
 * @param lockDir Path to the lock directory
 * @returns true if locked, false if available
 */
export function isLocked(lockDir: string): boolean {
  return existsSync(lockDir)
}

/**
 * Execute a function while holding a lock
 *
 * Uses spin-wait with configurable retry logic to acquire the lock.
 * Automatically releases the lock when the function completes or throws.
 *
 * @param resourcePath Path to the resource being protected
 * @param fn Function to execute while holding the lock
 * @param options Lock options
 * @returns Result of the function
 * @throws Error if lock cannot be acquired within retry limit
 *
 * @example
 * ```ts
 * await withLock(manifestPath, () => {
 *   const manifest = readManifest(teamName, config)
 *   manifest.members.push(member)
 *   writeManifest(teamName, manifest, config)
 * })
 * ```
 */
export async function withLock<T>(
  resourcePath: string,
  fn: () => T | Promise<T>,
  options?: LockOptions
): Promise<T> {
  const lockDir = `${resourcePath}.lock`
  const retryDelayMs = options?.retryDelayMs ?? LOCK_RETRY_DELAY_MS
  const maxRetries = options?.timeoutMs
    ? Math.ceil(options.timeoutMs / retryDelayMs)
    : (options?.maxRetries ?? LOCK_MAX_RETRIES)

  // Spin-wait to acquire lock
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (acquireLock(lockDir)) {
      try {
        return await fn()
      } finally {
        releaseLock(lockDir)
      }
    }
    // If lock is held, opportunistically clean up stale locks (crash recovery).
    // This is safe because we only remove locks whose PID is no longer alive
    // (or legacy locks that are very old).
    tryCleanupStaleLock(lockDir)
    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }

  throw new Error(
    `Failed to acquire lock for ${resourcePath} after ${maxRetries} retries ` +
    `(~${maxRetries * retryDelayMs}ms)`
  )
}

/**
 * Synchronous version of withLock
 *
 * Use only when async is not available. Blocks the event loop during waits.
 *
 * @param resourcePath Path to the resource being protected
 * @param fn Function to execute while holding the lock
 * @param options Lock options (timeoutMs not supported in sync version)
 * @returns Result of the function
 */
export function withLockSync<T>(
  resourcePath: string,
  fn: () => T,
  options?: Omit<LockOptions, "timeoutMs">
): T {
  const lockDir = `${resourcePath}.lock`
  const retryDelayMs = options?.retryDelayMs ?? LOCK_RETRY_DELAY_MS
  const maxRetries = options?.maxRetries ?? LOCK_MAX_RETRIES

  // Spin-wait to acquire lock (blocking)
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (acquireLock(lockDir)) {
      try {
        return fn()
      } finally {
        releaseLock(lockDir)
      }
    }
    // If lock is held, opportunistically clean up stale locks (crash recovery).
    tryCleanupStaleLock(lockDir)
    // Busy wait - not ideal but necessary for sync version
    const start = Date.now()
    while (Date.now() - start < retryDelayMs) {
      // Spin
    }
  }

  throw new Error(
    `Failed to acquire lock for ${resourcePath} after ${maxRetries} retries`
  )
}

/**
 * Try to acquire a lock without waiting
 *
 * Returns immediately with success or failure, no retry.
 *
 * @param resourcePath Path to the resource being protected
 * @param fn Function to execute if lock is acquired
 * @returns Result of the function, or null if lock not acquired
 */
export function tryWithLock<T>(
  resourcePath: string,
  fn: () => T
): T | null {
  const lockDir = `${resourcePath}.lock`

  if (acquireLock(lockDir)) {
    try {
      return fn()
    } finally {
      releaseLock(lockDir)
    }
  }

  // Attempt safe stale cleanup; caller can retry if desired.
  tryCleanupStaleLock(lockDir)
  return null
}

/**
 * Clean up stale locks that may have been left by crashed processes
 *
 * This should be called during initialization or recovery.
 * Use with caution - only call when you're sure no other process holds the lock.
 *
 * @param lockDir Path to the lock directory
 * @returns true if a stale lock was cleaned up
 */
export function cleanupStaleLock(lockDir: string): boolean {
  if (existsSync(lockDir)) {
    try {
      rmSync(lockDir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
  return false
}
