import { log } from "./logger"

type UnknownRecord = Record<string, unknown>
type RequestFetch = (request: Request) => Promise<Response>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function isRequestFetch(value: unknown): value is RequestFetch {
  return typeof value === "function"
}

function wrapRequestFetch(baseFetch: RequestFetch, auth: string): RequestFetch {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers(request.headers)
    headers.set("Authorization", auth)
    return baseFetch(new Request(request, { headers }))
  }
}

function getInternalClient(client: unknown): UnknownRecord | null {
  if (!isRecord(client)) {
    return null
  }

  const internal = client["_client"]
  return isRecord(internal) ? internal : null
}

function tryInjectViaSetConfigHeaders(internal: UnknownRecord, auth: string): boolean {
  const setConfig = internal["setConfig"]
  if (typeof setConfig !== "function") {
    return false
  }

  ;(setConfig as (config: { headers: Record<string, string> }) => unknown)({
    headers: {
      Authorization: auth,
    },
  })

  return true
}

function tryInjectViaInterceptors(internal: UnknownRecord, auth: string): boolean {
  const interceptors = internal["interceptors"]
  if (!isRecord(interceptors)) {
    return false
  }

  const requestInterceptors = interceptors["request"]
  if (!isRecord(requestInterceptors)) {
    return false
  }

  const use = requestInterceptors["use"]
  if (typeof use !== "function") {
    return false
  }

  ;(
    use as (
      interceptor: (request: Request, options: { headers?: Headers }) => Promise<Request> | Request
    ) => unknown
  )((request: Request): Request => {
    const headers = new Headers(request.headers)
    if (!headers.has("Authorization")) {
      headers.set("Authorization", auth)
    }
    return new Request(request, { headers })
  })

  return true
}

function tryInjectViaFetchWrapper(internal: UnknownRecord, auth: string): boolean {
  const getConfig = internal["getConfig"]
  const setConfig = internal["setConfig"]
  if (typeof getConfig !== "function" || typeof setConfig !== "function") {
    return false
  }

  const config = (getConfig as () => unknown)()
  if (!isRecord(config)) {
    return false
  }

  const fetchValue = config["fetch"]
  if (!isRequestFetch(fetchValue)) {
    return false
  }

  ;(setConfig as (configInput: { fetch: RequestFetch }) => unknown)({
    fetch: wrapRequestFetch(fetchValue, auth),
  })

  return true
}

function tryInjectViaMutableInternalConfig(internal: UnknownRecord, auth: string): boolean {
  const configValue = internal["_config"]
  if (!isRecord(configValue)) {
    return false
  }

  const fetchValue = configValue["fetch"]
  if (!isRequestFetch(fetchValue)) {
    return false
  }

  configValue["fetch"] = wrapRequestFetch(fetchValue, auth)
  return true
}

function tryInjectViaTopLevelFetch(client: unknown, auth: string): boolean {
  if (!isRecord(client)) {
    return false
  }

  const fetchValue = client["fetch"]
  if (!isRequestFetch(fetchValue)) {
    return false
  }

  client["fetch"] = wrapRequestFetch(fetchValue, auth)
  return true
}

function safeInjectionAttempt(step: string, attempt: () => boolean): boolean {
  try {
    return attempt()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log("[opencode-server-auth] Injection step failed", { step, message })
    return false
  }
}

/**
 * Builds HTTP Basic Auth header from environment variables.
 * Uses OPENCODE_SERVER_USERNAME (default: "opencode") and OPENCODE_SERVER_PASSWORD.
 */
export function getServerBasicAuthHeader(): string | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) {
    return undefined
  }

  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  const encoded = Buffer.from(`${username}:${password}`).toString("base64")
  return `Basic ${encoded}`
}

/**
 * Injects server auth into SDK client using a fallback chain to handle SDK shape differences.
 */
export function injectServerAuthIntoClient(client: unknown): void {
  const auth = getServerBasicAuthHeader()
  if (!auth) {
    return
  }

  const internal = getInternalClient(client)
  if (internal) {
    const injectedHeaders = safeInjectionAttempt("setConfigHeaders", () => tryInjectViaSetConfigHeaders(internal, auth))
    const injectedInterceptors = safeInjectionAttempt("interceptors", () => tryInjectViaInterceptors(internal, auth))
    const injectedFetch = safeInjectionAttempt("fetchWrapper", () => tryInjectViaFetchWrapper(internal, auth))
    const injectedMutable = safeInjectionAttempt("mutableInternalConfig", () => tryInjectViaMutableInternalConfig(internal, auth))

    const injected = injectedHeaders || injectedInterceptors || injectedFetch || injectedMutable
    if (!injected) {
      log("[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but SDK client structure is incompatible", {
        keys: Object.keys(internal),
      })
    }
    return
  }

  const injected = safeInjectionAttempt("topLevelFetch", () => tryInjectViaTopLevelFetch(client, auth))
  if (!injected) {
    log("[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but no compatible SDK client found")
  }
}
