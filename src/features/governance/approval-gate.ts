/**
 * Approval Gate Middleware
 *
 * A hook that intercepts critical tool executions and requests
 * user approval before proceeding. Implements the SuspendException
 * pattern for pausable execution.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import type { ApprovalResult, ApprovalAction, ApprovalPreview } from "./types"
import { SuspendException, InMemoryResumeTokenStore, type ResumeTokenStore } from "./suspend-exception"
import { getToolCriticalityRegistry, type ToolCriticalityRegistry } from "./tool-criticality"
import { getLedgerManager, type GovernanceLedgerWriter } from "./ledger"
import { log } from "../../shared/logger"

export const HOOK_NAME = "approval-gate"

/**
 * Approval gate configuration
 */
export interface ApprovalGateConfig {
  /** Enable/disable the approval gate */
  enabled?: boolean

  /** Session IDs that have blanket approval (bypass checks) */
  trustedSessions?: string[]

  /** Tool patterns to always skip (glob-style) */
  skipPatterns?: string[]

  /** Custom criticality registry (defaults to global) */
  registry?: ToolCriticalityRegistry

  /** Resume token store (defaults to in-memory) */
  tokenStore?: ResumeTokenStore

  /** Token expiry time in ms (default: 30 minutes) */
  tokenExpiryMs?: number

  /** Enable ledger integration for audit logging */
  enableLedger?: boolean

  /** Ledger base directory (defaults to .sisyphus/ledger) */
  ledgerBaseDir?: string
}

/**
 * State tracking for approved actions within a session
 */
interface SessionApprovalState {
  /** Set of approval keys that have been approved */
  approvedKeys: Set<string>

  /** Pending suspensions awaiting user response */
  pendingSuspensions: Map<string, SuspendException>

  /** Last activity timestamp */
  lastActivity: number
}

/**
 * Hook input/output types
 */
interface ToolExecuteBeforeInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
  skip?: boolean
}

/**
 * Compute a unique key for an approval request
 */
function computeApprovalKey(tool: string, args: unknown): string {
  // Create a deterministic key from tool and critical args
  const argsStr = JSON.stringify(args, Object.keys(args as object).sort())
  const hash = simpleHash(argsStr)
  return `${tool}:${hash}`
}

/**
 * Simple string hash for approval keys
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Format approval preview as a message for the user
 */
function formatApprovalMessage(
  tool: string,
  preview: ApprovalPreview,
  suspendInfo: { resumeToken: string; availableActions: ApprovalAction[] }
): string {
  const affectedList = preview.affectedItems
    .map((item) => `  - ${item.type}: ${item.identifier} (${item.action})`)
    .join("\n")

  const impactList = preview.estimatedImpact
    ? Object.entries(preview.estimatedImpact)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n")
    : ""

  const actions = suspendInfo.availableActions
    .map((a) => `  [${a.type}] ${a.label}`)
    .join("\n")

  return `
<approval-request tool="${tool}" token="${suspendInfo.resumeToken}">

## ${preview.title}

${preview.description}

${affectedList ? `### Affected Items\n${affectedList}` : ""}

${impactList ? `### Estimated Impact\n${impactList}` : ""}

### Available Actions
${actions}

To respond, use one of:
- \`/approve ${suspendInfo.resumeToken}\` - Proceed with operation
- \`/reject ${suspendInfo.resumeToken}\` - Cancel operation
- \`/modify ${suspendInfo.resumeToken} <new-args>\` - Modify and retry

</approval-request>
`.trim()
}

/**
 * Create the approval gate hook
 */
export function createApprovalGateHook(
  ctx: PluginInput,
  config: ApprovalGateConfig = {}
) {
  const {
    enabled = true,
    trustedSessions = [],
    skipPatterns = [],
    registry = getToolCriticalityRegistry(),
    tokenStore = new InMemoryResumeTokenStore(),
    tokenExpiryMs = 30 * 60 * 1000, // 30 minutes
    enableLedger = true,
    ledgerBaseDir,
  } = config

  // Get ledger manager for audit logging
  const ledgerManager = enableLedger
    ? getLedgerManager(ledgerBaseDir ? { baseDir: ledgerBaseDir } : undefined)
    : null

  /**
   * Get ledger for a session (lazy initialization)
   */
  function getLedger(sessionId: string): GovernanceLedgerWriter | null {
    return ledgerManager?.getLedger(sessionId) ?? null
  }

  // Session-level approval state
  const sessionStates = new Map<string, SessionApprovalState>()

  /**
   * Get or create session state
   */
  function getSessionState(sessionId: string): SessionApprovalState {
    let state = sessionStates.get(sessionId)
    if (!state) {
      state = {
        approvedKeys: new Set(),
        pendingSuspensions: new Map(),
        lastActivity: Date.now(),
      }
      sessionStates.set(sessionId, state)
    }
    state.lastActivity = Date.now()
    return state
  }

  /**
   * Check if a tool matches skip patterns
   */
  function shouldSkip(tool: string): boolean {
    return skipPatterns.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
        return regex.test(tool)
      }
      return pattern === tool
    })
  }

  /**
   * Handle tool.execute.before event
   */
  async function handleToolExecuteBefore(
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput
  ): Promise<void> {
    // Skip if disabled
    if (!enabled) return

    const { tool, sessionID } = input
    if (!sessionID) return

    // Skip trusted sessions
    if (trustedSessions.includes(sessionID)) return

    // Skip if tool matches skip patterns
    if (shouldSkip(tool)) return

    // Check if tool is critical
    if (!registry.isCritical(tool, output.args)) return

    // Check if already approved in this session
    const sessionState = getSessionState(sessionID)
    const approvalKey = computeApprovalKey(tool, output.args)

    if (sessionState.approvedKeys.has(approvalKey)) {
      log(`[${HOOK_NAME}] Tool already approved in session`, {
        tool,
        sessionID,
        approvalKey,
      })
      return // Already approved, proceed
    }

    // Generate preview
    const preview = registry.getPreview(tool, output.args) ?? {
      title: `Approve ${tool}`,
      description: registry.getReason(tool) ?? "This operation requires approval",
      affectedItems: [],
    }

    // Create suspension
    const suspension = SuspendException.forToolApproval({
      tool,
      toolArgs: output.args,
      sessionId: sessionID,
      reason: registry.getReason(tool) ?? "Critical operation requires approval",
      preview,
    })

    // Store suspension for later resume
    await tokenStore.store(suspension.suspendInfo.resumeToken, suspension.suspendInfo)
    sessionState.pendingSuspensions.set(suspension.suspendInfo.resumeToken, suspension)

    // Log permission escalation to governance ledger
    getLedger(sessionID)?.logPermissionEscalation({
      requestor: `tool:${tool}`,
      permission: `execute:${tool}`,
      grantedBy: "user", // Will be updated when user responds
      rationale: registry.getReason(tool) ?? "Critical operation",
    })

    // Format approval message
    const approvalMessage = formatApprovalMessage(tool, preview, {
      resumeToken: suspension.suspendInfo.resumeToken,
      availableActions: suspension.suspendInfo.availableActions,
    })

    // Inject approval request into output
    output.message = (output.message || "") + "\n\n" + approvalMessage

    log(`[${HOOK_NAME}] Tool execution suspended for approval`, {
      tool,
      sessionID,
      resumeToken: suspension.suspendInfo.resumeToken,
      category: registry.getCategory(tool),
    })

    // Mark to skip actual tool execution
    // The tool will need to be re-invoked after approval
    output.skip = true
  }

  /**
   * Process an approval response
   */
  async function processApproval(
    sessionId: string,
    token: string,
    result: ApprovalResult
  ): Promise<{ success: boolean; error?: string }> {
    const sessionState = getSessionState(sessionId)
    const suspension = sessionState.pendingSuspensions.get(token)

    if (!suspension) {
      // Try to retrieve from token store
      const storedInfo = await tokenStore.retrieve(token)
      if (!storedInfo) {
        return { success: false, error: "Invalid or expired approval token" }
      }

      // Check session match
      if (storedInfo.sessionId !== sessionId) {
        return { success: false, error: "Token does not belong to this session" }
      }
    }

    const suspendInfo = suspension?.suspendInfo ?? (await tokenStore.retrieve(token))
    if (!suspendInfo) {
      return { success: false, error: "Could not retrieve suspension info" }
    }

    // Process based on decision
    switch (result.decision) {
      case "approved": {
        // Mark as approved for this session
        const approvalKey = computeApprovalKey(suspendInfo.tool, suspendInfo.toolArgs)
        sessionState.approvedKeys.add(approvalKey)

        // Consume the token
        await tokenStore.consume(token)
        sessionState.pendingSuspensions.delete(token)

        // Log to governance ledger
        getLedger(sessionId)?.logApprovalEvent({
          tool: suspendInfo.tool,
          decision: "approved",
          previewShown: suspendInfo.previewData.title,
          decisionTimeMs: result.decisionTimeMs,
        })

        log(`[${HOOK_NAME}] Approval granted`, {
          tool: suspendInfo.tool,
          sessionId,
          token,
          decisionTimeMs: result.decisionTimeMs,
        })

        return { success: true }
      }

      case "rejected": {
        // Consume the token without adding to approved list
        await tokenStore.consume(token)
        sessionState.pendingSuspensions.delete(token)

        // Log to governance ledger
        getLedger(sessionId)?.logApprovalEvent({
          tool: suspendInfo.tool,
          decision: "rejected",
          previewShown: suspendInfo.previewData.title,
          decisionTimeMs: result.decisionTimeMs,
        })

        log(`[${HOOK_NAME}] Approval rejected`, {
          tool: suspendInfo.tool,
          sessionId,
          token,
          reason: result.reason,
        })

        return { success: true }
      }

      case "modified": {
        // Update the args and mark as approved
        if (result.modifiedArgs) {
          const approvalKey = computeApprovalKey(suspendInfo.tool, result.modifiedArgs)
          sessionState.approvedKeys.add(approvalKey)
        }

        await tokenStore.consume(token)
        sessionState.pendingSuspensions.delete(token)

        // Log to governance ledger
        getLedger(sessionId)?.logApprovalEvent({
          tool: suspendInfo.tool,
          decision: "modified",
          previewShown: suspendInfo.previewData.title,
          decisionTimeMs: result.decisionTimeMs,
        })

        log(`[${HOOK_NAME}] Approval with modifications`, {
          tool: suspendInfo.tool,
          sessionId,
          token,
        })

        return { success: true }
      }

      case "deferred": {
        // Keep the token valid for later
        // Log to governance ledger
        getLedger(sessionId)?.logApprovalEvent({
          tool: suspendInfo.tool,
          decision: "deferred",
          previewShown: suspendInfo.previewData.title,
          decisionTimeMs: result.decisionTimeMs,
        })

        log(`[${HOOK_NAME}] Approval deferred`, {
          tool: suspendInfo.tool,
          sessionId,
          token,
        })

        return { success: true }
      }

      default:
        return { success: false, error: `Unknown decision type: ${result.decision}` }
    }
  }

  /**
   * Handle session deletion - clean up state
   */
  function handleSessionDeleted(sessionId: string): void {
    const state = sessionStates.get(sessionId)
    if (state) {
      // Clean up pending tokens
      for (const token of state.pendingSuspensions.keys()) {
        tokenStore.consume(token).catch(() => {})
      }
      sessionStates.delete(sessionId)
    }
  }

  /**
   * Event handler for session lifecycle
   */
  async function handleEvent(input: { event: { type: string; properties?: unknown } }): Promise<void> {
    const { event } = input
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        handleSessionDeleted(sessionInfo.id)
      }
    }

    // Periodically clean up expired tokens
    if (Math.random() < 0.1) {
      // 10% chance on each event
      await tokenStore.cleanup(tokenExpiryMs)
    }
  }

  /**
   * Get pending approvals for a session
   */
  function getPendingApprovals(sessionId: string): SuspendException[] {
    const state = sessionStates.get(sessionId)
    return state ? Array.from(state.pendingSuspensions.values()) : []
  }

  /**
   * Grant blanket approval for a session
   */
  function grantBlanketApproval(sessionId: string): void {
    if (!trustedSessions.includes(sessionId)) {
      trustedSessions.push(sessionId)
    }
  }

  /**
   * Revoke blanket approval for a session
   */
  function revokeBlanketApproval(sessionId: string): void {
    const index = trustedSessions.indexOf(sessionId)
    if (index >= 0) {
      trustedSessions.splice(index, 1)
    }
  }

  return {
    "tool.execute.before": handleToolExecuteBefore,
    event: handleEvent,

    // Public API for programmatic approval handling
    processApproval,
    getPendingApprovals,
    grantBlanketApproval,
    revokeBlanketApproval,

    // For testing
    _getSessionState: getSessionState,
    _getTokenStore: () => tokenStore,
  }
}

export type ApprovalGateHook = ReturnType<typeof createApprovalGateHook>
