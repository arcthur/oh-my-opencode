import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface GitFileStat {
  path: string
  added: number
  removed: number
  status: "modified" | "added" | "deleted"
}

type GitDiffStatsDeps = {
  execFileSyncFn?: typeof execFileSync
  readFileSyncFn?: typeof readFileSync
}

export function isInsideGitWorkTree(
  directory: string,
  execFileSyncFn: typeof execFileSync = execFileSync
): boolean {
  try {
    const result = execFileSyncFn("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    return result === "true"
  } catch {
    return false
  }
}

export function getGitDiffStats(directory: string, deps: GitDiffStatsDeps = {}): GitFileStat[] {
  const execFileSyncFn = deps.execFileSyncFn ?? execFileSync
  const readFileSyncFn = deps.readFileSyncFn ?? readFileSync

  if (!isInsideGitWorkTree(directory, execFileSyncFn)) {
    return []
  }

  try {
    const diffOutput = execFileSyncFn("git", ["diff", "--numstat", "HEAD"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const statusOutput = execFileSyncFn("git", ["status", "--porcelain"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const untrackedOutput = execFileSyncFn("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const untrackedNumstat = untrackedOutput
      ? untrackedOutput
          .split("\n")
          .filter(Boolean)
          .map((filePath) => {
            try {
              const content = readFileSyncFn(join(directory, filePath), "utf-8")
              const lineCount = content.split("\n").length - (content.endsWith("\n") ? 1 : 0)
              return `${lineCount}\t0\t${filePath}`
            } catch {
              return `0\t0\t${filePath}`
            }
          })
          .join("\n")
      : ""

    const combinedNumstat = [diffOutput, untrackedNumstat].filter(Boolean).join("\n").trim()
    if (!combinedNumstat) return []

    const statusMap = new Map<string, GitFileStat["status"]>()
    for (const line of statusOutput.split("\n")) {
      if (!line) continue
      const status = line.substring(0, 2).trim()
      const filePath = line.substring(3)

      if (status === "A" || status === "??") {
        statusMap.set(filePath, "added")
      } else if (status === "D") {
        statusMap.set(filePath, "deleted")
      } else {
        statusMap.set(filePath, "modified")
      }
    }

    const stats: GitFileStat[] = []
    for (const line of combinedNumstat.split("\n")) {
      const parts = line.split("\t")
      if (parts.length < 3) continue

      const [addedStr, removedStr, path] = parts
      const added = addedStr === "-" ? 0 : parseInt(addedStr, 10)
      const removed = removedStr === "-" ? 0 : parseInt(removedStr, 10)

      stats.push({
        path,
        added: Number.isFinite(added) ? added : 0,
        removed: Number.isFinite(removed) ? removed : 0,
        status: statusMap.get(path) ?? "modified",
      })
    }

    return stats
  } catch {
    return []
  }
}
