import { existsSync, readdirSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { ensureDir, getTeamDir } from "../../sisyphus-tasks/storage"

function getIdleDir(teamName: string, config: Partial<OhMyOpenCodeConfig>): string {
  return join(getTeamDir(teamName, config), "idle")
}

function getIdlePath(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getIdleDir(teamName, config), `${agentId}.idle`)
}

export function markIdle(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const dir = getIdleDir(teamName, config)
  ensureDir(dir)
  const path = getIdlePath(teamName, agentId, config)
  if (!existsSync(path)) {
    writeFileSync(path, `${Date.now()}\n`, "utf-8")
  }
}

export function markBusy(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): void {
  const path = getIdlePath(teamName, agentId, config)
  if (!existsSync(path)) {
    return
  }
  try {
    unlinkSync(path)
  } catch {
    // Ignore per-file cleanup errors
  }
}

export function listIdleWorkers(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): string[] {
  const dir = getIdleDir(teamName, config)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".idle"))
    .map((name) => name.replace(/\.idle$/, ""))
}
