import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { buildAuthURL, exchangeCode, startCallbackServer } from "./oauth"
import { ANTIGRAVITY_CLIENT_ID, GOOGLE_TOKEN_URL, ANTIGRAVITY_CALLBACK_PORT } from "./constants"

describe("OAuth PKCE Removal", () => {
  describe("buildAuthURL", () => {
    it("should NOT include code_challenge parameter", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)

      // #then
      expect(url.searchParams.has("code_challenge")).toBe(false)
    })

    it("should NOT include code_challenge_method parameter", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)

      // #then
      expect(url.searchParams.has("code_challenge_method")).toBe(false)
    })

    it("should include state parameter for CSRF protection", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)
      const state = url.searchParams.get("state")

      // #then
      expect(state).toBeTruthy()
    })

    it("should have state as simple random string (not JSON/base64)", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)
      const state = url.searchParams.get("state")!

      // #then - positive assertions for simple random string
      expect(state.length).toBeGreaterThanOrEqual(16)
      expect(state.length).toBeLessThanOrEqual(64)
      // Should be URL-safe (alphanumeric, no special chars like { } " :)
      expect(state).toMatch(/^[a-zA-Z0-9_-]+$/)
      // Should NOT contain JSON indicators
      expect(state).not.toContain("{")
      expect(state).not.toContain("}")
      expect(state).not.toContain('"')
    })

    it("should include access_type=offline", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)

      // #then
      expect(url.searchParams.get("access_type")).toBe("offline")
    })

    it("should include prompt=consent", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)

      // #then
      expect(url.searchParams.get("prompt")).toBe("consent")
    })

    it("should NOT return verifier property (PKCE removed)", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)

      // #then
      expect(result).not.toHaveProperty("verifier")
      expect(result).toHaveProperty("url")
      expect(result).toHaveProperty("state")
    })

    it("should return state that matches URL state param", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result = await buildAuthURL(projectId)
      const url = new URL(result.url)

      // #then
      expect(result.state).toBe(url.searchParams.get("state")!)
    })
  })

  describe("exchangeCode", () => {
    let originalFetch: typeof fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it("should NOT send code_verifier in token exchange", async () => {
      // #given
      let capturedBody: string | null = null
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        if (url === GOOGLE_TOKEN_URL) {
          capturedBody = init?.body as string
          return new Response(JSON.stringify({
            access_token: "test-access",
            refresh_token: "test-refresh",
            expires_in: 3600,
            token_type: "Bearer"
          }))
        }
        return new Response("", { status: 404 })
      }) as unknown as typeof fetch

      // #when
      await exchangeCode("test-code", "http://localhost:51121/oauth-callback")

      // #then
      expect(capturedBody).toBeTruthy()
      const params = new URLSearchParams(capturedBody!)
      expect(params.has("code_verifier")).toBe(false)
    })

    it("should send required OAuth parameters", async () => {
      // #given
      let capturedBody: string | null = null
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        if (url === GOOGLE_TOKEN_URL) {
          capturedBody = init?.body as string
          return new Response(JSON.stringify({
            access_token: "test-access",
            refresh_token: "test-refresh",
            expires_in: 3600,
            token_type: "Bearer"
          }))
        }
        return new Response("", { status: 404 })
      }) as unknown as typeof fetch

      // #when
      await exchangeCode("test-code", "http://localhost:51121/oauth-callback")

      // #then
      const params = new URLSearchParams(capturedBody!)
      expect(params.get("grant_type")).toBe("authorization_code")
      expect(params.get("code")).toBe("test-code")
      expect(params.get("client_id")).toBe(ANTIGRAVITY_CLIENT_ID)
      expect(params.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback")
    })
  })

  describe("State/CSRF Validation", () => {
    it("should generate unique state for each call", async () => {
      // #given
      const projectId = "test-project"

      // #when
      const result1 = await buildAuthURL(projectId)
      const result2 = await buildAuthURL(projectId)

      // #then
      expect(result1.state).not.toBe(result2.state)
    })
  })

  describe("startCallbackServer Port Handling", () => {
    it("should prefer port 51121", () => {
      // #given
      const stop = mock(() => {})
      const serve = mock((options: { port: number }) => {
        return { port: options.port, stop } as unknown as ReturnType<typeof Bun.serve>
      })

      // #when
      const handle = startCallbackServer(5 * 60 * 1000, serve as unknown as typeof Bun.serve)

      // #then
      expect(serve).toHaveBeenCalledTimes(1)
      expect(serve.mock.calls[0][0].port).toBe(ANTIGRAVITY_CALLBACK_PORT)
      expect(handle.port).toBe(ANTIGRAVITY_CALLBACK_PORT)
      expect(handle.redirectUri).toBe(`http://localhost:${handle.port}/oauth-callback`)
      handle.close()
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it("should fallback to OS-assigned port if 51121 is occupied (EADDRINUSE)", () => {
      // #given
      const stop = mock(() => {})
      const fallbackPort = 61234
      const serve = mock((options: { port: number }) => {
        if (options.port === ANTIGRAVITY_CALLBACK_PORT) {
          throw Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" })
        }
        return { port: fallbackPort, stop } as unknown as ReturnType<typeof Bun.serve>
      })

      // #when
      const handle = startCallbackServer(5 * 60 * 1000, serve as unknown as typeof Bun.serve)

      // #then
      expect(serve).toHaveBeenCalledTimes(2)
      expect(serve.mock.calls[0][0].port).toBe(ANTIGRAVITY_CALLBACK_PORT)
      expect(serve.mock.calls[1][0].port).toBe(0)
      expect(handle.port).toBe(fallbackPort)
      expect(handle.port).not.toBe(ANTIGRAVITY_CALLBACK_PORT)
      handle.close()
      expect(stop).toHaveBeenCalledTimes(1)
    })

    it("should cleanup server on close (idempotent)", () => {
      // #given
      const stop = mock(() => {})
      const serve = mock((options: { port: number }) => {
        return { port: options.port, stop } as unknown as ReturnType<typeof Bun.serve>
      })
      const handle = startCallbackServer(5 * 60 * 1000, serve as unknown as typeof Bun.serve)

      // #when
      handle.close()
      handle.close()

      // #then
      expect(stop).toHaveBeenCalledTimes(1)
    })
  })
})
