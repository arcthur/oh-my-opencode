import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { appendDiscoveryEntry, getDiscoveryLedgerPath, loadDiscoveryEntries } from "./store"

describe("discovery-channel store", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0, dirs.length)) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  test("appends and loads discovery entries", () => {
    const workspace = mkdtempSync(join(tmpdir(), "discovery-store-"))
    dirs.push(workspace)

    appendDiscoveryEntry(workspace, {
      id: "dc_1",
      planId: "p1",
      claim: "Potential leak in queue",
      source: "delegate_output",
      sourceEventId: "call-1",
      timestamp: 1000,
      retrievalPath: "tool.delegate_task.output",
      status: "open",
    })

    const loaded = loadDiscoveryEntries(workspace, "p1")
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.claim).toBe("Potential leak in queue")
    expect(getDiscoveryLedgerPath(workspace, "p1")).toContain(".orchestrator/plans/p1/discoveries.jsonl")
  })
})
