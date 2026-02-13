import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PolicyLedgerStore } from "./policy-ledger"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("PolicyLedgerStore", () => {
  test("stores observed entries only", () => {
    const baseDir = createTempDir("policy-ledger-observed-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
      maxFileBytes: 1024,
    })

    store.appendObserved({
      observedId: "obs_1",
      timestamp: 1,
      sessionID: "s1",
      hookPoint: "tool.execute.before",
      toolName: "Read",
      payload: { sample: true },
      traceHookNodeId: "internal:policy-observe:tool.execute.before",
    })

    const entries = store.readSession("s1")
    expect(entries).toHaveLength(1)
    expect(entries[0]?.type).toBe("observed")
  })

  test("rolls oversized session ledger by keeping tail entries", () => {
    const baseDir = createTempDir("policy-ledger-roll-")
    const store = new PolicyLedgerStore({
      enabled: true,
      baseDir,
      retentionDays: 7,
      maxFileBytes: 768,
    })

    for (let i = 0; i < 20; i += 1) {
      store.appendObserved({
        observedId: `obs_${i}`,
        timestamp: i,
        sessionID: "s-roll",
        hookPoint: "tool.execute.before",
        toolName: "Read",
        payload: {
          id: i,
          blob: "x".repeat(180),
        },
        traceHookNodeId: "internal:policy-observe:tool.execute.before",
      })
    }

    const filePath = join(baseDir, "s-roll.jsonl")
    const fileSize = statSync(filePath).size
    const entries = store.readSession("s-roll")

    expect(fileSize).toBeLessThanOrEqual(1536)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.length).toBeLessThan(20)
  })
})
