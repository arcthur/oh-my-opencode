import type { OhMyOpenCodeConfig } from "../../../config/schema"
import {
  createFsMailboxTransport,
  type MailboxTransport,
} from "../mailbox"
import {
  signControlMessage,
  verifyInboxControlMessageSignature,
} from "../security/control-message-signature"
import {
  readManifest,
  addMemberAsync,
  removeMemberAsync,
  getMember,
  getCoordinator,
  isCoordinator,
  markWorkerIdle,
  getIdleWorkersFromManifest,
} from "./manifest"
import { getCoordinatorEpoch } from "./coordinator-lease"
import type { AgentIdentity } from "./types"

function resolveMailboxTransport(
  config: Partial<OhMyOpenCodeConfig>,
  transport?: MailboxTransport
): MailboxTransport {
  return transport ?? createFsMailboxTransport(config)
}

function isSignatureEnforced(config: Partial<OhMyOpenCodeConfig>): boolean {
  return config.sisyphus?.swarm?.enforce_signature ?? true
}

/**
 * Request to join a team (sent by worker to coordinator)
 */
export async function requestJoin(
  teamName: string,
  agent: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { timeoutMs?: number; mailboxTransport?: MailboxTransport }
): Promise<{ approved: boolean; reason?: string }> {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) {
    throw new Error(`Team "${teamName}" not found`)
  }
  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)

  // Create inbox for this agent
  mailboxTransport.createInbox(teamName, agent.id)

  const coordinatorId = manifest.coordinatorId

  // Check auto-approve
  if (manifest.settings.autoApprove) {
    // Auto-approved, add directly
    await addMemberAsync(teamName, agent, config)
    return { approved: true }
  }

  // Send join request to coordinator with full agent info
  mailboxTransport.sendMessage(teamName, agent.id, coordinatorId, {
    type: "join_request",
    agentName: agent.name,
    sessionId: agent.sessionId,
    capabilities: agent.capabilities,
    tmuxPane: agent.tmuxPane,
    worktreePath: agent.worktreePath,
  })

  // Wait for either approval or rejection
  const timeoutMs = options?.timeoutMs ?? 60000
  try {
    const response = await Promise.race([
      mailboxTransport.waitForMessage(teamName, agent.id, "join_approved", timeoutMs),
      mailboxTransport.waitForMessage(teamName, agent.id, "join_rejected", timeoutMs),
    ])

    if (response.from !== coordinatorId) {
      return { approved: false, reason: "Invalid join response sender" }
    }

    if (response.payload.type === "join_rejected") {
      return { approved: false, reason: response.payload.reason }
    }

    // join_approved: coordinator should have already persisted membership.
    if (!getMember(teamName, agent.id, config)) {
      return { approved: false, reason: "Join approval without membership update" }
    }

    return { approved: true }
  } catch {
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
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can approve join requests")
  }

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  mailboxTransport.sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "join_approved",
    agentName: requestingAgentId,
    teamName,
  })
}

/**
 * Reject a join request (called by coordinator)
 */
export function rejectJoin(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can reject join requests")
  }

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  mailboxTransport.sendMessage(teamName, coordinatorId, requestingAgentId, {
    type: "join_rejected",
    reason,
  })
}

/**
 * Request to leave a team (graceful shutdown)
 */
export async function requestLeave(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { timeoutMs?: number; force?: boolean; mailboxTransport?: MailboxTransport }
): Promise<{ approved: boolean; reason?: string }> {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
      await removeMemberAsync(teamName, agentId, config)
    } catch {
      // Ignore - may already be removed (idempotent)
    }
    return { approved: true }
  }
  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)

  // Request shutdown from coordinator
  mailboxTransport.sendMessage(teamName, agentId, manifest.coordinatorId, {
    type: "shutdown_request",
  })

  try {
    const timeoutMs = options?.timeoutMs ?? 30000
    const response = await Promise.race([
      mailboxTransport.waitForMessage(teamName, agentId, "shutdown_approved", timeoutMs),
      mailboxTransport.waitForMessage(teamName, agentId, "shutdown_rejected", timeoutMs),
    ])

    if (response.payload.type === "shutdown_rejected") {
      if (response.from !== manifest.coordinatorId) {
        return { approved: false, reason: "Invalid shutdown response sender" }
      }
      if (isSignatureEnforced(config)) {
        const verification = verifyInboxControlMessageSignature({
          teamName,
          recipientAgentId: agentId,
          message: response,
          config,
        })
        if (!verification.ok) {
          return { approved: false, reason: `Invalid shutdown response signature: ${verification.reason}` }
        }
      }
      return { approved: false, reason: response.payload.reason }
    }

    // shutdown_approved: Coordinator owns removeMember, so we just return success
    if (response.from !== manifest.coordinatorId) {
      return { approved: false, reason: "Invalid shutdown response sender" }
    }
    if (isSignatureEnforced(config)) {
      const verification = verifyInboxControlMessageSignature({
        teamName,
        recipientAgentId: agentId,
        message: response,
        config,
      })
      if (!verification.ok) {
        return { approved: false, reason: `Invalid shutdown response signature: ${verification.reason}` }
      }
    }
    return { approved: true }
  } catch {
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
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can approve shutdown requests")
  }

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  const payload = {
    type: "shutdown_approved",
  } as const
  const epoch = getCoordinatorEpoch(teamName, config) ?? undefined
  const auth = signControlMessage({
    teamName,
    fromAgentId: coordinatorId,
    toAgentId: requestingAgentId,
    payload,
    epoch,
    config,
  })
  mailboxTransport.sendMessage(teamName, coordinatorId, requestingAgentId, payload, { epoch, auth })
}

/**
 * Reject a shutdown request (called by coordinator)
 */
export function rejectShutdown(
  teamName: string,
  coordinatorId: string,
  requestingAgentId: string,
  reason: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): void {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    throw new Error("Only coordinator can reject shutdown requests")
  }

  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  const payload = {
    type: "shutdown_rejected",
    reason,
  } as const
  const epoch = getCoordinatorEpoch(teamName, config) ?? undefined
  const auth = signControlMessage({
    teamName,
    fromAgentId: coordinatorId,
    toAgentId: requestingAgentId,
    payload,
    epoch,
    config,
  })
  mailboxTransport.sendMessage(teamName, coordinatorId, requestingAgentId, payload, { epoch, auth })
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
  config: Partial<OhMyOpenCodeConfig>,
  options?: { mailboxTransport?: MailboxTransport }
): void {
  const coordinator = getCoordinator(teamName, config)
  if (!coordinator) {
    throw new Error(`Team "${teamName}" not found or has no coordinator`)
  }

  // Persist idle state in manifest (level-triggered)
  markWorkerIdle(teamName, agentId, config)

  // Also send message to trigger immediate processing in coordination loop
  const mailboxTransport = resolveMailboxTransport(config, options?.mailboxTransport)
  mailboxTransport.sendMessage(teamName, agentId, coordinator.id, {
    type: "idle_notification",
  })
}

/**
 * Get idle workers (level-triggered from manifest)
 *
 * This reads from the persistent idle store and returns a
 * membership-filtered view.
 */
export function getIdleWorkers(
  teamName: string,
  coordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>,
  _options?: { mailboxTransport?: MailboxTransport }
): string[] {
  if (!isCoordinator(teamName, coordinatorId, config)) {
    return []
  }

  return getIdleWorkersFromManifest(teamName, config)
}
