import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename } from "path"
import { parseFrontmatter } from "./frontmatter"
import { sanitizeModelField, getCommandSource } from "./model-sanitizer"
import { isMarkdownFile } from "./file-utils"
import type { CommandFrontmatter } from "../features/claude-code-command-loader/types"
import type { LoadedSkill, LazyContentLoader } from "../features/opencode-skill-loader/types"

export interface DiscoveredCommandMetadata {
  name: string
  description: string
  argumentHint?: string
  model?: string
  agent?: string
  subtask?: boolean
}

export interface DiscoveredCommand<S extends string = string> {
  name: string
  path?: string
  metadata: DiscoveredCommandMetadata
  content: string
  scope: S
}

/**
 * Discovers commands from a directory by reading markdown files with frontmatter.
 * Returns an array of discovered commands with their metadata and content.
 */
export function discoverCommandsFromDir<S extends string>(
  commandsDir: string,
  scope: S
): DiscoveredCommand<S>[] {
  if (!existsSync(commandsDir)) {
    return []
  }

  const entries = readdirSync(commandsDir, { withFileTypes: true })
  const commands: DiscoveredCommand<S>[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const commandPath = join(commandsDir, entry.name)
    const commandName = basename(entry.name, ".md")

    try {
      const content = readFileSync(commandPath, "utf-8")
      const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

      const metadata: DiscoveredCommandMetadata = {
        name: commandName,
        description: data.description || "",
        argumentHint: data["argument-hint"],
        model: sanitizeModelField(data.model, getCommandSource(scope)),
        agent: data.agent,
        subtask: Boolean(data.subtask),
      }

      commands.push({
        name: commandName,
        path: commandPath,
        metadata,
        content: body,
        scope,
      })
    } catch {
      continue
    }
  }

  return commands
}

export interface DiscoveredCommandWithLoader<S extends string = string> extends DiscoveredCommand<S> {
  lazyContentLoader?: LazyContentLoader
}

/**
 * Converts a LoadedSkill to a command-like structure.
 * @param skill The loaded skill
 * @param scopeOverride Optional scope override (defaults to skill.scope)
 */
export function skillToCommandInfo<S extends string = string>(
  skill: LoadedSkill,
  scopeOverride?: S
): DiscoveredCommandWithLoader<S> {
  return {
    name: skill.name,
    path: skill.path,
    metadata: {
      name: skill.name,
      description: skill.definition.description || "",
      argumentHint: skill.definition.argumentHint,
      model: skill.definition.model,
      agent: skill.definition.agent,
      subtask: skill.definition.subtask,
    },
    content: skill.definition.template,
    scope: (scopeOverride ?? skill.scope) as S,
    lazyContentLoader: skill.lazyContent,
  }
}
