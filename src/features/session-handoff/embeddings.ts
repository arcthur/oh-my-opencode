import type { HandoffPackage, EmbeddingIndexEntry, Decision, Artifact, AntiPattern } from "./types"

// ============================================================================
// Index Entry Building
// ============================================================================

function normalizeEmbeddingText(text: string, maxChars = 1500): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars)
}

function formatDecisionForEmbedding(decision: Decision): string {
  const rejected =
    decision.rejected && decision.rejected.length > 0
      ? `Rejected: ${decision.rejected
          .map((r) => `${r.approach} (${r.reason})`)
          .join("; ")}`
      : ""

  const related =
    decision.relatedFiles && decision.relatedFiles.length > 0
      ? `Files: ${decision.relatedFiles.join(", ")}`
      : ""

  return normalizeEmbeddingText(
    [
      `Decision: ${decision.what}`,
      `Chosen: ${decision.chosen}`,
      `Why: ${decision.why}`,
      rejected,
      related,
    ]
      .filter(Boolean)
      .join("\n")
  )
}

function formatArtifactForEmbedding(artifact: Artifact): string {
  return normalizeEmbeddingText(
    [`Artifact: ${artifact.path}`, `Change: ${artifact.changeType}`, `Summary: ${artifact.summary}`]
      .filter(Boolean)
      .join("\n")
  )
}

function formatAntiPatternForEmbedding(ap: AntiPattern): string {
  return normalizeEmbeddingText(
    [
      `AntiPattern: ${ap.approach}`,
      `Reason: ${ap.reason}`,
      ap.errorSignature ? `Error: ${ap.errorSignature}` : "",
      ap.context ? `Context: ${ap.context}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  )
}

export function buildEmbeddingIndexEntries(pkg: HandoffPackage): EmbeddingIndexEntry[] {
  const entries: EmbeddingIndexEntry[] = []
  let vectorIndex = 0

  for (let i = 0; i < pkg.payload.decisions.length; i++) {
    const decision = pkg.payload.decisions[i]
    entries.push({
      id: `${pkg.id}:decision:${i}`,
      category: "decision",
      index: i,
      content: formatDecisionForEmbedding(decision),
      vectorIndex,
    })
    vectorIndex++
  }

  for (let i = 0; i < pkg.payload.artifacts.length; i++) {
    const artifact = pkg.payload.artifacts[i]
    entries.push({
      id: `${pkg.id}:artifact:${i}`,
      category: "artifact",
      index: i,
      content: formatArtifactForEmbedding(artifact),
      vectorIndex,
    })
    vectorIndex++
  }

  for (let i = 0; i < pkg.payload.antiPatterns.length; i++) {
    const ap = pkg.payload.antiPatterns[i]
    entries.push({
      id: `${pkg.id}:antiPattern:${i}`,
      category: "antiPattern",
      index: i,
      content: formatAntiPatternForEmbedding(ap),
      vectorIndex,
    })
    vectorIndex++
  }

  for (let i = 0; i < pkg.payload.domainContext.length; i++) {
    const ctx = pkg.payload.domainContext[i]
    entries.push({
      id: `${pkg.id}:domainContext:${i}`,
      category: "domainContext",
      index: i,
      content: normalizeEmbeddingText(`DomainContext: ${ctx}`),
      vectorIndex,
    })
    vectorIndex++
  }

  return entries.filter((e) => e.content.trim().length > 0)
}

export async function generateEmbeddingVectors(
  entries: EmbeddingIndexEntry[],
  embed: (texts: string[]) => Promise<number[][]>
): Promise<Float32Array[]> {
  if (entries.length === 0) return []

  const texts = entries.map((e) => e.content)
  const vectors = await embed(texts)

  if (!Array.isArray(vectors) || vectors.length !== entries.length) {
    throw new Error(`Embedding provider returned ${vectors.length} vectors for ${entries.length} entries`)
  }

  return vectors.map((v) => Float32Array.from(v))
}

// ============================================================================
// Similarity / Search
// ============================================================================

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || b.length === 0) return 0
  if (a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }

  if (normA === 0 || normB === 0) return 0
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB))
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(1, raw))
}

