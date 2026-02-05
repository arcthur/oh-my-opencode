import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { dirname } from "path"
import { resolveCommandsInText, resolveFileReferencesInText } from "../../shared"
import { discoverCommandsFromDir, skillToCommandInfo } from "../../shared/command-discovery"
import { getCommandDirectories } from "../../shared/paths"
import { discoverAllSkills, type LoadedSkill } from "../../features/opencode-skill-loader"
import { loadBuiltinCommands } from "../../features/builtin-commands"
import type { BuiltinCommandName } from "../../features/builtin-commands/types"
import type { CommandScope, CommandInfo, SlashcommandToolOptions } from "./types"

export function discoverCommandsSync(disabledBuiltinCommands?: BuiltinCommandName[]): CommandInfo[] {
  const dirs = getCommandDirectories()

  const userCommands = discoverCommandsFromDir<CommandScope>(dirs.user, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir<CommandScope>(dirs.opencodeGlobal, "opencode")
  const projectCommands = discoverCommandsFromDir<CommandScope>(dirs.project, "project")
  const opencodeProjectCommands = discoverCommandsFromDir<CommandScope>(dirs.opencodeProject, "opencode-project")

  const builtinCommandsMap = loadBuiltinCommands(disabledBuiltinCommands)
  const builtinCommands: CommandInfo[] = Object.values(builtinCommandsMap).map((cmd) => ({
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
    return "No commands or skills found."
  }

  const lines = ["# Available Commands & Skills\n"]

  for (const cmd of items) {
    const hint = cmd.metadata.argumentHint ? ` ${cmd.metadata.argumentHint}` : ""
    lines.push(
      `- **/${cmd.name}${hint}**: ${cmd.metadata.description || "(no description)"} (${cmd.scope})`
    )
  }

  lines.push(`\n**Total**: ${items.length} items`)
  return lines.join("\n")
}

const TOOL_DESCRIPTION_PREFIX = `Load a skill or execute a command to get detailed instructions for a specific task.

Skills and commands provide specialized knowledge and step-by-step guidance.
Use this when a task matches an available skill's or command's description.

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
<available_skills>
${commandListForDescription}
</available_skills>`
}

export function createSlashcommandTool(options: SlashcommandToolOptions = {}): ToolDefinition {
  let cachedCommands: CommandInfo[] | null = options.commands ?? null
  let cachedSkills: LoadedSkill[] | null = options.skills ?? null
  let cachedDescription: string | null = null

  if (options.commands && options.skills) {
    cachedDescription = buildDescriptionFromItems([
      ...options.commands,
      ...options.skills.map((s) => skillToCommandInfo<CommandScope>(s)),
    ])
  }

  const getCommands = (): CommandInfo[] => {
    if (cachedCommands) return cachedCommands
    cachedCommands = discoverCommandsSync()
    return cachedCommands
  }

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (cachedSkills) return cachedSkills
    cachedSkills = await discoverAllSkills()
    return cachedSkills
  }

  const getAllItems = async (): Promise<CommandInfo[]> => {
    const commands = getCommands()
    const skills = await getSkills()
    return [...commands, ...skills.map(s => skillToCommandInfo<CommandScope>(s))]
  }

  const buildDescription = async (): Promise<string> => {
    if (cachedDescription) return cachedDescription
    const allItems = await getAllItems()
    cachedDescription = buildDescriptionFromItems(allItems)
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
      const allItems = await getAllItems()

      if (!args.command) {
        return formatCommandList(allItems) + "\n\nProvide a command or skill name to execute."
      }

      const cmdName = args.command.replace(/^\//, "")

      const exactMatch = allItems.find(
        (cmd) => cmd.name.toLowerCase() === cmdName.toLowerCase()
      )

      if (exactMatch) {
        return await formatLoadedCommand(exactMatch, args.user_message)
      }

      const partialMatches = allItems.filter((cmd) =>
        cmd.name.toLowerCase().includes(cmdName.toLowerCase())
      )

      if (partialMatches.length > 0) {
        const matchList = partialMatches.map((cmd) => `/${cmd.name}`).join(", ")
        return (
          `No exact match for "/${cmdName}". Did you mean: ${matchList}?\n\n` +
          formatCommandList(allItems)
        )
      }

      return (
        `Command or skill "/${cmdName}" not found.\n\n` +
        formatCommandList(allItems) +
        "\n\nTry a different name."
      )
    },
  })
}

// Default instance for backward compatibility (lazy loading)
export const slashcommand: ToolDefinition = createSlashcommandTool()
