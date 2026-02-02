import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  acquireLock,
  releaseLock,
  isLocked,
  withLock,
  withLockSync,
  tryWithLock,
  cleanupStaleLock,
} from "./semaphore"

describe("semaphore", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "semaphore-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("acquireLock/releaseLock", () => {
    test("acquires lock successfully", () => {
      const lockDir = join(tempDir, "test.lock")
      expect(acquireLock(lockDir)).toBe(true)
      expect(existsSync(lockDir)).toBe(true)
    })

    test("returns false if lock already exists", () => {
      const lockDir = join(tempDir, "test.lock")
      expect(acquireLock(lockDir)).toBe(true)
      expect(acquireLock(lockDir)).toBe(false)
    })

    test("releases lock successfully", () => {
      const lockDir = join(tempDir, "test.lock")
      acquireLock(lockDir)
      releaseLock(lockDir)
      expect(existsSync(lockDir)).toBe(false)
    })

    test("release does not throw if lock does not exist", () => {
      const lockDir = join(tempDir, "nonexistent.lock")
      expect(() => releaseLock(lockDir)).not.toThrow()
    })
  })

  describe("isLocked", () => {
    test("returns true if locked", () => {
      const lockDir = join(tempDir, "test.lock")
      acquireLock(lockDir)
      expect(isLocked(lockDir)).toBe(true)
    })

    test("returns false if not locked", () => {
      const lockDir = join(tempDir, "test.lock")
      expect(isLocked(lockDir)).toBe(false)
    })
  })

  describe("withLockSync", () => {
    test("executes function while holding lock", () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      let wasLocked = false
      const result = withLockSync(resource, () => {
        wasLocked = existsSync(lockDir)
        return 42
      })

      expect(result).toBe(42)
      expect(wasLocked).toBe(true)
      expect(existsSync(lockDir)).toBe(false) // Lock released after
    })

    test("releases lock even if function throws", () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      expect(() => {
        withLockSync(resource, () => {
          throw new Error("test error")
        })
      }).toThrow("test error")

      expect(existsSync(lockDir)).toBe(false)
    })

    test("waits for lock if already held", async () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      // Manually acquire lock
      acquireLock(lockDir)

      // Try to get lock with short timeout
      expect(() => {
        withLockSync(resource, () => "never reached", { maxRetries: 2 })
      }).toThrow(/Failed to acquire lock/)

      releaseLock(lockDir)
    })

    test("recovers from stale lock left by a dead process", () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      // Simulate a stale lock directory with metadata from a dead PID
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(
        join(lockDir, "_meta.json"),
        JSON.stringify({ pid: 999999, createdAt: Date.now() - 60_000 }, null, 2),
        "utf-8"
      )

      const result = withLockSync(resource, () => "recovered", { maxRetries: 5 })
      expect(result).toBe("recovered")
      expect(existsSync(lockDir)).toBe(false)
    })
  })

  describe("withLock (async)", () => {
    test("executes async function while holding lock", async () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      let wasLocked = false
      const result = await withLock(resource, async () => {
        wasLocked = existsSync(lockDir)
        await new Promise((r) => setTimeout(r, 10))
        return "async result"
      })

      expect(result).toBe("async result")
      expect(wasLocked).toBe(true)
      expect(existsSync(lockDir)).toBe(false)
    })

    test("releases lock even if async function throws", async () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      await expect(
        withLock(resource, async () => {
          throw new Error("async error")
        })
      ).rejects.toThrow("async error")

      expect(existsSync(lockDir)).toBe(false)
    })

    test("waits for lock if already held", async () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      // Manually acquire lock
      acquireLock(lockDir)

      // Release after a short delay
      setTimeout(() => releaseLock(lockDir), 100)

      // Should wait and eventually succeed
      const result = await withLock(resource, () => "success", { timeoutMs: 500 })
      expect(result).toBe("success")
    })
  })

  describe("tryWithLock", () => {
    test("returns result if lock acquired", () => {
      const resource = join(tempDir, "resource.json")

      const result = tryWithLock(resource, () => "got it")
      expect(result).toBe("got it")
    })

    test("returns null if lock not available", () => {
      const resource = join(tempDir, "resource.json")
      const lockDir = `${resource}.lock`

      acquireLock(lockDir)

      const result = tryWithLock(resource, () => "never reached")
      expect(result).toBeNull()

      releaseLock(lockDir)
    })
  })

  describe("cleanupStaleLock", () => {
    test("cleans up stale lock", () => {
      const lockDir = join(tempDir, "stale.lock")
      acquireLock(lockDir)

      expect(cleanupStaleLock(lockDir)).toBe(true)
      expect(existsSync(lockDir)).toBe(false)
    })

    test("returns false if no lock exists", () => {
      const lockDir = join(tempDir, "nonexistent.lock")
      expect(cleanupStaleLock(lockDir)).toBe(false)
    })
  })
})
