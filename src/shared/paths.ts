import { join } from "path"
import { getClaudeConfigDir } from "./claude-config-dir"
import { getOpenCodeConfigDir } from "./opencode-config-dir"

export interface CommandDirectories {
  user: string
  project: string
  opencodeGlobal: string
  opencodeProject: string
}

/**
 * Returns the standard directories for command discovery.
 * Uses getOpenCodeConfigDir() to respect OPENCODE_CONFIG_DIR env var.
 */
export function getCommandDirectories(): CommandDirectories {
  const opencodeConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  return {
    user: join(getClaudeConfigDir(), "commands"),
    project: join(process.cwd(), ".claude", "commands"),
    opencodeGlobal: join(opencodeConfigDir, "command"),
    opencodeProject: join(process.cwd(), ".opencode", "command"),
  }
}

export interface SkillDirectories {
  user: string
  project: string
  opencodeGlobal: string
  opencodeProject: string
}

/**
 * Returns the standard directories for skill discovery.
 * Uses getOpenCodeConfigDir() to respect OPENCODE_CONFIG_DIR env var.
 */
export function getSkillDirectories(): SkillDirectories {
  const opencodeConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  return {
    user: join(getClaudeConfigDir(), "skills"),
    project: join(process.cwd(), ".claude", "skills"),
    opencodeGlobal: join(opencodeConfigDir, "skills"),
    opencodeProject: join(process.cwd(), ".opencode", "skills"),
  }
}
