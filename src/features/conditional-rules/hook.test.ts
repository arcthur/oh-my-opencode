import { beforeEach, describe, expect, mock, test } from "bun:test"
import { contextBudgetArbiter } from "../context-budget"

const injectHookMessage = mock(() => true)

mock.module("../hook-message-injector", () => ({
  injectHookMessage,
}))

const { createConditionalRulesHooks, clearConditionalRulesCache } = require("./hook")
const { DEFAULT_CONDITIONAL_RULES_CONFIG } = require("./types")

describe("conditional-rules hook", () => {
  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
    injectHookMessage.mockReset()
    clearConditionalRulesCache()
  })

  test("injects rules for file tools when args use filePath (camelCase)", async () => {
    // given
    const hooks = createConditionalRulesHooks({
      config: {
        ...DEFAULT_CONDITIONAL_RULES_CONFIG,
        agents_md: { ...DEFAULT_CONDITIONAL_RULES_CONFIG.agents_md, enabled: false },
        conditional_rules: [
          {
            id: "all-files",
            name: "All Files Rule",
            conditions: [{ type: "glob", pattern: "**/*" }],
            content: "Always do the thing.",
            priority: 0,
          },
        ],
      },
    })

    // when
    await hooks["tool.execute.before"]?.({
      tool: "Read",
      args: { filePath: "src/foo.ts" },
      sessionId: "session-1",
      context: { cwd: "/project", agent: "general" },
    })

    // then
    expect(injectHookMessage).toHaveBeenCalledTimes(1)
  })

  test("injects rules for MultiEdit tool (case-insensitive)", async () => {
    // given
    const hooks = createConditionalRulesHooks({
      config: {
        ...DEFAULT_CONDITIONAL_RULES_CONFIG,
        agents_md: { ...DEFAULT_CONDITIONAL_RULES_CONFIG.agents_md, enabled: false },
        conditional_rules: [
          {
            id: "all-files",
            name: "All Files Rule",
            conditions: [{ type: "glob", pattern: "**/*" }],
            content: "Always do the thing.",
            priority: 0,
          },
        ],
      },
    })

    // when
    await hooks["tool.execute.before"]?.({
      tool: "MultiEdit",
      args: { filePath: "src/foo.ts" },
      sessionId: "session-1",
      context: { cwd: "/project", agent: "general" },
    })

    // then
    expect(injectHookMessage).toHaveBeenCalledTimes(1)
  })

  test("skips delegate_task append when delegate-prompt budget is exhausted", async () => {
    // given
    contextBudgetArbiter.setBudgetConfig({
      total_budget: 2000,
      source_limits: {
        "conditional-rules": 0,
      },
      overflow_strategy: "drop-low-priority",
    })
    const hooks = createConditionalRulesHooks({
      config: {
        ...DEFAULT_CONDITIONAL_RULES_CONFIG,
        agents_md: { ...DEFAULT_CONDITIONAL_RULES_CONFIG.agents_md, enabled: false },
        conditional_rules: [
          {
            id: "ts-only",
            name: "TS Rule",
            conditions: [{ type: "glob", pattern: "**/*.ts" }],
            content: "Always keep strict TS settings.",
            priority: 0,
          },
        ],
      },
    })

    // when
    const result = await hooks["tool.execute.before:delegate_task"]?.({
      args: {
        prompt: "Please modify src/foo.ts to improve readability.",
      },
      sessionId: "session-2",
      context: { cwd: "/project", agent: "general" },
    })

    // then
    expect(result).toBeUndefined()
  })
})
