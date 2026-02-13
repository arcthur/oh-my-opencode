#!/usr/bin/env bun

import {
  RELEASE_PLATFORM_DIRS,
  VERSION_SYNC_PLATFORM_DIRS,
} from "./platforms"

const mode = process.argv[2] ?? "release"

if (mode === "release") {
  process.stdout.write(JSON.stringify(RELEASE_PLATFORM_DIRS))
  process.exit(0)
}

if (mode === "all") {
  process.stdout.write(JSON.stringify(VERSION_SYNC_PLATFORM_DIRS))
  process.exit(0)
}

console.error(`Unknown mode: ${mode}. Use 'release' or 'all'.`)
process.exit(1)
