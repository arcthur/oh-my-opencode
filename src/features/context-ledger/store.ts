import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import { log } from "../../shared/logger"

export interface ContextLedgerConfig {
  enabled: boolean
  baseDir: string
}

export interface ContextLedgerWriteInput {
  sessionID: string
  source: string
  content: string
  immutable?: boolean
  metadata?: Record<string, unknown>
}

export interface ContextLedgerSegment {
  id: string
  sessionID: string
  index: number
  source: string
  content: string
  immutable: boolean
  metadata?: Record<string, unknown>
  previousHash: string
  hash: string
  createdAt: number
}

export interface ChainVerificationResult {
  valid: boolean
  reason?: string
}

export interface ContextLedgerStore {
  configure: (config: Partial<ContextLedgerConfig>) => void
  getConfig: () => ContextLedgerConfig
  append: (input: ContextLedgerWriteInput) => ContextLedgerSegment | null
  readSegments: (sessionID: string) => ContextLedgerSegment[]
  verifyChain: (sessionID: string) => ChainVerificationResult
  computePrefixFingerprint: (sessionID: string) => string
  clearSession: (sessionID: string) => void
}

const DEFAULT_LEDGER_CONFIG: ContextLedgerConfig = {
  enabled: false,
  baseDir: join(getOpenCodeStorageDir(), "context-ledger"),
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function getSessionDir(baseDir: string, sessionID: string): string {
  return join(baseDir, sessionID)
}

function getSegmentsFile(baseDir: string, sessionID: string): string {
  return join(getSessionDir(baseDir, sessionID), "segments.jsonl")
}

function sortObject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (Array.isArray(value)) {
      return value.map((item) => sortObject(item))
    }
    return value
  }

  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortObject(source[key])
  }
  return sorted
}

function computeSegmentHash(params: {
  previousHash: string
  source: string
  content: string
  immutable: boolean
  metadata?: Record<string, unknown>
}): string {
  const canonical = JSON.stringify({
    previousHash: params.previousHash,
    source: params.source,
    content: params.content,
    immutable: params.immutable,
    metadata: sortObject(params.metadata ?? {}),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function parseSegments(segmentsFile: string): ContextLedgerSegment[] {
  if (!existsSync(segmentsFile)) {
    return []
  }

  const content = readFileSync(segmentsFile, "utf-8")
  if (!content.trim()) {
    return []
  }

  const segments: ContextLedgerSegment[] = []
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ContextLedgerSegment
      if (!parsed || typeof parsed !== "object") {
        continue
      }
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.sessionID !== "string" ||
        typeof parsed.hash !== "string" ||
        typeof parsed.previousHash !== "string"
      ) {
        continue
      }
      segments.push(parsed)
    } catch {
      continue
    }
  }

  return segments.sort((a, b) => a.index - b.index)
}

export function createContextLedgerStore(
  initialConfig?: Partial<ContextLedgerConfig>
): ContextLedgerStore {
  let config: ContextLedgerConfig = {
    ...DEFAULT_LEDGER_CONFIG,
    ...initialConfig,
  }

  return {
    configure(nextConfig) {
      config = { ...config, ...nextConfig }
    },

    getConfig() {
      return { ...config }
    },

    append(input) {
      if (!config.enabled) {
        return null
      }

      if (!input.sessionID || !input.source || !input.content) {
        return null
      }

      ensureDir(config.baseDir)
      const sessionDir = getSessionDir(config.baseDir, input.sessionID)
      ensureDir(sessionDir)

      const segmentsFile = getSegmentsFile(config.baseDir, input.sessionID)
      const existing = parseSegments(segmentsFile)
      const last = existing[existing.length - 1]

      const immutable = input.immutable ?? true
      const previousHash = last?.hash ?? "root"
      const index = last ? last.index + 1 : 0
      const createdAt = Date.now()
      const hash = computeSegmentHash({
        previousHash,
        source: input.source,
        content: input.content,
        immutable,
        metadata: input.metadata,
      })

      const segment: ContextLedgerSegment = {
        id: `seg_${createdAt}_${randomUUID().slice(0, 8)}`,
        sessionID: input.sessionID,
        index,
        source: input.source,
        content: input.content,
        immutable,
        metadata: input.metadata,
        previousHash,
        hash,
        createdAt,
      }

      try {
        const serialized = JSON.stringify(segment)
        const prefix = existsSync(segmentsFile) && readFileSync(segmentsFile, "utf-8").trim().length > 0
          ? "\n"
          : ""
        writeFileSync(segmentsFile, `${prefix}${serialized}`, { flag: "a" })
      } catch (error) {
        log("[context-ledger] append failed", {
          sessionID: input.sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }

      return segment
    },

    readSegments(sessionID) {
      if (!config.enabled && !existsSync(getSegmentsFile(config.baseDir, sessionID))) {
        return []
      }
      return parseSegments(getSegmentsFile(config.baseDir, sessionID))
    },

    verifyChain(sessionID) {
      const segments = parseSegments(getSegmentsFile(config.baseDir, sessionID))
      let previousHash = "root"

      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i]
        if (segment.previousHash !== previousHash) {
          return {
            valid: false,
            reason: `invalid previousHash at index ${segment.index}`,
          }
        }

        const expectedHash = computeSegmentHash({
          previousHash: segment.previousHash,
          source: segment.source,
          content: segment.content,
          immutable: segment.immutable,
          metadata: segment.metadata,
        })

        if (segment.hash !== expectedHash) {
          return {
            valid: false,
            reason: `invalid hash at index ${segment.index}`,
          }
        }

        previousHash = segment.hash
      }

      return { valid: true }
    },

    computePrefixFingerprint(sessionID) {
      const segments = parseSegments(getSegmentsFile(config.baseDir, sessionID))
      const immutableHashes = segments
        .filter((segment) => segment.immutable)
        .map((segment) => segment.hash)

      if (immutableHashes.length === 0) {
        return ""
      }

      return createHash("sha256")
        .update(immutableHashes.join("\n"))
        .digest("hex")
        .slice(0, 24)
    },

    clearSession(sessionID) {
      const sessionDir = getSessionDir(config.baseDir, sessionID)
      if (existsSync(sessionDir)) {
        rmSync(sessionDir, { recursive: true, force: true })
      }
    },
  }
}

export const contextLedgerStore = createContextLedgerStore()

export function configureContextLedgerStore(config: Partial<ContextLedgerConfig>): void {
  contextLedgerStore.configure(config)
}

