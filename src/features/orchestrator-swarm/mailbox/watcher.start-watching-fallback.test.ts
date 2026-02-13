import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import * as fs from "fs"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createInbox, sendMessage } from "./writer"

/**
 * This test validates that startWatching can fall back to polling on fs.watch error
 * without leaking a background poller that cannot be disposed.
 *
 * NOTE: We must mock "fs" BEFORE importing "./watcher" (module captures watch at import time).
 */

type MockFsWatcher = {
  on: (event: string, cb: (...args: any[]) => void) => MockFsWatcher
  close: () => void
  __emit: (event: string, ...args: any[]) => void
}

let lastWatcher: MockFsWatcher | null = null

mock.module("fs", () => {
  const real = fs

  function createMockWatcher(): MockFsWatcher {
    const handlers = new Map<string, Array<(...args: any[]) => void>>()
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

  return {
    ...real,
    watch: (_path: string, _opts: any, _listener?: any) => {
      lastWatcher = createMockWatcher()
      return lastWatcher as any
    },
  }
})

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

    const { startWatching } = await import("./watcher")

    const received: string[] = []
    const disposable = startWatching(
      teamName,
      agentId,
      (message) => {
        received.push(message.id)
      },
      config,
      { intervalMs: 50, onError: () => {} }
    )

    // Trigger watcher error → should switch into polling mode
    expect(lastWatcher).not.toBeNull()
    lastWatcher?.__emit("error", new Error("watch failed"))

    // Verify polling is active by receiving one message
    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)
    await Bun.sleep(200)
    expect(received.length).toBe(1)

    // Dispose should stop whichever mode is active (including the polling fallback)
    disposable.dispose()

    // Send another message after disposal → must NOT be delivered
    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)
    await Bun.sleep(200)
    expect(received.length).toBe(1)
  })
})

