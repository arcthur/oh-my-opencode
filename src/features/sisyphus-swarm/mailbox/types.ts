import { z } from "zod"

export const MailboxMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  timestamp: z.string(),
  color: z.string().optional(),
  read: z.boolean(),
})

export type MailboxMessage = z.infer<typeof MailboxMessageSchema>

export const PermissionRequestSchema = z.object({
  type: z.literal("permission_request"),
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  agentId: z.string(),
  timestamp: z.number(),
})

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>

export const PermissionResponseSchema = z.object({
  type: z.literal("permission_response"),
  requestId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  updatedInput: z.unknown().optional(),
  feedback: z.string().optional(),
  permissionUpdates: z.unknown().optional(),
})

export type PermissionResponse = z.infer<typeof PermissionResponseSchema>

export const ShutdownRequestSchema = z.object({
  type: z.literal("shutdown_request"),
})

export type ShutdownRequest = z.infer<typeof ShutdownRequestSchema>

export const ShutdownApprovedSchema = z.object({
  type: z.literal("shutdown_approved"),
})

export type ShutdownApproved = z.infer<typeof ShutdownApprovedSchema>

export const ShutdownRejectedSchema = z.object({
  type: z.literal("shutdown_rejected"),
  reason: z.string().optional(),
})

export type ShutdownRejected = z.infer<typeof ShutdownRejectedSchema>

export const TaskAssignmentSchema = z.object({
  type: z.literal("task_assignment"),
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  assignedBy: z.string(),
  timestamp: z.number(),
  /** Optional context summary for the task (e.g., relevant notepad content) */
  contextSummary: z.string().optional(),
  /** List of relevant file paths for this task */
  relevantFiles: z.array(z.string()).optional(),
  /** Parent context for retry scenarios */
  parentContext: z.object({
    /** Number of previous attempts at this task */
    previousAttempts: z.number(),
    /** Error from last attempt if any */
    lastError: z.string().optional(),
    /** ID of the previous worker who attempted this */
    lastWorkerId: z.string().optional(),
  }).optional(),
  /** Required capabilities for this task */
  requiredCapabilities: z.array(z.string()).optional(),
  /** Priority level (higher = more urgent) */
  priority: z.number().optional(),
})

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>

export const TaskCompletedSchema = z.object({
  type: z.literal("task_completed"),
  taskId: z.string(),
  agentId: z.string(),
  timestamp: z.number(),
})

export type TaskCompleted = z.infer<typeof TaskCompletedSchema>

/**
 * Task rejected by worker (e.g., worker busy, or task callback rejected)
 *
 * This allows coordinator to reassign the task to another worker.
 */
export const TaskRejectedSchema = z.object({
  type: z.literal("task_rejected"),
  taskId: z.string(),
  agentId: z.string(),
  reason: z.string(),
  timestamp: z.number(),
})

export type TaskRejected = z.infer<typeof TaskRejectedSchema>

export const IdleNotificationSchema = z.object({
  type: z.literal("idle_notification"),
})

export type IdleNotification = z.infer<typeof IdleNotificationSchema>

/**
 * Agent capabilities - aligned with team/types.ts AgentCapabilitySchema
 */
const JoinRequestCapabilitySchema = z.enum([
  "code",
  "research",
  "review",
  "test",
  "debug",
  "design",
  "docs",
])

export const JoinRequestSchema = z.object({
  type: z.literal("join_request"),
  agentName: z.string(),
  sessionId: z.string(),
  /** Agent capabilities - optional for backward compatibility with old messages */
  capabilities: z.array(JoinRequestCapabilitySchema).optional(),
  /** Tmux pane reference */
  tmuxPane: z.string().optional(),
  /** Git worktree path */
  worktreePath: z.string().optional(),
})

export type JoinRequest = z.infer<typeof JoinRequestSchema>

export const JoinApprovedSchema = z.object({
  type: z.literal("join_approved"),
  agentName: z.string(),
  teamName: z.string(),
})

export type JoinApproved = z.infer<typeof JoinApprovedSchema>

export const JoinRejectedSchema = z.object({
  type: z.literal("join_rejected"),
  reason: z.string().optional(),
})

export type JoinRejected = z.infer<typeof JoinRejectedSchema>

// ============================================================================
// Plan Approval Messages
// ============================================================================

/**
 * Worker requests coordinator approval for an implementation plan.
 *
 * Sent when Worker enters plan mode and wants validation before execution.
 * Similar to permission_request but at task/plan level rather than tool level.
 */
export const PlanApprovalRequestSchema = z.object({
  type: z.literal("plan_approval_request"),
  /** Unique request ID for correlation */
  requestId: z.string(),
  /** The plan content (markdown or text) */
  plan: z.string(),
  /** Path to plan file if it exists on disk */
  planFile: z.string().optional(),
  /** Worker agent ID */
  agentId: z.string(),
  /** Associated task ID if any */
  taskId: z.string().optional(),
  /** Request timestamp */
  timestamp: z.number(),
})

export type PlanApprovalRequest = z.infer<typeof PlanApprovalRequestSchema>

/**
 * Coordinator response to plan approval request.
 */
export const PlanApprovalResponseSchema = z.object({
  type: z.literal("plan_approval_response"),
  /** Correlates with request */
  requestId: z.string(),
  /** Decision: approved, rejected, or request revision */
  decision: z.enum(["approved", "rejected", "revision_requested"]),
  /** Feedback explaining decision or revision requirements */
  feedback: z.string().optional(),
})

export type PlanApprovalResponse = z.infer<typeof PlanApprovalResponseSchema>

// ============================================================================
// Mode Control Messages
// ============================================================================

/**
 * Permission modes for Worker agents.
 *
 * - default: Normal operation, requires permission for high-risk tools
 * - plan: Force plan mode, require approval before execution
 * - acceptEdits: Auto-accept edit operations without confirmation
 * - bypassPermissions: Skip permission checks entirely (dangerous)
 */
export const PermissionModeSchema = z.enum([
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
])

export type PermissionMode = z.infer<typeof PermissionModeSchema>

/**
 * Coordinator requests Worker to change permission mode.
 *
 * Enables dynamic control of Worker behavior:
 * - Grant trusted Workers faster execution via acceptEdits
 * - Force plan mode for complex tasks requiring review
 * - Reset to default after elevated operations
 */
export const ModeSetRequestSchema = z.object({
  type: z.literal("mode_set_request"),
  /** Target permission mode */
  mode: PermissionModeSchema,
  /** Optional reason for mode change */
  reason: z.string().optional(),
  /** Auto-reset to default after N ms (optional) */
  duration: z.number().optional(),
})

export type ModeSetRequest = z.infer<typeof ModeSetRequestSchema>

/**
 * Worker acknowledgment of mode change.
 */
export const ModeSetResponseSchema = z.object({
  type: z.literal("mode_set_response"),
  /** Whether mode was successfully set */
  success: z.boolean(),
  /** Current mode after operation */
  currentMode: PermissionModeSchema,
  /** Optional message (e.g., error reason if !success) */
  message: z.string().optional(),
})

export type ModeSetResponse = z.infer<typeof ModeSetResponseSchema>

export const ProtocolMessageSchema = z.discriminatedUnion("type", [
  PermissionRequestSchema,
  PermissionResponseSchema,
  ShutdownRequestSchema,
  ShutdownApprovedSchema,
  ShutdownRejectedSchema,
  TaskAssignmentSchema,
  TaskCompletedSchema,
  TaskRejectedSchema,
  IdleNotificationSchema,
  JoinRequestSchema,
  JoinApprovedSchema,
  JoinRejectedSchema,
  // Plan Approval
  PlanApprovalRequestSchema,
  PlanApprovalResponseSchema,
  // Mode Control
  ModeSetRequestSchema,
  ModeSetResponseSchema,
])

export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>
