/**
 * Conditional Rules Hook
 *
 * Injects context-sensitive rules at:
 * 1. tool.execute.before (Read/Edit/Write) - file-specific rules
 * 2. tool.execute.before:delegate_task - append rules to delegation prompt
 */

import { isAbsolute, relative } from "node:path"
import { injectHookMessage } from "../hook-message-injector"
import { log } from "../../shared/logger"
import { RuleMatcher, formatRulesForInjection, formatRulesForDelegation } from "./matcher"
import { loadAllRules, extractFileMentions, shouldReloadRules } from "./loader"
import type { ConditionalRulesConfig, RuleMatchContext } from "./types"
import { DEFAULT_CONDITIONAL_RULES_CONFIG } from "./types"
import { contextBudgetArbiter } from "../context-view"

// ============================================================================
// Hook State
// ============================================================================

interface HookState {
  matcher: RuleMatcher | null
  lastLoadTime: number
  projectRoot: string
}

// Per-project state to handle multiple projects
const stateByProject = new Map<string, HookState>()

/**
 * Get or create state for a project
 */
function getState(projectRoot: string): HookState {
  if (!stateByProject.has(projectRoot)) {
    stateByProject.set(projectRoot, {
      matcher: null,
      lastLoadTime: 0,
      projectRoot,
    })
  }
  return stateByProject.get(projectRoot)!
}

/**
 * Get matcher, reloading if necessary
 */
async function getMatcher(projectRoot: string, config: ConditionalRulesConfig): Promise<RuleMatcher> {
  const state = getState(projectRoot)

  if (!state.matcher || shouldReloadRules(state.lastLoadTime)) {
    const rules = await loadAllRules(projectRoot, config)
    state.matcher = new RuleMatcher(rules)
    state.lastLoadTime = Date.now()

    log("[conditional-rules] matcher initialized", {
      projectRoot,
      ruleCount: state.matcher.getEnabledCount(),
    })
  }

  return state.matcher
}

// ============================================================================
// File Tools Hook
// ============================================================================

const FILE_TOOLS = new Set(["read", "edit", "write", "multiedit"])
const FILE_PATH_KEYS = ["file_path", "filePath", "path", "file", "notebook_path"] as const

function getFirstStringArg(
  args: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === "string" && value.trim()) {
      return value
    }
  }
  return undefined
}

type InjectedRuleIdsBySession = Map<string, Set<string>>

/**
 * Create hook for file operations
 */
function createFileToolsHookImpl(
  config: ConditionalRulesConfig,
  injectedPerSession: InjectedRuleIdsBySession
) {
  return async (params: {
    tool: string
    args: Record<string, unknown>
    sessionId: string
    context: { cwd: string; agent?: string }
  }) => {
    const { tool, args, sessionId, context } = params

    // Only process file-related tools
    const toolName = tool.toLowerCase()
    if (!FILE_TOOLS.has(toolName)) return

    const filePath = getFirstStringArg(args, FILE_PATH_KEYS)
    if (!filePath) return

    // Get or initialize session tracking
    if (!injectedPerSession.has(sessionId)) {
      injectedPerSession.set(sessionId, new Set())
    }
    const injected = injectedPerSession.get(sessionId)!

    try {
      const matcher = await getMatcher(context.cwd, config)

      // Build match context
      const relativePath = isAbsolute(filePath) ? relative(context.cwd, filePath) : filePath

      const matchContext: RuleMatchContext = {
        files: [relativePath],
        cwd: context.cwd,
        agent: context.agent,
      }

      const matched = matcher.match(matchContext)
      if (matched.length === 0) return

      // Filter out already-injected rules for this session
      const newMatches = matched.filter((m) => !injected.has(m.rule.id))
      if (newMatches.length === 0) return

      // Mark as injected
      newMatches.forEach((m) => injected.add(m.rule.id))

      // Format and inject
      const injection = formatRulesForInjection(newMatches)

      injectHookMessage(sessionId, injection, {
        agent: context.agent || "general",
      }, {
        source: "conditional-rules",
        channel: "synthetic-message",
        id: `file:${relativePath}:${newMatches.map((m) => m.rule.id).join(",")}`,
        priority: "high",
      })

      log("[conditional-rules] injected file rules", {
        sessionId,
        file: relativePath,
        ruleCount: newMatches.length,
        ruleIds: newMatches.map((m) => m.rule.id),
      })
    } catch (error) {
      log("[conditional-rules] error in file tools hook", {
        error: String(error),
        tool,
        filePath,
      })
    }
  }
}

/**
 * Create hook for file operations
 */
export function createFileToolsHook(config: ConditionalRulesConfig = DEFAULT_CONDITIONAL_RULES_CONFIG) {
  return createFileToolsHookImpl(config, new Map())
}

// ============================================================================
// Delegate Task Hook
// ============================================================================

/**
 * Create hook for delegate_task
 * This appends relevant rules to the delegation prompt
 */
export function createDelegateTaskHook(config: ConditionalRulesConfig = DEFAULT_CONDITIONAL_RULES_CONFIG) {
  return async (params: {
    args: Record<string, unknown>
    sessionId: string
    context: { cwd: string; agent?: string }
  }): Promise<{ args: Record<string, unknown> } | void> => {
    const { args, context } = params

    const prompt = args.prompt as string | undefined
    const category = args.category as string | undefined
    const skills = args.skills as string[] | undefined

    if (!prompt) return

    try {
      const matcher = await getMatcher(context.cwd, config)

      // Extract file mentions from prompt
      const mentionedFiles = extractFileMentions(prompt)

      // Build match context
      const matchContext: RuleMatchContext = {
        files: mentionedFiles,
        cwd: context.cwd,
        agent: context.agent,
        category,
        taskPhase: "implementation",
        skill: skills?.[0], // Primary skill
      }

      const matched = matcher.match(matchContext)
      if (matched.length === 0) return

      // Format rules for delegation
      const rulesContent = formatRulesForDelegation(matched)
      const appendBlock = `\n\n---\n\n## Applicable Rules\n\n${rulesContent}`
      const decision = contextBudgetArbiter.decide({
        sessionID: params.sessionId,
        source: "conditional-rules",
        channel: "delegate-prompt",
        id: `delegate:${category ?? "none"}:${matched.map((m) => m.rule.id).join(",")}`,
        priority: "high",
        content: appendBlock,
      })
      if (!decision.accepted) return

      log("[conditional-rules] appending rules to delegate_task", {
        category,
        mentionedFiles,
        ruleCount: matched.length,
      })

      // Return modified args with appended rules
      return {
        args: {
          ...args,
          prompt: `${prompt}${decision.finalContent}`,
        },
      }
    } catch (error) {
      log("[conditional-rules] error in delegate_task hook", {
        error: String(error),
      })
    }
  }
}

// ============================================================================
// Combined Hook Creator
// ============================================================================

export interface ConditionalRulesHookContext {
  config: ConditionalRulesConfig
}

/**
 * Create all conditional rules hooks
 */
export function createConditionalRulesHooks(ctx: ConditionalRulesHookContext) {
  const { config } = ctx

  const injectedPerSession: InjectedRuleIdsBySession = new Map()
  const fileToolsHook = createFileToolsHookImpl(config, injectedPerSession)
  const delegateTaskHook = createDelegateTaskHook(config)

  return {
    name: "conditional-rules",

    /**
     * Pre-tool hook for file operations
     */
    "tool.execute.before": fileToolsHook,

    /**
     * Special handling for delegate_task to modify args
     */
    "tool.execute.before:delegate_task": delegateTaskHook,

    /**
     * Cleanup per-session injection tracking on lifecycle events
     */
    event: async (input: { event: { type: string; properties?: unknown } }) => {
      const props = input.event.properties as Record<string, unknown> | undefined

      if (input.event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          injectedPerSession.delete(sessionInfo.id)
        }
      }

      if (input.event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          injectedPerSession.delete(sessionID)
        }
      }
    },
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear cached state (for testing or when config changes)
 */
export function clearConditionalRulesCache(): void {
  stateByProject.clear()
}

/**
 * Force reload rules for a project
 */
export async function reloadRules(projectRoot: string, config: ConditionalRulesConfig): Promise<number> {
  const state = getState(projectRoot)
  const rules = await loadAllRules(projectRoot, config)
  state.matcher = new RuleMatcher(rules)
  state.lastLoadTime = Date.now()
  return state.matcher.getEnabledCount()
}
