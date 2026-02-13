#!/usr/bin/env bun

import { PLATFORM_TARGETS } from "./platforms"

const platformDir = process.argv[2]
const field = process.argv[3] ?? "target"

if (!platformDir) {
  console.error("Usage: bun run script/release/resolve-platform-field.ts <platform-dir> [target|binary]")
  process.exit(1)
}

const platform = PLATFORM_TARGETS.find((candidate) => candidate.dir === platformDir)
if (!platform) {
  console.error(`Unknown platform dir: ${platformDir}`)
  process.exit(1)
}

if (field === "target") {
  process.stdout.write(platform.target)
  process.exit(0)
}

if (field === "binary") {
  process.stdout.write(platform.binary)
  process.exit(0)
}

console.error(`Unknown field: ${field}. Use 'target' or 'binary'.`)
process.exit(1)
