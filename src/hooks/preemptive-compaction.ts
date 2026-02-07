/**
 * Preemptive Compaction Hook
 *
 * Automatically triggers session compaction when token usage exceeds the configured threshold.
 * This prevents hitting the context window limit by proactively summarizing the session.
 *
 * Applies to all providers. Anthropic uses its dynamic configured context limit,
 * while non-Anthropic providers use a conservative default limit.
 *
 * Configuration via experimental settings:
 * - experimental.preemptive_compaction: boolean (default: true since v2.9.0)
 * - experimental.preemptive_compaction_threshold: number (default: 0.78)
 */

import { getDefaultAnthropicContextLimit } from "../shared/context-limits"

const DEFAULT_THRESHOLD = 0.78
const DEFAULT_ACTUAL_LIMIT = 200_000

export interface PreemptiveCompactionOptions {
  /** Threshold percentage to trigger compaction (default: 0.78) */
  threshold?: number
}

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

type PluginInput = {
  client: {
    session: {
      messages: (...args: any[]) => any
      summarize: (...args: any[]) => any
    }
    tui: {
      showToast: (...args: any[]) => any
    }
  }
  directory: string
}

export function createPreemptiveCompactionHook(ctx: PluginInput, options?: PreemptiveCompactionOptions) {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD
  const anthropicContextLimit = getDefaultAnthropicContextLimit()
  const compactionInProgress = new Set<string>()
  const compactedSessions = new Set<string>()

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown }
  ) => {
    const { sessionID } = input
    if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return

    try {
      const response = await ctx.client.session.messages({
        path: { id: sessionID },
      })
      const payload = response as { data?: MessageWrapper[] } | MessageWrapper[]
      const messages = Array.isArray(payload) ? payload : (payload.data ?? [])
      const assistantMessages = messages
        .filter((m) => m.info.role === "assistant")
        .map((m) => m.info as AssistantMessageInfo)

      if (assistantMessages.length === 0) return

      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      const actualLimit =
        lastAssistant.providerID === "anthropic"
          ? anthropicContextLimit
          : DEFAULT_ACTUAL_LIMIT

      const lastTokens = lastAssistant.tokens
      const totalInputTokens = (lastTokens?.input ?? 0) + (lastTokens?.cache?.read ?? 0)
      const usageRatio = totalInputTokens / actualLimit

      if (usageRatio < threshold) return

      const modelID = lastAssistant.modelID
      if (!modelID) return

      compactionInProgress.add(sessionID)

      await ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID: lastAssistant.providerID, modelID, auto: true } as never,
        query: { directory: ctx.directory },
      })

      compactedSessions.add(sessionID)
    } catch {
      // best-effort; do not disrupt tool execution
    } finally {
      compactionInProgress.delete(sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type !== "session.deleted") return
    const props = event.properties as Record<string, unknown> | undefined
    const sessionInfo = props?.info as { id?: string } | undefined
    if (sessionInfo?.id) {
      compactionInProgress.delete(sessionInfo.id)
      compactedSessions.delete(sessionInfo.id)
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
