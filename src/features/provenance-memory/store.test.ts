import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createProvenanceClaimStore } from "./store"

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

describe("provenance claim store", () => {
  test("stores claim with sourceEventId and retrievalPath", () => {
    const store = createProvenanceClaimStore({
      baseDir: createTempDir("prov-store-"),
      enabled: true,
    })

    const claim = store.appendClaim({
      sessionID: "s1",
      layer: "fact",
      claim: "User prefers markdown planning docs",
      sourceEventId: "evt_1",
      retrievalPath: ["policy-ledger", "event:evt_1"],
    })

    expect(claim).toBeDefined()
    expect(claim?.sourceEventId).toBe("evt_1")
    expect(claim?.retrievalPath).toEqual(["policy-ledger", "event:evt_1"])
  })

  test("verifies hash-chain integrity", () => {
    const store = createProvenanceClaimStore({
      baseDir: createTempDir("prov-chain-"),
      enabled: true,
    })

    store.appendClaim({
      sessionID: "s2",
      layer: "experience",
      claim: "Reviewer prefers deterministic ordering checks",
      sourceEventId: "evt_a",
      retrievalPath: ["hook:runtime", "test:parity"],
    })
    store.appendClaim({
      sessionID: "s2",
      layer: "fact",
      claim: "Primary model is openai/gpt-5.3-codex",
      sourceEventId: "evt_b",
      retrievalPath: ["config:model_policy", "runtime:contract"],
    })

    expect(store.verifyChain("s2")).toEqual({ valid: true })
  })
})
