import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename } from "path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../../shared/frontmatter"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { parseToolsConfig } from "../../shared/tools-parser"
import { formatScopedDescription } from "../../shared/description-formatter"
import { toRecord } from "../../shared/collection-utils"
import type { AgentScope, AgentFrontmatter, LoadedAgent } from "./types"

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  const agents: LoadedAgent[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    const agentName = basename(entry.name, ".md")

    try {
      const content = readFileSync(agentPath, "utf-8")
      const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

      const name = data.name || agentName
      const formattedDescription = formatScopedDescription(scope, data.description)

      const config: AgentConfig = {
        description: formattedDescription,
        mode: "subagent",
        prompt: body.trim(),
      }

      const toolsConfig = parseToolsConfig(data.tools)
      if (toolsConfig) {
        config.tools = toolsConfig
      }

      agents.push({
        name,
        path: agentPath,
        config,
        scope,
      })
    } catch {
      continue
    }
  }

  return agents
}

export function loadUserAgents(): Record<string, AgentConfig> {
  const userAgentsDir = join(getClaudeConfigDir(), "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user")
  return toRecord(agents, (a) => a.name, (a) => a.config)
}

export function loadProjectAgents(): Record<string, AgentConfig> {
  const projectAgentsDir = join(process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")
  return toRecord(agents, (a) => a.name, (a) => a.config)
}
