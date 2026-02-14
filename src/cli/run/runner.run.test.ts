import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { run, type RunDependencies } from "./runner"
import { ORCHESTRATOR_PROJECT_ROOT_ENV } from "../../features/orchestrator-tasks/storage"

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
  let hadProjectRootEnv = false
  let originalProjectRootEnv: string | undefined

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

    hadProjectRootEnv = Object.prototype.hasOwnProperty.call(
      process.env,
      ORCHESTRATOR_PROJECT_ROOT_ENV
    )
    originalProjectRootEnv = process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
  })

  afterEach(() => {
    if (hadProjectRootEnv && originalProjectRootEnv !== undefined) {
      process.env[ORCHESTRATOR_PROJECT_ROOT_ENV] = originalProjectRootEnv
    } else {
      delete process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]
    }
  })

  test("passes directory to event.subscribe for session-scoped events", async () => {
    // #when
    mockPollForCompletion.mockImplementationOnce(async () => {
      expect(process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]).toBe("/workspace/project")
      return 0
    })
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
    expect(process.env[ORCHESTRATOR_PROJECT_ROOT_ENV]).toBeUndefined()
    expect(mockSubscribe).toHaveBeenCalledWith({
      query: { directory: "/workspace/project" },
    })
  })
})
