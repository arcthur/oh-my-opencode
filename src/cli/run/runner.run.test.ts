import { beforeEach, describe, expect, mock, test } from "bun:test"
import { run, type RunDependencies } from "./runner"

const mockSubscribe = mock(async (_input?: unknown) => ({
  stream: new ReadableStream<Uint8Array>(),
}))
const mockPromptAsync = mock(async () => ({}))
const mockPollForCompletion = mock(async () => 0)
const mockProcessEvents = mock(async () => {})
const mockExecuteOnCompleteHook = mock(async () => {})
const mockServerCleanup = mock(() => {})
const mockResolveSession = mock(async () => "ses_run_test")
const mockLoadPluginConfig = mock(() => ({}))
const mockCreateServerConnection = mock(async () => ({
  client: {
    event: {
      subscribe: mockSubscribe,
    },
    session: {
      promptAsync: mockPromptAsync,
    },
  },
  cleanup: mockServerCleanup,
}))

const TEST_RUN_DEPS: Partial<RunDependencies> = {
  loadPluginConfig: mockLoadPluginConfig,
  createServerConnection: mockCreateServerConnection,
  resolveSession: mockResolveSession,
  pollForCompletion: mockPollForCompletion,
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
  createJsonOutputManager: () => null,
  executeOnCompleteHook: mockExecuteOnCompleteHook,
}

describe("run()", () => {
  beforeEach(() => {
    mockSubscribe.mockClear()
    mockPromptAsync.mockClear()
    mockPollForCompletion.mockClear()
    mockProcessEvents.mockClear()
    mockExecuteOnCompleteHook.mockClear()
    mockServerCleanup.mockClear()
    mockResolveSession.mockClear()
    mockLoadPluginConfig.mockClear()
    mockCreateServerConnection.mockClear()
  })

  test("passes directory to event.subscribe for session-scoped events", async () => {
    // #when
    const exitCode = await run(
      {
        message: "hello",
        directory: "/workspace/project",
        timeout: 0,
      },
      TEST_RUN_DEPS,
    )

    // #then
    expect(exitCode).toBe(0)
    expect(mockSubscribe).toHaveBeenCalledWith({
      query: { directory: "/workspace/project" },
    })
  })
})
