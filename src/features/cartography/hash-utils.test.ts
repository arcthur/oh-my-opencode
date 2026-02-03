import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashDirectory, md5 } from "./hash-utils"

describe("cartography hash-utils", () => {
  it("hashDirectory respects includePatterns for root-level files", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "cartography-hash-"))
    try {
      writeFileSync(join(root, "a.ts"), "export const a = 1\n", "utf8")

      // when
      const hash = hashDirectory(root, {
        includePatterns: new Set(["**/*.ts"]),
      })

      // then
      expect(hash).not.toBe(md5(""))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

