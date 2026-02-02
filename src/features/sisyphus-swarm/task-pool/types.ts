import { z } from "zod"
import { TaskSchema, type Task } from "../../sisyphus-tasks/types"
import { AgentCapabilitySchema } from "../team/types"

/**
 * Extended task with Swarm-specific fields
 */
export const SwarmTaskSchema = TaskSchema.extend({
  /** Required capabilities to work on this task */
  requiredCapabilities: z.array(AgentCapabilitySchema).optional(),
  /** Priority (higher = more important) */
  priority: z.number().default(0),
  /** Estimated complexity (1-10) */
  complexity: z.number().min(1).max(10).optional(),
  /** Deadline timestamp */
  deadline: z.number().optional(),
  /** Parent task ID for subtasks */
  parentTaskId: z.string().optional(),
  /** Assignment history */
  assignmentHistory: z.array(z.object({
    agentId: z.string(),
    assignedAt: z.number(),
    completedAt: z.number().optional(),
    result: z.enum(["completed", "failed", "reassigned"]).optional(),
  })).optional(),
})

export type SwarmTask = z.infer<typeof SwarmTaskSchema>

/**
 * Task assignment result
 */
export interface TaskAssignmentResult {
  success: boolean
  taskId?: string
  agentId?: string
  reason?: string
}

/**
 * Task pool statistics
 */
export interface TaskPoolStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  blocked: number
  averageCompletionTime?: number
}

/**
 * Task filter options
 */
export interface TaskFilterOptions {
  status?: Task["status"]
  owner?: string
  hasCapability?: string[]
  minPriority?: number
  excludeBlocked?: boolean
}
