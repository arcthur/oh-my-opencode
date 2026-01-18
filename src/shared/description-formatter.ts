/**
 * Formats a description string with a scope prefix.
 * Used consistently across all loaders to format command/agent/skill descriptions.
 *
 * @param scope - The scope identifier (e.g., "user", "project", "plugin: foo")
 * @param description - The original description (optional)
 * @returns Formatted string like "(scope) description"
 */
export function formatScopedDescription(scope: string, description?: string): string {
  const desc = description || ""
  return `(${scope}) ${desc}`
}
