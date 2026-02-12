import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

const DEPRECATED_UPSTREAM_PATHS = [
  "src/features/boulder-state",
  "src/features/claude-tasks",
  "src/tools/task",
  "src/hooks/task-reminder",
  "src/hooks/unstable-agent-babysitter",
  "src/features/tmux-subagent",
  "src/shared/tmux",
] as const

describe("fork boundary guard (deprecated upstream modules)", () => {
  test("deprecated upstream module paths must remain absent in this fork", () => {
    //#given
    const repoRoot = resolve(import.meta.dir, "../..")

    //#when / #then
    for (const relativePath of DEPRECATED_UPSTREAM_PATHS) {
      const absolutePath = join(repoRoot, relativePath)
      expect(existsSync(absolutePath)).toBe(false)
    }
  })
})
