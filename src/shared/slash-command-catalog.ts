import { loadBuiltinCommands } from "../features/builtin-commands"
import type { BuiltinCommandName } from "../features/builtin-commands/types"
import {
  discoverCommandsFromDir,
  type DiscoveredCommandWithLoader,
} from "./command-discovery"
import { getCommandDirectories } from "./paths"

export type SlashCommandScope =
  | "builtin"
  | "config"
  | "user"
  | "project"
  | "opencode"
  | "opencode-project"

export type SlashCommandInfo = DiscoveredCommandWithLoader<SlashCommandScope>

export function discoverSlashCommandsSync(
  disabledBuiltinCommands?: BuiltinCommandName[]
): SlashCommandInfo[] {
  const dirs = getCommandDirectories()

  const userCommands = discoverCommandsFromDir<SlashCommandScope>(dirs.user, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir<SlashCommandScope>(
    dirs.opencodeGlobal,
    "opencode"
  )
  const projectCommands = discoverCommandsFromDir<SlashCommandScope>(dirs.project, "project")
  const opencodeProjectCommands = discoverCommandsFromDir<SlashCommandScope>(
    dirs.opencodeProject,
    "opencode-project"
  )

  const builtinCommandsMap = loadBuiltinCommands(disabledBuiltinCommands)
  const builtinCommands: SlashCommandInfo[] = Object.values(builtinCommandsMap).map((cmd) => ({
    name: cmd.name,
    metadata: {
      name: cmd.name,
      description: cmd.description || "",
      argumentHint: cmd.argumentHint,
      model: cmd.model,
      agent: cmd.agent,
      subtask: cmd.subtask,
    },
    content: cmd.template,
    scope: "builtin",
  }))

  return [
    ...builtinCommands,
    ...opencodeProjectCommands,
    ...projectCommands,
    ...opencodeGlobalCommands,
    ...userCommands,
  ]
}
