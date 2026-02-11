import { createBackgroundOutput, createBackgroundTask } from "./tools"
import type { BackgroundTask } from "../../features/background-agent"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundOutputManager, BackgroundOutputClient } from "./tools"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createMockManager(task: BackgroundTask): BackgroundOutputManager {
  return {
    getTask: (id: string) => (id === task.id ? task : undefined),
  }
}

function createMockClient(messagesBySession: Record<string, BackgroundOutputMessage[]>): BackgroundOutputClient {
  const emptyMessages: BackgroundOutputMessage[] = []
  const client = {
    session: {
      messages: async ({ path }: { path: { id: string } }) => ({
        data: messagesBySession[path.id] ?? emptyMessages,
      }),
    },
  } satisfies BackgroundOutputClient
  return client
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides,
  }
}

describe("background_output full_session", () => {
  test("includes thinking and tool results when enabled", async () => {
    // given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z", agent: "test" },
          parts: [
            { type: "text", text: "hello" },
            { type: "thinking", thinking: "thinking text" },
            { type: "tool_result", content: "tool output" },
          ],
        },
        {
          id: "m2",
          info: { role: "assistant", time: "2026-01-01T00:00:01Z" },
          parts: [
            { type: "reasoning", text: "reasoning text" },
            { type: "text", text: "after" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
      include_tool_results: true,
    }, mockContext)

    // then
    expect(output).toContain("thinking text")
    expect(output).toContain("reasoning text")
    expect(output).toContain("tool output")
  })

  test("respects since_message_id exclusive filtering", async () => {
    // given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "hello" }],
        },
        {
          id: "m2",
          info: { role: "assistant", time: "2026-01-01T00:00:01Z" },
          parts: [{ type: "text", text: "after" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      since_message_id: "m1",
    }, mockContext)

    // then
    expect(output.includes("hello")).toBe(false)
    expect(output).toContain("after")
  })

  test("returns error when since_message_id not found", async () => {
    // given
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      since_message_id: "missing",
    }, mockContext)

    // then
    expect(output).toContain("since_message_id not found")
  })

  test("caps message_limit at 100", async () => {
    // given
    const task = createTask()
    const manager = createMockManager(task)
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: `m${index}`,
      info: {
        role: "assistant",
        time: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      },
      parts: [{ type: "text", text: `message-${index}` }],
    }))
    const client = createMockClient({ "ses-1": messages })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      message_limit: 200,
    }, mockContext)

    // then
    expect(output).toContain("Returned: 100")
    expect(output).toContain("Has more: true")
  })

  test("keeps legacy status output when full_session is false", async () => {
    // given
    const task = createTask({ status: "running" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({ task_id: "task-1" }, mockContext)

    // then
    expect(output).toContain("# Task Status")
    expect(output).toContain("Task ID")
  })

  test("shows interrupted note for interrupt status", async () => {
    // given
    const task = createTask({ status: "interrupt", error: "prompt interrupted" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({ task_id: "task-1" }, mockContext)

    // then
    expect(output).toContain("**interrupt**")
    expect(output).toContain("**Interrupted**")
  })

  test("returns immediately for interrupt status even when block=true", async () => {
    // given
    const task = createTask({ status: "interrupt", error: "prompt interrupted" })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({ task_id: "task-1", block: true, timeout: 1000 }, mockContext)

    // then
    expect(output).toContain("# Task Status")
    expect(output).toContain("**interrupt**")
  })

  test("truncates thinking content to thinking_max_chars", async () => {
    // given
    const longThinking = "x".repeat(500)
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [
            { type: "thinking", thinking: longThinking },
            { type: "text", text: "hello" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
      thinking_max_chars: 100,
    }, mockContext)

    // then
    expect(output).toContain("[thinking] " + "x".repeat(100) + "...")
    expect(output).not.toContain("x".repeat(200))
  })

  test("uses default 2000 chars when thinking_max_chars not provided", async () => {
    // given
    const longThinking = "y".repeat(2500)
    const task = createTask()
    const manager = createMockManager(task)
    const client = createMockClient({
      "ses-1": [
        {
          id: "m1",
          info: { role: "assistant", time: "2026-01-01T00:00:00Z" },
          parts: [
            { type: "thinking", thinking: longThinking },
            { type: "text", text: "hello" },
          ],
        },
      ],
    })
    const tool = createBackgroundOutput(manager, client)

    // when
    const output = await tool.execute({
      task_id: "task-1",
      full_session: true,
      include_thinking: true,
    }, mockContext)

    // then
    expect(output).toContain("[thinking] " + "y".repeat(2000) + "...")
    expect(output).not.toContain("y".repeat(2100))
  })
})
type BackgroundOutputMessage = {
  id?: string
  info?: { role?: string; time?: string | { created?: number }; agent?: string }
  parts?: Array<{
    type?: string
    text?: string
    thinking?: string
    content?: string | Array<{ type: string; text?: string }>
  }>
}

describe("background_output metadata title resolution", () => {
  test("uses category label for sisyphus-junior tasks", async () => {
    // given
    const task = createTask({
      id: "task-meta-1",
      agent: "sisyphus-junior",
      category: "deep",
      description: "Investigate flaky test",
      status: "running",
    })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    let metadataInput: { title?: string; metadata?: Record<string, unknown> } | undefined
    const contextWithMeta: ToolContext = {
      ...mockContext,
      metadata: (input) => {
        metadataInput = input
      },
    }

    // when
    await tool.execute({ task_id: "task-meta-1" }, contextWithMeta)

    // then
    expect(metadataInput?.title).toBe("deep - Investigate flaky test")
    expect(metadataInput?.metadata?.task_id).toBe("task-meta-1")
  })

  test("uses agent label for non-sisyphus-junior tasks", async () => {
    // given
    const task = createTask({
      id: "task-meta-2",
      agent: "oracle",
      description: "Summarize logs",
      status: "running",
    })
    const manager = createMockManager(task)
    const client = createMockClient({})
    const tool = createBackgroundOutput(manager, client)

    let metadataInput: { title?: string; metadata?: Record<string, unknown> } | undefined
    const contextWithMeta: ToolContext = {
      ...mockContext,
      metadata: (input) => {
        metadataInput = input
      },
    }

    // when
    await tool.execute({ task_id: "task-meta-2" }, contextWithMeta)

    // then
    expect(metadataInput?.title).toBe("oracle - Summarize logs")
    expect(metadataInput?.metadata?.agent).toBe("oracle")
  })
})

describe("background_task session id fallback", () => {
  test("returns pending session id instead of undefined when task is queued", async () => {
    // given
    const manager = {
      launch: async () => ({
        id: "bg_pending_1",
        sessionID: undefined,
        description: "queued task",
        agent: "explore",
        status: "pending",
      }),
    } as any

    const tool = createBackgroundTask(manager)
    let metadataInput: { title?: string; metadata?: Record<string, unknown> } | undefined
    const contextWithMeta: ToolContext = {
      ...mockContext,
      metadata: (input) => {
        metadataInput = input
      },
    }

    // when
    const output = await tool.execute(
      {
        description: "queued task",
        prompt: "run queued background task",
        agent: "explore",
      },
      contextWithMeta
    )

    // then
    expect(output).toContain("Session ID: pending")
    expect(output).not.toContain("Session ID: undefined")
    expect(metadataInput?.metadata?.sessionId).toBe("pending")
  })
})
