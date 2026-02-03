import { afterEach, describe, expect, it } from "bun:test"
import { findAvailablePort, startCallbackServer, type CallbackServer } from "./callback-server"

function canListenOnLocalhost(): boolean {
  for (let port = 30_000; port < 30_050; port++) {
    try {
      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: () => new Response(),
      })
      server.stop(true)
      return true
    } catch {
      // try next port
    }
  }
  return false
}

const describeIfCanListen = canListenOnLocalhost() ? describe : describe.skip

describeIfCanListen("findAvailablePort", () => {
  it("returns the start port when it is available", async () => {
    // given
    const startPort = 30_000

    // when
    const port = await findAvailablePort(startPort)

    // then
    expect(port).toBeGreaterThanOrEqual(startPort)
    expect(port).toBeLessThan(startPort + 20)
  })

  it("skips busy ports and returns next available", async () => {
    // given
    const basePort = await findAvailablePort(30_000)
    const blocker = Bun.serve({
      port: basePort,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    })

    // when
    const port = await findAvailablePort(basePort)

    // then
    expect(port).toBeGreaterThan(basePort)
    blocker.stop(true)
  })
})

describeIfCanListen("startCallbackServer", () => {
  let server: CallbackServer | null = null

  afterEach(() => {
    server?.close()
    server = null
  })

  it("starts server and returns port", async () => {
    // given - no preconditions

    // when
    server = await startCallbackServer()

    // then
    expect(server.port).toBeGreaterThanOrEqual(19877)
    expect(typeof server.waitForCallback).toBe("function")
    expect(typeof server.close).toBe("function")
  })

  it("resolves callback with code and state from query params", async () => {
    // given
    server = await startCallbackServer()
    const callbackUrl = `http://127.0.0.1:${server.port}/oauth/callback?code=test-code&state=test-state`

    // when
    const fetchPromise = fetch(callbackUrl)
    const result = await server.waitForCallback()
    const response = await fetchPromise

    // then
    expect(result).toEqual({ code: "test-code", state: "test-state" })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain("Authorization successful")
  })

  it("returns 404 for non-callback routes", async () => {
    // given
    server = await startCallbackServer()

    // when
    const response = await fetch(`http://127.0.0.1:${server.port}/other`)

    // then
    expect(response.status).toBe(404)
  })

  it("returns 400 and rejects when code is missing", async () => {
    // given
    server = await startCallbackServer()
    const callbackRejection = server.waitForCallback().catch((e: Error) => e)

    // when
    const response = await fetch(`http://127.0.0.1:${server.port}/oauth/callback?state=s`)

    // then
    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("returns 400 and rejects when state is missing", async () => {
    // given
    server = await startCallbackServer()
    const callbackRejection = server.waitForCallback().catch((e: Error) => e)

    // when
    const response = await fetch(`http://127.0.0.1:${server.port}/oauth/callback?code=c`)

    // then
    expect(response.status).toBe(400)
    const error = await callbackRejection
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("missing code or state")
  })

  it("close stops the server immediately", async () => {
    // given
    server = await startCallbackServer()
    const port = server.port

    // when
    server.close()
    server = null

    // then
    try {
      await fetch(`http://127.0.0.1:${port}/oauth/callback?code=c&state=s`)
      expect(true).toBe(false)
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})
