import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName =
  | "brainstorm"
  | "init-deep"
  | "ralph-loop"
  | "cancel-ralph"
  | "ulw-loop"
  | "cartography"
  | "refactor"
  | "start-work"
  | "stop-continuation"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
