#!/usr/bin/env bun

import { $ } from "bun"

const version = process.argv[2]

if (!version) {
  console.error("Usage: bun run script/release/commit-and-tag.ts <version>")
  process.exit(1)
}

await $`git config user.email "github-actions[bot]@users.noreply.github.com"`
await $`git config user.name "github-actions[bot]"`

await $`git add package.json assets/oh-my-opencode.schema.json packages/*/package.json`.nothrow()

const hasStagedChanges = await $`git diff --cached --quiet`.nothrow()
if (hasStagedChanges.exitCode !== 0) {
  await $`git commit -m ${`release: v${version}`}`
}

const tagName = `v${version}`
const tagExists = await $`git rev-parse ${tagName}`.nothrow()
if (tagExists.exitCode === 0) {
  console.log(`Tag ${tagName} already exists. Skipping tag creation.`)
} else {
  await $`git tag ${tagName}`
  await $`git push origin ${tagName}`
}

const branchPush = await $`git push origin HEAD`.nothrow()
if (branchPush.exitCode !== 0) {
  console.log("Branch push failed (non-critical)")
}
