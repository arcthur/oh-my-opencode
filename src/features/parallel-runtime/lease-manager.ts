import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import type {
  ParallelRuntimeConfig,
  SlotAcquireRequest,
  SlotLease,
} from "./types"
import { resolveParallelRuntimeConfig } from "./types"
import {
  appendEvent,
  cleanupExpiredLeases,
  recordRunEvent,
  upsertRun,
  clearRunLease,
} from "./run-registry"
import { withRuntimeStateLock } from "./storage"

function buildLeaseId(): string {
  return `lease_${randomUUID().slice(0, 12)}`
}

function findLeaseByRunId(
  leases: Record<string, { runId: string }>,
  runId: string
): string | undefined {
  for (const [leaseId, lease] of Object.entries(leases)) {
    if (lease.runId === runId) return leaseId
  }
  return undefined
}

function isEnforceMode(config: ParallelRuntimeConfig): boolean {
  return config.mode === "enforce"
}

function shouldAppendWouldBlockEvent(
  events: Array<{ runId: string; type: string }>,
  runId: string
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.runId !== runId) continue
    return event.type !== "would_block"
  }
  return true
}

/**
 * Non-blocking slot acquisition attempt.
 *
 * - shadow mode: allows oversubscription while recording would_block.
 * - enforce mode: returns null immediately when saturated (no waiting, no timed_out).
 */
export async function tryAcquireSlot(
  req: SlotAcquireRequest,
  config: ParallelRuntimeConfig
): Promise<SlotLease | null> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) {
    return null
  }

  return withRuntimeStateLock(runtimeConfig, async (state) => {
    const now = Date.now()
    cleanupExpiredLeases(state, now)

    const existingLeaseId = findLeaseByRunId(state.leases, req.runId)
    if (existingLeaseId) {
      const existing = state.leases[existingLeaseId]
      existing.expiresAt = now + runtimeConfig.lease_ttl_ms
      existing.ownerSessionId = req.ownerSessionId ?? existing.ownerSessionId
      existing.metadata = req.metadata ?? existing.metadata

      upsertRun(state, {
        runId: req.runId,
        subsystem: req.subsystem,
        status: "running",
        ownerSessionId: existing.ownerSessionId,
        metadata: existing.metadata,
        leaseId: existingLeaseId,
        updatedAt: now,
      })

      return {
        leaseId: existingLeaseId,
        runId: req.runId,
        acquiredAt: existing.acquiredAt,
        expiresAt: existing.expiresAt,
      }
    }

    const activeCount = Object.keys(state.leases).length
    const hasCapacity = activeCount < runtimeConfig.global_slots
    const shadowBypass = !hasCapacity && runtimeConfig.mode === "shadow"

    if (!hasCapacity) {
      if (shouldAppendWouldBlockEvent(state.events, req.runId)) {
        appendEvent(
          state,
          {
            runId: req.runId,
            subsystem: req.subsystem,
            type: "would_block",
            timestamp: now,
            ownerSessionId: req.ownerSessionId,
            metadata: {
              global_slots: runtimeConfig.global_slots,
              active_leases: activeCount,
            },
          },
          now
        )
      }
      upsertRun(state, {
        runId: req.runId,
        subsystem: req.subsystem,
        status: "blocked",
        ownerSessionId: req.ownerSessionId,
        metadata: req.metadata,
        updatedAt: now,
      })
    }

    if (!hasCapacity && isEnforceMode(runtimeConfig)) {
      return null
    }

    const leaseId = buildLeaseId()
    const acquiredAt = now
    const expiresAt = now + runtimeConfig.lease_ttl_ms

    state.leases[leaseId] = {
      leaseId,
      runId: req.runId,
      subsystem: req.subsystem,
      ownerSessionId: req.ownerSessionId,
      metadata: req.metadata,
      acquiredAt,
      expiresAt,
      shadowBypass: shadowBypass || undefined,
    }

    upsertRun(state, {
      runId: req.runId,
      subsystem: req.subsystem,
      status: "running",
      ownerSessionId: req.ownerSessionId,
      metadata: req.metadata,
      leaseId,
      startedAt: acquiredAt,
      updatedAt: now,
    })

    appendEvent(
      state,
      {
        runId: req.runId,
        subsystem: req.subsystem,
        type: "started",
        timestamp: now,
        ownerSessionId: req.ownerSessionId,
        leaseId,
        metadata: shadowBypass
          ? { mode: "shadow", reason: "would_block_but_allowed" }
          : req.metadata,
      },
      now
    )

    return {
      leaseId,
      runId: req.runId,
      acquiredAt,
      expiresAt,
    }
  })
}

export async function acquireSlot(
  req: SlotAcquireRequest,
  config: ParallelRuntimeConfig
): Promise<SlotLease | null> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) {
    return null
  }

  const startedAt = Date.now()
  let blockedEventRecorded = false

  while (true) {
    const acquired = await withRuntimeStateLock(runtimeConfig, async (state) => {
      const now = Date.now()
      cleanupExpiredLeases(state, now)

      const existingLeaseId = findLeaseByRunId(state.leases, req.runId)
      if (existingLeaseId) {
        const existing = state.leases[existingLeaseId]
        existing.expiresAt = now + runtimeConfig.lease_ttl_ms
        existing.ownerSessionId = req.ownerSessionId ?? existing.ownerSessionId
        existing.metadata = req.metadata ?? existing.metadata

        upsertRun(state, {
          runId: req.runId,
          subsystem: req.subsystem,
          status: "running",
          ownerSessionId: existing.ownerSessionId,
          metadata: existing.metadata,
          leaseId: existingLeaseId,
          updatedAt: now,
        })

        return {
          leaseId: existingLeaseId,
          runId: req.runId,
          acquiredAt: existing.acquiredAt,
          expiresAt: existing.expiresAt,
        } as SlotLease
      }

      const activeCount = Object.keys(state.leases).length
      const hasCapacity = activeCount < runtimeConfig.global_slots
      const shadowBypass = !hasCapacity && runtimeConfig.mode === "shadow"

      if (!hasCapacity && !blockedEventRecorded) {
        blockedEventRecorded = true
        appendEvent(state, {
          runId: req.runId,
          subsystem: req.subsystem,
          type: "would_block",
          timestamp: now,
          ownerSessionId: req.ownerSessionId,
          metadata: {
            global_slots: runtimeConfig.global_slots,
            active_leases: activeCount,
          },
        }, now)
        upsertRun(state, {
          runId: req.runId,
          subsystem: req.subsystem,
          status: "blocked",
          ownerSessionId: req.ownerSessionId,
          metadata: req.metadata,
          updatedAt: now,
        })
      }

      if (!hasCapacity && isEnforceMode(runtimeConfig)) {
        return null
      }

      const leaseId = buildLeaseId()
      const acquiredAt = now
      const expiresAt = now + runtimeConfig.lease_ttl_ms

      state.leases[leaseId] = {
        leaseId,
        runId: req.runId,
        subsystem: req.subsystem,
        ownerSessionId: req.ownerSessionId,
        metadata: req.metadata,
        acquiredAt,
        expiresAt,
        shadowBypass: shadowBypass || undefined,
      }

      upsertRun(state, {
        runId: req.runId,
        subsystem: req.subsystem,
        status: "running",
        ownerSessionId: req.ownerSessionId,
        metadata: req.metadata,
        leaseId,
        startedAt: acquiredAt,
        updatedAt: now,
      })

      appendEvent(state, {
        runId: req.runId,
        subsystem: req.subsystem,
        type: "started",
        timestamp: now,
        ownerSessionId: req.ownerSessionId,
        leaseId,
        metadata: shadowBypass
          ? { mode: "shadow", reason: "would_block_but_allowed" }
          : req.metadata,
      }, now)

      return {
        leaseId,
        runId: req.runId,
        acquiredAt,
        expiresAt,
      } as SlotLease
    })

    if (acquired) {
      return acquired
    }

    if (!isEnforceMode(runtimeConfig)) {
      return null
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= runtimeConfig.acquire_timeout_ms) {
      await recordRunEvent(
        {
          runId: req.runId,
          subsystem: req.subsystem,
          type: "timed_out",
          ownerSessionId: req.ownerSessionId,
          metadata: {
            reason: "acquire_timeout",
            acquire_timeout_ms: runtimeConfig.acquire_timeout_ms,
          },
        },
        runtimeConfig
      )
      return null
    }

    await sleep(50)
  }
}

export async function renewSlot(
  leaseId: string,
  config: ParallelRuntimeConfig
): Promise<boolean> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) {
    return false
  }

  return withRuntimeStateLock(runtimeConfig, async (state) => {
    const now = Date.now()
    cleanupExpiredLeases(state, now)

    const lease = state.leases[leaseId]
    if (!lease) return false

    lease.expiresAt = now + runtimeConfig.lease_ttl_ms
    upsertRun(state, {
      runId: lease.runId,
      subsystem: lease.subsystem,
      status: "running",
      ownerSessionId: lease.ownerSessionId,
      metadata: lease.metadata,
      leaseId,
      updatedAt: now,
    })

    return true
  })
}

export async function releaseSlot(
  leaseId: string,
  config: ParallelRuntimeConfig
): Promise<void> {
  const runtimeConfig = resolveParallelRuntimeConfig(config)
  if (!runtimeConfig.enabled) return

  await withRuntimeStateLock(runtimeConfig, async (state) => {
    const now = Date.now()
    cleanupExpiredLeases(state, now)

    const lease = state.leases[leaseId]
    if (!lease) return

    delete state.leases[leaseId]
    clearRunLease(state, lease.runId)

    appendEvent(state, {
      runId: lease.runId,
      subsystem: lease.subsystem,
      type: "released",
      timestamp: now,
      leaseId,
      ownerSessionId: lease.ownerSessionId,
    }, now)
  })
}
