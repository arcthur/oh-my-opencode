import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runCartography } from "../../../src/features/cartography/service"
import type { CartographyResult } from "../../../src/features/cartography/types"
import { getRepoOverviewCacheFilePath } from "../../../src/shared/repo-overview-cache"

function createTestConfig() {
  return {
    enabled: true,
    max_depth: 2,
    min_files: 1,
    max_parallel_explorers: 1,
    include_patterns: ["**/*.ts"],
    exclude_patterns: [],
  }
}

describe("cartography service", () => {
  it("update(force=true) regenerates codemap even when no hashes changed", async () => {
    // given
    const projectRoot = mkdtempSync(join(tmpdir(), "cartography-service-"))
    try {
      writeFileSync(join(projectRoot, "index.ts"), "export const value = 1\n", "utf8")

      // when
      const initResult = await runCartography(projectRoot, "init", {
        config: createTestConfig(),
      })
      const normalUpdate = await runCartography(projectRoot, "update", {
        config: createTestConfig(),
      })
      const forceUpdate = await runCartography(projectRoot, "update", {
        config: createTestConfig(),
        force: true,
      })

      // then
      expect((initResult as CartographyResult).createdCodemaps.length).toBeGreaterThan(0)
      expect((forceUpdate as CartographyResult).analyzedDirs.length).toBeGreaterThanOrEqual(
        (normalUpdate as CartographyResult).analyzedDirs.length
      )
      expect(
        (forceUpdate as CartographyResult).updatedCodemaps.length
          + (forceUpdate as CartographyResult).createdCodemaps.length
      ).toBeGreaterThan(0)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it("update(force=true) invalidates repo-overview cache when codemap artifacts change", async () => {
    // given
    const projectRoot = mkdtempSync(join(tmpdir(), "cartography-service-"))
    const cacheFile = getRepoOverviewCacheFilePath(projectRoot)
    try {
      writeFileSync(join(projectRoot, "index.ts"), "export const value = 1\n", "utf8")
      const initResult = await runCartography(projectRoot, "init", {
        config: createTestConfig(),
      })
      expect((initResult as CartographyResult).createdCodemaps.length).toBeGreaterThan(0)

      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(
        cacheFile,
        JSON.stringify({
          overview: "cached-overview",
          timestamp: Date.now(),
          projectDir: projectRoot,
        }),
        "utf8"
      )

      // when
      await runCartography(projectRoot, "update", {
        config: createTestConfig(),
        force: true,
      })

      // then
      expect(existsSync(cacheFile)).toBe(false)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(cacheFile, { force: true })
    }
  })

  it("init keeps repo-overview cache when codemap generation fails without artifact updates", async () => {
    // given
    const projectRoot = mkdtempSync(join(tmpdir(), "cartography-service-"))
    const cacheFile = getRepoOverviewCacheFilePath(projectRoot)
    try {
      writeFileSync(join(projectRoot, "index.ts"), "export const value = 1\n", "utf8")
      mkdirSync(join(projectRoot, "codemap.md"), { recursive: true })

      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(
        cacheFile,
        JSON.stringify({
          overview: "cached-overview",
          timestamp: Date.now(),
          projectDir: projectRoot,
        }),
        "utf8"
      )

      // when
      const result = await runCartography(projectRoot, "init", {
        config: createTestConfig(),
      })

      // then
      expect((result as CartographyResult).errors.length).toBeGreaterThan(0)
      expect((result as CartographyResult).createdCodemaps.length).toBe(0)
      expect((result as CartographyResult).updatedCodemaps.length).toBe(0)
      expect(existsSync(cacheFile)).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(cacheFile, { force: true })
    }
  })
})
