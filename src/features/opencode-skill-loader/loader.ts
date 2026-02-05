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
  scope: SkillScope,
  namePrefix: string = ""
): Promise<LoadedSkill | null> {
  try {
    const content = await fs.readFile(skillPath, "utf-8")
    const result = await buildSkillFromContent({
      content,
      skillPath,
      resolvedPath,
      defaultName,
      scope,
      namePrefix,
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

async function loadSkillsFromDir(
  skillsDir: string,
  scope: SkillScope,
  namePrefix: string = "",
  depth: number = 0,
  maxDepth: number = 2
): Promise<LoadedSkill[]> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
  const skillMap = new Map<string, LoadedSkill>()

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
        const skill = await loadSkillFromPath(skillMdPath, resolvedPath, dirName, scope, namePrefix)
        if (skill && !skillMap.has(skill.name)) {
          skillMap.set(skill.name, skill)
        }
        continue
      } catch {
        // SKILL.md not found, try named convention below
      }

      // Fallback: try {dirName}.md (e.g., my-skill/my-skill.md)
      const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
      try {
        await fs.access(namedSkillMdPath)
        const skill = await loadSkillFromPath(namedSkillMdPath, resolvedPath, dirName, scope, namePrefix)
        if (skill && !skillMap.has(skill.name)) {
          skillMap.set(skill.name, skill)
        }
        continue
      } catch {
        // Neither convention found, skip this directory
      }

      if (depth < maxDepth) {
        const newPrefix = namePrefix ? `${namePrefix}/${dirName}` : dirName
        const nestedSkills = await loadSkillsFromDir(
          resolvedPath,
          scope,
          newPrefix,
          depth + 1,
          maxDepth
        )
        for (const nestedSkill of nestedSkills) {
          if (!skillMap.has(nestedSkill.name)) {
            skillMap.set(nestedSkill.name, nestedSkill)
          }
        }
      }

      continue
    }

    if (isMarkdownFile(entry)) {
      const skillName = basename(entry.name, ".md")
      const skill = await loadSkillFromPath(entryPath, skillsDir, skillName, scope, namePrefix)
      if (skill && !skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill)
      }
    }
  }

  return Array.from(skillMap.values())
}

/**
 * Deduplicates skills by name, keeping the first occurrence (higher priority).
 * Priority order: opencode-project > opencode > project > user
 * (OpenCode Global skills take precedence over legacy Claude project skills)
 */
function deduplicateSkills(skills: LoadedSkill[]): LoadedSkill[] {
  const seen = new Set<string>()
  const result: LoadedSkill[] = []
  for (const skill of skills) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name)
      result.push(skill)
    }
  }
  return result
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
  const [opencodeProjectSkills, opencodeGlobalSkills, projectSkills, userSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverOpencodeGlobalSkills(),
    discoverProjectClaudeSkills(),
    discoverUserClaudeSkills(),
  ])

  // Priority: opencode-project > opencode > project > user
  return deduplicateSkills([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...projectSkills,
    ...userSkills,
  ])
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<LoadedSkill[]> {
  const { includeClaudeCodePaths = true } = options

  const [opencodeProjectSkills, opencodeGlobalSkills] = await Promise.all([
    discoverOpencodeProjectSkills(),
    discoverOpencodeGlobalSkills(),
  ])

  if (!includeClaudeCodePaths) {
    // Priority: opencode-project > opencode
    return deduplicateSkills([...opencodeProjectSkills, ...opencodeGlobalSkills])
  }

  const [projectSkills, userSkills] = await Promise.all([
    discoverProjectClaudeSkills(),
    discoverUserClaudeSkills(),
  ])

  // Priority: opencode-project > opencode > project > user
  return deduplicateSkills([
    ...opencodeProjectSkills,
    ...opencodeGlobalSkills,
    ...projectSkills,
    ...userSkills,
  ])
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
