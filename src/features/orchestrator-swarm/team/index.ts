/**
 * orchestrator Swarm Team Management
 *
 * Handles team creation, membership, and coordination.
 */

// Types
export {
  AgentRoleSchema,
  type AgentRole,
  AgentCapabilitySchema,
  type AgentCapability,
  AgentIdentitySchema,
  type AgentIdentity,
  TeamManifestSchema,
  type TeamManifest,
  type TeamStatus,
  AgentStatusSchema,
  type AgentStatus,
} from "./types"

// Manifest operations
export {
  generateAgentId,
  getManifestPath,
  teamExists,
  readManifest,
  type ReadManifestOptions,
  writeManifest,
  createAgentIdentity,
  createTeam,
  addMemberAsync,
  removeMemberAsync,
  updateMemberAsync,
  heartbeat,
  getMember,
  getCoordinator,
  getWorkers,
  isCoordinator,
  listTeams,
  deleteTeam,
  getStaleMembers,
  isCoordinatorAlive,
  // P0-1: Coordinator takeover
  takeoverAsCoordinatorAsync,
  type TakeoverResult,
  // P0-2: Level-triggered idle workers
  markWorkerIdle,
  markWorkerBusy,
  getIdleWorkersFromManifest,
} from "./manifest"

export {
  CoordinatorLeaseSchema,
  type CoordinatorLease,
  readCoordinatorLease,
  getCoordinatorEpoch,
  acquireOrRenewCoordinatorLease,
  isLeaseStale,
  coordinatorLeaseExists,
} from "./coordinator-lease"

// Membership operations
export {
  requestJoin,
  approveJoin,
  rejectJoin,
  requestLeave,
  approveShutdown,
  rejectShutdown,
  notifyIdle,
  getIdleWorkers,
} from "./membership"
