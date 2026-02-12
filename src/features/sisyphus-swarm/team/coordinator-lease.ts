import { existsSync } from "fs"
import { join } from "path"
import { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { getTeamDir, readJsonSafe, writeJsonAtomic } from "../../sisyphus-tasks/storage"
import { withLock } from "../sync/semaphore"

export const CoordinatorLeaseSchema = z.object({
  holderId: z.string(),
  epoch: z.number(),
  leaseExpiresAt: z.number(),
  updatedAt: z.number(),
})

export type CoordinatorLease = z.infer<typeof CoordinatorLeaseSchema>

function getCoordinatorLeasePath(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getTeamDir(teamName, config), "coordinator-lease.json")
}

export function readCoordinatorLease(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): CoordinatorLease | null {
  return readJsonSafe(getCoordinatorLeasePath(teamName, config), CoordinatorLeaseSchema)
}

export function getCoordinatorEpoch(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): number | null {
  return readCoordinatorLease(teamName, config)?.epoch ?? null
}

export async function acquireOrRenewCoordinatorLease(
  teamName: string,
  holderId: string,
  config: Partial<OhMyOpenCodeConfig>,
  options?: { force?: boolean }
): Promise<{ acquired: boolean; lease?: CoordinatorLease; reason?: string }> {
  const leasePath = getCoordinatorLeasePath(teamName, config)
  const ttlMs = config.sisyphus?.swarm?.coordinator_lease_ttl_ms ?? 15_000
  const now = Date.now()

  return withLock(leasePath, () => {
    const current = readCoordinatorLease(teamName, config)
    if (!current) {
      const created: CoordinatorLease = {
        holderId,
        epoch: 1,
        leaseExpiresAt: now + ttlMs,
        updatedAt: now,
      }
      writeJsonAtomic(leasePath, created)
      return { acquired: true, lease: created }
    }

    const isExpired = current.leaseExpiresAt <= now
    const sameHolder = current.holderId === holderId

    if (!sameHolder && !isExpired && !options?.force) {
      return {
        acquired: false,
        reason: `coordinator lease held by ${current.holderId} until ${current.leaseExpiresAt}`,
      }
    }

    const nextEpoch = sameHolder ? current.epoch : current.epoch + 1
    const renewed: CoordinatorLease = {
      holderId,
      epoch: nextEpoch,
      leaseExpiresAt: now + ttlMs,
      updatedAt: now,
    }
    writeJsonAtomic(leasePath, renewed)
    return { acquired: true, lease: renewed }
  })
}

export function isLeaseStale(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>,
  now = Date.now()
): boolean {
  const lease = readCoordinatorLease(teamName, config)
  if (!lease) {
    return true
  }
  return lease.leaseExpiresAt <= now
}

export function coordinatorLeaseExists(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): boolean {
  return existsSync(getCoordinatorLeasePath(teamName, config))
}
