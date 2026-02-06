import type { HookName } from "../../config"

interface BuildHookEnablementMapParams {
  hookNames: readonly HookName[]
  disabledHooks: ReadonlySet<string>
  claudeCodeHooksEnabled?: boolean
}

export function isHookEnabled(
  disabledHooks: ReadonlySet<string>,
  hookName: HookName
): boolean {
  return !disabledHooks.has(hookName)
}

export function isClaudeCodeBridgeEnabled(params: {
  disabledHooks: ReadonlySet<string>
  claudeCodeHooksEnabled?: boolean
}): boolean {
  const { disabledHooks, claudeCodeHooksEnabled } = params
  return !disabledHooks.has("claude-code-hooks") && (claudeCodeHooksEnabled ?? true)
}

export function buildHookEnablementMap(
  params: BuildHookEnablementMapParams
): Map<HookName, boolean> {
  const { hookNames, disabledHooks, claudeCodeHooksEnabled } = params
  const enablementMap = new Map<HookName, boolean>()

  for (const hookName of hookNames) {
    enablementMap.set(hookName, isHookEnabled(disabledHooks, hookName))
  }

  enablementMap.set(
    "claude-code-hooks",
    isClaudeCodeBridgeEnabled({
      disabledHooks,
      claudeCodeHooksEnabled,
    })
  )

  return enablementMap
}
