import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createContextLedgerStore } from "./store"

describe("context-ledger store", () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "omo-context-ledger-"))
  })

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })

  test("builds append-only hash chain and keeps immutable prefix fingerprint stable", () => {
    // #given
    const store = createContextLedgerStore({
      enabled: true,
      baseDir,
    })

    // #when
    const first = store.append({
      sessionID: "session-ledger-1",
      source: "rules-injector",
      content: "Rule A",
      immutable: true,
    })
    const second = store.append({
      sessionID: "session-ledger-1",
      source: "user-memory",
      content: "Memory B",
      immutable: true,
    })
    const beforeFingerprint = store.computePrefixFingerprint("session-ledger-1")
    store.append({
      sessionID: "session-ledger-1",
      source: "runtime-note",
      content: "Mutable tail",
      immutable: false,
    })
    const afterFingerprint = store.computePrefixFingerprint("session-ledger-1")

    // #then
    expect(first.previousHash).toBe("root")
    expect(second.previousHash).toBe(first.hash)
    expect(beforeFingerprint.length).toBeGreaterThan(0)
    expect(afterFingerprint).toBe(beforeFingerprint)
    expect(store.verifyChain("session-ledger-1").valid).toBe(true)
  })
})

