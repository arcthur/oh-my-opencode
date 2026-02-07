import type { ParsedTokenLimitError, RecoveryRequest } from "../types"

interface RecoveryDeps {
  client: {
    session: {
      summarize: (opts: {
        path: { id: string }
        body: { providerID: string; modelID: string; auto: boolean }
        query: { directory: string }
      }) => Promise<unknown>
    }
    tui: {
      showToast: (opts: {
        body: {
          title: string
          message: string
          variant: "warning" | "error" | "success"
          duration: number
        }
      }) => Promise<unknown>
    }
  }
  directory: string
}

interface AssistantIdentity {
  providerID?: string
  modelID?: string
}

interface RecoveryToastOptions {
  toast?: boolean
}

const TOKEN_LIMIT_PATTERNS = [
  /(\d+)\s*tokens?\s*>\s*(\d+)\s*maximum/i,
  /prompt.*?(\d+).*?tokens.*?exceeds.*?(\d+)/i,
  /(\d+).*?tokens.*?limit.*?(\d+)/i,
]

function extractTokens(text: string): { currentTokens: number; maxTokens: number } | null {
  for (const pattern of TOKEN_LIMIT_PATTERNS) {
    const matched = text.match(pattern)
    if (!matched) {
      continue
    }

    const a = parseInt(matched[1], 10)
    const b = parseInt(matched[2], 10)
    if (a > b) {
      return { currentTokens: a, maxTokens: b }
    }
    return { currentTokens: b, maxTokens: a }
  }

  return null
}

function coerceErrorText(error: unknown): string | null {
  if (typeof error === "string") {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === "string") {
      return maybeMessage
    }
  }
  return null
}

export function parseTokenLimitError(error: unknown): ParsedTokenLimitError | null {
  const text = coerceErrorText(error)
  if (!text) {
    return null
  }

  const lower = text.toLowerCase()
  if (!lower.includes("token") && !lower.includes("too long") && !lower.includes("context")) {
    return null
  }

  const tokens = extractTokens(text)
  if (!tokens) {
    return {
      currentTokens: 0,
      maxTokens: 0,
    }
  }

  return tokens
}

export async function runRecoveryCompaction(
  deps: RecoveryDeps,
  request: RecoveryRequest,
  identity: AssistantIdentity,
  options?: RecoveryToastOptions
): Promise<boolean> {
  const providerID = request.providerID ?? identity.providerID
  const modelID = request.modelID ?? identity.modelID
  const toastEnabled = options?.toast ?? true

  if (!providerID || !modelID) {
    if (toastEnabled) {
      await deps.client.tui
        .showToast({
          body: {
            title: "Recovery Skipped",
            message: "Missing provider or model metadata for recovery summarize.",
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => undefined)
    }
    return false
  }

  if (toastEnabled) {
    await deps.client.tui
      .showToast({
        body: {
          title: "Context Limit Hit",
          message: "Recovering session with automatic summarize...",
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => undefined)
  }

  await deps.client.session.summarize({
    path: { id: request.sessionID },
    body: {
      providerID,
      modelID,
      auto: true,
    },
    query: { directory: deps.directory },
  })

  return true
}
