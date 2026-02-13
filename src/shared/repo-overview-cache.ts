import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { log } from "./logger"

interface RepoOverviewCacheEntry {
  overview: string
  timestamp: number
  projectDir: string
}

const REPO_OVERVIEW_CACHE_DIR = join(homedir(), ".opencode", "cache", "repo-overview")

function ensureRepoOverviewCacheDir(): void {
  if (!existsSync(REPO_OVERVIEW_CACHE_DIR)) {
    mkdirSync(REPO_OVERVIEW_CACHE_DIR, { recursive: true })
  }
}

function getRepoOverviewCacheKey(projectDir: string): string {
  return Buffer.from(projectDir).toString("base64url")
}

export function getRepoOverviewCacheFilePath(projectDir: string): string {
  return join(REPO_OVERVIEW_CACHE_DIR, `${getRepoOverviewCacheKey(projectDir)}.json`)
}

export function getCachedRepoOverview(
  projectDir: string,
  cacheDurationMs: number
): string | null {
  try {
    ensureRepoOverviewCacheDir()
    const cacheFile = getRepoOverviewCacheFilePath(projectDir)

    if (!existsSync(cacheFile)) return null

    const data: RepoOverviewCacheEntry = JSON.parse(readFileSync(cacheFile, "utf-8"))
    if (Date.now() - data.timestamp > cacheDurationMs) return null
    if (data.projectDir !== projectDir) return null

    return data.overview
  } catch {
    return null
  }
}

export function setCachedRepoOverview(projectDir: string, overview: string): void {
  try {
    ensureRepoOverviewCacheDir()
    const cacheFile = getRepoOverviewCacheFilePath(projectDir)
    const data: RepoOverviewCacheEntry = {
      overview,
      timestamp: Date.now(),
      projectDir,
    }
    writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    log("[repo-overview] failed to cache overview", { error: String(error) })
  }
}

export function invalidateRepoOverviewCache(projectDir: string): boolean {
  try {
    const cacheFile = getRepoOverviewCacheFilePath(projectDir)
    if (!existsSync(cacheFile)) {
      return false
    }
    rmSync(cacheFile, { force: true })
    return true
  } catch (error) {
    log("[repo-overview] failed to invalidate cache", { error: String(error) })
    return false
  }
}
