import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createContextLedgerStore } from "../context-ledger/store"
import { compilePrefixContext } from "./compile"

describe("prefix compiler", () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "omo-prefix-compiler-"))
  })

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })

  test("compiles stable prefix from immutable ledger segments and appends dynamic tail", () => {
    // #given
    const store = createContextLedgerStore({
      enabled: true,
      baseDir,
    })
    store.append({
      sessionID: "session-compiler-1",
      source: "rules-injector",
      content: "Rule A",
      immutable: true,
    })
    store.append({
      sessionID: "session-compiler-1",
      source: "user-memory",
      content: "Memory B",
      immutable: true,
    })

    // #when
    const result = compilePrefixContext({
      sessionID: "session-compiler-1",
      pendingMerged: "Dynamic C",
      ledgerStore: store,
      config: {
        enabled: true,
      },
    })

    // #then
    expect(result.usedLedger).toBe(true)
    expect(result.prefix).toContain("Rule A")
    expect(result.prefix).toContain("Memory B")
    expect(result.dynamicTail).toContain("Dynamic C")
    expect(result.compiled).toContain("Dynamic C")
    expect(result.prefixFingerprint.length).toBeGreaterThan(0)
  })

  test("falls back to pending context when compiler is disabled", () => {
    // #given
    const store = createContextLedgerStore({
      enabled: true,
      baseDir,
    })

    // #when
    const result = compilePrefixContext({
      sessionID: "session-compiler-2",
      pendingMerged: "Only pending content",
      ledgerStore: store,
      config: {
        enabled: false,
      },
    })

    // #then
    expect(result.usedLedger).toBe(false)
    expect(result.compiled).toBe("Only pending content")
  })

  test("keeps dynamic tail when matching immutable segment was trimmed by prefix char limit", () => {
    // #given
    const store = createContextLedgerStore({
      enabled: true,
      baseDir,
    })
    store.append({
      sessionID: "session-compiler-3",
      source: "rules-injector",
      content: "Dynamic C",
      immutable: true,
    })
    store.append({
      sessionID: "session-compiler-3",
      source: "rules-injector",
      content: "AB",
      immutable: true,
    })

    // #when
    const result = compilePrefixContext({
      sessionID: "session-compiler-3",
      pendingMerged: "Dynamic C",
      ledgerStore: store,
      config: {
        enabled: true,
        maxPrefixChars: 2,
        separator: "\n\n---\n\n",
      },
    })

    // #then
    expect(result.prefix).toBe("AB")
    expect(result.dynamicTail).toBe("Dynamic C")
    expect(result.compiled).toContain("Dynamic C")
  })
})
