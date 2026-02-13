import { log } from "../../shared/logger"
import { parseDiscoveryMarkers } from "./parser"
import { appendDiscoveryEntry, loadDiscoveryEntries } from "./store"
import type {
  DiscoveryCaptureInput,
  DiscoveryChannelConfig,
  DiscoveryEntry,
} from "./types"

function normalizeClaim(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/g, " ")
}

function makeDiscoveryId(now: number, seed: number): string {
  return `dc_${now}_${seed.toString(36)}`
}

export class DiscoveryChannel {
  private dedupeSeenAt = new Map<string, number>()
  private readonly now: () => number

  constructor(
    private readonly workspaceDir: string,
    private readonly config: DiscoveryChannelConfig,
    now?: () => number
  ) {
    this.now = now ?? (() => Date.now())
  }

  capture(input: DiscoveryCaptureInput): DiscoveryEntry[] {
    if (!this.config.enabled || !input.text.trim()) {
      return []
    }

    const claims = parseDiscoveryMarkers(input.text, this.config.markerMode)
    if (claims.length === 0) {
      return []
    }

    const now = this.now()
    this.pruneDedupeWindow(now)

    const existing = loadDiscoveryEntries(this.workspaceDir, input.planId)
    const openItems = existing.filter((entry) => entry.status === "open")
    const accepted: DiscoveryEntry[] = []
    let remainingSlots = Math.max(0, this.config.maxOpenItems - openItems.length)

    for (let index = 0; index < claims.length; index += 1) {
      if (remainingSlots <= 0) break
      const claim = claims[index]
      const key = `${input.planId}:${normalizeClaim(claim)}`
      const seenAt = this.dedupeSeenAt.get(key)
      if (seenAt !== undefined && now - seenAt <= this.config.dedupeWindowMs) {
        continue
      }

      const duplicatedInStore = openItems.some(
        (entry) =>
          normalizeClaim(entry.claim) === normalizeClaim(claim)
          && now - entry.timestamp <= this.config.dedupeWindowMs
      )
      if (duplicatedInStore) {
        this.dedupeSeenAt.set(key, now)
        continue
      }

      const entry: DiscoveryEntry = {
        id: makeDiscoveryId(now, index + Math.floor(Math.random() * 1000)),
        planId: input.planId,
        claim,
        source: input.source,
        sourceEventId: input.sourceEventId,
        timestamp: now,
        retrievalPath: input.retrievalPath,
        status: "open",
      }
      appendDiscoveryEntry(this.workspaceDir, entry)
      this.dedupeSeenAt.set(key, now)
      accepted.push(entry)
      remainingSlots -= 1
    }

    if (accepted.length > 0) {
      log("[discovery-channel] captured discoveries", {
        planId: input.planId,
        captured: accepted.length,
        source: input.source,
      })
    }

    return accepted
  }

  listUnresolved(planId: string, limit = 20): DiscoveryEntry[] {
    return loadDiscoveryEntries(this.workspaceDir, planId)
      .filter((entry) => entry.status === "open")
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.max(0, limit))
  }

  renderIdleReminder(planId: string, limit = 5): string | null {
    const unresolved = this.listUnresolved(planId, limit)
    if (unresolved.length === 0) return null

    const items = unresolved.map((entry, index) => `${index + 1}. ${entry.claim}`)
    return [
      "## Discovery Backlog (Unresolved)",
      "Address or explicitly defer these findings before final completion:",
      ...items,
      "",
      "If deferred, keep them tracked in discoveries.jsonl for next handoff.",
    ].join("\n")
  }

  private pruneDedupeWindow(now: number): void {
    for (const [key, timestamp] of this.dedupeSeenAt.entries()) {
      if (now - timestamp > this.config.dedupeWindowMs) {
        this.dedupeSeenAt.delete(key)
      }
    }
  }
}

export type {
  DiscoveryChannelConfig,
  DiscoveryCaptureInput,
  DiscoveryEntry,
} from "./types"
