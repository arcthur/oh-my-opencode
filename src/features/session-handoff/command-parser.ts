/**
 * Handoff Command Parser
 *
 * Pure parsing logic for /handoff commands.
 * Separates management commands from goal-oriented handoffs.
 */

// ============================================================================
// Types
// ============================================================================

export type ParsedHandoffCommand =
  | { type: "management"; subcommand: ManagementSubcommand; args: string }
  | { type: "goal"; goal: string }

export type ManagementSubcommand = "list" | "show" | "delete" | "cleanup"

// ============================================================================
// Constants
// ============================================================================

/** Management commands that don't trigger active handoff */
const MANAGEMENT_COMMANDS = new Set<ManagementSubcommand>(["list", "show", "delete", "cleanup"])

/** Command prefix for handoff */
const COMMAND_PREFIX = "/handoff"

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse /handoff command and determine action
 *
 * Command formats:
 * - `/handoff` - list handoffs (management)
 * - `/handoff list` - list handoffs (management)
 * - `/handoff show <id>` - show specific handoff (management)
 * - `/handoff delete <id>` - delete handoff (management)
 * - `/handoff cleanup` - cleanup expired (management)
 * - `/handoff <goal>` - create goal-oriented handoff (active)
 *
 * @param promptText - The raw prompt text
 * @returns Parsed command or null if not a handoff command
 */
export function parseHandoffCommand(promptText: string): ParsedHandoffCommand | null {
  const trimmed = promptText.trim()

  // Check for /handoff prefix
  if (!trimmed.startsWith(COMMAND_PREFIX)) {
    return null
  }

  // Extract everything after /handoff
  const afterCommand = trimmed.slice(COMMAND_PREFIX.length).trim()

  // If empty, treat as "list"
  if (!afterCommand) {
    return { type: "management", subcommand: "list", args: "" }
  }

  // Check for management subcommands
  const firstWord = afterCommand.split(/\s+/)[0].toLowerCase()
  if (isManagementSubcommand(firstWord)) {
    const args = afterCommand.slice(firstWord.length).trim()
    return { type: "management", subcommand: firstWord, args }
  }

  // Everything else is a goal for active handoff
  return { type: "goal", goal: afterCommand }
}

/**
 * Check if a string is a management subcommand
 */
function isManagementSubcommand(cmd: string): cmd is ManagementSubcommand {
  return MANAGEMENT_COMMANDS.has(cmd as ManagementSubcommand)
}

/**
 * Check if prompt text contains a handoff command
 */
export function isHandoffCommand(promptText: string): boolean {
  return promptText.trim().startsWith(COMMAND_PREFIX)
}

/**
 * Check if parsed command is a management command
 */
export function isManagementCommand(parsed: ParsedHandoffCommand): parsed is { type: "management"; subcommand: ManagementSubcommand; args: string } {
  return parsed.type === "management"
}

/**
 * Check if parsed command is a goal command
 */
export function isGoalCommand(parsed: ParsedHandoffCommand): parsed is { type: "goal"; goal: string } {
  return parsed.type === "goal"
}
