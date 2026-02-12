import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import type { InboxMessage } from "./reader"
import {
  readInbox,
  readUnread,
  readByType,
  hasUnread,
  countUnread,
  findMessage,
  getLastReadTimestamp,
  readInboxMeta,
  readInboxRaw,
} from "./reader"

describe("mailbox/reader", () => {
  let testDir: string
  let config: Partial<OhMyOpenCodeConfig>
  const teamName = "test-team"
  const agentId = "agent_test123"

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-reader-test-${Date.now()}`)
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

  /**
   * Helper to create inbox directory with message files
   */
  function createTestInbox(messages: InboxMessage[], lastRead?: number): void {
    const inboxDir = join(testDir, teamName, "inboxes", agentId)
    const pendingDir = join(inboxDir, "pending")
    const processingDir = join(inboxDir, "processing")
    const doneDir = join(inboxDir, "done")
    mkdirSync(inboxDir, { recursive: true })
    mkdirSync(pendingDir, { recursive: true })
    mkdirSync(processingDir, { recursive: true })
    mkdirSync(doneDir, { recursive: true })

    // Create meta file
    const meta = {
      agentId,
      createdAt: Date.now(),
      lastRead: lastRead ?? Date.now(),
    }
    writeFileSync(join(inboxDir, "_meta.json"), JSON.stringify(meta, null, 2))

    // Create message files
    for (const msg of messages) {
      const dir = msg.read ? doneDir : pendingDir
      writeFileSync(join(dir, `${msg.id}.json`), JSON.stringify(msg, null, 2))
    }
  }

  test("readInbox returns empty array for non-existent inbox", () => {
    const messages = readInbox(teamName, agentId, config)
    expect(messages).toEqual([])
  })

  test("readInbox returns all messages", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
      {
        id: "msg_002",
        from: "agent_other",
        timestamp: Date.now(),
        read: true,
        payload: { type: "idle_notification" },
      },
    ])

    const messages = readInbox(teamName, agentId, config)
    expect(messages.length).toBe(2)
  })

  test("readUnread returns only unread messages", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
      {
        id: "msg_002",
        from: "agent_other",
        timestamp: Date.now(),
        read: true,
        payload: { type: "idle_notification" },
      },
    ])

    const messages = readUnread(teamName, agentId, config)
    expect(messages.length).toBe(1)
    expect(messages[0].id).toBe("msg_001")
  })

  test("readByType filters by message type", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: {
          type: "task_assignment",
          taskId: "task_1",
          title: "Test",
          description: "Test task",
          assignedBy: "coord",
          timestamp: Date.now(),
        },
      },
      {
        id: "msg_002",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
    ])

    const taskMessages = readByType(teamName, agentId, "task_assignment", config)
    expect(taskMessages.length).toBe(1)
    expect(taskMessages[0].id).toBe("msg_001")
  })

  test("hasUnread returns correct boolean", () => {
    // No inbox
    expect(hasUnread(teamName, agentId, config)).toBe(false)

    // Create with unread
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
    ])

    expect(hasUnread(teamName, agentId, config)).toBe(true)
  })

  test("countUnread returns correct count", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
      {
        id: "msg_002",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "shutdown_approved" },
      },
      {
        id: "msg_003",
        from: "agent_other",
        timestamp: Date.now(),
        read: true,
        payload: { type: "idle_notification" },
      },
    ])

    expect(countUnread(teamName, agentId, config)).toBe(2)
  })

  test("findMessage locates message by ID", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
      {
        id: "msg_002",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "shutdown_request" },
      },
    ])

    const found = findMessage(teamName, agentId, "msg_002", config)
    expect(found).not.toBeNull()
    expect(found?.payload.type).toBe("shutdown_request")

    const notFound = findMessage(teamName, agentId, "msg_999", config)
    expect(notFound).toBeNull()
  })

  test("findMessage locates message directly from processing queue", () => {
    // #given
    const inboxDir = join(testDir, teamName, "inboxes", agentId)
    const pendingDir = join(inboxDir, "pending")
    const processingDir = join(inboxDir, "processing")
    const doneDir = join(inboxDir, "done")
    mkdirSync(pendingDir, { recursive: true })
    mkdirSync(processingDir, { recursive: true })
    mkdirSync(doneDir, { recursive: true })
    writeFileSync(
      join(inboxDir, "_meta.json"),
      JSON.stringify({ agentId, createdAt: Date.now(), lastRead: Date.now() }, null, 2)
    )
    writeFileSync(
      join(processingDir, "msg_processing.json"),
      JSON.stringify(
        {
          id: "msg_processing",
          from: "agent_other",
          timestamp: Date.now(),
          read: false,
          payload: { type: "idle_notification" },
        },
        null,
        2
      )
    )

    // #when
    const found = findMessage(teamName, agentId, "msg_processing", config)

    // #then
    expect(found).not.toBeNull()
    expect(found?.id).toBe("msg_processing")
    expect(found?.read).toBe(true)
  })

  test("getLastReadTimestamp returns timestamp from meta", () => {
    const timestamp = Date.now()
    createTestInbox([], timestamp)

    expect(getLastReadTimestamp(teamName, agentId, config)).toBe(timestamp)
  })

  test("getLastReadTimestamp returns null for non-existent inbox", () => {
    expect(getLastReadTimestamp(teamName, agentId, config)).toBeNull()
  })

  test("readInboxMeta returns meta data", () => {
    createTestInbox([])

    const meta = readInboxMeta(teamName, agentId, config)
    expect(meta).not.toBeNull()
    expect(meta?.agentId).toBe(agentId)
  })

  test("readInboxRaw returns Inbox-compatible structure", () => {
    createTestInbox([
      {
        id: "msg_001",
        from: "agent_other",
        timestamp: Date.now(),
        read: false,
        payload: { type: "idle_notification" },
      },
    ])

    const inbox = readInboxRaw(teamName, agentId, config)
    expect(inbox).not.toBeNull()
    expect(inbox?.agentId).toBe(agentId)
    expect(inbox?.messages.length).toBe(1)
  })

  test("readInbox sorts messages by timestamp", () => {
    const now = Date.now()
    createTestInbox([
      {
        id: "msg_newer",
        from: "agent_other",
        timestamp: now + 1000,
        read: false,
        payload: { type: "idle_notification" },
      },
      {
        id: "msg_older",
        from: "agent_other",
        timestamp: now,
        read: false,
        payload: { type: "shutdown_approved" },
      },
    ])

    const messages = readInbox(teamName, agentId, config)
    expect(messages[0].id).toBe("msg_older")
    expect(messages[1].id).toBe("msg_newer")
  })

  test("readInbox handles invalid JSON gracefully", () => {
    const inboxDir = join(testDir, teamName, "inboxes", agentId)
    const pendingDir = join(inboxDir, "pending")
    const processingDir = join(inboxDir, "processing")
    const doneDir = join(inboxDir, "done")
    mkdirSync(inboxDir, { recursive: true })
    mkdirSync(pendingDir, { recursive: true })
    mkdirSync(processingDir, { recursive: true })
    mkdirSync(doneDir, { recursive: true })

    // Create valid meta
    writeFileSync(join(inboxDir, "_meta.json"), JSON.stringify({ agentId }))

    // Create invalid message file
    writeFileSync(join(pendingDir, "msg_invalid.json"), "invalid json content")

    // Create valid message
    const validMsg: InboxMessage = {
      id: "msg_valid",
      from: "agent_other",
      timestamp: Date.now(),
      read: false,
      payload: { type: "idle_notification" },
    }
    writeFileSync(join(pendingDir, "msg_valid.json"), JSON.stringify(validMsg))

    const messages = readInbox(teamName, agentId, config)
    expect(messages.length).toBe(1)
    expect(messages[0].id).toBe("msg_valid")
  })
})
