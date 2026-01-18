/**
 * Parses a comma-separated string of tool names into a Record<string, boolean>.
 * Used by agent loaders to configure allowed tools.
 *
 * @param toolsStr - Comma-separated list of tool names (e.g., "Read,Write,Bash")
 * @returns Record mapping lowercase tool names to true, or undefined if input is empty
 */
export function parseToolsConfig(toolsStr?: string): Record<string, boolean> | undefined {
  if (!toolsStr) return undefined

  const tools = toolsStr.split(",").map((t) => t.trim()).filter(Boolean)
  if (tools.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of tools) {
    result[tool.toLowerCase()] = true
  }
  return result
}

/**
 * Parses a whitespace-separated string of allowed tool names into an array.
 * Used by skill loaders to configure allowed tools list.
 *
 * @param allowedTools - Whitespace-separated list of tool names
 * @returns Array of tool names, or undefined if input is empty
 */
export function parseAllowedTools(allowedTools: string | undefined): string[] | undefined {
  if (!allowedTools) return undefined
  return allowedTools.split(/\s+/).filter(Boolean)
}
