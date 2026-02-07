import type { ContextWindowSnapshot } from "./types"

interface AssistantMessageInfo {
  role: "assistant"
  providerID: string
  modelID?: string
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

interface MessageWrapper {
  info: { role: string } & Partial<AssistantMessageInfo>
}

interface ProbeDeps {
  client: {
    session: {
      messages: (opts: { path: { id: string } }) => Promise<unknown>
    }
  }
  resolveLimit: (input: { providerID?: string; modelID?: string }) => number
}

interface SnapshotInput {
  sessionID: string
  callID?: string
}

interface ContextWindowProbe {
  getSnapshot: (input: SnapshotInput) => Promise<ContextWindowSnapshot | null>
  getLastSnapshot: (sessionID: string) => ContextWindowSnapshot | undefined
  clearSession: (sessionID: string) => void
}

function selectAssistantMessages(payload: unknown): MessageWrapper[] {
  const wrapper = payload as { data?: MessageWrapper[] } | MessageWrapper[]
  const messages = Array.isArray(wrapper) ? wrapper : (wrapper.data ?? [])

  return messages
    .filter((message) => message.info.role === "assistant")
    .map((message) => message)
}

export function createContextWindowProbe(deps: ProbeDeps): ContextWindowProbe {
  const INVOCATION_CACHE_TTL_MS = 60_000
  const MAX_INVOCATION_CACHE_ENTRIES = 500

  const invocationCache = new Map<
    string,
    { value: ContextWindowSnapshot | null; expiresAt: number }
  >()
  const inFlight = new Map<string, Promise<ContextWindowSnapshot | null>>()
  const latestBySession = new Map<string, ContextWindowSnapshot>()

  const fetchSnapshot = async (sessionID: string): Promise<ContextWindowSnapshot | null> => {
    const response = await deps.client.session.messages({ path: { id: sessionID } })
    const assistantMessages = selectAssistantMessages(response)
    if (assistantMessages.length === 0) {
      return null
    }

    const lastInfo = assistantMessages[assistantMessages.length - 1].info
    const providerID = typeof lastInfo.providerID === "string" ? lastInfo.providerID : undefined
    if (!providerID) {
      return null
    }
    const modelID = typeof lastInfo.modelID === "string" ? lastInfo.modelID : undefined
    const limitTokens = deps.resolveLimit({ providerID, modelID })

    const tokens = (lastInfo as { tokens?: unknown }).tokens as
      | AssistantMessageInfo["tokens"]
      | undefined
    const inputTokens = typeof tokens?.input === "number" ? tokens.input : 0
    const cacheReadTokens = typeof tokens?.cache?.read === "number" ? tokens.cache.read : 0
    const outputTokens = typeof tokens?.output === "number" ? tokens.output : 0
    const usedInputCacheTokens = inputTokens + cacheReadTokens
    const usedTotalTokens = usedInputCacheTokens + outputTokens
    const usageRatio = limitTokens > 0 ? usedInputCacheTokens / limitTokens : 0

    const snapshot: ContextWindowSnapshot = {
      sessionID,
      providerID,
      modelID,
      limitTokens,
      usedInputCacheTokens,
      usedTotalTokens,
      usageRatio,
      capturedAt: Date.now(),
      source: "session.messages",
    }

    latestBySession.set(sessionID, snapshot)
    return snapshot
  }

  const pruneInvocationCache = (now: number): void => {
    if (invocationCache.size === 0) {
      return
    }

    if (invocationCache.size > MAX_INVOCATION_CACHE_ENTRIES) {
      for (const [key, entry] of invocationCache) {
        if (entry.expiresAt <= now) {
          invocationCache.delete(key)
        }
      }

      while (invocationCache.size > MAX_INVOCATION_CACHE_ENTRIES) {
        const oldestKey = invocationCache.keys().next().value as string | undefined
        if (!oldestKey) {
          break
        }
        invocationCache.delete(oldestKey)
      }
    }
  }

  return {
    async getSnapshot(input) {
      const key = input.callID ? `${input.sessionID}:${input.callID}` : undefined

      if (key) {
        const cached = invocationCache.get(key)
        if (cached) {
          if (cached.expiresAt > Date.now()) {
            return cached.value
          }
          invocationCache.delete(key)
        }
      }

      if (key && inFlight.has(key)) {
        return inFlight.get(key) ?? null
      }

      const loader = fetchSnapshot(input.sessionID)
        .catch(() => null)
        .then((snapshot) => {
          if (key) {
            const now = Date.now()
            invocationCache.set(key, { value: snapshot, expiresAt: now + INVOCATION_CACHE_TTL_MS })
            inFlight.delete(key)
            pruneInvocationCache(now)
          }
          return snapshot
        })

      if (key) {
        inFlight.set(key, loader)
      }

      return loader
    },

    getLastSnapshot(sessionID) {
      return latestBySession.get(sessionID)
    },

    clearSession(sessionID) {
      latestBySession.delete(sessionID)
      const keyPrefix = `${sessionID}:`
      for (const key of invocationCache.keys()) {
        if (key.startsWith(keyPrefix)) {
          invocationCache.delete(key)
        }
      }
      for (const key of inFlight.keys()) {
        if (key.startsWith(keyPrefix)) {
          inFlight.delete(key)
        }
      }
    },
  }
}
