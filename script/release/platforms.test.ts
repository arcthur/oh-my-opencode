import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"

import {
  RELEASE_PLATFORM_DIRS,
  VERSION_SYNC_PLATFORM_DIRS,
  PLATFORM_TARGETS,
} from "./platforms"

describe("release platform matrix", () => {
  it("keeps optionalDependencies aligned with release platforms", async () => {
    // #given release platforms and optionalDependencies from package.json
    const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as {
      optionalDependencies: Record<string, string>
    }

    const optionalPackages = Object.keys(packageJson.optionalDependencies)
      .filter((name) => name.startsWith("oh-my-opencode-"))
      .map((name) => name.replace("oh-my-opencode-", ""))
      .sort()

    // #when
    const releasePlatforms = [...RELEASE_PLATFORM_DIRS].sort()

    // #then
    expect(optionalPackages).toEqual(releasePlatforms)
  })

  it("ensures all matrix entries map to real package directories", () => {
    // #given
    const allPlatforms = VERSION_SYNC_PLATFORM_DIRS

    // #when / #then
    for (const platform of allPlatforms) {
      expect(existsSync(new URL(`../../packages/${platform}/package.json`, import.meta.url))).toBe(true)
    }
  })

  it("keeps baseline targets non-published by default", () => {
    // #given
    const baselineTargets = PLATFORM_TARGETS.filter((platform) => platform.target.includes("baseline"))

    // #when / #then
    expect(baselineTargets.length).toBeGreaterThan(0)
    for (const target of baselineTargets) {
      expect(target.publish).toBe(false)
    }
  })
})
