import { beforeEach, describe, expect, mock, test } from "bun:test"

const mockSubscribe = mock(async (_input?: unknown) => ({
  stream: new ReadableStream<Uint8Array>(),
}))
const mockPromptAsync = mock(async () => ({}))
const mockPollForCompletion = mock(async () => 0)
const mockProcessEvents = mock(async () => {})
const mockExecuteOnCompleteHook = mock(async () => {})
const mockServerCleanup = mock(() => {})
const mockResolveSession = mock(async () => "ses_run_test")

mock.module("../../plugin-config", () => ({
  loadPluginConfig: () => ({}),
}))

mock.module("./server-connection", () => ({
  createServerConnection: async () => ({
    client: {
      event: {
        subscribe: mockSubscribe,
      },
      session: {
        promptAsync: mockPromptAsync,
      },
    },
    cleanup: mockServerCleanup,
  }),
}))

mock.module("./session-resolver", () => ({
  resolveSession: mockResolveSession,
}))

mock.module("./poll-for-completion", () => ({
  pollForCompletion: mockPollForCompletion,
}))

mock.module("./events", () => ({
  createEventState: () => ({
    messageCount: 0,
    lastPartText: "",
    mainSessionIdle: false,
    mainSessionError: false,
    hasReceivedMeaningfulWork: false,
    currentTool: null,
    lastError: null,
  }),
  processEvents: mockProcessEvents,
  serializeError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}))

mock.module("./json-output", () => ({
  createJsonOutputManager: () => null,
}))

mock.module("./on-complete-hook", () => ({
  executeOnCompleteHook: mockExecuteOnCompleteHook,
}))

const { run } = await import("./runner")

describe("run()", () => {
  beforeEach(() => {
    mockSubscribe.mockClear()
    mockPromptAsync.mockClear()
    mockPollForCompletion.mockClear()
    mockProcessEvents.mockClear()
    mockExecuteOnCompleteHook.mockClear()
    mockServerCleanup.mockClear()
    mockResolveSession.mockClear()
  })

  test("passes directory to event.subscribe for session-scoped events", async () => {
    // #when
    const exitCode = await run({
      message: "hello",
      directory: "/workspace/project",
      timeout: 0,
    })

    // #then
    expect(exitCode).toBe(0)
    expect(mockSubscribe).toHaveBeenCalledWith({
      query: { directory: "/workspace/project" },
    })
  })
})
