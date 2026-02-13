import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { readInbox, readUnread, type InboxMessage, readInboxMeta } from "./reader"
import {
  generateMessageId,
  createInbox,
  ensureInbox,
  sendMessage,
  broadcast,
  claimPendingMessages,
  ackProcessedMessage,
  deleteMessages,
  clearInbox,
  pruneOldMessages,
  getInboxDir,
  getInboxDoneDir,
  getInboxPendingDir,
} from "./writer"

describe("mailbox/writer", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-writer-test-${Date.now()}`)
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
  })

  test("generateMessageId creates unique IDs", () => {
    const id1 = generateMessageId()
    const id2 = generateMessageId()

    expect(id1).toMatch(/^msg_[a-z0-9-]{12}$/)
    expect(id2).toMatch(/^msg_[a-z0-9-]{12}$/)
    expect(id1).not.toBe(id2)
  })

  test("createInbox creates inbox directory with meta file", () => {
    const agentId = "agent_test123"
    createInbox(teamName, agentId, config)

    const inboxDir = getInboxDir(teamName, agentId, config)
    expect(existsSync(inboxDir)).toBe(true)

    const metaPath = join(inboxDir, "_meta.json")
    expect(existsSync(metaPath)).toBe(true)

    const meta = readInboxMeta(teamName, agentId, config)
    expect(meta?.agentId).toBe(agentId)
  })

  test("ensureInbox only creates if not exists", () => {
    const agentId = "agent_test123"

    // First call creates
    ensureInbox(teamName, agentId, config)
    const inboxDir = getInboxDir(teamName, agentId, config)
    expect(existsSync(inboxDir)).toBe(true)

    // Get initial createdAt
    const meta1 = readInboxMeta(teamName, agentId, config)
    const initialCreatedAt = meta1?.createdAt

    // Wait a bit
    Bun.sleepSync(10)

    // Second call doesn't recreate
    ensureInbox(teamName, agentId, config)
    const meta2 = readInboxMeta(teamName, agentId, config)
    expect(meta2?.createdAt).toBe(initialCreatedAt)
  })

  test("sendMessage adds message to recipient inbox", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    const messageId = sendMessage(teamName, fromAgent, toAgent, {
      type: "idle_notification",
    }, config)

    expect(messageId).toMatch(/^msg_/)

    const messages = readInbox(teamName, toAgent, config)
    expect(messages.length).toBe(1)
    expect(messages[0].id).toBe(messageId)
    expect(messages[0].from).toBe(fromAgent)
    expect(messages[0].read).toBe(false)
    expect(messages[0].payload.type).toBe("idle_notification")
  })

  test("sendMessage creates inbox if not exists", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_new"

    sendMessage(teamName, fromAgent, toAgent, {
      type: "idle_notification",
    }, config)

    const inboxDir = getInboxDir(teamName, toAgent, config)
    expect(existsSync(inboxDir)).toBe(true)
  })

  test("broadcast sends to all team members", () => {
    const sender = "agent_sender"
    const receiver1 = "agent_r1"
    const receiver2 = "agent_r2"

    // Create inboxes for receivers
    createInbox(teamName, sender, config)
    createInbox(teamName, receiver1, config)
    createInbox(teamName, receiver2, config)

    const messageIds = broadcast(teamName, sender, {
      type: "shutdown_approved",
    }, config)

    expect(messageIds.length).toBe(2) // Excludes sender by default

    // Check each receiver got the message
    expect(readInbox(teamName, receiver1, config).length).toBe(1)
    expect(readInbox(teamName, receiver2, config).length).toBe(1)
    expect(readInbox(teamName, sender, config).length).toBe(0)
  })

  test("broadcast includes self when option set", () => {
    const sender = "agent_sender"
    const receiver = "agent_receiver"

    createInbox(teamName, sender, config)
    createInbox(teamName, receiver, config)

    broadcast(teamName, sender, { type: "shutdown_approved" }, config, { includeSelf: true })

    expect(readInbox(teamName, sender, config).length).toBe(1)
    expect(readInbox(teamName, receiver, config).length).toBe(1)
  })

  test("ackProcessedMessage consumes a queued message", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    const msgId = sendMessage(teamName, fromAgent, toAgent, {
      type: "idle_notification",
    }, config)

    // Initially unread
    expect(readUnread(teamName, toAgent, config).length).toBe(1)

    // Claim then ack
    const claimed = claimPendingMessages(teamName, toAgent, config)
    expect(claimed.map((m) => m.id)).toContain(msgId)
    expect(ackProcessedMessage(teamName, toAgent, msgId, config)).toBe(true)

    // Now consumed
    expect(readUnread(teamName, toAgent, config).length).toBe(0)
    expect(readInbox(teamName, toAgent, config).length).toBe(0)
  })

  test("deleteMessages removes specific messages", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    const msg1 = sendMessage(teamName, fromAgent, toAgent, { type: "idle_notification" }, config)
    const msg2 = sendMessage(teamName, fromAgent, toAgent, { type: "shutdown_approved" }, config)

    expect(readInbox(teamName, toAgent, config).length).toBe(2)

    deleteMessages(teamName, toAgent, [msg1], config)

    const remaining = readInbox(teamName, toAgent, config)
    expect(remaining.length).toBe(1)
    expect(remaining[0].id).toBe(msg2)
  })

  test("clearInbox removes all messages", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    sendMessage(teamName, fromAgent, toAgent, { type: "idle_notification" }, config)
    sendMessage(teamName, fromAgent, toAgent, { type: "shutdown_approved" }, config)

    expect(readInbox(teamName, toAgent, config).length).toBe(2)

    clearInbox(teamName, toAgent, config)

    expect(readInbox(teamName, toAgent, config).length).toBe(0)
    // Meta file should still exist
    expect(readInboxMeta(teamName, toAgent, config)).not.toBeNull()
  })

  test("pruneOldMessages removes old read messages", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    // Send and persist into done queue
    const oldMsgId = sendMessage(teamName, fromAgent, toAgent, { type: "idle_notification" }, config)
    const claimed = claimPendingMessages(teamName, toAgent, config)
    expect(claimed.map((m) => m.id)).toContain(oldMsgId)
    expect(ackProcessedMessage(teamName, toAgent, oldMsgId, config, { keepDone: true })).toBe(true)

    // Manually modify timestamp to be old
    const doneDir = getInboxDoneDir(teamName, toAgent, config)
    const msgPath = join(doneDir, `${oldMsgId}.json`)
    const msg = JSON.parse(readFileSync(msgPath, "utf-8")) as InboxMessage
    msg.timestamp = Date.now() - 48 * 60 * 60 * 1000 // 48 hours ago
    require("fs").writeFileSync(msgPath, JSON.stringify(msg, null, 2))

    // Send a new unread message
    sendMessage(teamName, fromAgent, toAgent, { type: "shutdown_approved" }, config)

    // Prune with 24 hour max age
    const pruned = pruneOldMessages(teamName, toAgent, config, { maxAge: 24 * 60 * 60 * 1000 })

    expect(pruned).toBe(1)
    expect(readInbox(teamName, toAgent, config).length).toBe(1)
  })

  test("each message is stored as separate file", () => {
    const fromAgent = "agent_from"
    const toAgent = "agent_to"

    const msg1 = sendMessage(teamName, fromAgent, toAgent, { type: "idle_notification" }, config)
    const msg2 = sendMessage(teamName, fromAgent, toAgent, { type: "shutdown_approved" }, config)

    const pendingDir = getInboxPendingDir(teamName, toAgent, config)
    const files = readdirSync(pendingDir).filter(f => f.endsWith(".json"))

    expect(files.length).toBe(2)
    expect(files).toContain(`${msg1}.json`)
    expect(files).toContain(`${msg2}.json`)
  })
})
