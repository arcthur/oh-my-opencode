import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const TARGET_FILES = [
  "src/agents/momus.ts",
  "src/agents/prometheus/brainstorming-mode.ts",
  "src/agents/prometheus/behavioral-summary.ts",
  "src/agents/prometheus/high-accuracy-mode.ts",
  "src/agents/prometheus/identity-constraints.ts",
  "src/agents/prometheus/plan-generation.ts",
  "src/agents/prometheus/plan-template.ts",
  "src/features/policy-runtime/prometheus-policy.ts",
  "src/hooks/sisyphus-junior-notepad/constants.ts",
  "src/hooks/keyword-detector/ultrawork/planner.ts",
] as const

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: "legacy_plan_glob", regex: /\.sisyphus\/plans\/\*\.md/ },
  { name: "legacy_plan_name_path", regex: /\.sisyphus\/plans\/\{plan-name\}\.md/ },
  { name: "legacy_plan_flat_example", regex: /\.sisyphus\/plans\/my-plan\.md/ },
  { name: "legacy_notepad_plan_name_path", regex: /\.sisyphus\/notepads\/\{plan-name\}\// },
  { name: "legacy_todo_execution_phrase", regex: /complex todo list/i },
]

const REQUIRED_CANONICAL_PLAN_PATTERN = /\.sisyphus\/plans\/[^`\s]+\/plan\.md/

describe("prompt contract guard (execution ssot wording)", () => {
  test("target prompts use canonical plan path wording", () => {
    // #given
    const repoRoot = resolve(import.meta.dir, "../..")

    // #when / #then
    for (const relativePath of TARGET_FILES) {
      const absolutePath = join(repoRoot, relativePath)
      expect(existsSync(absolutePath)).toBe(true)
      const content = readFileSync(absolutePath, "utf-8")

      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(content).not.toMatch(pattern.regex)
      }

      expect(content).toMatch(REQUIRED_CANONICAL_PLAN_PATTERN)
    }
  })
})
