import type { ContextLedgerStore } from "../context-ledger/store"

export interface PrefixCompilerConfig {
  enabled: boolean
  maxPrefixSegments: number
  maxPrefixChars: number
  separator: string
}

export interface CompilePrefixContextInput {
  sessionID: string
  pendingMerged: string
  ledgerStore: Pick<ContextLedgerStore, "readSegments" | "computePrefixFingerprint">
  config?: Partial<PrefixCompilerConfig>
}

export interface PrefixCompileResult {
  compiled: string
  prefix: string
  dynamicTail: string
  prefixFingerprint: string
  usedLedger: boolean
}

const DEFAULT_PREFIX_COMPILER_CONFIG: PrefixCompilerConfig = {
  enabled: false,
  maxPrefixSegments: 64,
  maxPrefixChars: 32_000,
  separator: "\n\n---\n\n",
}

function clampPrefixByChars(values: string[], maxChars: number, separator: string): string[] {
  if (maxChars <= 0) {
    return []
  }

  const selected: string[] = []
  let length = 0

  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i]
    if (!value) {
      continue
    }
    const separatorLength = selected.length === 0 ? 0 : separator.length
    const nextLength = length + separatorLength + value.length
    if (nextLength > maxChars) {
      continue
    }
    selected.unshift(value)
    length = nextLength
  }

  return selected
}

function fallback(pendingMerged: string): PrefixCompileResult {
  return {
    compiled: pendingMerged,
    prefix: "",
    dynamicTail: pendingMerged,
    prefixFingerprint: "",
    usedLedger: false,
  }
}

export function compilePrefixContext(input: CompilePrefixContextInput): PrefixCompileResult {
  const config: PrefixCompilerConfig = {
    ...DEFAULT_PREFIX_COMPILER_CONFIG,
    ...input.config,
  }

  const pendingMerged = input.pendingMerged ?? ""
  if (!config.enabled) {
    return fallback(pendingMerged)
  }

  try {
    const segments = input.ledgerStore.readSegments(input.sessionID)
    const immutableSegments = segments.filter((segment) => segment.immutable)
    if (immutableSegments.length === 0) {
      return fallback(pendingMerged)
    }

    const limitedSegments = immutableSegments.slice(
      Math.max(0, immutableSegments.length - Math.max(1, config.maxPrefixSegments))
    )

    const uniquePrefixContents: string[] = []
    const seenContent = new Set<string>()
    for (const segment of limitedSegments) {
      if (!segment.content || seenContent.has(segment.content)) {
        continue
      }
      seenContent.add(segment.content)
      uniquePrefixContents.push(segment.content)
    }

    const clampedPrefixContents = clampPrefixByChars(
      uniquePrefixContents,
      config.maxPrefixChars,
      config.separator
    )
    const prefix = clampedPrefixContents.join(config.separator)
    const compiledPrefixContentSet = new Set(clampedPrefixContents)
    const prefixFingerprint = input.ledgerStore.computePrefixFingerprint(input.sessionID)

    const normalizedPending = pendingMerged.trim()
    const dynamicTail =
      normalizedPending.length > 0 && !compiledPrefixContentSet.has(normalizedPending)
        ? pendingMerged
        : ""

    if (!prefix && !dynamicTail) {
      return fallback(pendingMerged)
    }

    const compiled = prefix && dynamicTail
      ? `${prefix}${config.separator}${dynamicTail}`
      : (prefix || dynamicTail)

    return {
      compiled,
      prefix,
      dynamicTail,
      prefixFingerprint,
      usedLedger: true,
    }
  } catch {
    return fallback(pendingMerged)
  }
}
