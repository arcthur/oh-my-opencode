import type { PluginInput } from "@opencode-ai/plugin"
import type { OrgMemoryConfig } from "./types"
import { DEFAULT_CONFIG } from "./types"
import { getOrgMemorySummary, addCustomRule, addProtectedPath } from "./storage"
import { log } from "../../shared/logger"

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

interface EventInput {
  event: {
    type: string
    properties?: unknown
  }
}

interface MessageInput {
  sessionID: string
  message: {
    role: string
    content: string
  }
}

/**
 * Creates a hook that injects org/project memory into sessions
 * and captures project-level "remember" requests.
 */
export function createOrgMemoryHook(ctx: PluginInput, userConfig?: Partial<OrgMemoryConfig>) {
  const config: OrgMemoryConfig = { ...DEFAULT_CONFIG, ...userConfig }
  const injectedSessions = new Set<string>()

  // Patterns to detect project-level memory requests
  const PROJECT_REMEMBER_PATTERNS = [
    // "remember for this project that X"
    /\bremember\s+(?:for\s+(?:this\s+)?project|project-wide)\s+(?:that\s+)?(.+)/i,
    // "project rule: X"
    /\bproject\s+rule\s*:\s*(.+)/i,
    // "team convention: X"
    /\b(?:team|org)\s+convention\s*:\s*(.+)/i,
    // "never modify X" -> protected path
    /\bnever\s+(?:modify|change|edit|touch)\s+(.+)/i,
    // "always use X for Y in this project"
    /\balways\s+use\s+(.+)\s+(?:for|in)\s+(?:this\s+)?project/i,
  ]

  // Pattern for protected paths
  const PROTECTED_PATH_PATTERN = /\bnever\s+(?:modify|change|edit|touch)\s+(.+)/i

  async function injectOrgMemory(sessionID: string, output: ToolExecuteOutput): Promise<void> {
    if (!config.enabled || !config.auto_inject) return
    if (injectedSessions.has(sessionID)) return

    const memorySummary = getOrgMemorySummary(ctx.directory, config)
    if (memorySummary) {
      output.output += `\n\n${memorySummary}`
      log("[org-memory] injected project memory", { sessionID })
    }

    injectedSessions.add(sessionID)
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    // Inject on first tool use in session
    if (!injectedSessions.has(input.sessionID)) {
      await injectOrgMemory(input.sessionID, output)
    }
  }

  const userPromptSubmit = async (input: MessageInput) => {
    if (!config.enabled) return

    const content = input.message.content

    // Check for protected path pattern first
    const protectedMatch = content.match(PROTECTED_PATH_PATTERN)
    if (protectedMatch && protectedMatch[1]) {
      const path = protectedMatch[1].trim()
      // Extract just the path, remove trailing punctuation
      const cleanPath = path.replace(/[.,!?;:]+$/, "").trim()
      if (cleanPath.length > 0) {
        addProtectedPath(ctx.directory, cleanPath)
        log("[org-memory] added protected path", { path: cleanPath })
        return
      }
    }

    // Check for project-level remember patterns
    for (const pattern of PROJECT_REMEMBER_PATTERNS) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const rule = match[1].trim()
        if (rule.length > 5) {
          addCustomRule(ctx.directory, rule)
          log("[org-memory] captured project rule", { rule: rule.substring(0, 50) })
        }
        break
      }
    }
  }

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined

    // Clear session state on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        injectedSessions.delete(sessionInfo.id)
      }
    }

    // Clear session state on compaction (will re-inject on next tool use)
    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        injectedSessions.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "user.prompt.submit": userPromptSubmit,
    event: eventHandler,
  }
}
