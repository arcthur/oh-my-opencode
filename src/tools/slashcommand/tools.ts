import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { dirname } from "path"
import { log, resolveCommandsInText, resolveFileReferencesInText } from "../../shared"
import type { BuiltinCommandName } from "../../features/builtin-commands/types"
import { discoverSlashCommandsSync } from "../../shared/slash-command-catalog"
import type { CommandInfo, SlashcommandToolOptions } from "./types"

export function discoverCommandsSync(disabledBuiltinCommands?: BuiltinCommandName[]): CommandInfo[] {
  return discoverSlashCommandsSync(disabledBuiltinCommands)
}

async function formatLoadedCommand(cmd: CommandInfo, userMessage?: string): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${cmd.name} Command\n`)

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`)
  }

  if (cmd.metadata.argumentHint) {
    sections.push(`**Usage**: /${cmd.name} ${cmd.metadata.argumentHint}\n`)
  }

  if (userMessage) {
    sections.push(`**Arguments**: ${userMessage}\n`)
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`)
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`)
  }

  if (cmd.metadata.subtask) {
    sections.push(`**Subtask**: true\n`)
  }

  sections.push(`**Scope**: ${cmd.scope}\n`)
  sections.push("---\n")
  sections.push("## Command Instructions\n")

  let content = cmd.content || ""
  if (!content && cmd.lazyContentLoader) {
    content = await cmd.lazyContentLoader.load()
  }

  const commandDir = cmd.path ? dirname(cmd.path) : process.cwd()
  const withFileRefs = await resolveFileReferencesInText(content, commandDir)
  const resolvedContent = await resolveCommandsInText(withFileRefs)

  // Substitute user_message into content if provided
  let finalContent = resolvedContent.trim()
  if (userMessage) {
    finalContent = finalContent.replace(/\$\{user_message\}/g, userMessage)
  }

  sections.push(finalContent)

  return sections.join("\n")
}

function formatCommandList(items: CommandInfo[]): string {
  if (items.length === 0) {
    return "No commands found."
  }

  const lines = ["# Available Commands\n"]

  for (const cmd of items) {
    const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
    lines.push(
      `- **/${cmd.name}${hint}**: ${cmd.metadata.description || "(no description)"} (${cmd.scope})`
    )
  }

  lines.push(`\n**Total**: ${items.length} commands`)
  return lines.join("\n")
}

const TOOL_DESCRIPTION_PREFIX = `Load or execute a slash command to get detailed instructions for a specific task.

Slash commands provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available command's description.

**How to use:**
- Call with command name only: command='publish'
- Call with command and arguments: command='publish' user_message='patch'
- The tool will return detailed instructions for the command with your arguments substituted.
`

function buildDescriptionFromItems(items: CommandInfo[]): string {
  const commandListForDescription = items
    .map((cmd) => {
      const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
      return `- /${cmd.name}${hint}: ${cmd.metadata.description} (${cmd.scope})`
    })
    .join("\n")

  return `${TOOL_DESCRIPTION_PREFIX}
<available_commands>
${commandListForDescription}
</available_commands>`
}

export function createSlashcommandTool(options: SlashcommandToolOptions = {}): ToolDefinition {
  let cachedCommands: CommandInfo[] | null = options.commands ?? null
  let cachedDescription: string | null = null

  if (options.skills && options.skills.length > 0) {
    log(
      "[slashcommand] deprecated options.skills provided and ignored; use the `skill` tool for skill execution"
    )
  }

  if (options.commands) {
    cachedDescription = buildDescriptionFromItems(options.commands)
  }

  const getCommands = (): CommandInfo[] => {
    if (cachedCommands) return cachedCommands
    cachedCommands = discoverCommandsSync(options.disabledBuiltinCommands)
    return cachedCommands
  }

  const buildDescription = (): string => {
    if (cachedDescription) return cachedDescription
    const commands = getCommands()
    cachedDescription = buildDescriptionFromItems(commands)
    return cachedDescription
  }

  // Pre-warm the cache immediately
  buildDescription()

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },

    args: {
      command: tool.schema
        .string()
        .describe(
          "The slash command name (without leading slash). E.g., 'publish', 'commit', 'plan'"
        ),
      user_message: tool.schema
        .string()
        .optional()
        .describe(
          "Optional arguments or context to pass to the command. E.g., for '/publish patch', command='publish' user_message='patch'"
        ),
    },

    async execute(args) {
      const commands = getCommands()

      if (!args.command) {
        return formatCommandList(commands) + "\n\nProvide a command name to execute."
      }

      const cmdName = args.command.replace(/^\//, "")

      const exactMatch = commands.find(
        (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase()
      )

      if (exactMatch) {
        return await formatLoadedCommand(exactMatch, args.user_message)
      }

      const partialMatches = commands.filter((cmd) =>
        cmd.name.toLowerCase().includes(cmdName.toLowerCase())
      )

      if (partialMatches.length > 0) {
        const matchList = partialMatches.map((cmd) => `/${cmd.name}`).join(", ")
        return (
          `No exact match for "/${cmdName}". Did you mean: ${matchList}?\n\n` +
          formatCommandList(commands)
        )
      }

      return (
        cmdName.includes(":")
          ? `Marketplace plugin commands like "/${cmdName}" are not supported. Use .claude/commands/ for custom commands.\n\n${formatCommandList(commands)}`
          : `Command "/${cmdName}" not found.\n\n${formatCommandList(commands)}\n\nTry a different name.`
      )
    },
  })
}

// Default instance for backward compatibility (lazy loading)
export const slashcommand: ToolDefinition = createSlashcommandTool()
