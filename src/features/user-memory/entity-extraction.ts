/**
 * Entity Extraction Module
 *
 * Pattern-based extraction of entities from text.
 * Entities: person, project, technology, organization
 */

import type { EntityType, EntityNode, EntityMention, WeeklySummary } from "./types"

// ============================================================================
// Entity Patterns
// ============================================================================

interface EntityPattern {
  pattern: RegExp
  type: EntityType
  nameGroup: number
}

/**
 * Patterns for extracting entities from text
 * Each pattern captures a named entity and its type
 */
const ENTITY_PATTERNS: EntityPattern[] = [
  // Person patterns: "with John", "asked Alice", "from Bob Smith"
  { pattern: /\b(?:with|asked|from|by|told|helped)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g, type: "person", nameGroup: 1 },
  // Person at beginning: "John said", "Alice mentioned"
  { pattern: /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|mentioned|suggested|recommended|asked|told|helped)/gm, type: "person", nameGroup: 1 },

  // Project patterns: "in project-name", "on my-app", "the foo-bar repo"
  { pattern: /\b(?:in|on|for)\s+(?:the\s+)?([a-z][a-z0-9-_]+)\s+(?:project|repo|repository|codebase)/gi, type: "project", nameGroup: 1 },
  { pattern: /\b(?:project|repo|repository)\s+([a-z][a-z0-9-_]+)\b/gi, type: "project", nameGroup: 1 },
  // Project in path-like format: src/foo-bar/ or packages/my-lib
  { pattern: /\b(?:src|packages|libs|apps)\/([a-z][a-z0-9-_]+)\//gi, type: "project", nameGroup: 1 },

  // Technology patterns: explicit mentions
  { pattern: /\b(?:using|with|in)\s+(TypeScript|JavaScript|Python|Rust|Go|Java|Ruby|C\+\+|C#|Swift|Kotlin|Scala|Elixir|Clojure)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(React|Vue|Angular|Svelte|Next\.?js|Nuxt|Remix|Astro|SolidJS)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(Node\.?js|Deno|Bun|Express|Fastify|Koa|NestJS|Hono)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(PostgreSQL|MySQL|MongoDB|Redis|SQLite|DynamoDB|Prisma|Drizzle)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(Docker|Kubernetes|AWS|GCP|Azure|Vercel|Cloudflare|Netlify)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(Git|GitHub|GitLab|Bitbucket|CircleCI|GitHub Actions)\b/gi, type: "technology", nameGroup: 1 },
  { pattern: /\b(?:using|with)\s+(Vim|Neovim|VS\s?Code|Emacs|IntelliJ|WebStorm|Cursor)\b/gi, type: "technology", nameGroup: 1 },

  // Organization patterns: "at Company", "from Org Inc"
  { pattern: /\b(?:at|from|joined)\s+([A-Z][a-zA-Z]+(?:\s+(?:Inc|Corp|Ltd|LLC|Co)\.?)?)\b/g, type: "organization", nameGroup: 1 },
  { pattern: /\b([A-Z][a-zA-Z]+(?:\s+(?:Inc|Corp|Ltd|LLC|Co)\.?)?)\s+(?:team|company|organization)\b/g, type: "organization", nameGroup: 1 },

  // Concept patterns: explicit label to reduce noise
  { pattern: /\b(?:pattern|concept|principle|methodology|approach|strategy)\s*:\s*([A-Za-z][A-Za-z0-9 _-]{2,60}?)(?=\.|,|;|$)/gi, type: "concept", nameGroup: 1 },
  { pattern: /\b(?:pattern|concept|principle|methodology|approach|strategy)\s+(?:called|named)?\s*([A-Za-z][A-Za-z0-9 _-]{2,60}?)(?=\.|,|;|$)/gi, type: "concept", nameGroup: 1 },
]

/**
 * Common words that should not be extracted as entities
 */
const STOPWORDS = new Set([
  // Common verbs/articles
  "The", "This", "That", "These", "Those", "Some", "Any", "All", "Both",
  "Each", "Every", "Other", "Another", "Such", "What", "Which", "Who",
  // Common project false positives
  "src", "lib", "dist", "build", "node_modules", "test", "tests", "spec",
  // Common tech false positives (too generic)
  "API", "REST", "HTTP", "JSON", "XML", "HTML", "CSS", "SQL",
  // Time words
  "Today", "Yesterday", "Tomorrow", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday", "Sunday", "January", "February",
  "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December",
])

// ============================================================================
// Entity ID Generation
// ============================================================================

/**
 * Normalize entity name for consistent ID generation
 * - lowercase
 * - remove special chars
 * - replace spaces with underscores
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
}

/**
 * Generate canonical entity ID
 * Format: "type:normalized_name"
 */
export function generateEntityId(type: EntityType, name: string): string {
  return `${type}:${normalizeEntityName(name)}`
}

// ============================================================================
// Entity Extraction
// ============================================================================

/**
 * Extracted entity before reconciliation
 */
export interface ExtractedEntity {
  id: string
  name: string
  type: EntityType
  mention: EntityMention
}

/**
 * Extract entities from text
 *
 * @param text - Text to extract entities from
 * @param timestamp - Timestamp of the text source
 * @param context - Optional context (e.g., file path, project)
 */
export function extractEntitiesFromText(
  text: string,
  timestamp: number,
  context?: string,
  source: EntityMention["source"] = "L0",
  sourceId?: string
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  for (const { pattern, type, nameGroup } of ENTITY_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const name = match[nameGroup]?.trim()
      if (!name || name.length < 2 || name.length > 50) continue
      if (STOPWORDS.has(name)) continue

      const id = generateEntityId(type, name)
      if (seen.has(id)) continue
      seen.add(id)

      // Extract surrounding context (up to 100 chars)
      const start = Math.max(0, match.index - 50)
      const end = Math.min(text.length, match.index + match[0].length + 50)
      const contextSnippet = text.slice(start, end).replace(/\s+/g, " ").trim()

      entities.push({
        id,
        name,
        type,
        mention: {
          timestamp,
          context: context ?? contextSnippet,
          source,
          sourceId,
        },
      })
    }
  }

  return entities
}

/**
 * Extract entities from a work history entry
 */
export function extractEntitiesFromWorkHistory(entry: {
  summary: string
  project?: string
  timestamp: number
  files?: string[]
}): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()

  // Extract from summary
  const summaryEntities = extractEntitiesFromText(
    entry.summary,
    entry.timestamp,
    entry.project
  )
  for (const e of summaryEntities) {
    if (!seen.has(e.id)) {
      seen.add(e.id)
      entities.push(e)
    }
  }

  // Extract project as entity if present
  if (entry.project && entry.project.length >= 2) {
    const projectId = generateEntityId("project", entry.project)
    if (!seen.has(projectId)) {
      seen.add(projectId)
      entities.push({
        id: projectId,
        name: entry.project,
        type: "project",
        mention: {
          timestamp: entry.timestamp,
          context: `Project: ${entry.project} - ${entry.summary.slice(0, 80)}`,
          source: "L0" as const,
        },
      })
    }
  }

  // Extract technology from file extensions
  if (entry.files) {
    const techFromFiles = inferTechFromFiles(entry.files)
    for (const tech of techFromFiles) {
      const techId = generateEntityId("technology", tech)
      if (!seen.has(techId)) {
        seen.add(techId)
        entities.push({
          id: techId,
          name: tech,
          type: "technology",
          mention: {
            timestamp: entry.timestamp,
            context: `Inferred from: ${entry.files.slice(0, 3).join(", ")}`,
            source: "L0" as const,
          },
        })
      }
    }
  }

  return entities
}

/**
 * Extract entities from a weekly summary (L1)
 */
export function extractEntitiesFromWeeklySummary(summary: WeeklySummary): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []
  const seen = new Set<string>()
  const sourceId = String(summary.weekStart)

  const textBlocks = [
    summary.summary,
    summary.keyAchievements.join(". "),
    summary.lessonsLearned.join(". "),
    summary.techStack.length > 0 ? `Tech stack: ${summary.techStack.join(", ")}` : "",
    summary.projects.length > 0 ? `Projects: ${summary.projects.join(", ")}` : "",
  ].filter(Boolean)

  const text = textBlocks.join("\n")
  const extracted = extractEntitiesFromText(
    text,
    summary.weekStart,
    "Weekly summary",
    "L1",
    sourceId
  )

  for (const e of extracted) {
    if (!seen.has(e.id)) {
      seen.add(e.id)
      entities.push(e)
    }
  }

  for (const project of summary.projects) {
    if (project.length < 2) continue
    const projectId = generateEntityId("project", project)
    if (seen.has(projectId)) continue
    seen.add(projectId)
    entities.push({
      id: projectId,
      name: project,
      type: "project",
      mention: {
        timestamp: summary.weekStart,
        context: `Project: ${project} - ${summary.summary.slice(0, 80)}`,
        source: "L1",
        sourceId,
      },
    })
  }

  for (const tech of summary.techStack) {
    if (tech.length < 2) continue
    const techId = generateEntityId("technology", tech)
    if (seen.has(techId)) continue
    seen.add(techId)
    entities.push({
      id: techId,
      name: tech,
      type: "technology",
      mention: {
        timestamp: summary.weekStart,
        context: `Tech: ${tech} - ${summary.summary.slice(0, 80)}`,
        source: "L1",
        sourceId,
      },
    })
  }

  return entities
}

/**
 * Infer technologies from file extensions
 */
function inferTechFromFiles(files: string[]): string[] {
  const techMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java",
    ".rb": "Ruby",
    ".swift": "Swift",
    ".kt": "Kotlin",
  }

  const techs = new Set<string>()
  for (const file of files) {
    for (const [ext, tech] of Object.entries(techMap)) {
      if (file.endsWith(ext)) {
        techs.add(tech)
        break
      }
    }
  }

  return Array.from(techs)
}

/**
 * Merge extracted entities into an entity node
 * Creates new node or updates existing
 */
export function mergeIntoEntityNode(
  existing: EntityNode | undefined,
  extracted: ExtractedEntity
): EntityNode {
  if (!existing) {
    return {
      id: extracted.id,
      name: extracted.name,
      type: extracted.type,
      aliases: [],
      aliasConfidence: {},
      mentions: [extracted.mention],
      mentionCount: 1,
      firstSeen: extracted.mention.timestamp,
      lastSeen: extracted.mention.timestamp,
      metadata: {},
    }
  }

  // Update existing node
  const mentions = [...existing.mentions, extracted.mention]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10) // Keep last 10 mentions

  return {
    ...existing,
    mentions,
    mentionCount: existing.mentionCount + 1,
    lastSeen: Math.max(existing.lastSeen, extracted.mention.timestamp),
  }
}
