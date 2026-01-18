import { promises as fs } from "fs"
import { join, basename } from "path"
import { resolveSymlinkAsync, isMarkdownFile } from "../../shared/file-utils"
import { toDefinitionRecord } from "../../shared/collection-utils"
import { getSkillDirectories } from "../../shared/paths"
import { buildSkillFromContent } from "./skill-builder"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { SkillScope, LoadedSkill, LazyContentLoader } from "./types"

async function loadSkillFromPath(
  skillPath: string,
  resolvedPath: string,
  defaultName: string,
  scope: SkillScope
): Promise<LoadedSkill | null> {
  try {
    const content = await fs.readFile(skillPath, "utf-8")
    const result = await buildSkillFromContent({
      content,
      skillPath,
      resolvedPath,
      defaultName,
      scope,
    })

    if (!result) return null

    // RATIONALE: We read the file eagerly to ensure atomic consistency between
    // metadata and body. We maintain the LazyContentLoader interface for
    // compatibility, but the state is effectively eager.
    const eagerLoader: LazyContentLoader = {
      loaded: true,
      content: result.templateContent,
      load: async () => result.templateContent,
    }

    return {
      ...result.skill,
      lazyContent: eagerLoader,
    }
  } catch {
    return null
  }
}

async function loadSkillsFromDir(skillsDir: string, scope: SkillScope): Promise<LoadedSkill[]> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue

    const entryPath = join(skillsDir, entry.name)

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const resolvedPath = await resolveSymlinkAsync(entryPath)
      const dirName = entry.name

      // Try SKILL.md first (canonical convention)
      const skillMdPath = join(resolvedPath, "SKILL.md")
      try {
        await fs.access(skillMdPath)
        const skill = await loadSkillFromPath(skillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
        // SKILL.md not found, try named convention below
      }

      // Fallback: try {dirName}.md (e.g., my-skill/my-skill.md)
      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
      try {
        await fs.access(namedSkillMdPath)
        const skill = await loadSkillFromPath(namedSkillMdPath, resolvedPath, dirName, scope)
        if (skill) skills.push(skill)
        continue
      } catch {
        // Neither convention found, skip this directory
      }

      continue
    }

    if (isMarkdownFile(entry)) {
      const skillName = basename(entry.name, ".md")
      const skill = await loadSkillFromPath(entryPath, skillsDir, skillName, scope)
      if (skill) skills.push(skill)
    }
  }

  return skills
}

export async function loadUserSkills(): Promise<Record<string, CommandDefinition>> {
  const dirs = getSkillDirectories()
  const skills = await loadSkillsFromDir(dirs.user, "user")
  return toDefinitionRecord(skills)
}

export async function loadProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const dirs = getSkillDirectories()
  const skills = await loadSkillsFromDir(dirs.project, "project")
  return toDefinitionRecord(skills)
}

export async function loadOpencodeGlobalSkills(): Promise<Record<string, CommandDefinition>> {
  const dirs = getSkillDirectories()
  const skills = await loadSkillsFromDir(dirs.opencodeGlobal, "opencode")
  return toDefinitionRecord(skills)
}

export async function loadOpencodeProjectSkills(): Promise<Record<string, CommandDefinition>> {
  const dirs = getSkillDirectories()
  const skills = await loadSkillsFromDir(dirs.opencodeProject, "opencode-project")
  return toDefinitionRecord(skills)
}

export interface DiscoverSkillsOptions {
  includeClaudeCodePaths?: boolean
}

export async function discoverAllSkills(): Promise<LoadedSkill[]> {
  const [opencodeProjectSkills, projectSkills, opencodeGlobalSkills, userSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverProjectClaudeSkills(),
    discoverOpencodeGlobalSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true } = options

  const [opencodeProjectSkills, opencodeGlobalSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverOpencodeGlobalSkills(),
  ])

  if (!includeClaudeCodePaths) {
    return [...opencodeProjectSkills, ...opencodeGlobalSkills]
  }

  const [projectSkills, userSkills] = await Promise.all([
    discoverProjectClaudeSkills(),
    discoverUserClaudeSkills(),
  ])

  return [...opencodeProjectSkills, ...projectSkills, ...opencodeGlobalSkills, ...userSkills]
}

export async function getSkillByName(name: string, options: DiscoverSkillsOptions = {}): Promise<LoadedSkill | undefined> {
  const skills = await discoverSkills(options)
  return skills.find(s => s.name === name)
}

export async function discoverUserClaudeSkills(): Promise<LoadedSkill[]> {
  const dirs = getSkillDirectories()
  return loadSkillsFromDir(dirs.user, "user")
}

export async function discoverProjectClaudeSkills(): Promise<LoadedSkill[]> {
  const dirs = getSkillDirectories()
  return loadSkillsFromDir(dirs.project, "project")
}

export async function discoverOpencodeGlobalSkills(): Promise<LoadedSkill[]> {
  const dirs = getSkillDirectories()
  return loadSkillsFromDir(dirs.opencodeGlobal, "opencode")
}

export async function discoverOpencodeProjectSkills(): Promise<LoadedSkill[]> {
  const dirs = getSkillDirectories()
  return loadSkillsFromDir(dirs.opencodeProject, "opencode-project")
}
