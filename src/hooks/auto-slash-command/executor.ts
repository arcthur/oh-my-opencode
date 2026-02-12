import { dirname } from "path"
import {
  resolveCommandsInText,
  resolveFileReferencesInText,
} from "../../shared"
import { discoverSlashCommandsSync } from "../../shared/slash-command-catalog"
import type { ParsedSlashCommand } from "./types"
import type { BuiltinCommandName } from "../../features/builtin-commands/types"
import type { CommandInfo } from "../../tools/slashcommand/types"

export interface ExecutorOptions {
  disabledBuiltinCommands?: BuiltinCommandName[]
}

async function discoverAllCommands(options?: ExecutorOptions): Promise<CommandInfo[]> {
  return discoverSlashCommandsSync(options?.disabledBuiltinCommands)
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
      error: parsed.command.includes(":")
        ? `Marketplace plugin commands like "/${parsed.command}" are not supported. Use .claude/commands/ for custom commands.`
        : `Command "/${parsed.command}" not found. Use the slashcommand tool to list available commands.`,
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
