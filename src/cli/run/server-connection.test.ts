import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"

const originalConsole = globalThis.console

const mockServerClose = mock(() => {})
const mockCreateOpencode = mock(() =>
  Promise.resolve({
    client: { session: {} },
    server: { url: "http://127.0.0.1:4096", close: mockServerClose },
  })
)
const mockCreateOpencodeClient = mock(() => ({ session: {} }))
const mockIsPortAvailable = mock(() => Promise.resolve(true))
const mockGetAvailableServerPort = mock(() => Promise.resolve({ port: 4096, wasAutoSelected: false }))
const mockConsoleLog = mock(() => {})

mock.module("@opencode-ai/sdk", () => ({
  createOpencode: mockCreateOpencode,
  createOpencodeClient: mockCreateOpencodeClient,
}))

mock.module("../../shared/port-utils", () => ({
  isPortAvailable: mockIsPortAvailable,
  getAvailableServerPort: mockGetAvailableServerPort,
  DEFAULT_SERVER_PORT: 4096,
}))

const { createServerConnection } = await import("./server-connection")

describe("createServerConnection", () => {
  beforeEach(() => {
    mockCreateOpencode.mockClear()
    mockCreateOpencodeClient.mockClear()
    mockIsPortAvailable.mockClear()
    mockGetAvailableServerPort.mockClear()
    mockServerClose.mockClear()
    mockConsoleLog.mockClear()
    globalThis.console = { ...console, log: mockConsoleLog } as typeof console
  })

  afterEach(() => {
    globalThis.console = originalConsole
  })

  it("attach mode returns client with no-op cleanup", async () => {
    const signal = new AbortController().signal
    const attachUrl = "http://localhost:8080"

    const result = await createServerConnection({ attach: attachUrl, signal })

    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: attachUrl })
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("explicit port starts server when port is available", async () => {
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(true)

    const result = await createServerConnection({ port, signal })

    expect(mockIsPortAvailable).toHaveBeenCalledWith(8080, "127.0.0.1")
    expect(mockCreateOpencode).toHaveBeenCalledWith({ signal, port: 8080, hostname: "127.0.0.1" })
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled()
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })

  it("explicit port attaches when port is occupied", async () => {
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(false)

    const result = await createServerConnection({ port, signal })

    expect(mockIsPortAvailable).toHaveBeenCalledWith(8080, "127.0.0.1")
    expect(mockCreateOpencode).not.toHaveBeenCalled()
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:8080" })
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).not.toHaveBeenCalled()
  })

  it("normalizes wildcard hostname to loopback when attaching to occupied port", async () => {
    const signal = new AbortController().signal
    const port = 8080
    mockIsPortAvailable.mockResolvedValueOnce(false)

    await createServerConnection({ port, signal, hostname: "0.0.0.0" })

    expect(mockCreateOpencode).not.toHaveBeenCalled()
    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:8080" })
  })

  it("auto mode uses getAvailableServerPort", async () => {
    const signal = new AbortController().signal
    mockGetAvailableServerPort.mockResolvedValueOnce({ port: 4100, wasAutoSelected: true })

    const result = await createServerConnection({ signal })

    expect(mockGetAvailableServerPort).toHaveBeenCalledWith(4096, "127.0.0.1")
    expect(mockCreateOpencode).toHaveBeenCalledWith({ signal, port: 4100, hostname: "127.0.0.1" })
    expect(mockCreateOpencodeClient).not.toHaveBeenCalled()
    expect(result.client).toBeDefined()
    expect(result.cleanup).toBeDefined()
    result.cleanup()
    expect(mockServerClose).toHaveBeenCalled()
  })

  it("invalid port throws error", async () => {
    const signal = new AbortController().signal

    await expect(createServerConnection({ port: 0, signal })).rejects.toThrow("Port must be between 1 and 65535")
    await expect(createServerConnection({ port: -1, signal })).rejects.toThrow("Port must be between 1 and 65535")
    await expect(createServerConnection({ port: 99999, signal })).rejects.toThrow("Port must be between 1 and 65535")
  })
})
