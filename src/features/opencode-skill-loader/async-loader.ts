import { readFile, readdir } from "fs/promises"
import type { Dirent } from "fs"
import { join, basename } from "path"
import { resolveSymlink, isMarkdownFile } from "../../shared/file-utils"
import { buildSkillFromContent } from "./skill-builder"
import type { SkillScope, LoadedSkill } from "./types"

// Re-export for backward compatibility with tests
export { loadMcpJsonFromDir as loadMcpJsonFromDirAsync } from "./mcp-parser"

export async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0

  const worker = async () => {
    while (index < items.length) {
      const currentIndex = index++
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)

  return results
}

export async function loadSkillFromPathAsync(
  skillPath: string,
  resolvedPath: string,
  defaultName: string,
  scope: SkillScope
): Promise<LoadedSkill | null> {
  try {
    const content = await readFile(skillPath, "utf-8")
    const result = await buildSkillFromContent({
      content,
      skillPath,
      resolvedPath,
      defaultName,
      scope,
      strictParsing: true,
    })

    return result?.skill ?? null
  } catch {
    return null
  }
}

export async function discoverSkillsInDirAsync(skillsDir: string): Promise<LoadedSkill[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    
    const processEntry = async (entry: Dirent): Promise<LoadedSkill | null> => {
      if (entry.name.startsWith(".")) return null

      const entryPath = join(skillsDir, entry.name)

      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const resolvedPath = resolveSymlink(entryPath)
        const dirName = entry.name

        const skillMdPath = join(resolvedPath, "SKILL.md")
        try {
          await readFile(skillMdPath, "utf-8")
          return await loadSkillFromPathAsync(skillMdPath, resolvedPath, dirName, "opencode-project")
        } catch {
          const namedSkillMdPath = join(resolvedPath, `${dirName}.md`)
          try {
            await readFile(namedSkillMdPath, "utf-8")
            return await loadSkillFromPathAsync(namedSkillMdPath, resolvedPath, dirName, "opencode-project")
          } catch {
            return null
          }
        }
      }

      if (isMarkdownFile(entry)) {
        const skillName = basename(entry.name, ".md")
        return await loadSkillFromPathAsync(entryPath, skillsDir, skillName, "opencode-project")
      }

      return null
    }

    const skillPromises = await mapWithConcurrency(entries, processEntry, 16)
    return skillPromises.filter((skill): skill is LoadedSkill => skill !== null)
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return []
    }
    return []
  }
}
