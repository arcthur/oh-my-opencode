import { z } from "zod"

/**
 * Agent role in a team
 */
export const AgentRoleSchema = z.enum(["coordinator", "worker", "observer"])
export type AgentRole = z.infer<typeof AgentRoleSchema>

/**
 * Agent capabilities - what types of work an agent can perform
 */
export const AgentCapabilitySchema = z.enum([
  "code",       // Write and modify code
  "research",   // Search docs, explore codebase
  "review",     // Code review, verification
  "test",       // Run and write tests
  "debug",      // Debugging and troubleshooting
  "design",     // Architecture and design decisions
  "docs",       // Documentation writing
])
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>

/**
 * Agent identity within a team
 */
export const AgentIdentitySchema = z.object({
  /** Unique agent ID: agent_{uuid8} */
  id: z.string(),
  /** Human-readable name: sisyphus-1, junior-alpha */
  name: z.string(),
  /** Claude Code session ID */
  sessionId: z.string(),
  /** Role in the team */
  role: AgentRoleSchema,
  /** What this agent can do */
  capabilities: z.array(AgentCapabilitySchema),
  /** Tmux pane reference: session:window.pane */
  tmuxPane: z.string().optional(),
  /** Git worktree path if using isolation */
  worktreePath: z.string().optional(),
  /** When the agent joined */
  joinedAt: z.number(),
  /** Last heartbeat timestamp */
  lastHeartbeat: z.number().optional(),
})

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>

/**
 * Team manifest - metadata about a team
 */
export const TeamManifestSchema = z.object({
  /** Team name (also directory name) */
  name: z.string(),
  /** Team description */
  description: z.string().optional(),
  /** When the team was created */
  createdAt: z.number(),
  /** ID of the coordinator agent */
  coordinatorId: z.string(),
  /** All team members (including coordinator) */
  members: z.array(AgentIdentitySchema),
  /** Team-wide settings */
  settings: z.object({
    /** Maximum members allowed (0 = unlimited) */
    maxMembers: z.number().default(10),
    /** Allow new members to join without approval */
    autoApprove: z.boolean().default(false),
    /** Heartbeat timeout in ms before marking agent as dead */
    heartbeatTimeoutMs: z.number().default(30000),
    /** Task assignment strategy */
    assignmentStrategy: z.enum(["round-robin", "capability-match", "load-balance"]).default("capability-match"),
  }).default(() => ({
    maxMembers: 10,
    autoApprove: false,
    heartbeatTimeoutMs: 30000,
    assignmentStrategy: "capability-match" as const,
  })),
  /**
   * Workers currently idle and ready for tasks (level-triggered)
   *
   * This persists idle state so that when new tasks arrive,
   * the coordinator can immediately assign them without waiting
   * for workers to re-send idle notifications.
   */
  idleWorkers: z.array(z.string()).default([]),
})

export type TeamManifest = z.infer<typeof TeamManifestSchema>

/**
 * Team status summary
 */
export interface TeamStatus {
  name: string
  coordinatorId: string
  totalMembers: number
  activeMembers: number
  idleMembers: number
  workingMembers: number
  pendingJoinRequests: number
}

/**
 * Agent status in the team
 */
export const AgentStatusSchema = z.enum([
  "joining",    // Waiting for join approval
  "idle",       // Ready for work
  "working",    // Currently executing a task
  "paused",     // Non-blocking wait for external event (permission, plan approval)
  "leaving",    // Gracefully shutting down
  "dead",       // No heartbeat, presumed dead
])

export type AgentStatus = z.infer<typeof AgentStatusSchema>
