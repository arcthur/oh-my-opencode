import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  sendMessage,
  readUnreadByType,
  markAsRead,
  waitForMessage,
  createInbox,
} from "../mailbox"
import {
  readManifest,
  addMember,
  removeMember,
  getMember,
  getCoordinator,
  isCoordinator,
  markWorkerIdle,
  getIdleWorkersFromManifest,
} from "./manifest"
import type { AgentIdentity } from "./types"

/**
 * Request to join a team (sent by worker to coordinator)
 */
export async function requestJoin(
  teamName: string,
  agent: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { timeoutMs?: number }
): Promise<{ approved: boolean; reason?: string }> {
  const manifest = readManifest(teamName, config)
  if (!manifest) {
    throw new Error(`Team "${teamName}" not found`)
  }

  // Create inbox for this agent
  createInbox(teamName, agent.id, config)

  const coordinatorId = manifest.coordinatorId

  // Check auto-approve
  if (manifest.settings.autoApprove) {
    // Auto-approved, add directly
    addMember(teamName, agent, config)
    return { approved: true }
  }

  // Send join request to coordinator with full agent info
  sendMessage(teamName, agent.id, coordinatorId, {
    type: "join_request",
    agentName: agent.name,
    sessionId: agent.sessionId,
    capabilities: agent.capabilities,
    tmuxPane: agent.tmuxPane,
    worktreePath: agent.worktreePath,
  }, config)

  // Wait for either approval or rejection
  const timeoutMs = options?.timeoutMs ?? 60000
  try {
    const response = await Promise.race([
      waitForMessage(teamName, agent.id, "join_approved", config, timeoutMs),
      waitForMessage(teamName, agent.id, "join_rejected", config, timeoutMs),
    ])

    if (response.payload.type === "join_rejected") {
      return { approved: false, reason: response.payload.reason }
    }

    // join_approved: Coordinator owns addMember, so we just return success
    return { approved: true }
  } catch {
    // As a fallback, check for explicit rejection message that may already exist
    const rejections = readUnreadByType(teamName, agent.id, "join_rejected", config)
    if (rejections.length > 0) {
      const rejection = rejections[0]
      markAsRead(teamName, agent.id, [rejection.id], config)
      if (rejection.payload.type === "join_rejected") {
        return { approved: false, reason: rejection.payload.reason }
      }
    }
    return { approved: false, reason: "Timeout waiting for approval" }
  }
}

/**
 * Approve a join request (called by coordinator)
 */
export function approveJoin(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can approve join requests")
  }

  sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "join_approved",
    agentName: requestingAgentId,
    teamName,
  }, config)
}

/**
 * Reject a join request (called by coordinator)
 */
export function rejectJoin(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can reject join requests")
  }

  sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "join_rejected",
    reason,
  }, config)
}

/**
 * Get pending join requests (called by coordinator)
 */
export function getPendingJoinRequests(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): Array<{
  agentId: string
  agentName: string
  sessionId: string
  capabilities?: string[]
  tmuxPane?: string
  worktreePath?: string
  messageId: string
}> {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const requests = readUnreadByType(teamName, coordinatorId, "join_request", config)

  // Mark as read to prevent duplicate processing on next call
  if (requests.length > 0) {
    markAsRead(teamName, coordinatorId, requests.map(m => m.id), config)
  }

  return requests.map(msg => {
    if (msg.payload.type === "join_request") {
      return {
        agentId: msg.from, // The actual agent ID for sending responses
        agentName: msg.payload.agentName,
        sessionId: msg.payload.sessionId,
        capabilities: msg.payload.capabilities,
        tmuxPane: msg.payload.tmuxPane,
        worktreePath: msg.payload.worktreePath,
        messageId: msg.id,
      }
    }
    // TypeScript guard - should never reach
    throw new Error("Unexpected message type")
  })
}

/**
 * Request to leave a team (graceful shutdown)
 */
export async function requestLeave(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { timeoutMs?: number; force?: boolean }
): Promise<{ approved: boolean; reason?: string }> {
  const manifest = readManifest(teamName, config)
  if (!manifest) {
    throw new Error(`Team "${teamName}" not found`)
  }

  const member = getMember(teamName, agentId, config)
  if (!member) {
    throw new Error(`Agent "${agentId}" is not a member of team "${teamName}"`)
  }

  // Coordinator leaving requires special handling
  if (manifest.coordinatorId === agentId) {
    throw new Error("Coordinator cannot leave. Transfer coordinator role first or delete the team.")
  }

  // Force leave - just remove without approval
  if (options?.force) {
    try {
      removeMember(teamName, agentId, config)
    } catch {
      // Ignore - may already be removed (idempotent)
    }
    return { approved: true }
  }

  // Request shutdown from coordinator
  sendMessage(teamName, agentId, manifest.coordinatorId, {
    type: "shutdown_request",
  }, config)

  try {
    const timeoutMs = options?.timeoutMs ?? 30000
    const response = await Promise.race([
      waitForMessage(teamName, agentId, "shutdown_approved", config, timeoutMs),
      waitForMessage(teamName, agentId, "shutdown_rejected", config, timeoutMs),
    ])

    if (response.payload.type === "shutdown_rejected") {
      return { approved: false, reason: response.payload.reason }
    }

    // shutdown_approved: Coordinator owns removeMember, so we just return success
    return { approved: true }
  } catch {
    // Check if rejected
    const rejections = readUnreadByType(teamName, agentId, "shutdown_rejected", config)
    if (rejections.length > 0) {
      const rejection = rejections[0]
      markAsRead(teamName, agentId, [rejection.id], config)
      if (rejection.payload.type === "shutdown_rejected") {
        return { approved: false, reason: rejection.payload.reason }
      }
    }
    return { approved: false, reason: "Timeout waiting for approval" }
  }
}

/**
 * Approve a shutdown request (called by coordinator)
 */
export function approveShutdown(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can approve shutdown requests")
  }

  sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "shutdown_approved",
  }, config)
}

/**
 * Reject a shutdown request (called by coordinator)
 */
export function rejectShutdown(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can reject shutdown requests")
  }

  sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "shutdown_rejected",
    reason,
  }, config)
}

/**
 * Get pending shutdown requests (called by coordinator)
 */
export function getPendingShutdownRequests(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): Array<{ agentId: string; messageId: string }> {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  const requests = readUnreadByType(teamName, coordinatorId, "shutdown_request", config)

  // Mark as read to prevent duplicate processing on next call
  if (requests.length > 0) {
    markAsRead(teamName, coordinatorId, requests.map(m => m.id), config)
  }

  return requests.map(msg => ({
    agentId: msg.from,
    messageId: msg.id,
  }))
}

/**
 * Notify idle status to coordinator (level-triggered)
 *
 * This now also persists the idle state in the manifest so that
 * when new tasks arrive, the coordinator can immediately assign them
 * without waiting for workers to re-send idle notifications.
 */
export function notifyIdle(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const coordinator = getCoordinator(teamName, config)
  if (!coordinator) {
    throw new Error(`Team "${teamName}" not found or has no coordinator`)
  }

  // Persist idle state in manifest (level-triggered)
  markWorkerIdle(teamName, agentId, config)

  // Also send message to trigger immediate processing in coordination loop
  sendMessage(teamName, agentId, coordinator.id, {
    type: "idle_notification",
  }, config)
}

/**
 * Get idle workers (level-triggered from manifest)
 *
 * This reads from the persistent idleWorkers list in the manifest,
 * preventing the "edge-trigger lost" problem where idle info was
 * consumed (markAsRead) but no task was available at that moment.
 *
 * Messages are still consumed to avoid unbounded growth, but the
 * actual idle state is read from the manifest.
 */
export function getIdleWorkers(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  // Consume messages to prevent unbounded inbox growth
  // (Messages act as triggers, not as source of truth)
  const notifications = readUnreadByType(teamName, coordinatorId, "idle_notification", config)
  if (notifications.length > 0) {
    markAsRead(teamName, coordinatorId, notifications.map(m => m.id), config)
  }

  // Return idle workers from manifest (level-triggered, persistent)
  return getIdleWorkersFromManifest(teamName, config)
}
