import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import { log } from "../../shared/logger"

export type ClaimLayer = "fact" | "experience"

export interface ProvenanceClaimInput {
  sessionID: string
  layer: ClaimLayer
  claim: string
  sourceEventId: string
  retrievalPath: string[]
  timestamp?: number
  metadata?: Record<string, unknown>
}

export interface ProvenanceClaim extends ProvenanceClaimInput {
  claimId: string
  timestamp: number
}

interface ProvenanceClaimEntry {
  id: string
  previousHash: string
  hash: string
  claim: ProvenanceClaim
}

export interface ProvenanceStoreConfig {
  enabled: boolean
  baseDir: string
}

const DEFAULT_PROVENANCE_STORE_CONFIG: ProvenanceStoreConfig = {
  enabled: true,
  baseDir: join(getOpenCodeStorageDir(), "provenance-memory"),
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function sessionFile(baseDir: string, sessionID: string): string {
  return join(baseDir, sessionID, "claims.jsonl")
}

function parseEntries(filePath: string): ProvenanceClaimEntry[] {
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
        const parsed = JSON.parse(line) as ProvenanceClaimEntry
        if (!parsed || typeof parsed !== "object") {
          return []
        }
        if (
          typeof parsed.id !== "string"
          || typeof parsed.previousHash !== "string"
          || typeof parsed.hash !== "string"
          || typeof parsed.claim?.claimId !== "string"
        ) {
          return []
        }
        return [parsed]
      } catch {
        return []
      }
    })
}

function computeHash(previousHash: string, claim: ProvenanceClaim): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        previousHash,
        claim,
      })
    )
    .digest("hex")
}

export interface ProvenanceClaimStore {
  configure: (next: Partial<ProvenanceStoreConfig>) => void
  appendClaim: (input: ProvenanceClaimInput) => ProvenanceClaim | null
  readClaims: (sessionID: string) => ProvenanceClaim[]
  verifyChain: (sessionID: string) => { valid: boolean; reason?: string }
}

export function createProvenanceClaimStore(
  initialConfig?: Partial<ProvenanceStoreConfig>
): ProvenanceClaimStore {
  let config: ProvenanceStoreConfig = {
    ...DEFAULT_PROVENANCE_STORE_CONFIG,
    ...initialConfig,
  }

  return {
    configure(next) {
      config = { ...config, ...next }
    },

    appendClaim(input) {
      if (!config.enabled) {
        return null
      }
      if (!input.sessionID || !input.claim || !input.sourceEventId || input.retrievalPath.length === 0) {
        return null
      }

      const claim: ProvenanceClaim = {
        claimId: `claim_${Date.now()}_${randomUUID().slice(0, 8)}`,
        sessionID: input.sessionID,
        layer: input.layer,
        claim: input.claim,
        sourceEventId: input.sourceEventId,
        retrievalPath: [...input.retrievalPath],
        timestamp: input.timestamp ?? Date.now(),
        metadata: input.metadata,
      }

      const filePath = sessionFile(config.baseDir, input.sessionID)
      ensureDir(dirname(filePath))
      const entries = parseEntries(filePath)
      const previousHash = entries[entries.length - 1]?.hash ?? "root"
      const entry: ProvenanceClaimEntry = {
        id: `entry_${Date.now()}_${randomUUID().slice(0, 8)}`,
        previousHash,
        hash: computeHash(previousHash, claim),
        claim,
      }

      try {
        const prefix = entries.length > 0 ? "\n" : ""
        appendFileSync(filePath, `${prefix}${JSON.stringify(entry)}`)
      } catch (error) {
        log("[provenance-memory] append failed", {
          sessionID: input.sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }

      return claim
    },

    readClaims(sessionID) {
      return parseEntries(sessionFile(config.baseDir, sessionID)).map((entry) => entry.claim)
    },

    verifyChain(sessionID) {
      const entries = parseEntries(sessionFile(config.baseDir, sessionID))
      let previousHash = "root"
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]
        if (entry.previousHash !== previousHash) {
          return { valid: false, reason: `invalid previous hash at index ${i}` }
        }
        const expected = computeHash(entry.previousHash, entry.claim)
        if (expected !== entry.hash) {
          return { valid: false, reason: `invalid hash at index ${i}` }
        }
        previousHash = entry.hash
      }
      return { valid: true }
    },
  }
}

export const provenanceClaimStore = createProvenanceClaimStore()
