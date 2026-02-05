import { dirname } from "path"
import {
  resolveCommandsInText,
  resolveFileReferencesInText,
} from "../../shared"
import { discoverCommandsFromDir, skillToCommandInfo, type DiscoveredCommandWithLoader } from "../../shared/command-discovery"
import { getCommandDirectories } from "../../shared/paths"
import { discoverAllSkills, type LoadedSkill } from "../../features/opencode-skill-loader"
import { loadBuiltinCommands } from "../../features/builtin-commands"
import type { ParsedSlashCommand } from "./types"

type CommandScope = "user" | "project" | "opencode" | "opencode-project" | "skill" | "builtin"
type CommandInfo = DiscoveredCommandWithLoader<CommandScope>

export interface ExecutorOptions {
  skills?: LoadedSkill[]
}

async function discoverAllCommands(options?: ExecutorOptions): Promise<CommandInfo[]> {
  const dirs = getCommandDirectories()

  const builtinCommands = Object.values(loadBuiltinCommands()).map((cmd) => ({
    name: cmd.name,
    metadata: {
      name: cmd.name,
      description: cmd.description ?? "",
      model: cmd.model,
      agent: cmd.agent,
      subtask: Boolean(cmd.subtask),
    },
    content: cmd.template,
    scope: "builtin" as const,
  }))

  const userCommands = discoverCommandsFromDir(dirs.user, "user")
  const opencodeGlobalCommands = discoverCommandsFromDir(dirs.opencodeGlobal, "opencode")
  const projectCommands = discoverCommandsFromDir(dirs.project, "project")
  const opencodeProjectCommands = discoverCommandsFromDir(dirs.opencodeProject, "opencode-project")

  const skills = options?.skills ?? await discoverAllSkills()
  const skillCommands = skills.map(s => skillToCommandInfo(s, "skill" as const))

  return [
    ...builtinCommands,
    ...opencodeProjectCommands,
    ...projectCommands,
    ...opencodeGlobalCommands,
    ...userCommands,
    ...skillCommands,
  ]
}

async function findCommand(commandName: string, options?: ExecutorOptions): Promise<CommandInfo | null> {
  const allCommands = await discoverAllCommands(options)
  return allCommands.find(
    (cmd) => cmd.name.toLowerCase() === commandName.toLowerCase()
  ) ?? null
}

async function formatCommandTemplate(cmd: CommandInfo, args: string): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${cmd.name} Command\n`)

  if (cmd.metadata.description) {
    sections.push(`**Description**: ${cmd.metadata.description}\n`)
  }

  if (args) {
    sections.push(`**User Arguments**: ${args}\n`)
  }

  if (cmd.metadata.model) {
    sections.push(`**Model**: ${cmd.metadata.model}\n`)
  }

  if (cmd.metadata.agent) {
    sections.push(`**Agent**: ${cmd.metadata.agent}\n`)
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
  sections.push(resolvedContent.trim())

  if (args) {
    sections.push("\n\n---\n")
    sections.push("## User Request\n")
    sections.push(args)
  }

  return sections.join("\n")
}

export interface ExecuteResult {
  success: boolean
  replacementText?: string
  error?: string
}

export async function executeSlashCommand(parsed: ParsedSlashCommand, options?: ExecutorOptions): Promise<ExecuteResult> {
  const command = await findCommand(parsed.command, options)

  if (!command) {
    return {
      success: false,
      error: `Command "/${parsed.command}" not found. Use the slashcommand tool to list available commands.`,
    }
  }

  try {
    const template = await formatCommandTemplate(command, parsed.args)
    return {
      success: true,
      replacementText: template,
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to load command "/${parsed.command}": ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
