import { parseFrontmatter } from "../../shared/frontmatter"
import { sanitizeModelField, getCommandSource } from "../../shared/model-sanitizer"
import { wrapSkillTemplate } from "../../shared/template-wrapper"
import { formatScopedDescription } from "../../shared/description-formatter"
import { parseAllowedTools } from "../../shared/tools-parser"
import { parseSkillMcpConfigFromFrontmatter, loadMcpJsonFromDir } from "./mcp-parser"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, SkillMetadata, LoadedSkill } from "./types"

export interface BuildSkillParams {
  content: string
  skillPath: string
  resolvedPath: string
  defaultName: string
  scope: SkillScope
  /** If true, returns null when frontmatter parsing fails. Default: false */
  strictParsing?: boolean
}

export interface BuildSkillResult {
  skill: LoadedSkill
  templateContent: string
}

/**
 * Builds a LoadedSkill from raw file content.
 * Returns null if frontmatter parsing fails.
 */
export async function buildSkillFromContent(
  params: BuildSkillParams
): Promise<BuildSkillResult | null> {
  const { content, skillPath, resolvedPath, defaultName, scope, strictParsing = false } = params

  const { data, body, parseError } = parseFrontmatter<SkillMetadata>(content)
  if (strictParsing && parseError) return null

  const frontmatterMcp = parseSkillMcpConfigFromFrontmatter(content)
  const mcpJsonMcp = await loadMcpJsonFromDir(resolvedPath)
  const mcpConfig = mcpJsonMcp || frontmatterMcp

  const skillName = data.name || defaultName
  const formattedDescription = formatScopedDescription(`${scope} - Skill`, data.description)
  const templateContent = wrapSkillTemplate(body, resolvedPath)

  const definition: CommandDefinition = {
    name: skillName,
    description: formattedDescription,
    template: templateContent,
    model: sanitizeModelField(data.model, getCommandSource(scope)),
    agent: data.agent,
    subtask: data.subtask,
    argumentHint: data["argument-hint"],
  }

  const skill: LoadedSkill = {
    name: skillName,
    path: skillPath,
    resolvedPath,
    definition,
    scope,
    license: data.license,
    compatibility: data.compatibility,
    metadata: data.metadata,
    allowedTools: parseAllowedTools(data["allowed-tools"]),
    mcpConfig,
  }

  return { skill, templateContent }
}
