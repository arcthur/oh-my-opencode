import type { ToolDefinition } from "@opencode-ai/plugin"

/**
 * Returns a shallow-copied tool record with disabled tool names removed.
 * Matching is exact and case-sensitive to avoid accidental over-filtering.
 */
export function filterDisabledTools(
  tools: Record<string, ToolDefinition>,
  disabledTools?: string[]
): Record<string, ToolDefinition> {
  const disabled = new Set(disabledTools ?? [])
  if (disabled.size === 0) {
    return { ...tools }
  }

  const filtered: Record<string, ToolDefinition> = {}
  for (const [name, definition] of Object.entries(tools)) {
    if (!disabled.has(name)) {
      filtered[name] = definition
    }
  }

  return filtered
}
