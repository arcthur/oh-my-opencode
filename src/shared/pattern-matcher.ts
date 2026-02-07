import type { ClaudeHooksConfig, HookMatcher } from "../hooks/claude-code-hooks/types"

/**
 * Escape regex special characters except asterisk (*).
 * We preserve * for glob-style wildcard conversion.
 */
function escapeRegexExceptAsterisk(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
}

export function matchesToolMatcher(toolName: string, matcher: string): boolean {
  if (!matcher) {
    return true
  }
  const patterns = matcher.split("|").map((p) => p.trim())
  return patterns.some((p) => {
    if (p.includes("*")) {
      const escaped = escapeRegexExceptAsterisk(p)
      const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i")
      return regex.test(toolName)
    }
    return p.toLowerCase() === toolName.toLowerCase()
  })
}

export function findMatchingHooks(
  config: ClaudeHooksConfig,
  eventName: keyof ClaudeHooksConfig,
  toolName?: string
): HookMatcher[] {
  const hookMatchers = config[eventName]
  if (!hookMatchers) return []

  return hookMatchers.filter((hookMatcher) => {
    if (!toolName) return true
    return matchesToolMatcher(toolName, hookMatcher.matcher)
  })
}
