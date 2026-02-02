/**
 * Sisyphus Swarm Team Management
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
  writeManifest,
  createAgentIdentity,
  createTeam,
  addMember,
  removeMember,
  updateMember,
  heartbeat,
  transferCoordinator,
  getMember,
  getCoordinator,
  getWorkers,
  isCoordinator,
  listTeams,
  deleteTeam,
  getStaleMembers,
  isCoordinatorAlive,
  // P0-1: Coordinator takeover
  takeoverAsCoordinator,
  type TakeoverResult,
  // P0-2: Level-triggered idle workers
  markWorkerIdle,
  markWorkerBusy,
  getIdleWorkersFromManifest,
} from "./manifest"

// Membership operations
export {
  requestJoin,
  approveJoin,
  rejectJoin,
  getPendingJoinRequests,
  requestLeave,
  approveShutdown,
  rejectShutdown,
  getPendingShutdownRequests,
  notifyIdle,
  getIdleWorkers,
} from "./membership"
