import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../config/schema"
import { countIncompleteTasks } from "../features/task-system"
import { resolveActiveTaskSelector } from "../features/work-state"
import { log } from "../shared/logger"

const HOOK_NAME = "pre-completion-verification"

const COMPLETION_PATTERNS = [
  /\b(done|completed?|finished|all\s+done)\b/i,
  /\b(task|work|implementation)\s+(is\s+)?(complete|done|finished)\b/i,
  /\ball\s+(tasks?|items?)\s+(are\s+)?(complete|done|finished)\b/i,
  /\bsuccessfully\s+(completed?|implemented|finished)\b/i,
  /\bready\s+(for|to)\s+(review|merge|deploy)\b/i,
]

const VERIFICATION_REMINDER = `
─────────────────────────────────────────────────────
[COMPLETION VERIFICATION REQUIRED]

You claimed completion, but incomplete tasks remain.

Before claiming work is done, you MUST:
1. Run verification commands for each completed task
2. Confirm all tests pass
3. Transition each task to completed with evidence

Current incomplete tasks need to be addressed first.
Use task_transition to update task lifecycle status after verification.
─────────────────────────────────────────────────────
`

interface SessionState {
  lastCompletionClaimTime?: number
  reminderInjected?: boolean
}

export interface PreCompletionVerificationOptions {
  disabled?: boolean
}

function extractTextFromParts(
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

export function createPreCompletionVerificationHook(
  ctx: PluginInput,
  options?: PreCompletionVerificationOptions,
  taskConfig: Partial<OhMyOpenCodeConfig> = {}
) {
  if (options?.disabled) {
    return {}
  }

  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function containsCompletionClaim(text: string): boolean {
    if (!text || typeof text !== "string") return false
    return COMPLETION_PATTERNS.some((pattern) => pattern.test(text))
  }

  const chatMessageHandler = async (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
    },
    output: {
      message: Record<string, unknown>
      parts: Array<{ type: string; text?: string; [key: string]: unknown }>
    }
  ): Promise<void> => {
    const state = getState(input.sessionID)
    const messageText = extractTextFromParts(output.parts)

    if (!containsCompletionClaim(messageText)) {
      state.reminderInjected = false
      return
    }

    if (state.reminderInjected) {
      return
    }

    let incompleteCount = 0
    try {
      const { selector } = resolveActiveTaskSelector(ctx.directory, input.sessionID)
      incompleteCount = countIncompleteTasks(selector, taskConfig)
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to query tasks`, {
        sessionID: input.sessionID,
        error: String(err),
      })
      return
    }

    if (incompleteCount === 0) {
      return
    }

    log(`[${HOOK_NAME}] Completion claim with ${incompleteCount} incomplete tasks`, {
      sessionID: input.sessionID,
      incompleteCount,
      totalTasks: incompleteCount,
    })

    output.parts.push({
      type: "text",
      text: VERIFICATION_REMINDER,
    })
    state.reminderInjected = true
    state.lastCompletionClaimTime = Date.now()
  }

  const eventHandler = async ({
    event,
  }: {
    event: { type: string; properties?: unknown }
  }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessions.delete(sessionInfo.id)
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "user") {
        const state = sessions.get(sessionID)
        if (state) {
          state.reminderInjected = false
        }
      }
    }
  }

  return {
    "chat.message": chatMessageHandler,
    event: eventHandler,
  }
}
