#!/usr/bin/env bun

import { resolveRepoRootFromImportMeta, syncReleaseVersions } from "./version-sync"

const version = process.argv[2]

if (!version) {
  console.error("Usage: bun run script/release/update-versions.ts <version>")
  process.exit(1)
}

const rootDir = resolveRepoRootFromImportMeta(import.meta.url)

await syncReleaseVersions({ version, rootDir })
console.log(`Synced release versions to ${version}`)
