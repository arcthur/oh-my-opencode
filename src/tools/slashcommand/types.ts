import type { LoadedSkill } from "../../features/opencode-skill-loader"
import type { BuiltinCommandName } from "../../features/builtin-commands/types"
import type {
  SlashCommandInfo,
  SlashCommandScope,
} from "../../shared/slash-command-catalog"

export type CommandScope = SlashCommandScope
export type CommandMetadata = SlashCommandInfo["metadata"]
export type CommandInfo = SlashCommandInfo

export type SlashCommandCatalogItem = SlashCommandInfo

export interface SlashcommandToolOptions {
  /** Pre-loaded commands (skip discovery if provided) */
  commands?: CommandInfo[]
  /** Optional disabled built-in command list when commands are discovered lazily */
  disabledBuiltinCommands?: BuiltinCommandName[]
  /** @deprecated Skills are intentionally excluded from slashcommand semantics */
  skills?: LoadedSkill[]
}
