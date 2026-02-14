import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, type FSWatcher } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../../src/config/schema"
import { createInbox, sendMessage } from "../../../src/features/orchestrator-swarm/mailbox/writer"
import { startWatching } from "../../../src/features/orchestrator-swarm/mailbox/watcher"
import { waitFor } from "../helpers/wait-for"

/**
 * This test validates that startWatching can fall back to polling on fs.watch error
 * without leaking a background poller that cannot be disposed.
 *
 * It uses the `watchImpl` injection seam to deterministically emit watcher errors
 * without module-level mocking.
 */

type MockFsWatcher = {
  on: (event: string, cb: (...args: unknown[]) => void) => MockFsWatcher
  close: () => void
  __emit: (event: string, ...args: unknown[]) => void
}

let lastWatcher: MockFsWatcher | null = null

function createMockWatcher(): MockFsWatcher {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  let closed = false

  return {
    on(event, cb) {
      const arr = handlers.get(event) ?? []
      arr.push(cb)
      handlers.set(event, arr)
      return this
    },
    close() {
      closed = true
    },
    __emit(event, ...args) {
      if (closed) return
      const arr = handlers.get(event) ?? []
      for (const cb of arr) cb(...args)
    },
  }
}

function watchImpl(_watchDir: string, _onChange: () => void): FSWatcher {
  lastWatcher = createMockWatcher()
  return lastWatcher as unknown as FSWatcher
}

describe("mailbox/watcher startWatching fallback", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-start-watching-fallback-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      orchestrator: {
        swarm: {
          enabled: true,
          storage_path: testDir,
          ui_mode: "toast",
        },
      },
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    lastWatcher = null
  })

  test("falls back to polling on fs.watch error and remains disposable", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const received: string[] = []
    const disposable = startWatching(
      teamName,
      agentId,
      (message) => {
        received.push(message.id)
      },
      config,
      { intervalMs: 50, onError: () => {}, watchImpl }
    )

    // Trigger watcher error -> should switch into polling mode
    expect(lastWatcher).not.toBeNull()
    lastWatcher?.__emit("error", new Error("watch failed"))

    // Verify polling is active by receiving one message
    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)
    await waitFor(() => {
      expect(received.length).toBe(1)
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "polling fallback to deliver the first message",
    })

    // Dispose should stop whichever mode is active (including the polling fallback)
    disposable.dispose()

    // Send another message after disposal -> must NOT be delivered
    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)
    await waitFor(() => {
      expect(received.length).toBe(1)
    }, {
      timeoutMs: 1_000,
      intervalMs: 25,
      description: "no delivery after watcher disposal",
    })
  })

  test("falls back to polling when inbox directory does not exist", async () => {
    // #given
    const agentId = "agent_receiver"
    const senderId = "agent_sender"

    const received: string[] = []
    const disposable = startWatching(
      teamName,
      agentId,
      (message) => {
        received.push(message.id)
      },
      config,
      { intervalMs: 50, onError: () => {}, watchImpl }
    )

    // No inbox created yet => watchDir does not exist => should not use fs.watch
    expect(lastWatcher).toBeNull()

    // #when
    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)

    // #then
    await waitFor(() => {
      expect(received.length).toBe(1)
    }, {
      timeoutMs: 2_000,
      intervalMs: 25,
      description: "polling delivers message when watchDir is missing",
    })

    disposable.dispose()

    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)
    await waitFor(() => {
      expect(received.length).toBe(1)
    }, {
      timeoutMs: 1_000,
      intervalMs: 25,
      description: "polling watcher stops after disposal",
    })
  })
})
