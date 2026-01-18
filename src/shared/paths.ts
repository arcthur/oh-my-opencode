import { join } from "path"
import { homedir } from "os"
import { getClaudeConfigDir } from "./claude-config-dir"

export interface CommandDirectories {
  user: string
  project: string
  opencodeGlobal: string
  opencodeProject: string
}

/**
 * Returns the standard directories for command discovery.
 */
export function getCommandDirectories(): CommandDirectories {
  return {
    user: join(getClaudeConfigDir(), "commands"),
    project: join(process.cwd(), ".claude", "commands"),
    opencodeGlobal: join(homedir(), ".config", "opencode", "command"),
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
 */
export function getSkillDirectories(): SkillDirectories {
  return {
    user: join(getClaudeConfigDir(), "skills"),
    project: join(process.cwd(), ".claude", "skills"),
    opencodeGlobal: join(homedir(), ".config", "opencode", "skill"),
    opencodeProject: join(process.cwd(), ".opencode", "skill"),
  }
}
