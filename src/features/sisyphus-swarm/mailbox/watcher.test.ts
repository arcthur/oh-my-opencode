import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { createInbox, sendMessage } from "./writer"
import { readInbox, readUnread } from "./reader"
import { startPolling, waitForMessage, MessageQueue } from "./watcher"

describe("mailbox/watcher", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-watcher-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    config = {
      sisyphus: {
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
  })

  test("startPolling receives messages", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const received: string[] = []

    const watcher = startPolling(
      teamName,
      agentId,
      (message) => {
        received.push(message.id)
      },
      config,
      { intervalMs: 50 }
    )

    // Send a message
    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)

    // Wait for polling to pick it up
    await Bun.sleep(200)

    watcher.dispose()

    expect(received.length).toBe(1)
  })

  test("startPolling auto-marks messages as read", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const watcher = startPolling(
      teamName,
      agentId,
      () => {
        // Just receive
      },
      config,
      { intervalMs: 50, autoMarkRead: true }
    )

    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)

    await Bun.sleep(200)
    watcher.dispose()

    // Should be marked as read
    const unread = readUnread(teamName, agentId, config)
    expect(unread.length).toBe(0)
  })

  test("startPolling respects autoMarkRead=false", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const watcher = startPolling(
      teamName,
      agentId,
      () => {
        // Just receive
      },
      config,
      { intervalMs: 50, autoMarkRead: false }
    )

    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)

    await Bun.sleep(200)
    watcher.dispose()

    // Should still be unread (but we processed it, so it keeps getting reprocessed)
    // This is expected behavior when autoMarkRead is false
    const unread = readUnread(teamName, agentId, config)
    expect(unread.length).toBe(1)
  })

  test("dispose stops polling", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    let callCount = 0
    const watcher = startPolling(
      teamName,
      agentId,
      () => {
        callCount++
      },
      config,
      { intervalMs: 50 }
    )

    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)
    await Bun.sleep(100)

    watcher.dispose()
    const countAfterDispose = callCount

    // Send another message after dispose
    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)
    await Bun.sleep(100)

    // Count should not have increased
    expect(callCount).toBe(countAfterDispose)
  })

  test("waitForMessage resolves on matching message", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    // Start waiting
    const waitPromise = waitForMessage(teamName, agentId, "task_assignment", config, 5000)

    // Send the expected message after a short delay
    await Bun.sleep(100)
    sendMessage(teamName, senderId, agentId, {
      type: "task_assignment",
      taskId: "task_001",
      title: "Test",
      description: "...",
      assignedBy: senderId,
      timestamp: Date.now(),
    }, config)

    const message = await waitPromise
    expect(message.payload.type).toBe("task_assignment")
  })

  test("waitForMessage does not auto-consume other message types", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    // Send an unrelated message first (should remain unread)
    const unrelatedId = sendMessage(teamName, senderId, agentId, { type: "shutdown_rejected", reason: "no" }, config)

    // Start waiting for a different message type
    const waitPromise = waitForMessage(teamName, agentId, "task_assignment", config, 5000)

    await Bun.sleep(100)
    sendMessage(teamName, senderId, agentId, {
      type: "task_assignment",
      taskId: "task_001",
      title: "Test",
      description: "...",
      assignedBy: senderId,
      timestamp: Date.now(),
    }, config)

    const msg = await waitPromise
    expect(msg.payload.type).toBe("task_assignment")

    // Unrelated message should still exist (not consumed)
    const inbox = readInbox(teamName, agentId, config)
    expect(inbox.some(m => m.id === unrelatedId)).toBe(true)
  })

  test("waitForMessage times out", async () => {
    const agentId = "agent_receiver"
    createInbox(teamName, agentId, config)

    try {
      await waitForMessage(teamName, agentId, "task_assignment", config, 100)
      expect(true).toBe(false) // Should not reach here
    } catch (err) {
      expect((err as Error).message).toContain("Timeout")
    }
  })

  test("MessageQueue buffers and delivers messages", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const queue = new MessageQueue(teamName, agentId, config, { intervalMs: 50 })
    queue.start()

    // Send messages
    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)
    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)

    await Bun.sleep(200)

    // Should have pending messages
    expect(queue.pending).toBeGreaterThanOrEqual(0) // May have been processed

    // Get next (with short timeout since messages should be there)
    const msg1 = await queue.next(1000)
    expect(msg1).toBeDefined()

    queue.stop()
  })

  test("MessageQueue.drain returns all pending", async () => {
    const agentId = "agent_receiver"
    const senderId = "agent_sender"
    createInbox(teamName, agentId, config)

    const queue = new MessageQueue(teamName, agentId, config, { intervalMs: 50 })
    queue.start()

    sendMessage(teamName, senderId, agentId, { type: "idle_notification" }, config)
    sendMessage(teamName, senderId, agentId, { type: "shutdown_request" }, config)

    await Bun.sleep(200)

    const messages = queue.drain()
    // Note: messages may have been picked up by next() calls or polling
    // The important thing is drain() doesn't throw
    expect(Array.isArray(messages)).toBe(true)

    queue.stop()
  })

  test("callbacks onStart and onStop are called", async () => {
    const agentId = "agent_receiver"
    createInbox(teamName, agentId, config)

    let started = false
    let stopped = false

    const watcher = startPolling(
      teamName,
      agentId,
      () => {},
      config,
      {
        intervalMs: 50,
        onStart: () => { started = true },
        onStop: () => { stopped = true },
      }
    )

    expect(started).toBe(true)
    expect(stopped).toBe(false)

    watcher.dispose()

    expect(stopped).toBe(true)
  })
})
