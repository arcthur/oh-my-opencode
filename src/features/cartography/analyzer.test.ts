import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverDirectories } from "./analyzer"
import type { CartographyConfig } from "./types"

describe("cartography analyzer", () => {
  it("always includes the project root even if below min_files", async () => {
    // given
    const projectRoot = mkdtempSync(join(tmpdir(), "cartography-analyzer-"))
    try {
      writeFileSync(join(projectRoot, "only-one.ts"), "export const x = 1\n", "utf8")

      const config: CartographyConfig = {
        enabled: true,
        max_depth: 2,
        min_files: 3,
        max_parallel_explorers: 1,
        include_patterns: ["**/*.ts"],
        exclude_patterns: [],
      }

      // when
      const dirs = await discoverDirectories(projectRoot, config)

      // then
      expect(dirs.some((d) => d.relativePath === ".")).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

