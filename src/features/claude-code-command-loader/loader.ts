import { promises as fs, type Dirent } from "fs"
import { join, basename } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField, getCommandSource } from "../../shared/model-sanitizer"
import { isMarkdownFile } from "../../shared/file-utils"
import { log } from "../../shared/logger"
import { wrapCommandTemplate } from "../../shared/template-wrapper"
import { formatScopedDescription } from "../../shared/description-formatter"
import { toDefinitionRecord } from "../../shared/collection-utils"
import { getCommandDirectories } from "../../shared/paths"
import type { CommandScope, CommandDefinition, CommandFrontmatter, LoadedCommand } from "./types"

async function loadCommandsFromDir(
  commandsDir: string,
  scope: CommandScope,
  visited: Set<string> = new Set(),
  prefix: string = ""
): Promise<LoadedCommand[]> {
  try {
    await fs.access(commandsDir)
  } catch {
    return []
  }

  let realPath: string
  try {
    realPath = await fs.realpath(commandsDir)
  } catch (error) {
    log(`Failed to resolve command directory: ${commandsDir}`, error)
    return []
  }

  if (visited.has(realPath)) {
    return []
  }
  visited.add(realPath)

  let entries: Dirent[]
  try {
    entries = await fs.readdir(commandsDir, { withFileTypes: true })
  } catch (error) {
    log(`Failed to read command directory: ${commandsDir}`, error)
    return []
  }

  const commands: LoadedCommand[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue
      const subDirPath = join(commandsDir, entry.name)
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name
      const subCommands = await loadCommandsFromDir(subDirPath, scope, visited, subPrefix)
      commands.push(...subCommands)
      continue
    }

    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const baseCommandName = basename(entry.name, ".md")
    const commandName = prefix ? `${prefix}:${baseCommandName}` : baseCommandName

    try {
      const content = await fs.readFile(commandPath, "utf-8")
      const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

      const wrappedTemplate = wrapCommandTemplate(body)
      const formattedDescription = formatScopedDescription(scope, data.description)

      const definition: CommandDefinition = {
        name: commandName,
        description: formattedDescription,
        template: wrappedTemplate,
        agent: data.agent,
        model: sanitizeModelField(data.model, getCommandSource(scope)),
        subtask: data.subtask,
        argumentHint: data["argument-hint"],
        handoffs: data.handoffs,
      }

      commands.push({
        name: commandName,
        path: commandPath,
        definition,
        scope,
      })
    } catch (error) {
      log(`Failed to parse command: ${commandPath}`, error)
      continue
    }
  }

  return commands
}

export async function loadUserCommands(): Promise<Record<string, CommandDefinition>> {
  const dirs = getCommandDirectories()
  const commands = await loadCommandsFromDir(dirs.user, "user")
  return toDefinitionRecord(commands)
}

export async function loadProjectCommands(): Promise<Record<string, CommandDefinition>> {
  const dirs = getCommandDirectories()
  const commands = await loadCommandsFromDir(dirs.project, "project")
  return toDefinitionRecord(commands)
}

export async function loadOpencodeGlobalCommands(): Promise<Record<string, CommandDefinition>> {
  const dirs = getCommandDirectories()
  const commands = await loadCommandsFromDir(dirs.opencodeGlobal, "opencode")
  return toDefinitionRecord(commands)
}

export async function loadOpencodeProjectCommands(): Promise<Record<string, CommandDefinition>> {
  const dirs = getCommandDirectories()
  const commands = await loadCommandsFromDir(dirs.opencodeProject, "opencode-project")
  return toDefinitionRecord(commands)
}

export async function loadAllCommands(): Promise<Record<string, CommandDefinition>> {
  const [user, project, global, projectOpencode] = await Promise.all([
    loadUserCommands(),
    loadProjectCommands(),
    loadOpencodeGlobalCommands(),
    loadOpencodeProjectCommands(),
  ])
  return { ...projectOpencode, ...global, ...project, ...user }
}
