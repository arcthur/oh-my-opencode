import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { RELEASE_PLATFORM_DIRS, VERSION_SYNC_PLATFORM_DIRS } from "./platforms"

const MAIN_PACKAGE_JSON_PATH = "package.json"

interface PackageJson {
  version?: string
  optionalDependencies?: Record<string, string>
}

function assertPackageJsonExists(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Missing package.json: ${path}`)
  }
}

async function readPackageJson(path: string): Promise<PackageJson> {
  const content = await Bun.file(path).text()
  return JSON.parse(content) as PackageJson
}

async function writePackageJson(path: string, data: PackageJson): Promise<void> {
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`)
}

export interface SyncReleaseVersionsOptions {
  version: string
  rootDir?: string
}

export async function syncReleaseVersions(options: SyncReleaseVersionsOptions): Promise<void> {
  const { version } = options
  const rootDir = options.rootDir ? resolve(options.rootDir) : process.cwd()

  const mainPackageJsonPath = resolve(rootDir, MAIN_PACKAGE_JSON_PATH)
  assertPackageJsonExists(mainPackageJsonPath)

  const mainPackageJson = await readPackageJson(mainPackageJsonPath)
  mainPackageJson.version = version

  if (mainPackageJson.optionalDependencies) {
    for (const platform of RELEASE_PLATFORM_DIRS) {
      const packageName = `oh-my-opencode-${platform}`
      if (packageName in mainPackageJson.optionalDependencies) {
        mainPackageJson.optionalDependencies[packageName] = version
      }
    }
  }

  await writePackageJson(mainPackageJsonPath, mainPackageJson)

  for (const platform of VERSION_SYNC_PLATFORM_DIRS) {
    const packagePath = resolve(rootDir, "packages", platform, "package.json")
    assertPackageJsonExists(packagePath)

    const packageJson = await readPackageJson(packagePath)
    packageJson.version = version
    await writePackageJson(packagePath, packageJson)
  }
}

export function resolveRepoRootFromImportMeta(importMetaUrl: string): string {
  return resolve(dirname(new URL(importMetaUrl).pathname), "..", "..")
}
