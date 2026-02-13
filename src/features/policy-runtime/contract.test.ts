import { describe, expect, test } from "bun:test"
import { CURRENT_CONFIG_VERSION, type OhMyOpenCodeConfig } from "../../config"
import { buildExecutionContract } from "./contract"

function baseConfig(overrides?: Partial<OhMyOpenCodeConfig>): OhMyOpenCodeConfig {
  return {
    config_version: CURRENT_CONFIG_VERSION,
    architecture_version: 2,
    ...overrides,
  }
}

describe("buildExecutionContract", () => {
  test("uses default profile and model policy when not configured", () => {
    const contract = buildExecutionContract({
      config: baseConfig(),
      taskId: "task-1",
    })

    expect(contract.taskId).toBe("task-1")
    expect(contract.modelPolicy.primary).toBe("openai/gpt-5.3-codex")
    expect(contract.budgets.contextTokensTarget).toBe(240000)
    expect(contract.defaultConflictResolution).toBe("most-restrictive")
  })

  test("maps contract clauses and budget profile from config", () => {
    const contract = buildExecutionContract({
      config: baseConfig({
        contracts: {
          clauses: [
            {
              id: "c1",
              description: "desc",
              hook_points: ["tool.execute.before"],
              enforcement: "hard",
              selector: { tool_name: "Write", agent: "orchestrator", session_tags: ["prod"] },
              condition: { equals: { "payload.env": "prod" } },
              action: { type: "deny", message: "blocked" },
              priority: 1,
              conflict_resolution: "most-restrictive",
              enabled: true,
              version: 1,
              provenance: { author: "a", source: "s", created_at: 1 },
              reason_code: "RC1",
            },
          ],
          conflict_resolution: "most-restrictive",
        },
        budget_profiles: {
          default: {
            context_tokens_target: 400000,
            context_tokens_hard_limit: 600000,
            reasoning_budget: "high",
            max_tool_calls: 60,
            wall_clock_ms: 240000,
          },
        },
      }),
      taskId: "task-2",
    })

    expect(contract.budgets.contextProfile).toBe("profile_600")
    expect(contract.budgets.maxToolCalls).toBe(60)
    expect(contract.defaultConflictResolution).toBe("most-restrictive")
    const customClause = contract.clauses.find((clause) => clause.id === "c1")
    expect(customClause).toBeDefined()
    expect(customClause?.selector.toolName).toBe("Write")
    expect(customClause?.reasonCode).toBe("RC1")
    expect(
      contract.clauses.some((clause) => clause.id === "builtin:policy-write-existing-guard")
    ).toBe(true)
  })
})
