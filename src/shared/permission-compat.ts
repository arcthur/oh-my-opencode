/**
 * Permission system utilities for OpenCode 1.1.1+.
 * This module only supports the new permission format.
 */

/**
 * Permission values:
 * - "allow": full access
 * - "deny": no access
 * - "ask": prompt user before use
 * - "research": scoped access — only navigator/librarian subagent_type, no categories, no skill injection.
 *   Translated to "allow" for the host runtime; enforcement is in the tool itself.
 */
export type PermissionValue = "ask" | "allow" | "deny" | "research"

/**
 * Normalizes a PermissionValue for the host runtime.
 * "research" → "allow" (host doesn't understand scoped values)
 */
export function normalizePermissionForHost(value: PermissionValue): "ask" | "allow" | "deny" {
  if (value === "research") return "allow"
  return value
}

/**
 * Normalizes a permission record for the host runtime.
 */
export function normalizePermissionsForHost(
  permissions: Record<string, PermissionValue>
): Record<string, "ask" | "allow" | "deny"> {
  return Object.fromEntries(
    Object.entries(permissions).map(([key, value]) => [key, normalizePermissionForHost(value)])
  )
}

export interface PermissionFormat {
  permission: Record<string, PermissionValue>
}

/**
 * Creates tool restrictions that deny specified tools.
 */
export function createAgentToolRestrictions(
  denyTools: string[]
): PermissionFormat {
  return {
    permission: Object.fromEntries(
      denyTools.map((tool) => [tool, "deny" as const])
    ),
  }
}

/**
 * Creates tool restrictions that ONLY allow specified tools.
 * All other tools are denied by default using `*: deny` pattern.
 */
export function createAgentToolAllowlist(
  allowTools: string[]
): PermissionFormat {
  return {
    permission: {
      "*": "deny" as const,
      ...Object.fromEntries(
        allowTools.map((tool) => [tool, "allow" as const])
      ),
    },
  }
}

/**
 * Converts legacy tools format to permission format.
 * For migrating user configs from older versions.
 */
export function migrateToolsToPermission(
  tools: Record<string, boolean>
): Record<string, PermissionValue> {
  return Object.fromEntries(
    Object.entries(tools).map(([key, value]) => [
      key,
      value ? ("allow" as const) : ("deny" as const),
    ])
  )
}

/**
 * Migrates agent config from legacy tools format to permission format.
 * If config has `tools`, converts to `permission`.
 */
export function migrateAgentConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...config }

  if (result.tools && typeof result.tools === "object") {
    const existingPermission =
      (result.permission as Record<string, PermissionValue>) || {}
    const migratedPermission = migrateToolsToPermission(
      result.tools as Record<string, boolean>
    )
    result.permission = { ...migratedPermission, ...existingPermission }
    delete result.tools
  }

  return result
}
