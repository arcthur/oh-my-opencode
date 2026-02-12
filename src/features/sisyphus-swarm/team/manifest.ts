import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, ensureDir, writeJsonAtomic, readJsonSafe } from "../../sisyphus-tasks/storage"
import { withLock } from "../sync/semaphore"
import { listIdleWorkers, markBusy, markIdle } from "./idle-store"
import { readHeartbeat, readAllHeartbeats, writeHeartbeat } from "./heartbeat-store"
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
export interface ReadManifestOptions {
  includeHeartbeats?: boolean
  heartbeats?: Map<string, number>
}

export function readManifest(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: ReadManifestOptions
): TeamManifest | null {
  const manifestPath = getManifestPath(teamName, config)
  const manifest = readJsonSafe(manifestPath, TeamManifestSchema)
  if (!manifest) {
    return null
  }

  if (options?.includeHeartbeats !== false) {
    const heartbeats = options?.heartbeats ?? readAllHeartbeats(teamName, config)
    if (heartbeats.size > 0) {
      for (const member of manifest.members) {
        const heartbeatAt = heartbeats.get(member.id)
        if (heartbeatAt !== undefined) {
          member.lastHeartbeat = heartbeatAt
        }
      }
    }
  }
  return manifest
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
  }

  writeManifest(teamName, manifest, config)
  writeHeartbeat(teamName, coordWithRole.id, config, coordWithRole.lastHeartbeat ?? Date.now())

  // Create inboxes directory
  const inboxesDir = join(getTeamDir(teamName, config), "inboxes")
  ensureDir(inboxesDir)

  return manifest
}

/**
 * Add a member to the team.
 */
export async function addMemberAsync(
  teamName: string,
  member: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>
): Promise<TeamManifest> {
  const manifestPath = getManifestPath(teamName, config)

  return withLock(manifestPath, () => {
    const manifest = readManifest(teamName, config, { includeHeartbeats: false })
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const existing = manifest.members.find(m => m.id === member.id)
    if (existing) {
      existing.capabilities = member.capabilities
      existing.tmuxPane = member.tmuxPane
      existing.worktreePath = member.worktreePath
      existing.lastHeartbeat = Date.now()
      writeManifest(teamName, manifest, config)
      writeHeartbeat(teamName, existing.id, config, existing.lastHeartbeat)
      return manifest
    }

    if (manifest.settings.maxMembers > 0 && manifest.members.length >= manifest.settings.maxMembers) {
      throw new Error(`Team "${teamName}" has reached maximum members (${manifest.settings.maxMembers})`)
    }

    manifest.members.push(member)
    writeManifest(teamName, manifest, config)
    writeHeartbeat(teamName, member.id, config, member.lastHeartbeat ?? Date.now())
    return manifest
  })
}

/**
 * Remove a member from the team.
 */
export async function removeMemberAsync(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): Promise<TeamManifest> {
  const manifestPath = getManifestPath(teamName, config)

  return withLock(manifestPath, () => {
    const manifest = readManifest(teamName, config, { includeHeartbeats: false })
    if (!manifest) {
      throw new Error(`Team "${teamName}" not found`)
    }

    if (manifest.coordinatorId === agentId) {
      throw new Error("Cannot remove coordinator from team. Transfer coordinator role first.")
    }

    const memberIndex = manifest.members.findIndex(m => m.id === agentId)
    if (memberIndex === -1) {
      return manifest
    }

    manifest.members.splice(memberIndex, 1)
    markBusy(teamName, agentId, config)

    writeManifest(teamName, manifest, config)
    return manifest
  })
}

/**
 * Update member info (e.g., heartbeat, capabilities).
 */
export async function updateMemberAsync(
  teamName: string,
  agentId: string,
  updates: Partial<Pick<AgentIdentity, "capabilities" | "tmuxPane" | "worktreePath" | "lastHeartbeat">>,
  config: Partial<OhMyOpenCodeConfig>
): Promise<TeamManifest> {
  const manifestPath = getManifestPath(teamName, config)
  return withLock(manifestPath, () => {
    const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
    if (updates.lastHeartbeat !== undefined) {
      writeHeartbeat(teamName, member.id, config, updates.lastHeartbeat)
    }
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
  writeHeartbeat(teamName, agentId, config, Date.now())
}

/**
 * Get a specific member by ID
 */
export function getMember(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): AgentIdentity | null {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
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
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) return []

  const timeout = manifest.settings.heartbeatTimeoutMs
  const now = Date.now()

  return manifest.members.filter(m => {
    const heartbeatAt = readHeartbeat(teamName, m.id, config) ?? m.lastHeartbeat
    if (!heartbeatAt) return true
    return now - heartbeatAt > timeout
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
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) return false

  const coordinator = manifest.members.find(m => m.id === manifest.coordinatorId)
  if (!coordinator) return false

  const heartbeatAt = readHeartbeat(teamName, coordinator.id, config) ?? coordinator.lastHeartbeat
  // If no heartbeat recorded, assume alive (just started)
  if (!heartbeatAt) return true

  const timeout = manifest.settings.heartbeatTimeoutMs
  const now = Date.now()

  return now - heartbeatAt < timeout
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
  markIdle(teamName, workerId, config)
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
  markBusy(teamName, workerId, config)
}

/**
 * Get list of idle workers from idle store (level-triggered)
 *
 * Returns only workers that are still members.
 */
export function getIdleWorkersFromManifest(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const manifest = readManifest(teamName, config, { includeHeartbeats: false })
  if (!manifest) return []

  const idleWorkers = listIdleWorkers(teamName, config)
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
 * Take over as the new coordinator of a team.
 */
export async function takeoverAsCoordinatorAsync(
  teamName: string,
  newCoordinator: AgentIdentity,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { force?: boolean }
): Promise<TakeoverResult> {
  const manifestPath = getManifestPath(teamName, config)

  return withLock(manifestPath, () => {
    const manifest = readManifest(teamName, config, { includeHeartbeats: false })
    if (!manifest) {
      return { success: false, reason: `Team "${teamName}" not found` }
    }

    const previousCoordinatorId = manifest.coordinatorId
    if (previousCoordinatorId === newCoordinator.id) {
      return { success: true, previousCoordinatorId }
    }

    if (!options?.force) {
      const oldCoordinator = manifest.members.find(m => m.id === previousCoordinatorId)
      const oldHeartbeat = oldCoordinator
        ? (readHeartbeat(teamName, oldCoordinator.id, config) ?? oldCoordinator.lastHeartbeat)
        : undefined
      if (oldHeartbeat) {
        const timeout = manifest.settings.heartbeatTimeoutMs
        const now = Date.now()
        if (now - oldHeartbeat < timeout) {
          return {
            success: false,
            reason: `Cannot takeover: coordinator "${previousCoordinatorId}" is still alive (heartbeat ${Math.round((now - oldHeartbeat) / 1000)}s ago, timeout ${timeout / 1000}s)`,
            previousCoordinatorId,
          }
        }
      }
    }

    const oldCoordIndex = manifest.members.findIndex(m => m.id === previousCoordinatorId)
    if (oldCoordIndex !== -1) {
      manifest.members[oldCoordIndex].role = "worker"
    }

    const existingMemberIndex = manifest.members.findIndex(m => m.id === newCoordinator.id)
    if (existingMemberIndex !== -1) {
      manifest.members[existingMemberIndex].role = "coordinator"
      manifest.members[existingMemberIndex].lastHeartbeat = Date.now()
      writeHeartbeat(
        teamName,
        manifest.members[existingMemberIndex].id,
        config,
        manifest.members[existingMemberIndex].lastHeartbeat
      )
    } else {
      const coordWithRole: AgentIdentity = {
        ...newCoordinator,
        role: "coordinator",
        lastHeartbeat: Date.now(),
      }
      manifest.members.push(coordWithRole)
      writeHeartbeat(teamName, coordWithRole.id, config, coordWithRole.lastHeartbeat ?? Date.now())
    }

    manifest.coordinatorId = newCoordinator.id
    writeManifest(teamName, manifest, config)
    return { success: true, previousCoordinatorId }
  })
}
