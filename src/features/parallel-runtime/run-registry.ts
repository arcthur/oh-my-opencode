import type {
  ParallelRuntimeConfig,
  ParallelSubsystem,
  RunEvent,
  RuntimeRunRecord,
  RuntimeRunStatus,
  RuntimeSnapshot,
  RuntimeState,
} from "./types"
import { resolveParallelRuntimeConfig } from "./types"
import { readRuntimeState, withRuntimeStateLock } from "./storage"

const MAX_RECENT_EVENTS = 500
const MAX_RECENT_EVENTS_IN_SNAPSHOT = 50
const TERMINAL_RUN_RETENTION_MS = 24 * 60 * 60 * 1000

function isTerminalStatus(status: RuntimeRunStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "timed_out" ||
    status === "released"
  )
}

function toRunStatus(eventType: RunEvent["type"]): RuntimeRunStatus {
  switch (eventType) {
    case "queued":
      return "queued"
    case "started":
    case "heartbeat":
      return "running"
    case "would_block":
      return "blocked"
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "timed_out":
      return "timed_out"
    case "released":
      return "released"
    default:
      return "running"
  }
}

export function appendEvent(state: RuntimeState, event: RunEvent, now = Date.now()): void {
  const normalized: RunEvent = {
    ...event,
    timestamp: event.timestamp ?? now,
  }
  state.events.push(normalized)
  if (state.events.length > MAX_RECENT_EVENTS) {
    state.events.splice(0, state.events.length - MAX_RECENT_EVENTS)
  }
}

export function upsertRun(
  state: RuntimeState,
  params: {
    runId: string
    subsystem: ParallelSubsystem
    status: RuntimeRunStatus
    ownerSessionId?: string
    leaseId?: string
    metadata?: Record<string, unknown>
    startedAt?: number
    updatedAt?: number
  }
): RuntimeRunRecord {
  const now = params.updatedAt ?? Date.now()
  const existing = state.runs[params.runId]
  const run: RuntimeRunRecord = {
    runId: params.runId,
    subsystem: params.subsystem,
    status: params.status,
    ownerSessionId: params.ownerSessionId ?? existing?.ownerSessionId,
    metadata: params.metadata ?? existing?.metadata,
    leaseId: params.leaseId ?? existing?.leaseId,
    startedAt: existing?.startedAt ?? params.startedAt ?? now,
    updatedAt: now,
  }
  state.runs[params.runId] = run
  return run
}

export function clearRunLease(state: RuntimeState, runId: string): void {
  const run = state.runs[runId]
  if (!run) return
  run.leaseId = undefined
  run.updatedAt = Date.now()
}

export function cleanupExpiredLeases(state: RuntimeState, now = Date.now()): string[] {
  const expiredLeaseIds: string[] = []
  for (const [leaseId, lease] of Object.entries(state.leases)) {
    if (lease.expiresAt > now) continue
    expiredLeaseIds.push(leaseId)
    delete state.leases[leaseId]
    clearRunLease(state, lease.runId)
    upsertRun(state, {
      runId: lease.runId,
      subsystem: lease.subsystem,
      status: "timed_out",
      ownerSessionId: lease.ownerSessionId,
      metadata: lease.metadata,
      updatedAt: now,
    })
    appendEvent(state, {
      runId: lease.runId,
      subsystem: lease.subsystem,
      type: "timed_out",
      timestamp: now,
      leaseId,
      ownerSessionId: lease.ownerSessionId,
      metadata: {
        reason: "lease_expired",
      },
    }, now)
  }

  for (const [runId, run] of Object.entries(state.runs)) {
    if (!isTerminalStatus(run.status)) continue
    if (now - run.updatedAt <= TERMINAL_RUN_RETENTION_MS) continue
    delete state.runs[runId]
  }

  return expiredLeaseIds
}

function buildSnapshotFromState(
  state: RuntimeState,
  config: ParallelRuntimeConfig,
  now = Date.now()
): RuntimeSnapshot {
  cleanupExpiredLeases(state, now)

  const leases = Object.values(state.leases).sort((a, b) => a.acquiredAt - b.acquiredAt)
  const runs = Object.values(state.runs).sort((a, b) => b.updatedAt - a.updatedAt)
  const activeLeases = leases.length
  const globalSlots = config.global_slots
  const availableSlots = Math.max(0, globalSlots - activeLeases)

  const activeBySubsystem: Record<string, number> = {
    background: 0,
    swarm: 0,
  }
  for (const lease of leases) {
    activeBySubsystem[lease.subsystem] = (activeBySubsystem[lease.subsystem] ?? 0) + 1
  }

  const runningBySubsystem: Record<string, number> = {
    background: 0,
    swarm: 0,
  }
  const runningRuns = runs.filter((run) => run.status === "running").length
  for (const run of runs) {
    if (run.status !== "running") continue
    runningBySubsystem[run.subsystem] = (runningBySubsystem[run.subsystem] ?? 0) + 1
  }

  return {
    mode: config.mode,
    globalSlots: config.global_slots,
    activeLeases,
    availableSlots,
    oversubscribed: Math.max(0, activeLeases - globalSlots),
    activeBySubsystem,
    runningRuns,
    runningBySubsystem,
    leases,
    runs,
    recentEvents: state.events.slice(-MAX_RECENT_EVENTS_IN_SNAPSHOT),
  }
}

export async function recordRunEvent(
  event: RunEvent,
  config: ParallelRuntimeConfig
): Promise<void> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) return

  await withRuntimeStateLock(runtimeConfig, async (state) => {
    const now = Date.now()
    cleanupExpiredLeases(state, now)
    appendEvent(state, event, now)

    const existing = state.runs[event.runId]
    const subsystem = event.subsystem ?? existing?.subsystem
    if (!subsystem) return

    const status = toRunStatus(event.type)
    upsertRun(state, {
      runId: event.runId,
      subsystem,
      status,
      ownerSessionId: event.ownerSessionId ?? existing?.ownerSessionId,
      leaseId: event.leaseId ?? existing?.leaseId,
      metadata: event.metadata ?? existing?.metadata,
      updatedAt: now,
    })

    if (event.type === "released") {
      clearRunLease(state, event.runId)
    }
  })
}

export async function getRuntimeSnapshot(
  config: ParallelRuntimeConfig
): Promise<RuntimeSnapshot> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) {
    return {
      mode: runtimeConfig.mode,
      globalSlots: runtimeConfig.global_slots,
      activeLeases: 0,
      availableSlots: runtimeConfig.global_slots,
      oversubscribed: 0,
      activeBySubsystem: { background: 0, swarm: 0 },
      runningRuns: 0,
      runningBySubsystem: { background: 0, swarm: 0 },
      leases: [],
      runs: [],
      recentEvents: [],
    }
  }

  return withRuntimeStateLock(runtimeConfig, async (state) => {
    return buildSnapshotFromState(state, runtimeConfig)
  })
}

export function getRuntimeSnapshotSync(
  config: ParallelRuntimeConfig
): RuntimeSnapshot {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) {
    return {
      mode: runtimeConfig.mode,
      globalSlots: runtimeConfig.global_slots,
      activeLeases: 0,
      availableSlots: runtimeConfig.global_slots,
      oversubscribed: 0,
      activeBySubsystem: { background: 0, swarm: 0 },
      runningRuns: 0,
      runningBySubsystem: { background: 0, swarm: 0 },
      leases: [],
      runs: [],
      recentEvents: [],
    }
  }

  const state = readRuntimeState()
  return buildSnapshotFromState(state, runtimeConfig)
}
