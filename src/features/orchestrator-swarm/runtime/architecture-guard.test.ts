import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath))
      continue
    }
    if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".test.ts")) {
      files.push(fullPath)
    }
  }
  return files
}

describe("swarm runtime architecture guard", () => {
  test("tool and hook layers do not own swarm runtime maps", () => {
    // #given
    const root = join(import.meta.dir, "../../../../")
    const swarmToolSource = readFileSync(join(root, "src/tools/swarm.ts"), "utf-8")
    const swarmFromPlanSource = readFileSync(join(root, "src/hooks/swarm-from-plan/index.ts"), "utf-8")

    // #then
    expect(swarmToolSource.includes("const orchestrators = new Map")).toBe(false)
    expect(swarmToolSource.includes("const sessionTeams = new Map")).toBe(false)
    expect(swarmFromPlanSource.includes("from \"../../tools/swarm\"")).toBe(false)
  })

  test("runtime hot paths do not import withLockSync", () => {
    // #given
    const root = join(import.meta.dir, "../../../../")
    const guardedDirs = [
      "src/features/orchestrator-swarm/agent",
      "src/features/orchestrator-swarm/team",
      "src/features/orchestrator-swarm/task-graph",
      "src/features/orchestrator-swarm/mailbox",
    ]
    const targetFiles = guardedDirs.flatMap((dir) => collectTsFiles(join(root, dir)))

    // #then
    for (const file of targetFiles) {
      const source = readFileSync(file, "utf-8")
      expect(source.includes("withLockSync")).toBe(false)
    }
  })
})
