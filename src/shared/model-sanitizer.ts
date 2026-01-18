export type CommandSource = "claude-code" | "opencode"

/**
 * Determines the command source based on scope.
 * opencode and opencode-project scopes use "opencode" source, all others use "claude-code".
 */
export function getCommandSource(scope: string): CommandSource {
  return scope === "opencode" || scope === "opencode-project" ? "opencode" : "claude-code"
}

export function sanitizeModelField(model: unknown, source: CommandSource = "claude-code"): string | undefined {
  if (source === "claude-code") {
    return undefined
  }
  
  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim()
  }
  return undefined
}
