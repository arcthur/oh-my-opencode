import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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
})
