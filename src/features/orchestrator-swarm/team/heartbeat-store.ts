import { existsSync, readdirSync } from "fs"
import { join } from "path"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { ensureDir, getTeamDir, readJsonSafe, writeJsonAtomic } from "../../orchestrator-tasks/storage"
import { z } from "zod"

const HeartbeatRecordSchema = z.object({
  agentId: z.string(),
  heartbeatAt: z.number(),
})

type HeartbeatRecord = z.infer<typeof HeartbeatRecordSchema>

function getHeartbeatDir(teamName: string, config: Partial<OhMyOpenCodeConfig>): string {
  return join(getTeamDir(teamName, config), "heartbeats")
}

function getHeartbeatPath(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): string {
  return join(getHeartbeatDir(teamName, config), `${agentId}.json`)
}

export function writeHeartbeat(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>,
  heartbeatAt = Date.now()
): void {
  const dir = getHeartbeatDir(teamName, config)
  ensureDir(dir)
  const path = getHeartbeatPath(teamName, agentId, config)
  const record: HeartbeatRecord = { agentId, heartbeatAt }
  writeJsonAtomic(path, record)
}

export function readHeartbeat(
  teamName: string,
  agentId: string,
  config: Partial<OhMyOpenCodeConfig>
): number | null {
  const path = getHeartbeatPath(teamName, agentId, config)
  const record = readJsonSafe(path, HeartbeatRecordSchema)
  return record?.heartbeatAt ?? null
}

export function readAllHeartbeats(
  teamName: string,
  config: Partial<OhMyOpenCodeConfig>
): Map<string, number> {
  const dir = getHeartbeatDir(teamName, config)
  if (!existsSync(dir)) {
    return new Map()
  }
  const result = new Map<string, number>()
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"))
  for (const file of files) {
    const agentId = file.replace(/\.json$/, "")
    const heartbeatAt = readHeartbeat(teamName, agentId, config)
    if (heartbeatAt !== null) {
      result.set(agentId, heartbeatAt)
    }
  }
  return result
}
