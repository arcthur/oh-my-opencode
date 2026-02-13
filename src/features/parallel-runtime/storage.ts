import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { ensureDir, getProjectRoot, writeJsonAtomic } from "../orchestrator-tasks/storage"
import { withLock } from "../orchestrator-swarm/sync/semaphore"
import type { ParallelRuntimeConfig, RuntimeState } from "./types"

const RUNTIME_SCHEMA_VERSION = 1
const STATE_FILENAME = "state.json"

export function getParallelRuntimeDir(): string {
  return join(getProjectRoot(), ".orchestrator", "runtime", "parallel")
}

export function getParallelRuntimeStatePath(): string {
  return join(getParallelRuntimeDir(), STATE_FILENAME)
}

export function createEmptyRuntimeState(now = Date.now()): RuntimeState {
  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    updatedAt: now,
    leases: {},
    runs: {},
    events: [],
  }
}

function sanitizeRuntimeState(value: unknown): RuntimeState {
  if (!value || typeof value !== "object") {
    return createEmptyRuntimeState()
  }

  const obj = value as Record<string, unknown>

  const leases =
    obj.leases && typeof obj.leases === "object"
      ? (obj.leases as Record<string, RuntimeState["leases"][string]>)
      : {}
  const runs =
    obj.runs && typeof obj.runs === "object"
      ? (obj.runs as Record<string, RuntimeState["runs"][string]>)
      : {}
  const events = Array.isArray(obj.events) ? (obj.events as RuntimeState["events"]) : []
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now()
  const schemaVersion = typeof obj.schemaVersion === "number" ? obj.schemaVersion : RUNTIME_SCHEMA_VERSION

  return {
    schemaVersion,
    updatedAt,
    leases,
    runs,
    events,
  }
}

export function readRuntimeState(): RuntimeState {
  const statePath = getParallelRuntimeStatePath()
  if (!existsSync(statePath)) {
    return createEmptyRuntimeState()
  }

  try {
    const raw = readFileSync(statePath, "utf-8")
    return sanitizeRuntimeState(JSON.parse(raw))
  } catch {
    return createEmptyRuntimeState()
  }
}

export function writeRuntimeState(state: RuntimeState): void {
  const statePath = getParallelRuntimeStatePath()
  ensureDir(dirname(statePath))
  writeJsonAtomic(statePath, state)
}

export async function withRuntimeStateLock<T>(
  config: ParallelRuntimeConfig,
  fn: (state: RuntimeState) => Promise<T> | T
): Promise<T> {
  const statePath = getParallelRuntimeStatePath()
  ensureDir(dirname(statePath))

  return withLock(
    statePath,
    async () => {
      const state = readRuntimeState()
      const result = await fn(state)
      state.updatedAt = Date.now()
      writeRuntimeState(state)
      return result
    },
    {
      timeoutMs: config.lock_timeout_ms,
    }
  )
}
