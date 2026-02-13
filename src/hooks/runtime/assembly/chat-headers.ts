import { isSubagentSession } from "../../../features/claude-code-session-state"
import type { RuntimeExecutionNode } from "../types"
import type { ChatHeadersInput, ChatHeadersOutput } from "./types"

export const COPILOT_INTERLEAVED_THINKING_HEADER = "interleaved-thinking-2025-05-14"

interface HeaderModelShape {
  providerID?: string
  modelID?: string
  id?: string
  api?: {
    npm?: string
  }
}

export function appendHeaderToken(existingValue: string | undefined, token: string): string {
  if (!existingValue) {
    return token
  }

  const normalized = existingValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (normalized.includes(token)) {
    return normalized.join(", ")
  }

  return [...normalized, token].join(", ")
}

export function buildChatHeadersNodes(
  input: ChatHeadersInput,
  output: ChatHeadersOutput
): RuntimeExecutionNode[] {
  const model = input.model as HeaderModelShape
  const providerID = (model.providerID ?? "").toLowerCase()
  const modelID = (model.modelID ?? model.id ?? "").toLowerCase()
  const apiNpm = (model.api?.npm ?? "").toLowerCase()
  const isCopilotProvider = providerID.includes("github-copilot")
  const isAnthropicCopilotModel =
    apiNpm === "@ai-sdk/anthropic"
    || (apiNpm === "@ai-sdk/github-copilot" && modelID.includes("claude"))

  const nodes: RuntimeExecutionNode[] = []

  if (isCopilotProvider && isAnthropicCopilotModel) {
    nodes.push({
      id: "internal:copilot-anthropic-beta:chat.headers",
      invoke: async () => {
        const key = "anthropic-beta"
        output.headers[key] = appendHeaderToken(
          output.headers[key],
          COPILOT_INTERLEAVED_THINKING_HEADER
        )
      },
    })
  }

  if (isCopilotProvider && isSubagentSession(input.sessionID)) {
    nodes.push({
      id: "internal:copilot-subagent-initiator:chat.headers",
      invoke: async () => {
        output.headers["x-initiator"] = "agent"
      },
    })
  }

  return nodes
}
