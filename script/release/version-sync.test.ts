import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { RELEASE_PLATFORM_DIRS, VERSION_SYNC_PLATFORM_DIRS } from "./platforms"
import { syncReleaseVersions } from "./version-sync"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-release-sync-"))
  tempDirs.push(root)

  const optionalDependencies = Object.fromEntries(
    RELEASE_PLATFORM_DIRS.map((platform) => [`oh-my-opencode-${platform}`, "0.0.1"])
  )

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "oh-my-opencode", version: "0.0.1", optionalDependencies }, null, 2)}\n`
  )

  for (const platform of VERSION_SYNC_PLATFORM_DIRS) {
    const dir = join(root, "packages", platform)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: `oh-my-opencode-${platform}`, version: "0.0.1" }, null, 2)}\n`
    )
  }

  return root
}

describe("syncReleaseVersions", () => {
  test("updates main and platform package versions from a single source", async () => {
    // #given
    const root = createFixtureRepo()

    // #when
    await syncReleaseVersions({ version: "9.9.9", rootDir: root })

    // #then
    const mainPackage = JSON.parse(await Bun.file(join(root, "package.json")).text()) as {
      version: string
      optionalDependencies: Record<string, string>
    }
    expect(mainPackage.version).toBe("9.9.9")

    for (const platform of RELEASE_PLATFORM_DIRS) {
      expect(mainPackage.optionalDependencies[`oh-my-opencode-${platform}`]).toBe("9.9.9")
    }

    for (const platform of VERSION_SYNC_PLATFORM_DIRS) {
      const platformPackage = JSON.parse(
        await Bun.file(join(root, "packages", platform, "package.json")).text()
      ) as { version: string }
      expect(platformPackage.version).toBe("9.9.9")
    }
  })

  test("throws when a platform package is missing", async () => {
    // #given
    const root = createFixtureRepo()
    const missingPlatform = VERSION_SYNC_PLATFORM_DIRS[0]
    rmSync(join(root, "packages", missingPlatform, "package.json"))

    // #when / #then
    await expect(syncReleaseVersions({ version: "1.2.3", rootDir: root })).rejects.toThrow(
      `Missing package.json: ${join(root, "packages", missingPlatform, "package.json")}`
    )
  })
})
