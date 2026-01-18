import { readFile } from "fs/promises"
import { join } from "path"
import yaml from "js-yaml"
import type { SkillMcpConfig } from "../skill-mcp-manager/types"

/**
 * Parses MCP configuration from skill frontmatter.
 * Looks for 'mcp' field in YAML frontmatter.
 *
 * @param content - The full skill file content including frontmatter
 * @returns SkillMcpConfig if found, undefined otherwise
 */
export function parseSkillMcpConfigFromFrontmatter(content: string): SkillMcpConfig | undefined {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) return undefined

  try {
    const parsed = yaml.load(frontmatterMatch[1], { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
    if (parsed && typeof parsed === "object" && "mcp" in parsed && parsed.mcp) {
      return parsed.mcp as SkillMcpConfig
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Loads MCP configuration from mcp.json file in skill directory.
 * Supports two formats:
 * 1. { mcpServers: { ... } } - wrapped format
 * 2. { serverName: { command: ... } } - direct format
 *
 * @param skillDir - Directory containing the skill
 * @returns SkillMcpConfig if found and valid, undefined otherwise
 */
export async function loadMcpJsonFromDir(skillDir: string): Promise<SkillMcpConfig | undefined> {
  const mcpJsonPath = join(skillDir, "mcp.json")

  try {
    const content = await readFile(mcpJsonPath, "utf-8")
    const parsed = JSON.parse(content) as Record<string, unknown>

    if (parsed && typeof parsed === "object" && "mcpServers" in parsed && parsed.mcpServers) {
      return parsed.mcpServers as SkillMcpConfig
    }

    if (parsed && typeof parsed === "object" && !("mcpServers" in parsed)) {
      const hasCommandField = Object.values(parsed).some(
        (v) => v && typeof v === "object" && "command" in (v as Record<string, unknown>)
      )
      if (hasCommandField) {
        return parsed as SkillMcpConfig
      }
    }
  } catch {
    return undefined
  }
  return undefined
}
