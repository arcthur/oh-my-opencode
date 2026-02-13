import { createHash, randomUUID } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import { log } from "../../shared/logger"
import type { ObservedEvent, PolicyLedgerEntry } from "./types"

export interface PolicyLedgerConfig {
  enabled: boolean
  baseDir: string
  retentionDays: number
  maxFileBytes: number
}

const DEFAULT_POLICY_LEDGER_CONFIG: PolicyLedgerConfig = {
  enabled: true,
  baseDir: join(getOpenCodeStorageDir(), "policy-ledger"),
  retentionDays: 7,
  maxFileBytes: 2 * 1024 * 1024,
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function sessionLedgerFile(baseDir: string, sessionID: string): string {
  return join(baseDir, `${sessionID}.jsonl`)
}

function computeEntryHash(previousHash: string, payload: Record<string, unknown>): string {
  const canonical = JSON.stringify({
    previousHash,
    payload,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function readEntries(filePath: string): PolicyLedgerEntry[] {
  if (!existsSync(filePath)) {
    return []
  }

  const content = readFileSync(filePath, "utf-8")
  if (!content.trim()) {
    return []
  }

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as PolicyLedgerEntry
        if (!parsed || typeof parsed !== "object") {
          return []
        }
        if (parsed.type !== "observed") {
          return []
        }
        return [parsed]
      } catch {
        return []
      }
    })
}

export class PolicyLedgerStore {
  private config: PolicyLedgerConfig

  constructor(config?: Partial<PolicyLedgerConfig>) {
    this.config = { ...DEFAULT_POLICY_LEDGER_CONFIG, ...config }
  }

  configure(next: Partial<PolicyLedgerConfig>): void {
    this.config = { ...this.config, ...next }
  }

  appendObserved(event: ObservedEvent): void {
    this.appendEntry(event.sessionID, Date.now(), {
      type: "observed",
      observed: event as unknown as Record<string, unknown>,
    })
  }

  private appendEntry(
    sessionID: string,
    timestamp: number,
    payload: Record<string, unknown>
  ): void {
    if (!this.config.enabled) {
      return
    }

    ensureDir(this.config.baseDir)
    const filePath = sessionLedgerFile(this.config.baseDir, sessionID)
    ensureDir(dirname(filePath))
    this.rotateIfOversized(filePath)

    const entries = readEntries(filePath)
    const previousHash = entries[entries.length - 1]?.hash ?? "root"
    const hash = computeEntryHash(previousHash, payload)
    const base = {
      id: `obs_${Date.now()}_${randomUUID().slice(0, 8)}`,
      sessionID,
      timestamp,
      previousHash,
      hash,
    }
    const entry = {
      ...base,
      ...payload,
    } as PolicyLedgerEntry

    try {
      const prefix =
        existsSync(filePath) && readFileSync(filePath, "utf-8").trim().length > 0 ? "\n" : ""
      appendFileSync(filePath, `${prefix}${JSON.stringify(entry)}`)
    } catch (error) {
      log("[policy-ledger] append failed", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private rotateIfOversized(filePath: string): void {
    if (!existsSync(filePath)) {
      return
    }

    const maxFileBytes = this.config.maxFileBytes
    if (maxFileBytes <= 0) {
      return
    }

    let fileSize = 0
    try {
      fileSize = statSync(filePath).size
    } catch {
      return
    }

    if (fileSize <= maxFileBytes) {
      return
    }

    const rotatedPath = `${filePath}.${Date.now()}.rolled`
    try {
      renameSync(filePath, rotatedPath)
    } catch (error) {
      log("[policy-ledger] rotate failed", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  readSession(sessionID: string): PolicyLedgerEntry[] {
    return readEntries(sessionLedgerFile(this.config.baseDir, sessionID))
  }

  cleanup(now = Date.now()): void {
    if (!existsSync(this.config.baseDir)) {
      return
    }

    const cutoff = now - this.config.retentionDays * 24 * 60 * 60 * 1000
    for (const fileName of readdirSync(this.config.baseDir)) {
      const filePath = join(this.config.baseDir, fileName)
      try {
        const stats = statSync(filePath)
        if (stats.mtimeMs < cutoff) {
          unlinkSync(filePath)
        }
      } catch {
        continue
      }
    }
  }
}

let policyLedgerStoreSingleton: PolicyLedgerStore | null = null

export function getPolicyLedgerStore(config?: Partial<PolicyLedgerConfig>): PolicyLedgerStore {
  if (!policyLedgerStoreSingleton) {
    policyLedgerStoreSingleton = new PolicyLedgerStore(config)
    return policyLedgerStoreSingleton
  }

  if (config) {
    policyLedgerStoreSingleton.configure(config)
  }
  return policyLedgerStoreSingleton
}

export function resetPolicyLedgerStore(): void {
  policyLedgerStoreSingleton = null
}
