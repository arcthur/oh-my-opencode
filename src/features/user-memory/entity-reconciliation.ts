/**
 * Entity Reconciliation Module
 *
 * Handles alias detection and entity merging.
 * "JS" -> "John Smith", "React" -> "ReactJS"
 */

import type { EntityType, EntityNode, EntityGraph, EntityRelationship, RelationshipPredicate } from "./types"
import { normalizeEntityName, generateEntityId, type ExtractedEntity, mergeIntoEntityNode } from "./entity-extraction"
import { calculateCountBasedConfidence } from "./entity-confidence"

// ============================================================================
// Similarity Configuration
// ============================================================================

/**
 * Similarity thresholds by entity type
 * Higher threshold = stricter matching
 */
const SIMILARITY_THRESHOLDS: Record<EntityType, number> = {
  person: 0.85,       // Strict for names
  project: 0.80,      // Moderate for project names
  technology: 0.90,   // Very strict for tech (React != ReactJS by default)
  organization: 0.85,
  concept: 0.80,      // Moderate for abstract concepts
}

/**
 * Known aliases mapping
 * Canonical name -> aliases
 */
const KNOWN_ALIASES: Record<string, string[]> = {
  // Technologies
  "typescript": ["ts"],
  "javascript": ["js"],
  "reactjs": ["react"],
  "vuejs": ["vue"],
  "nodejs": ["node"],
  "vscode": ["vs code", "visual studio code"],
  "neovim": ["nvim"],
  "postgresql": ["postgres", "pg"],
  "mongodb": ["mongo"],
  "kubernetes": ["k8s"],
  "github actions": ["gh actions"],
  // Common abbreviations
  "next.js": ["nextjs", "next"],
  "nuxt.js": ["nuxtjs", "nuxt"],
}

// ============================================================================
// String Similarity
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculate normalized similarity (0-1)
 */
export function calculateStringSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().trim()
  const normB = b.toLowerCase().trim()

  if (normA === normB) return 1.0

  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return 1.0

  const distance = levenshteinDistance(normA, normB)
  return 1 - distance / maxLen
}

/**
 * Check if one string is an abbreviation of another
 * "JS" -> "John Smith" = true
 * "TS" -> "TypeScript" = true
 */
export function isAbbreviation(short: string, long: string): boolean {
  const shortNorm = short.toLowerCase().replace(/[^a-z]/g, "")
  const longNorm = long.toLowerCase()

  if (shortNorm.length >= longNorm.length) return false
  if (shortNorm.length < 2) return false

  // Check initials match (e.g., "JS" for "John Smith")
  const words = longNorm.split(/\s+/)
  if (words.length >= 2) {
    const initials = words.map(w => w[0]).join("")
    if (initials === shortNorm) return true
  }

  // Check prefix match (e.g., "TS" for "TypeScript")
  const longCompact = longNorm.replace(/[^a-z]/g, "")
  if (longCompact.startsWith(shortNorm)) return true

  // Check camelCase initials (e.g., "TS" for "TypeScript")
  const camelInitials = long
    .split("")
    .filter(c => c === c.toUpperCase() && /[A-Z]/.test(c))
    .join("")
    .toLowerCase()
  if (camelInitials === shortNorm) return true

  return false
}

// ============================================================================
// Alias Detection
// ============================================================================

/**
 * Determine if two entity names should be merged as aliases
 */
export function shouldMergeAsAlias(
  name1: string,
  name2: string,
  type: EntityType
): { shouldMerge: boolean; confidence: number } {
  const norm1 = normalizeEntityName(name1)
  const norm2 = normalizeEntityName(name2)

  // Exact match (after normalization)
  if (norm1 === norm2) {
    return { shouldMerge: true, confidence: 1.0 }
  }

  // Check known aliases
  for (const [canonical, aliases] of Object.entries(KNOWN_ALIASES)) {
    const allForms = [canonical, ...aliases].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, ""))
    const n1 = norm1.replace(/[^a-z0-9]/g, "")
    const n2 = norm2.replace(/[^a-z0-9]/g, "")

    if (allForms.includes(n1) && allForms.includes(n2)) {
      return { shouldMerge: true, confidence: 0.95 }
    }
  }

  // Check abbreviation relationship
  if (isAbbreviation(name1, name2)) {
    return { shouldMerge: true, confidence: 0.85 }
  }
  if (isAbbreviation(name2, name1)) {
    return { shouldMerge: true, confidence: 0.85 }
  }

  // Check edit distance similarity
  const similarity = calculateStringSimilarity(name1, name2)
  const threshold = SIMILARITY_THRESHOLDS[type]

  if (similarity >= threshold) {
    return { shouldMerge: true, confidence: similarity }
  }

  return { shouldMerge: false, confidence: similarity }
}

// ============================================================================
// Entity Graph Operations
// ============================================================================

/**
 * Find the canonical entity ID for a given name
 * Checks alias index first, then tries to find matches
 */
export function findCanonicalEntity(
  graph: EntityGraph,
  name: string,
  type: EntityType
): string | undefined {
  const normalized = normalizeEntityName(name)

  // Check direct ID match
  const directId = generateEntityId(type, name)
  if (graph.nodes[directId]) {
    return directId
  }

  // Check alias index
  const aliasKey = `${type}:${normalized}`
  if (graph.aliasIndex[aliasKey]) {
    return graph.aliasIndex[aliasKey]
  }

  // Try to find a matching node by similarity
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== type) continue

    const { shouldMerge } = shouldMergeAsAlias(name, node.name, type)
    if (shouldMerge) {
      return node.id
    }

    // Check existing aliases
    for (const alias of node.aliases) {
      const { shouldMerge: aliasMatch } = shouldMergeAsAlias(name, alias, type)
      if (aliasMatch) {
        return node.id
      }
    }
  }

  return undefined
}

/**
 * Add an extracted entity to the graph
 * Handles alias detection and merging automatically
 */
export function addEntityToGraph(
  graph: EntityGraph,
  extracted: ExtractedEntity
): EntityGraph {
  // Find existing canonical entity
  const canonicalId = findCanonicalEntity(graph, extracted.name, extracted.type)

  if (canonicalId) {
    // Merge into existing entity
    const existingNode = graph.nodes[canonicalId]
    const updatedNode = mergeIntoEntityNode(existingNode, extracted)

    // Add as alias if name differs from canonical
    if (normalizeEntityName(extracted.name) !== normalizeEntityName(existingNode.name)) {
      if (!updatedNode.aliases.includes(extracted.name)) {
        updatedNode.aliases.push(extracted.name)
        updatedNode.aliasConfidence[extracted.name] = 1.0
      }
      // Update alias index
      graph.aliasIndex[`${extracted.type}:${normalizeEntityName(extracted.name)}`] = canonicalId
    }

    return {
      ...graph,
      nodes: {
        ...graph.nodes,
        [canonicalId]: updatedNode,
      },
    }
  }

  // Create new entity node
  const newNode = mergeIntoEntityNode(undefined, extracted)

  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [extracted.id]: newNode,
    },
  }
}

// ============================================================================
// Relationship Inference (Co-occurrence)
// ============================================================================

export interface RelationshipObservation {
  timestamp: number
  context: string
}

function buildRelationshipId(
  subject: string,
  predicate: RelationshipPredicate,
  object: string
): string {
  return `rel:${subject}|${predicate}|${object}`
}

function addOrUpdateRelationship(
  graph: EntityGraph,
  subject: string,
  predicate: RelationshipPredicate,
  object: string,
  observation: RelationshipObservation
): EntityGraph {
  const id = buildRelationshipId(subject, predicate, object)
  const context = observation.context.trim().slice(0, 200)

  const existingIndex = graph.relationships.findIndex((r) => r.id === id)
  if (existingIndex < 0) {
    const relationship: EntityRelationship = {
      id,
      subject,
      predicate,
      object,
      confidence: calculateCountBasedConfidence(1, 5),
      observationCount: 1,
      firstObserved: observation.timestamp,
      lastObserved: observation.timestamp,
      contextSamples: context ? [context] : [],
    }
    return {
      ...graph,
      lastExtraction: Math.max(graph.lastExtraction, observation.timestamp),
      relationships: [...graph.relationships, relationship],
    }
  }

  const existing = graph.relationships[existingIndex]
  const nextCount = existing.observationCount + 1
  const nextContextSamples = context
    ? [context, ...existing.contextSamples.filter((c) => c !== context)].slice(0, 3)
    : existing.contextSamples

  const updatedRelationship: EntityRelationship = {
    ...existing,
    observationCount: nextCount,
    confidence: calculateCountBasedConfidence(nextCount, 5),
    firstObserved: Math.min(existing.firstObserved, observation.timestamp),
    lastObserved: Math.max(existing.lastObserved, observation.timestamp),
    contextSamples: nextContextSamples,
  }

  const nextRelationships = [...graph.relationships]
  nextRelationships[existingIndex] = updatedRelationship

  return {
    ...graph,
    lastExtraction: Math.max(graph.lastExtraction, observation.timestamp),
    relationships: nextRelationships,
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids))
}

/**
 * Add extracted entities and inferred relationships from a single observation.
 * Relationships are inferred via simple type-aware co-occurrence rules:
 * - person + project => works_on
 * - project + technology => uses
 * - person + person => collaborates_with (canonical ordering)
 */
export function addEntitiesAndCooccurrenceRelationships(
  graph: EntityGraph,
  extractedEntities: ExtractedEntity[],
  observation: RelationshipObservation
): EntityGraph {
  let updated = graph

  for (const entity of extractedEntities) {
    updated = addEntityToGraph(updated, entity)
  }

  const people = uniqueIds(
    extractedEntities
      .filter((e) => e.type === "person")
      .map((e) => findCanonicalEntity(updated, e.name, e.type) ?? e.id)
  )
  const projects = uniqueIds(
    extractedEntities
      .filter((e) => e.type === "project")
      .map((e) => findCanonicalEntity(updated, e.name, e.type) ?? e.id)
  )
  const technologies = uniqueIds(
    extractedEntities
      .filter((e) => e.type === "technology")
      .map((e) => findCanonicalEntity(updated, e.name, e.type) ?? e.id)
  )

  // person -> project
  for (const person of people) {
    for (const project of projects) {
      updated = addOrUpdateRelationship(updated, person, "works_on", project, observation)
    }
  }

  // project -> technology
  for (const project of projects) {
    for (const technology of technologies) {
      updated = addOrUpdateRelationship(updated, project, "uses", technology, observation)
    }
  }

  // person <-> person (canonicalized)
  if (people.length >= 2) {
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const [a, b] = [people[i], people[j]].sort()
        updated = addOrUpdateRelationship(updated, a, "collaborates_with", b, observation)
      }
    }
  }

  // Keep graphVersion stable; lastExtraction handled by relationship updates above.
  // Ensure lastExtraction still advances when no relationships were inferred.
  if (updated.lastExtraction < observation.timestamp) {
    return { ...updated, lastExtraction: observation.timestamp }
  }

  return updated
}

/**
 * Prune entity graph to stay within limits
 */
export function pruneEntityGraph(
  graph: EntityGraph,
  maxEntities: number = 200,
  maxRelationships: number = 500,
  minMentions: number = 2
): EntityGraph {
  const sortedNodes = Object.values(graph.nodes)
    .sort((a, b) => {
      const aQualified = a.mentionCount >= minMentions
      const bQualified = b.mentionCount >= minMentions
      if (aQualified !== bQualified) return aQualified ? -1 : 1

      if (a.mentionCount !== b.mentionCount) {
        return b.mentionCount - a.mentionCount
      }

      return b.lastSeen - a.lastSeen
    })
    .slice(0, maxEntities)

  const keptIds = new Set(sortedNodes.map(n => n.id))

  // Rebuild nodes
  const prunedNodes: Record<string, EntityNode> = {}
  for (const node of sortedNodes) {
    prunedNodes[node.id] = node
  }

  // Filter relationships
  const prunedRelationships = graph.relationships
    .filter(r => keptIds.has(r.subject) && keptIds.has(r.object))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return b.lastObserved - a.lastObserved
    })
    .slice(0, maxRelationships)

  // Rebuild alias index
  const prunedAliasIndex: Record<string, string> = {}
  for (const node of sortedNodes) {
    prunedAliasIndex[`${node.type}:${normalizeEntityName(node.name)}`] = node.id
    for (const alias of node.aliases) {
      prunedAliasIndex[`${node.type}:${normalizeEntityName(alias)}`] = node.id
    }
  }

  return {
    ...graph,
    nodes: prunedNodes,
    relationships: prunedRelationships,
    aliasIndex: prunedAliasIndex,
  }
}
