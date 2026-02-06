export type ParallelMode = "shadow" | "enforce"

/**
 * Well-known subsystems: "background" and "swarm".
 * String type allows future subsystems without modifying the union.
 */
export type ParallelSubsystem = "background" | "swarm" | (string & {})

export interface ParallelRuntimeConfig {
  enabled: boolean
  mode: ParallelMode
  global_slots: number
  lease_ttl_ms: number
  heartbeat_ms: number
  acquire_timeout_ms: number
  lock_timeout_ms: number
}

export interface SlotAcquireRequest {
  subsystem: ParallelSubsystem
  runId: string
  ownerSessionId?: string
  metadata?: Record<string, unknown>
}

export interface SlotLease {
  leaseId: string
  runId: string
  acquiredAt: number
  expiresAt: number
}

export type RunEventType =
  | "queued"
  | "started"
  | "heartbeat"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "released"
  | "would_block"

export interface RunEvent {
  runId: string
  subsystem?: ParallelSubsystem
  type: RunEventType
  timestamp?: number
  ownerSessionId?: string
  leaseId?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeLeaseRecord extends SlotLease {
  subsystem: ParallelSubsystem
  ownerSessionId?: string
  metadata?: Record<string, unknown>
  shadowBypass?: boolean
}

export type RuntimeRunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "released"

export interface RuntimeRunRecord {
  runId: string
  subsystem: ParallelSubsystem
  status: RuntimeRunStatus
  ownerSessionId?: string
  metadata?: Record<string, unknown>
  leaseId?: string
  startedAt: number
  updatedAt: number
}

export interface RuntimeState {
  schemaVersion: number
  updatedAt: number
  leases: Record<string, RuntimeLeaseRecord>
  runs: Record<string, RuntimeRunRecord>
  events: RunEvent[]
}

export interface RuntimeSnapshot {
  mode: ParallelMode
  globalSlots: number
  activeLeases: number
  availableSlots: number
  oversubscribed: number
  activeBySubsystem: Record<string, number>
  runningRuns: number
  runningBySubsystem: Record<string, number>
  leases: RuntimeLeaseRecord[]
  runs: RuntimeRunRecord[]
  recentEvents: RunEvent[]
}

export const DEFAULT_PARALLEL_RUNTIME_CONFIG: ParallelRuntimeConfig = {
  enabled: true,
  mode: "shadow",
  global_slots: 6,
  lease_ttl_ms: 120_000,
  heartbeat_ms: 10_000,
  acquire_timeout_ms: 15_000,
  lock_timeout_ms: 2_000,
}

export function resolveParallelRuntimeConfig(
  config?: Partial<ParallelRuntimeConfig>
): ParallelRuntimeConfig {
  return {
    enabled: config?.enabled ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.enabled,
    mode: config?.mode ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.mode,
    global_slots: Math.max(1, config?.global_slots ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.global_slots),
    lease_ttl_ms: Math.max(1_000, config?.lease_ttl_ms ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.lease_ttl_ms),
    heartbeat_ms: Math.max(1_000, config?.heartbeat_ms ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.heartbeat_ms),
    acquire_timeout_ms: Math.max(
      100,
      config?.acquire_timeout_ms ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.acquire_timeout_ms
    ),
    lock_timeout_ms: Math.max(100, config?.lock_timeout_ms ?? DEFAULT_PARALLEL_RUNTIME_CONFIG.lock_timeout_ms),
  }
}
