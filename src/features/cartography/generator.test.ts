import { describe, it, expect } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateCodemap } from "./generator"
import { hashDirectory } from "./hash-utils"
import type { AnalysisResult, DirectoryInfo } from "./types"

describe("cartography generator", () => {
  it("computes meta.sourceHash from directory content (respects maxDepth)", () => {
    // given
    const projectRoot = mkdtempSync(join(tmpdir(), "cartography-generator-"))
    try {
      writeFileSync(join(projectRoot, "a.ts"), "export const a = 1\n", "utf8")
      mkdirSync(join(projectRoot, "sub"))
      writeFileSync(join(projectRoot, "sub", "b.ts"), "export const b = 2\n", "utf8")

      const dir: DirectoryInfo = {
        path: projectRoot,
        relativePath: ".",
        name: "project",
        depth: 0,
        fileCount: 1,
        lineCount: 1,
        extensions: [".ts"],
        hasSubdirs: true,
        subdirCount: 1,
      }

      const analysis: AnalysisResult[] = [
        {
          directory: projectRoot,
          symbols: [],
          patterns: [],
          flows: [],
          integrations: [],
          source: "ast-grep",
        },
      ]

      const includePatterns = ["**/*.ts"]

      // when
      const { meta: depth0 } = generateCodemap(dir, analysis, projectRoot, {
        includePatterns,
        maxDepth: 0,
      })
      const { meta: depth1 } = generateCodemap(dir, analysis, projectRoot, {
        includePatterns,
        maxDepth: 1,
      })

      // then
      const expectedDepth0 = hashDirectory(projectRoot, {
        includePatterns: new Set(includePatterns),
        maxDepth: 0,
      })
      const expectedDepth1 = hashDirectory(projectRoot, {
        includePatterns: new Set(includePatterns),
        maxDepth: 1,
      })

      expect(depth0.sourceHash).toBe(expectedDepth0)
      expect(depth1.sourceHash).toBe(expectedDepth1)
      expect(depth0.sourceHash).not.toBe(depth1.sourceHash)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })
})

