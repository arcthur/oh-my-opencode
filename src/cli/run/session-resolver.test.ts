import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { resolveSession } from "./session-resolver"
import type { OpencodeClient } from "./types"

const createMockClient = (overrides: {
  getResult?: { error?: unknown; data?: { id: string } }
  createResults?: Array<{ error?: unknown; data?: { id: string } }>
} = {}): OpencodeClient => {
  const { getResult, createResults = [] } = overrides
  let createCallIndex = 0

  return {
    session: {
      get: mock((opts: { path: { id: string } }) =>
        Promise.resolve(getResult ?? { data: { id: opts.path.id } })
      ),
      create: mock(() => {
        const result =
          createResults[createCallIndex] ?? { data: { id: "new-session-id" } }
        createCallIndex++
        return Promise.resolve(result)
      }),
    },
  } as unknown as OpencodeClient
}

describe("resolveSession", () => {
  beforeEach(() => {
    spyOn(console, "log").mockImplementation(() => {})
    spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns provided session ID when session exists", async () => {
    const sessionId = "existing-session-id"
    const mockClient = createMockClient({
      getResult: { data: { id: sessionId } },
    })

    const result = await resolveSession({ client: mockClient, sessionId })

    expect(result).toBe(sessionId)
    expect(mockClient.session.get).toHaveBeenCalledWith({
      path: { id: sessionId },
    })
    expect(mockClient.session.create).not.toHaveBeenCalled()
  })

  it("throws error when provided session ID not found", async () => {
    const sessionId = "non-existent-session-id"
    const mockClient = createMockClient({
      getResult: { error: { message: "Session not found" } },
    })

    const result = resolveSession({ client: mockClient, sessionId })

    await expect(result).rejects.toThrow(`Session not found: ${sessionId}`)
    expect(mockClient.session.get).toHaveBeenCalledWith({
      path: { id: sessionId },
    })
    expect(mockClient.session.create).not.toHaveBeenCalled()
  })

  it("creates new session when no session ID provided", async () => {
    const mockClient = createMockClient({
      createResults: [{ data: { id: "new-session-id" } }],
    })

    const result = await resolveSession({ client: mockClient })

    expect(result).toBe("new-session-id")
    expect(mockClient.session.create).toHaveBeenCalledWith({
      body: {
        title: "oh-my-opencode run",
        permission: [
          { permission: "question", action: "deny", pattern: "*" },
        ],
      },
    })
    expect(mockClient.session.get).not.toHaveBeenCalled()
  })

  it("retries session creation on failure", async () => {
    const mockClient = createMockClient({
      createResults: [
        { error: { message: "Network error" } },
        { data: { id: "retried-session-id" } },
      ],
    })

    const result = await resolveSession({ client: mockClient })

    expect(result).toBe("retried-session-id")
    expect(mockClient.session.create).toHaveBeenCalledTimes(2)
  })

  it("throws after all retries exhausted", async () => {
    const mockClient = createMockClient({
      createResults: [
        { error: { message: "Error 1" } },
        { error: { message: "Error 2" } },
        { error: { message: "Error 3" } },
      ],
    })

    const result = resolveSession({ client: mockClient })

    await expect(result).rejects.toThrow("Failed to create session after all retries")
    expect(mockClient.session.create).toHaveBeenCalledTimes(3)
  })
})
