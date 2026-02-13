import { describe, expect, test } from "bun:test"
import { HookNameSchema, type HookName } from "../../config"
import { buildHookEnablementMap, isClaudeCodeBridgeEnabled } from "./enablement"

describe("enablement consistency", () => {
  test("disabled_hooks disables question-label-truncator and runtime-tracker", () => {
    const hookEnablementMap = buildHookEnablementMap({
      hookNames: [...HookNameSchema.options] as HookName[],
      disabledHooks: new Set([
        "question-label-truncator",
        "runtime-tracker",
      ]),
      claudeCodeHooksEnabled: true,
    })

    expect(hookEnablementMap.get("question-label-truncator")).toBe(false)
    expect(hookEnablementMap.get("runtime-tracker")).toBe(false)
  })

  test("disabled_hooks wins over claude_code.hooks for claude-code-hooks", () => {
    const hookEnablementMap = buildHookEnablementMap({
      hookNames: [...HookNameSchema.options] as HookName[],
      disabledHooks: new Set(["claude-code-hooks"]),
      claudeCodeHooksEnabled: true,
    })

    expect(hookEnablementMap.get("claude-code-hooks")).toBe(false)
  })

  test("claude_code.hooks=false disables bridge when disabled_hooks does not include it", () => {
    const hookEnablementMap = buildHookEnablementMap({
      hookNames: [...HookNameSchema.options] as HookName[],
      disabledHooks: new Set<string>(),
      claudeCodeHooksEnabled: false,
    })

    expect(
      isClaudeCodeBridgeEnabled({
        disabledHooks: new Set<string>(),
        claudeCodeHooksEnabled: false,
      })
    ).toBe(false)
    expect(hookEnablementMap.get("claude-code-hooks")).toBe(false)
  })
})
