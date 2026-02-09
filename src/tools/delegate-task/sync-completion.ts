export type SyncCompletionState = "complete" | "incomplete" | "unknown"

export interface SyncCompletionMessage {
  info?: {
    id?: string
    role?: string
    finish?: string
  }
}

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])

export function getSyncCompletionState(messages: SyncCompletionMessage[]): SyncCompletionState {
  let lastUser: SyncCompletionMessage | undefined
  let lastAssistant: SyncCompletionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && msg.info?.role === "assistant") lastAssistant = msg
    if (!lastUser && msg.info?.role === "user") lastUser = msg
    if (lastUser && lastAssistant) break
  }

  const finishReason = lastAssistant?.info?.finish
  if (!finishReason) return "unknown"
  if (NON_TERMINAL_FINISH_REASONS.has(finishReason)) return "incomplete"

  const lastUserId = lastUser?.info?.id
  const lastAssistantId = lastAssistant?.info?.id
  if (!lastUserId || !lastAssistantId) return "unknown"

  return lastUserId < lastAssistantId ? "complete" : "incomplete"
}
