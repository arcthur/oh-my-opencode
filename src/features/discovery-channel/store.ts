import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { DiscoveryEntry } from "./types"

const DISCOVERY_LEDGER_FILE = "discoveries.jsonl"

export function getDiscoveryLedgerPath(workspaceDir: string, planId: string): string {
  return join(workspaceDir, ".orchestrator", "plans", planId, DISCOVERY_LEDGER_FILE)
}

export function appendDiscoveryEntry(workspaceDir: string, entry: DiscoveryEntry): void {
  const ledgerPath = getDiscoveryLedgerPath(workspaceDir, entry.planId)
  mkdirSync(dirname(ledgerPath), { recursive: true })
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf-8")
}

export function loadDiscoveryEntries(workspaceDir: string, planId: string): DiscoveryEntry[] {
  const ledgerPath = getDiscoveryLedgerPath(workspaceDir, planId)
  if (!existsSync(ledgerPath)) return []

  const content = readFileSync(ledgerPath, "utf-8")
  const entries: DiscoveryEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as DiscoveryEntry
      if (
        typeof parsed.id === "string"
        && typeof parsed.planId === "string"
        && typeof parsed.claim === "string"
        && typeof parsed.sourceEventId === "string"
        && typeof parsed.retrievalPath === "string"
        && typeof parsed.timestamp === "number"
      ) {
        entries.push(parsed)
      }
    } catch {
      continue
    }
  }
  return entries
}
