import { describe, expect, mock, test, beforeEach } from "bun:test"

const mockPromptWithModelSuggestionRetry = mock(async () => {})

mock.module("../../shared", () => ({
  log: mock(() => {}),
  getAgentToolRestrictions: () => ({}),
  promptWithModelSuggestionRetry: mockPromptWithModelSuggestionRetry,
}))

describe("background-agent spawner", () => {
  beforeEach(() => {
    mockPromptWithModelSuggestionRetry.mockReset()
    mockPromptWithModelSuggestionRetry.mockImplementation(async () => {})
  })

  test("uses LaunchInput.directory when provided", async () => {
    // #given
    const { startTask, createTask } = require("./spawner")

    const mockGet = mock(async () => ({ data: { directory: "/parent-dir" } }))
    const mockCreate = mock(async (req: unknown) => ({ data: { id: "ses_child" }, req }))

    const client = {
      session: {
        get: mockGet,
        create: mockCreate,
      },
    }

    const input = {
      description: "test",
      prompt: "do it",
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
      directory: "/worktree-dir",
    }

    const task = createTask(input)
    const item = { task, input }

    const concurrencyManager = { release: mock(() => {}) }
    const onTaskError = mock(() => {})

    // #when
    await startTask(item, {
      client,
      directory: "/default-dir",
      concurrencyManager,
      onTaskError,
    })

    // #then
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const createArgs = mockCreate.mock.calls[0]?.[0] as { query?: { directory?: string } } | undefined
    expect(createArgs?.query?.directory).toBe("/worktree-dir")
  })

  test("defaults to parent session directory when LaunchInput.directory is not set", async () => {
    // #given
    const { startTask, createTask } = require("./spawner")

    const mockGet = mock(async () => ({ data: { directory: "/parent-dir" } }))
    const mockCreate = mock(async (req: unknown) => ({ data: { id: "ses_child" }, req }))

    const client = {
      session: {
        get: mockGet,
        create: mockCreate,
      },
    }

    const input = {
      description: "test",
      prompt: "do it",
      agent: "explore",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    }

    const task = createTask(input)
    const item = { task, input }

    const concurrencyManager = { release: mock(() => {}) }
    const onTaskError = mock(() => {})

    // #when
    await startTask(item, {
      client,
      directory: "/default-dir",
      concurrencyManager,
      onTaskError,
    })

    // #then
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const createArgs = mockCreate.mock.calls[0]?.[0] as { query?: { directory?: string } } | undefined
    expect(createArgs?.query?.directory).toBe("/parent-dir")
  })
})
