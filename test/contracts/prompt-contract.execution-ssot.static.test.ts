import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const TARGET_FILES = [
  "src/agents/reviewer.ts",
  "src/agents/planner/brainstorming-mode.ts",
  "src/agents/planner/behavioral-summary.ts",
  "src/agents/planner/high-accuracy-mode.ts",
  "src/agents/planner/identity-constraints.ts",
  "src/agents/planner/plan-generation.ts",
  "src/agents/planner/plan-template.ts",
  "src/features/policy-runtime/planner-policy.ts",
  "src/hooks/specialist-notepad/constants.ts",
  "src/hooks/keyword-detector/ultrawork/planner.ts",
] as const

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: "legacy_plan_glob", regex: /\.orchestrator\/plans\/\*\.md/ },
  { name: "legacy_plan_name_path", regex: /\.orchestrator\/plans\/\{plan-name\}\.md/ },
  { name: "legacy_plan_flat_example", regex: /\.orchestrator\/plans\/my-plan\.md/ },
  { name: "legacy_notepad_plan_name_path", regex: /\.orchestrator\/notepads\/\{plan-name\}\// },
  { name: "legacy_todo_execution_phrase", regex: /complex todo list/i },
]

const REQUIRED_CANONICAL_PLAN_PATTERN = /\.orchestrator\/plans\/[^`\s]+\/plan\.md/

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
