import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, ensureDir, writeJsonAtomic, readJsonSafe } from "../../sisyphus-tasks/storage"
import { withLockSync } from "../sync/semaphore"
import {
  TeamManifestSchema,
  AgentIdentitySchema,
  type TeamManifest,
  type AgentIdentity,
  type AgentRole,
  type AgentCapability,
} from "./types"

/**
 * Generate a unique agent ID
 */
export function generateAgentId(): string {
  return `agent_${randomUUID().slice(0, 8)}`
}

/**
 * Get the manifest file path for a team
 */
export function getManifestPath(teamName: string, config: Partial<OhMyOpenCodeConfig>): string {
  return join(getTeamDir(teamName, config), "manifest.json")
}

/**
 * Check if a team exists
 */
export function teamExists(teamName: string, config: Partial<OhMyOpenCodeConfig>): boolean {
  return existsSync(getManifestPath(teamName, config))
}

/**
 * Read team manifest
 */
export function readManifest(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): TeamManifest | null {
  const manifestPath = getManifestPath(teamName, config)
  return readJsonSafe(manifestPath, TeamManifestSchema)
}

/**
 * Write team manifest (atomic)
 */
export function writeManifest(
  teamName: string,
  manifest: TeamManifest,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const manifestPath = getManifestPath(teamName, config)
  ensureDir(getTeamDir(teamName, config))
  writeJsonAtomic(manifestPath, manifest)
}

/**
 * Create a new agent identity
 */
export function createAgentIdentity(options: {
  id?: string
  name: string
  sessionId: string
  role: AgentRole
  capabilities?: AgentCapability[]
  tmuxPane?: string
  worktreePath?: string
}): AgentIdentity {
  return {
    id: options.id ?? generateAgentId(),
    name: options.name,
    sessionId: options.sessionId,
    role: options.role,
    capabilities: options.capabilities ?? ["code"],
    tmuxPane: options.tmuxPane,
    worktreePath: options.worktreePath,
    joinedAt: Date.now(),
    lastHeartbeat: Date.now(),
  }
}

/**
 * Create a new team with the given agent as coordinator
 */
export function createTeam(
  teamName: string,
  coordinator: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>,
  options?: {
    description?: string
    settings?: Partial<TeamManifest["settings"]>
  }
): TeamManifest {
  if (teamExists(teamName, config)) {
    throw new Error(`Team "${teamName}" already exists`)
  }

  // Ensure coordinator has coordinator role
  const coordWithRole: AgentIdentity = {
    ...coordinator,
    role: "coordinator",
  }

  const manifest: TeamManifest = {
    name: teamName,
    description: options?.description,
    createdAt: Date.now(),
    coordinatorId: coordWithRole.id,
    members: [coordWithRole],
    settings: {
      maxMembers: options?.settings?.maxMembers ?? 10,
      autoApprove: options?.settings?.autoApprove ?? false,
      heartbeatTimeoutMs: options?.settings?.heartbeatTimeoutMs ?? 30000,
      assignmentStrategy: options?.settings?.assignmentStrategy ?? "capability-match",
    },
    idleWorkers: [],
  }

  writeManifest(teamName, manifest, config)

  // Create inboxes directory
  const inboxesDir = join(getTeamDir(teamName, config), "inboxes")
  ensureDir(inboxesDir)

  return manifest
}

/**
 * Add a member to the team
 *
 * Uses file locking to prevent concurrent modification conflicts.
 */
export function addMember(
  teamName: string,
  member: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>
): TeamManifest {
  const manifestPath = getManifestPath(teamName, config)

  return withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    // Idempotent: if already a member, update fields and return
    const existing = manifest.members.find(m => m.id === member.id)
    if (existing) {
      // Update mutable fields to latest values
      existing.capabilities = member.capabilities
      existing.tmuxPane = member.tmuxPane
      existing.worktreePath = member.worktreePath
      existing.lastHeartbeat = Date.now()
      writeManifest(teamName, manifest, config)
      return manifest
    }

    // Check max members
    if (manifest.settings.maxMembers > 0 && manifest.members.length >= manifest.settings.maxMembers) {
      throw new Error(`Team "${teamName}" has reached maximum members (${manifest.settings.maxMembers})`)
    }

    manifest.members.push(member)
    writeManifest(teamName, manifest, config)

    return manifest
  })
}

/**
 * Remove a member from the team
 *
 * Uses file locking to prevent concurrent modification conflicts.
 * Also cleans up the worker from idleWorkers list if present.
 */
export function removeMember(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): TeamManifest {
  const manifestPath = getManifestPath(teamName, config)

  return withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    // Can't remove coordinator
    if (manifest.coordinatorId === agentId) {
      throw new Error(`Cannot remove coordinator from team. Transfer coordinator role first.`)
    }

    const memberIndex = manifest.members.findIndex(m => m.id === agentId)
    if (memberIndex === -1) {
      // Idempotent: already removed, return current manifest
      return manifest
    }

    manifest.members.splice(memberIndex, 1)

    // Also remove from idleWorkers if present (cleanup)
    if (manifest.idleWorkers) {
      const idleIndex = manifest.idleWorkers.indexOf(agentId)
      if (idleIndex !== -1) {
        manifest.idleWorkers.splice(idleIndex, 1)
      }
    }

    writeManifest(teamName, manifest, config)

    return manifest
  })
}

/**
 * Update member info (e.g., heartbeat, capabilities)
 *
 * Uses file locking to prevent concurrent modification conflicts.
 */
export function updateMember(
  teamName: string,
  agentId: string,
  updates: Partial<Pick<AgentIdentity, "capabilities" | "tmuxPane" | "worktreePath" | "lastHeartbeat">>,
  config: Partial<OhMyOpenCodeConfig>
): TeamManifest {
  const manifestPath = getManifestPath(teamName, config)

  return withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const member = manifest.members.find(m => m.id === agentId)
    if (!member) {
      throw new Error(`Agent "${agentId}" is not a member of team "${teamName}"`)
    }

    if (updates.capabilities !== undefined) member.capabilities = updates.capabilities
    if (updates.tmuxPane !== undefined) member.tmuxPane = updates.tmuxPane
    if (updates.worktreePath !== undefined) member.worktreePath = updates.worktreePath
    if (updates.lastHeartbeat !== undefined) member.lastHeartbeat = updates.lastHeartbeat

    writeManifest(teamName, manifest, config)
    return manifest
  })
}

/**
 * Update member heartbeat
 */
export function heartbeat(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  updateMember(teamName, agentId, { lastHeartbeat: Date.now() }, config)
}

/**
 * Transfer coordinator role to another member
 *
 * Uses file locking to prevent concurrent modification conflicts.
 */
export function transferCoordinator(
  teamName: string,
  newCoordinatorId: string,
  config: Partial<OhMyOpenCodeConfig>
): TeamManifest {
  const manifestPath = getManifestPath(teamName, config)

  return withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const newCoord = manifest.members.find(m => m.id === newCoordinatorId)
    if (!newCoord) {
      throw new Error(`Agent "${newCoordinatorId}" is not a member of team "${teamName}"`)
    }

    // Update roles
    for (const member of manifest.members) {
      if (member.id === manifest.coordinatorId) {
        member.role = "worker"
      } else if (member.id === newCoordinatorId) {
        member.role = "coordinator"
      }
    }

    manifest.coordinatorId = newCoordinatorId
    writeManifest(teamName, manifest, config)

    return manifest
  })
}

/**
 * Get a specific member by ID
 */
export function getMember(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): AgentIdentity | null {
  const manifest = readManifest(teamName, config)
  if (!manifest) return null
  return manifest.members.find(m => m.id === agentId) ?? null
}

/**
 * Get the coordinator of a team
 */
export function getCoordinator(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): AgentIdentity | null {
  const manifest = readManifest(teamName, config)
  if (!manifest) return null
  return manifest.members.find(m => m.id === manifest.coordinatorId) ?? null
}

/**
 * Get all workers (non-coordinator members)
 */
export function getWorkers(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): AgentIdentity[] {
  const manifest = readManifest(teamName, config)
  if (!manifest) return []
  return manifest.members.filter(m => m.id !== manifest.coordinatorId)
}

/**
 * Check if an agent is the coordinator
 */
export function isCoordinator(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const manifest = readManifest(teamName, config)
  if (!manifest) return false
  return manifest.coordinatorId === agentId
}

/**
 * List all teams
 */
export function listTeams(config: Partial<OhMyOpenCodeConfig>): string[] {
  const swarmConfig = config.sisyphus?.swarm
  const storagePath = swarmConfig?.storage_path ?? ".sisyphus/teams"

  // Handle absolute vs relative path
  const { isAbsolute } = require("path")
  const { getProjectRoot } = require("../../sisyphus-tasks/storage")
  const baseDir = isAbsolute(storagePath) ? storagePath : join(getProjectRoot(), storagePath)

  if (!existsSync(baseDir)) {
    return []
  }

  return readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => existsSync(join(baseDir, dirent.name, "manifest.json")))
    .map(dirent => dirent.name)
}

/**
 * Delete a team (removes all team files)
 */
export function deleteTeam(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const teamDir = getTeamDir(teamName, config)
  if (!existsSync(teamDir)) {
    throw new Error(`Team "${teamName}" not found`)
  }

  const { rmSync } = require("fs")
  rmSync(teamDir, { recursive: true })
}

/**
 * Get members with stale heartbeats
 */
export function getStaleMembers(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): AgentIdentity[] {
  const manifest = readManifest(teamName, config)
  if (!manifest) return []

  const timeout = manifest.settings.heartbeatTimeoutMs
  const now = Date.now()

  return manifest.members.filter(m => {
    if (!m.lastHeartbeat) return true
    return now - m.lastHeartbeat > timeout
  })
}

/**
 * Check if the coordinator is alive (has recent heartbeat)
 *
 * Workers can use this to detect coordinator failure and
 * potentially trigger recovery or enter degraded mode.
 */
export function isCoordinatorAlive(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  const manifest = readManifest(teamName, config)
  if (!manifest) return false

  const coordinator = manifest.members.find(m => m.id === manifest.coordinatorId)
  if (!coordinator) return false

  // If no heartbeat recorded, assume alive (just started)
  if (!coordinator.lastHeartbeat) return true

  const timeout = manifest.settings.heartbeatTimeoutMs
  const now = Date.now()

  return now - coordinator.lastHeartbeat < timeout
}

/**
 * Mark a worker as idle (level-triggered)
 *
 * This persists the idle state in the manifest so that when new tasks
 * arrive, the coordinator can immediately assign them without waiting
 * for workers to re-send idle notifications.
 */
export function markWorkerIdle(
  teamName: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const manifestPath = getManifestPath(teamName, config)

  withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) return

    // Initialize idleWorkers if not present (backward compatibility)
    if (!manifest.idleWorkers) {
      manifest.idleWorkers = []
    }

    // Add worker if not already in idle list
    if (!manifest.idleWorkers.includes(workerId)) {
      manifest.idleWorkers.push(workerId)
      writeManifest(teamName, manifest, config)
    }
  })
}

/**
 * Mark a worker as busy (remove from idle list)
 *
 * Called when a task is assigned to the worker.
 */
export function markWorkerBusy(
  teamName: string,
  workerId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const manifestPath = getManifestPath(teamName, config)

  withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) return

    // Initialize idleWorkers if not present (backward compatibility)
    if (!manifest.idleWorkers) {
      manifest.idleWorkers = []
      return
    }

    const index = manifest.idleWorkers.indexOf(workerId)
    if (index !== -1) {
      manifest.idleWorkers.splice(index, 1)
      writeManifest(teamName, manifest, config)
    }
  })
}

/**
 * Get list of idle workers from manifest (level-triggered)
 *
 * This reads from the persistent idleWorkers list rather than
 * consuming messages, preventing the "edge-trigger lost" problem.
 *
 * Only returns workers that are still team members (filters out
 * stale entries from workers that have left).
 */
export function getIdleWorkersFromManifest(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const manifest = readManifest(teamName, config)
  if (!manifest) return []

  const idleWorkers = manifest.idleWorkers ?? []
  if (idleWorkers.length === 0) return []

  // Filter to only include workers that are still members
  const memberIds = new Set(manifest.members.map(m => m.id))
  return idleWorkers.filter(id => memberIds.has(id))
}

/**
 * Result of a coordinator takeover attempt
 */
export interface TakeoverResult {
  success: boolean
  reason?: string
  previousCoordinatorId?: string
}

/**
 * Take over as the new coordinator of a team
 *
 * This function atomically:
 * 1. Checks if the old coordinator's heartbeat has timed out
 * 2. Updates coordinatorId to the new agent
 * 3. Adds the new agent as a member (if not already)
 * 4. Updates the old coordinator's role to "worker"
 *
 * Split-brain prevention: If the old coordinator is still alive
 * (heartbeat within timeout), the takeover is rejected.
 *
 * @param teamName The team to take over
 * @param newCoordinator The agent attempting to become coordinator
 * @param config OpenCode config
 * @param options.force Force takeover even if old coordinator is alive (use with caution)
 * @returns TakeoverResult indicating success or failure with reason
 */
export function takeoverAsCoordinator(
  teamName: string,
  newCoordinator: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { force?: boolean }
): TakeoverResult {
  const manifestPath = getManifestPath(teamName, config)

  return withLockSync(manifestPath, () => {
    const manifest = readManifest(teamName, config)
    if (!manifest) {
      return { success: false, reason: `Team "${teamName}" not found` }
    }

    const previousCoordinatorId = manifest.coordinatorId

    // Check if we're already the coordinator
    if (previousCoordinatorId === newCoordinator.id) {
      return { success: true, previousCoordinatorId }
    }

    // Check if old coordinator is still alive (split-brain prevention)
    if (!options?.force) {
      const oldCoordinator = manifest.members.find(m => m.id === previousCoordinatorId)
      if (oldCoordinator?.lastHeartbeat) {
        const timeout = manifest.settings.heartbeatTimeoutMs
        const now = Date.now()
        if (now - oldCoordinator.lastHeartbeat < timeout) {
          return {
            success: false,
            reason: `Cannot takeover: coordinator "${previousCoordinatorId}" is still alive (heartbeat ${Math.round((now - oldCoordinator.lastHeartbeat) / 1000)}s ago, timeout ${timeout / 1000}s)`,
            previousCoordinatorId,
          }
        }
      }
    }

    // Update old coordinator's role to worker (if still in members)
    const oldCoordIndex = manifest.members.findIndex(m => m.id === previousCoordinatorId)
    if (oldCoordIndex !== -1) {
      manifest.members[oldCoordIndex].role = "worker"
    }

    // Check if new coordinator is already a member
    const existingMemberIndex = manifest.members.findIndex(m => m.id === newCoordinator.id)
    if (existingMemberIndex !== -1) {
      // Update existing member to coordinator role
      manifest.members[existingMemberIndex].role = "coordinator"
      manifest.members[existingMemberIndex].lastHeartbeat = Date.now()
    } else {
      // Add new coordinator as member
      const coordWithRole: AgentIdentity = {
        ...newCoordinator,
        role: "coordinator",
        lastHeartbeat: Date.now(),
      }
      manifest.members.push(coordWithRole)
    }

    // Update coordinatorId
    manifest.coordinatorId = newCoordinator.id

    writeManifest(teamName, manifest, config)

    return { success: true, previousCoordinatorId }
  })
}
