import { join } from "path"
import { homedir } from "os"
import { getClaudeConfigDir } from "./claude-config-dir"
import { getOpenCodeConfigDir } from "./opencode-config-dir"

export interface CommandDirectories {
  user: string
  project: string
  opencodeGlobal: string
  opencodeProject: string
}

export interface DirectoryContext {
  cwd?: string
  homeDir?: string
  claudeConfigDir?: string
  opencodeConfigDir?: string
}

function resolveDirectoryContext(context: DirectoryContext = {}): Required<DirectoryContext> {
  return {
    cwd: context.cwd ?? process.cwd(),
    homeDir: context.homeDir ?? homedir(),
    claudeConfigDir: context.claudeConfigDir ?? getClaudeConfigDir(),
    opencodeConfigDir: context.opencodeConfigDir ?? getOpenCodeConfigDir({ binary: "opencode" }),
  }
}

/**
 * Returns the standard directories for command discovery.
 * Uses getOpenCodeConfigDir() to respect OPENCODE_CONFIG_DIR env var.
 */
export function getCommandDirectories(context: DirectoryContext = {}): CommandDirectories {
  const resolved = resolveDirectoryContext(context)
  return {
    user: join(resolved.claudeConfigDir, "commands"),
    project: join(resolved.cwd, ".claude", "commands"),
    opencodeGlobal: join(resolved.opencodeConfigDir, "command"),
    opencodeProject: join(resolved.cwd, ".opencode", "command"),
  }
}

export interface SkillDirectories {
  user: string
  project: string
  agentsUser: string
  agentsProject: string
  opencodeGlobal: string
  opencodeProject: string
}

/**
 * Returns the standard directories for skill discovery.
 * Uses getOpenCodeConfigDir() to respect OPENCODE_CONFIG_DIR env var.
 */
export function getSkillDirectories(context: DirectoryContext = {}): SkillDirectories {
  const resolved = resolveDirectoryContext(context)
  return {
    user: join(resolved.claudeConfigDir, "skills"),
    project: join(resolved.cwd, ".claude", "skills"),
    agentsUser: join(resolved.homeDir, ".agents", "skills"),
    agentsProject: join(resolved.cwd, ".agents", "skills"),
    opencodeGlobal: join(resolved.opencodeConfigDir, "skills"),
    opencodeProject: join(resolved.cwd, ".opencode", "skills"),
  }
}
