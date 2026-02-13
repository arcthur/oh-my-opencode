import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getServerBasicAuthHeader, injectServerAuthIntoClient } from "./opencode-server-auth"

describe("opencode-server-auth", () => {
  const originalEnv = {
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD,
    OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME,
  }

  const restoreEnv = (key: "OPENCODE_SERVER_PASSWORD" | "OPENCODE_SERVER_USERNAME", value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  }

  beforeEach(() => {
    restoreEnv("OPENCODE_SERVER_PASSWORD", originalEnv.OPENCODE_SERVER_PASSWORD)
    restoreEnv("OPENCODE_SERVER_USERNAME", originalEnv.OPENCODE_SERVER_USERNAME)
  })

  afterEach(() => {
    restoreEnv("OPENCODE_SERVER_PASSWORD", originalEnv.OPENCODE_SERVER_PASSWORD)
    restoreEnv("OPENCODE_SERVER_USERNAME", originalEnv.OPENCODE_SERVER_USERNAME)
  })

  test("#given no password #when building auth header #then returns undefined", () => {
    // #given
    delete process.env.OPENCODE_SERVER_PASSWORD

    // #when
    const result = getServerBasicAuthHeader()

    // #then
    expect(result).toBeUndefined()
  })

  test("#given password without username #when building auth header #then uses default opencode username", () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    // #when
    const result = getServerBasicAuthHeader()

    // #then
    expect(result).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given password with username #when building auth header #then uses custom username", () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "arthur"

    // #when
    const result = getServerBasicAuthHeader()

    // #then
    expect(result).toBe("Basic YXJ0aHVyOnNlY3JldA==")
  })

  test("#given server password #when injecting via setConfig headers #then Authorization header is set", () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedHeadersConfig: { headers: Record<string, string> } | undefined
    const client = {
      _client: {
        setConfig: (config: { headers?: Record<string, string> }) => {
          if (config.headers) {
            receivedHeadersConfig = { headers: config.headers }
          }
        },
      },
    }

    // #when
    injectServerAuthIntoClient(client)

    // #then
    expect(receivedHeadersConfig).toEqual({
      headers: {
        Authorization: "Basic b3BlbmNvZGU6c2VjcmV0",
      },
    })
  })

  test("#given server password #when injecting wraps internal fetch #then wrapped fetch adds Authorization header", async () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    type InternalConfig = {
      fetch?: (request: Request) => Promise<Response>
      headers?: Record<string, string>
    }

    let currentConfig: InternalConfig = {
      fetch: baseFetch,
      headers: {},
    }

    const client = {
      _client: {
        getConfig: (): InternalConfig => ({ ...currentConfig }),
        setConfig: (config: InternalConfig): InternalConfig => {
          currentConfig = { ...currentConfig, ...config }
          return { ...currentConfig }
        },
      },
    }

    // #when
    injectServerAuthIntoClient(client)
    if (!currentConfig.fetch) {
      throw new Error("expected fetch to be set")
    }
    await currentConfig.fetch(new Request("http://example.com"))

    // #then
    expect(receivedAuthorization).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when internal has _config.fetch but no setConfig #then fetch is wrapped and injects Authorization", async () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    const internal = {
      _config: {
        fetch: baseFetch,
      },
    }

    const client = {
      _client: internal,
    }

    // #when
    injectServerAuthIntoClient(client)
    await internal._config.fetch(new Request("http://example.com"))

    // #then
    expect(receivedAuthorization).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given setConfig throws #when internal has mutable _config.fetch #then fallback still injects Authorization", async () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    const internal = {
      setConfig: () => {
        throw new Error("setConfig incompatible")
      },
      _config: {
        fetch: baseFetch,
      },
    }

    const client = {
      _client: internal,
    }

    // #when
    injectServerAuthIntoClient(client)
    await internal._config.fetch(new Request("http://example.com"))

    // #then
    expect(receivedAuthorization).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when client has top-level fetch #then fetch is wrapped and injects Authorization", async () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    const client = {
      fetch: baseFetch,
    }

    // #when
    injectServerAuthIntoClient(client)
    await client.fetch(new Request("http://example.com"))

    // #then
    expect(receivedAuthorization).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when interceptors are available #then request interceptor injects Authorization", async () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let registeredInterceptor:
      | ((request: Request, options: { headers?: Headers }) => Promise<Request> | Request)
      | undefined

    const client = {
      _client: {
        interceptors: {
          request: {
            use: (
              interceptor: (request: Request, options: { headers?: Headers }) => Promise<Request> | Request
            ): number => {
              registeredInterceptor = interceptor
              return 0
            },
          },
        },
      },
    }

    // #when
    injectServerAuthIntoClient(client)
    if (!registeredInterceptor) {
      throw new Error("expected interceptor to be registered")
    }
    const request = new Request("http://example.com")
    const result = await registeredInterceptor(request, {})

    // #then
    expect(result.headers.get("Authorization")).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given no server password #when injecting into client with fetch #then does not wrap fetch", async () => {
    // #given
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    type InternalConfig = { fetch?: (request: Request) => Promise<Response> }
    let currentConfig: InternalConfig = { fetch: baseFetch }
    let setConfigCalled = false

    const client = {
      _client: {
        getConfig: (): InternalConfig => ({ ...currentConfig }),
        setConfig: (config: InternalConfig): InternalConfig => {
          setConfigCalled = true
          currentConfig = { ...currentConfig, ...config }
          return { ...currentConfig }
        },
      },
    }

    // #when
    injectServerAuthIntoClient(client)
    if (!currentConfig.fetch) {
      throw new Error("expected fetch to exist")
    }
    await currentConfig.fetch(new Request("http://example.com"))

    // #then
    expect(setConfigCalled).toBe(false)
    expect(receivedAuthorization).toBeNull()
  })

  test("#given server password #when client has no compatible structure #then does not throw", () => {
    // #given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"

    // #when #then
    expect(() => injectServerAuthIntoClient({})).not.toThrow()
    expect(() => injectServerAuthIntoClient(null)).not.toThrow()
    expect(() => injectServerAuthIntoClient(undefined)).not.toThrow()
  })
})
