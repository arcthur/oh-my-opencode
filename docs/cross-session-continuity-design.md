# Cross-Session Continuity: Handoff, Reference & Conditional Rules

## Overview

This document describes three interconnected features for cross-session knowledge continuity:

1. **Session Handoff** - Structured knowledge extraction and transfer between sessions
2. **Session Reference** - Declarative syntax for referencing historical session context
3. **Conditional Rules** - Path-sensitive rule injection based on working context

These features transform Oh-My-OpenCode from a single-session tool into a **continuously learning, context-aware** coding assistant.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Cross-Session Continuity Architecture                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Session A                    Session B                    Session C        │
│   ─────────                    ─────────                    ─────────        │
│   ┌─────────┐                  ┌─────────┐                  ┌─────────┐      │
│   │ Complete│  ──handoff──▶    │  Start  │  ──handoff──▶   │  Start  │      │
│   │ design  │                  │  impl   │                  │  review │      │
│   └─────────┘                  └─────────┘                  └─────────┘      │
│       │                            │                            │            │
│       ▼                            │                            │            │
│   ┌─────────┐                      │                            │            │
│   │Handoff  │◄─────────────────────┼────── @session:~2 ────────┘            │
│   │Package  │                      │                                         │
│   └─────────┘                      │                                         │
│                                    ▼                                         │
│                            ┌─────────────────┐                               │
│                            │Conditional Rules │                              │
│                            │(path-sensitive)  │                              │
│                            └─────────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Motivation

**Problem**: Each new session starts with zero context about previous work. This leads to:

- Re-explaining architecture decisions already made
- Re-discovering failed approaches
- Inconsistent coding patterns across sessions
- Manual context rebuilding via copy-paste

**Solution**: Structured knowledge transfer that preserves:

- **Decisions** - What was chosen and why
- **Artifacts** - What was created or modified
- **Anti-patterns** - What failed and should be avoided
- **Domain knowledge** - Insights about the codebase

### Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Structured over free-form** | Handoff packages have defined schemas, not prose dumps |
| **Compaction-aligned** | Handoff extraction mirrors `compaction-context-injector` structure |
| **Embedding-ready** | All content indexable for semantic retrieval |
| **Lazy extraction** | Handoffs created on-demand or at session idle, not continuously |
| **Declarative reference** | `@session:id` syntax is explicit and parseable |

---

## Part 1: Session Handoff

### Core Concept

A **Handoff Package** is a structured "graduation certificate" for a completed session, containing transferable knowledge for future sessions working on related tasks.

```
Session completes
      │
      ▼
┌─────────────────┐     extract      ┌─────────────────┐
│  Session        │  ────────────▶   │  HandoffPackage │
│  Messages       │                  │  (structured)   │
│  + Tool calls   │                  │                 │
│  + Decisions    │                  │  - decisions[]  │
└─────────────────┘                  │  - artifacts[]  │
                                     │  - antiPatterns[]│
                                     │  - domainContext│
                                     └────────┬────────┘
                                              │
                                    store     │
                                              ▼
                                     ┌─────────────────┐
                                     │ ~/.config/      │
                                     │ opencode/       │
                                     │ oh-my-opencode/ │
                                     │ handoffs/       │
                                     └─────────────────┘
```

### HandoffPackage Schema

```typescript
interface HandoffPackage {
  /** Unique identifier (format: "ho_{timestamp}_{hash}") */
  id: string

  /** Source session ID */
  sourceSessionId: string

  /** Creation timestamp */
  createdAt: number

  /** Expiration timestamp (default: 7 days) */
  expiresAt: number

  /** Package metadata */
  metadata: HandoffMetadata

  /** Knowledge payload */
  payload: HandoffPayload

  /**
   * Embedding index metadata for semantic search (lazy-computed).
   * Vectors are stored separately in `handoffs/embeddings/{id}.bin`.
   */
  embeddingIndex?: EmbeddingIndexEntry[]
}

interface EmbeddingIndexEntry {
  /** Stable identifier for this entry */
  id: string

  /** The embedded content */
  content: string

  /** Category: decision, artifact, antiPattern, domainContext */
  category: "decision" | "artifact" | "antiPattern" | "domainContext"

  /** Index within category */
  index: number

  /** Index into `handoffs/embeddings/{handoffId}.bin` */
  vectorIndex: number
}

interface HandoffMetadata {
  /** Original goal/request from the session */
  originalGoal: string

  /** Session duration in milliseconds */
  durationMs: number

  /** Project path where work occurred */
  projectPath: string

  /** Target intent description (optional, for guided handoffs) */
  targetIntent?: string

  /** Key files involved */
  keyFiles: string[]

  /** Session outcome */
  outcome: "completed" | "partial" | "blocked"
}

interface HandoffPayload {
  /** Key decisions made during the session */
  decisions: Decision[]

  /** Files created or modified */
  artifacts: Artifact[]

  /** Approaches that failed (to prevent re-exploration) */
  antiPatterns: AntiPattern[]

  /** Domain knowledge discovered */
  domainContext: string[]

  /** Remaining tasks (optional, for continuation) */
  remainingTasks?: string[]
}
```

### Decision Schema

Decisions are the most valuable part of a handoff - they capture **why** choices were made.

```typescript
interface Decision {
  /** What decision was made */
  what: string

  /** The chosen approach */
  chosen: string

  /** Rationale for the choice */
  why: string

  /** Alternatives that were considered and rejected */
  rejected?: RejectedAlternative[]

  /** Files affected by this decision */
  relatedFiles?: string[]

  /** Decision category for filtering */
  category?: "architecture" | "implementation" | "tooling" | "convention"
}

interface RejectedAlternative {
  approach: string
  reason: string
}
```

**Example Decision:**

```json
{
  "what": "State management approach for user preferences",
  "chosen": "Zustand with persist middleware",
  "why": "Simpler API than Redux, built-in persistence, good TypeScript support",
  "rejected": [
    { "approach": "Redux Toolkit", "reason": "Overkill for this use case, more boilerplate" },
    { "approach": "React Context", "reason": "No built-in persistence, prop drilling issues" }
  ],
  "relatedFiles": ["src/stores/preferences.ts", "src/hooks/usePreferences.ts"],
  "category": "architecture"
}
```

### Artifact Schema

Artifacts track what files were created or modified, providing a map of changes.

```typescript
interface Artifact {
  /** File path (relative to project root) */
  path: string

  /** Change type */
  changeType: "created" | "modified" | "deleted"

  /** Brief summary of what changed */
  summary: string

  /** Key line ranges with descriptions (optional) */
  lineRanges?: LineRange[]

  /** Dependencies this file introduced or modified */
  dependencies?: string[]
}

interface LineRange {
  start: number
  end: number
  description: string
}
```

### AntiPattern Schema

Anti-patterns prevent future sessions from repeating failed experiments.

```typescript
interface AntiPattern {
  /** The approach that was tried */
  approach: string

  /** Why it failed */
  reason: string

  /** Error signature for matching (optional) */
  errorSignature?: string

  /** Context in which this failed */
  context?: string
}
```

**Example AntiPattern:**

```json
{
  "approach": "Using native fetch for file uploads",
  "reason": "No built-in progress tracking, had to switch to axios",
  "errorSignature": "Cannot read property 'onUploadProgress' of undefined",
  "context": "Large file upload feature in src/components/FileUploader.tsx"
}
```

### Extraction Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Handoff Extraction Flow                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. Trigger (session.idle OR /handoff create)                             │
│     │                                                                     │
│     ▼                                                                     │
│  2. Load session messages (via session-manager)                           │
│     │                                                                     │
│     ▼                                                                     │
│  3. Build extraction context                                              │
│     ├─ Filter to meaningful exchanges (skip noise)                        │
│     ├─ Identify tool calls with significant results                       │
│     └─ Extract file modification events                                   │
│     │                                                                     │
│     ▼                                                                     │
│  4. LLM extraction (using HANDOFF_EXTRACTION_PROMPT)                      │
│     ├─ Model: configurable (default: haiku for cost)                      │
│     ├─ Reuse summarizer session pool from user-memory                     │
│     └─ Circuit breaker for resilience                                     │
│     │                                                                     │
│     ▼                                                                     │
│  5. Parse and validate response                                           │
│     ├─ Zod schema validation                                              │
│     └─ Fallback to metadata-only if LLM fails                             │
│     │                                                                     │
│     ▼                                                                     │
│  6. Generate embedding index (if configured)                              │
│     ├─ Embed decisions, artifacts, antiPatterns separately                │
│     ├─ Use same embedding provider selection as user-memory               │
│     └─ Persist vectors to handoffs/embeddings/*.bin (index stored in JSON)│
│     │                                                                     │
│     ▼                                                                     │
│  7. Store HandoffPackage                                                  │
│     ├─ Save to ~/.config/opencode/oh-my-opencode/handoffs/{id}.json       │
│     ├─ Update handoffs/index.json                                         │
│     └─ Atomic write for safety                                            │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Extraction Prompt

The extraction prompt aligns with `compaction-context-injector` structure but focuses on **cross-session value**:

```typescript
const HANDOFF_EXTRACTION_PROMPT = `
You are extracting transferable knowledge from a completed coding session.

Focus ONLY on information valuable to FUTURE sessions working on RELATED tasks.

## Extraction Guidelines

### Decisions (max 10)
Extract technical decisions with clear rationale.
- Focus on "why" over "what" - code can be re-read, reasoning cannot
- Include rejected alternatives to prevent re-exploration
- Tag with category: architecture | implementation | tooling | convention

### Artifacts (max 20)
List files created/modified with their purpose.
- Include line ranges for significant changes
- Note new dependencies introduced
- Skip trivial changes (typo fixes, formatting)

### Anti-Patterns (critical)
Document approaches that FAILED.
- Include error signatures when available
- Explain why the approach didn't work
- This prevents future sessions from repeating failures

### Domain Context
Capture non-obvious insights about the codebase:
- Component relationships not evident from imports
- Naming conventions and patterns
- Gotchas and quirks
- Performance considerations discovered

## Output Format

Return a JSON object matching the HandoffPayload schema.

## Exclusions

Do NOT include:
- Debugging attempts that were just exploration
- Typo fixes and formatting changes
- Generic programming knowledge
- Information obvious from reading the files
`
```

### Injection Flow

When a new session starts, relevant handoffs are automatically injected:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Handoff Injection Flow                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. Session starts (user.prompt.submit, first message)                    │
│     │                                                                     │
│     ▼                                                                     │
│  2. Find relevant handoffs                                                │
│     ├─ Filter by projectPath (must match current project)                 │
│     ├─ Filter by expiration (skip expired)                                │
│     └─ If initial prompt available: semantic similarity ranking           │
│     │                                                                     │
│     ▼                                                                     │
│  3. Select top N handoffs (default: 3)                                    │
│     │                                                                     │
│     ▼                                                                     │
│  4. Format for injection                                                  │
│     ├─ Prioritize decisions and antiPatterns                              │
│     ├─ Truncate if exceeds token budget                                   │
│     └─ Add source attribution                                             │
│     │                                                                     │
│     ▼                                                                     │
│  5. Inject via hook-message-injector                                      │
│     ├─ Priority: "normal" (after user-memory baseline)                    │
│     └─ Once per session (not per message)                                 │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Injection Format

```markdown
## Previous Session Context

The following context was extracted from recent sessions on this project.

### Session: ho_1706500000_abc123 (2 days ago)
**Goal**: Implement user authentication system

⚠️ **Staleness Warning**: 60% of related files have been modified since this session.
Modified: src/stores/auth.ts, src/api/interceptors.ts
*Some decisions or context may be outdated. Verify before applying.*

**Key Decisions:**
1. **JWT storage**: Chose httpOnly cookies over localStorage
   - Why: XSS protection, automatic inclusion in requests
   - Rejected: localStorage (XSS vulnerable), sessionStorage (no persistence)

2. **Token refresh**: Implemented silent refresh with interceptor
   - Why: Better UX than forcing re-login
   - Related: src/api/interceptors.ts

**Avoid These Approaches:**
- ❌ Storing refresh token in memory: Lost on page reload
- ❌ Using axios instance without interceptor: Refresh logic duplicated

**Domain Knowledge:**
- Auth state lives in src/stores/auth.ts, syncs with cookie on load
- All protected routes check useAuth() hook, not direct store access
```

### Staleness Detection

When injecting handoffs, the system checks if related files have been modified after the handoff was created. This helps prevent outdated decisions from being applied blindly.

**Detection Logic:**
1. Check all `keyFiles` and `artifacts` mentioned in the handoff
2. Use `git log` to get accurate file modification times (falls back to filesystem mtime)
3. Calculate staleness percentage: `modifiedFiles.length / totalFiles.length`

**Staleness Triggers:**
- **>50% files modified** → Mark as stale
- **Handoff >3 days old AND any file modified** → Mark as stale

**Warning Format:**
```markdown
⚠️ **Staleness Warning**: 60% of related files have been modified since this session.
Modified: src/foo.ts, src/bar.ts and 3 more
*Some decisions or context may be outdated. Verify before applying.*
```

This helps the LLM understand that handoff content may be outdated and should be verified against current code.

### Storage Structure

```
~/.config/opencode/oh-my-opencode/
└── handoffs/
    ├── index.json                    # Metadata index for quick lookup
    ├── ho_1706500000_abc123.json     # Individual handoff packages
    ├── ho_1706400000_def456.json
    └── embeddings/
        ├── ho_1706500000_abc123.bin  # Embedding vectors (optional)
        └── ho_1706400000_def456.bin
```

**Index Schema:**

```typescript
interface HandoffIndex {
  /** Schema version */
  version: 1

  /** Indexed handoffs */
  handoffs: HandoffIndexEntry[]

  /** Last cleanup timestamp */
  lastCleanup: number
}

interface HandoffIndexEntry {
  id: string
  sourceSessionId: string
  projectPath: string
  originalGoal: string
  createdAt: number
  expiresAt: number
  outcome: "completed" | "partial" | "blocked"
  decisionCount: number
  artifactCount: number
}
```

### Commands

| Command | Description |
|---------|-------------|
| `/handoff create` | Manually create handoff from current session |
| `/handoff create "description"` | Create with custom description |
| `/handoff list` | List handoffs for current project |
| `/handoff list --all` | List all handoffs across projects |
| `/handoff show <id>` | Display handoff details |
| `/handoff inject <id>` | Manually inject specific handoff |
| `/handoff delete <id>` | Delete a handoff |
| `/handoff cleanup` | Remove expired handoffs |

### Configuration

```typescript
interface SessionHandoffConfig {
  /** Enable session handoff feature */
  enabled: boolean  // default: true

  /** Automatically extract handoff on session idle */
  auto_extract: boolean  // default: true

  /** Automatically inject relevant handoffs on session start */
  auto_inject: boolean  // default: true

  /** Minimum messages for auto-extraction */
  min_messages_for_extract: number  // default: 5

  /** Minimum file modifications for auto-extraction (prevents chat-only sessions) */
  min_file_changes_for_extract: number  // default: 1

  /** Maximum handoffs to inject */
  max_inject_count: number  // default: 3

  /** Handoff expiration in days */
  expiry_days: number  // default: 7

  /** Run extraction asynchronously (non-blocking) */
  async_extraction: boolean  // default: true

  /** Extractor configuration */
  extractor: {
    /** Model for extraction (haiku is cost-effective) */
    model: "haiku" | "sonnet" | "opus"  // default: "haiku"

    /** Maximum decisions to extract */
    max_decisions: number  // default: 10

    /** Maximum artifacts to track */
    max_artifacts: number  // default: 20

    /** Generate embedding index */
    generate_embeddings: boolean  // default: true
  }
}
```

**Configuration location:** `session_handoff` in oh-my-opencode.json

---

## Part 2: Session Reference (@session:id)

### Core Concept

Session Reference provides a **declarative syntax** for explicitly referencing content from previous sessions within prompts.

```
User prompt:
"Based on @session:~1's authentication decisions, implement the logout flow"

System processing:
1. Parse @session:~1 → resolve to most recent session
2. Retrieve relevant content (decisions about authentication)
3. Inject as context before processing prompt
4. Agent sees: prompt + referenced context
```

### Syntax Specification

```
@session:<identifier>[:<query>]

Identifiers:
  @session:abc123          Full session ID
  @session:~1              Most recent session (relative)
  @session:~2              Second most recent session
  @session:latest          Alias for ~1
  @session:handoff:xyz     Direct handoff reference

Queries (optional):
  @session:abc123:decisions      Only decisions
  @session:abc123:artifacts      Only file changes
  @session:abc123:antiPatterns   Only failed approaches
  @session:abc123:context        Only domain knowledge
  @session:abc123:"auth"         Semantic search for "auth"
  @session:abc123:"JWT tokens"   Semantic search phrase
```

### Examples

| Reference | Meaning |
|-----------|---------|
| `@session:~1` | Everything from most recent session |
| `@session:~1:decisions` | Only decisions from most recent |
| `@session:~2:"database"` | Database-related content from 2nd most recent |
| `@session:abc123` | Everything from specific session |
| `@session:handoff:ho_123` | Direct handoff by ID |
| `@session:latest:antiPatterns` | What to avoid from latest session |

### Resolution Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Session Reference Resolution                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Input: "@session:~1:\"authentication\""                                  │
│     │                                                                     │
│     ▼                                                                     │
│  1. Parse reference                                                       │
│     ├─ type: "relative"                                                   │
│     ├─ identifier: "~1"                                                   │
│     └─ query: { type: "semantic", query: "authentication" }               │
│     │                                                                     │
│     ▼                                                                     │
│  2. Resolve identifier                                                    │
│     ├─ List recent sessions for current project                           │
│     ├─ ~1 → sessions[0] → "session_abc123"                                │
│     └─ Check for associated handoff                                       │
│     │                                                                     │
│     ▼                                                                     │
│  3. Choose resolution path                                                │
│     │                                                                     │
│     ├─── Handoff exists? ───┬─── YES ──▶ Resolve from handoff (fast)      │
│     │                       │                                              │
│     │                       └─── NO ───▶ Resolve from session (slower)    │
│     │                                                                     │
│     ▼                                                                     │
│  4. Apply query filter                                                    │
│     ├─ Section filter: return only specified section                      │
│     └─ Semantic filter: embedding search within content                   │
│     │                                                                     │
│     ▼                                                                     │
│  5. Return ResolvedReference                                              │
│     ├─ source: { type, id, timestamp }                                    │
│     ├─ content: { decisions, artifacts, ... }                             │
│     └─ relevanceScore: 0.0-1.0                                            │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### ResolvedReference Schema

```typescript
interface ResolvedReference {
  /** Source information */
  source: {
    type: "session" | "handoff"
    id: string
    timestamp: number
    projectPath: string
  }

  /** Resolved content */
  content: ResolvedContent

  /** Relevance score (0-1) for semantic queries */
  relevanceScore: number
}

interface ResolvedContent {
  /** Summary of the source */
  summary: string

  /** Decisions (filtered by query) */
  decisions?: Decision[]

  /** Artifacts (filtered by query) */
  artifacts?: Artifact[]

  /** Domain context (filtered by query) */
  domainContext?: string[]

  /** Anti-patterns (filtered by query) */
  antiPatterns?: AntiPattern[]

  /** Raw message excerpts (fallback when no handoff) */
  messageExcerpts?: MessageExcerpt[]
}

interface MessageExcerpt {
  role: "user" | "assistant"
  content: string
  timestamp: number
  score: number  // Relevance score for semantic search
}
```

### Resolution Strategies

**Strategy 1: Handoff Resolution (Preferred)**

When a handoff exists for the referenced session:
- Fast: Pre-extracted, structured data
- Complete: All payload sections available
- Searchable: Embedding index for semantic queries

**Strategy 2: Session Resolution (Fallback)**

When no handoff exists:
- Slower: Must process raw messages
- Less structured: Returns message excerpts
- On-demand extraction: Can trigger lazy handoff creation

```typescript
async function resolveSessionReference(
  ref: SessionReference,
  options: ResolveOptions
): Promise<ResolvedReference | null> {

  // 1. Resolve identifier to concrete target
  const target = await resolveIdentifier(ref)
  if (!target) return null

  // 2. Prefer handoff (structured, fast)
  if (target.handoff) {
    return resolveFromHandoff(target.handoff, ref.query, options)
  }

  // 3. Fallback to session messages
  if (options.allowSessionFallback !== false) {
    return resolveFromSession(target.sessionId, ref.query, options)
  }

  // 4. Optionally trigger lazy handoff creation
  if (options.createHandoffIfMissing) {
    const handoff = await extractHandoff(target.sessionId)
    await saveHandoff(handoff)
    return resolveFromHandoff(handoff, ref.query, options)
  }

  return null
}
```

### Semantic Search

When a query like `@session:~1:"authentication"` is used:

```typescript
async function semanticSearchHandoff(
  handoff: HandoffPackage,
  query: string,
  maxResults: number
): Promise<ResolvedContent> {

  // 1. Get or compute embedding index (metadata)
  const index = handoff.embeddingIndex ?? await generateEmbeddingIndex(handoff)

  // 2. Load vectors (or generate + persist if missing)
  const vectors = await loadOrGenerateVectors(handoff, index)

  // 3. Embed the query
  const queryEmbedding = await embed(query)

  // 4. Compute similarities
  const scored = index.map(entry => ({
    ...entry,
    score: cosineSimilarity(queryEmbedding, vectors[entry.vectorIndex])
  }))

  // 5. Filter and sort by relevance
  const relevant = scored
    .filter(e => e.score > 0.3)  // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)

  // 6. Reconstruct content from relevant entries
  return reconstructContent(relevant, handoff)
}
```

**Implementation Note:** In the current implementation, vectors are persisted to
`~/.config/opencode/oh-my-opencode/handoffs/embeddings/{handoffId}.bin` when a handoff is created
(or lazily generated on first semantic query if missing). The handoff JSON stores only the
`embeddingIndex` metadata (`vectorIndex` mapping).

### Hook Integration

> **Implementation Note:** The @session reference parsing is integrated into the session-handoff hook
> rather than being a separate hook. See `src/features/session-handoff/hook.ts`.

```typescript
// Actual implementation in session-handoff/hook.ts user.prompt.submit handler:
"user.prompt.submit": async (input) => {
  const { sessionID, parts } = input
  const promptText = parts?.filter(p => p.type === "text")?.map(p => p.text).join("\n") || ""

  // ... session start and message tracking ...

  // Parse and resolve @session references in prompt
  if (promptText && /@session:/.test(promptText)) {
    const references = parseSessionReferences(promptText)
    if (references.length > 0 && collector) {
      const refContent = references.map(r =>
        `## Referenced Session Context\n\n*From: ${r.original}*\n\n${r.content}`
      ).join("\n\n---\n\n")

      collector.register(sessionID, {
        id: `session-ref-${Date.now()}`,
        source: "session-handoff",
        content: refContent,
        priority: "high",
      })
    }
  }
}
```

### Injection Format

```markdown
## Referenced Session Context

### From session ~1 (2 hours ago): "Implement user authentication"

**Decisions matching "authentication":**

1. **Token storage strategy**
   - Chosen: httpOnly cookies
   - Why: XSS protection, CSRF tokens for additional security
   - Related files: src/middleware/auth.ts, src/utils/cookies.ts

2. **Session management**
   - Chosen: Redis-backed sessions with 24h expiry
   - Why: Scalable across instances, configurable TTL
   - Rejected: In-memory sessions (not scalable)

**Relevant Anti-Patterns:**
- ❌ Storing JWT in localStorage: Vulnerable to XSS attacks

**Domain Knowledge:**
- Auth middleware in src/middleware/auth.ts must run before route handlers
- User model has passwordHash field, never expose in API responses

---
```

### Tool Interface (Future Work)

> **Status:** Not yet implemented. The @session reference syntax works via prompt injection,
> but a dedicated tool for programmatic session reference is planned for future.

Agents could also programmatically reference sessions:

```typescript
// PLANNED - Not yet implemented
const session_reference: ToolDefinition = tool({
  description: `Reference content from previous sessions.

Examples:
  @session:~1              - Most recent session
  @session:~1:decisions    - Only decisions
  @session:abc123:"API"    - Semantic search for "API"

Returns structured content from the referenced session.`,

  args: {
    reference: tool.schema.string()
      .describe('Session reference (e.g., "@session:~1:decisions")'),
    context: tool.schema.string().optional()
      .describe('Additional context for semantic search'),
  },

  execute: async (args) => {
    const ref = parseSessionReference(args.reference)
    if (!ref) {
      return "Invalid reference format. Use @session:<id>[:<query>]"
    }

    // Add context as semantic query if provided
    if (args.context && !ref.query) {
      ref.query = { type: "semantic", query: args.context }
    }

    const resolved = await resolveSessionReference(ref)
    if (!resolved) {
      return "Session not found or no relevant content"
    }

    return formatResolvedForTool(resolved)
  }
})
```

### Configuration

```typescript
interface SessionReferenceConfig {
  /** Enable @session reference syntax */
  enabled: boolean  // default: true

  /** Strip @session references from prompt after resolution */
  strip_from_prompt: boolean  // default: false (keep for context)

  /** Resolution options */
  resolve_options: {
    /** Prefer handoff over raw session */
    prefer_handoff: boolean  // default: true

    /** Fall back to session if handoff missing */
    allow_session_fallback: boolean  // default: true

    /** Create handoff on-demand if missing */
    create_handoff_if_missing: boolean  // default: false

    /** Maximum results for semantic search */
    max_results: number  // default: 5

    /** Minimum relevance score for semantic results */
    min_relevance: number  // default: 0.3
  }
}
```

**Configuration location:** `session_reference` in oh-my-opencode.json

> **Implementation Note:** The configuration is defined in `src/config/schema.ts` as
> `SessionReferenceConfigSchema`. Currently the @session parsing is part of the session-handoff
> hook. The hook honors `session_reference.enabled` and uses `resolve_options.max_results` /
> `resolve_options.min_relevance` for embedding-based semantic search. `strip_from_prompt` and
> session fallback / `create_handoff_if_missing` are still future work.

---

## Part 3: Conditional Rules

### Core Concept

Conditional Rules inject context-sensitive guidance based on the **current working context** - which files are being accessed, which agent is running, what category of task is being performed.

```
Working on src/frontend/components/Button.tsx
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ Rule Matcher evaluates all rules                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Rule: "react-components"                                 │
│   Conditions:                                            │
│     ✓ glob: src/components/**/*.tsx                      │
│     ✓ content: contains "import.*React"                  │
│   → MATCH                                                │
│                                                          │
│ Rule: "typescript-strict"                                │
│   Conditions:                                            │
│     ✓ glob: **/*.ts                                      │
│   → MATCH                                                │
│                                                          │
│ Rule: "backend-api"                                      │
│   Conditions:                                            │
│     ✗ directory: src/api (not matched)                   │
│   → NO MATCH                                             │
│                                                          │
└─────────────────────────────────────────────────────────┘
     │
     ▼
Inject matched rules into context
```

### Rule Sources

Two complementary sources for rules:

**1. Directory-level AGENTS.md files (Amp-style)**
```
project/
├── AGENTS.md                 # Project-wide rules
├── src/
│   ├── AGENTS.md            # Source code rules
│   ├── frontend/
│   │   └── AGENTS.md        # Frontend-specific
│   └── backend/
│       └── AGENTS.md        # Backend-specific
└── tests/
    └── AGENTS.md            # Test file rules
```

**2. Configuration-driven rules**
```json
{
  "conditional_rules": {
    "conditional_rules": [
      {
        "id": "typescript-strict",
        "conditions": [{ "type": "glob", "pattern": "**/*.ts" }],
        "content": "Use strict TypeScript. No 'any' types."
      }
    ]
  }
}
```

### AGENTS.md Format

AGENTS.md files support conditional includes using HTML comments:

```markdown
# Project Guidelines

These rules apply everywhere in this directory and subdirectories.

## General Principles
- Follow existing patterns in the codebase
- Add tests for new functionality

<!-- include: **/*.tsx -->
## React Components

These rules only apply to .tsx files:

- Use functional components with hooks
- Props interfaces must be exported
- Use React.memo for expensive renders
<!-- /include -->

<!-- include: **/*.test.ts -->
## Test Files

These rules only apply to test files:

- Use describe/it structure
- Mock external dependencies
- One assertion per test when possible
<!-- /include -->

<!-- include: src/api/** -->
## API Routes

These rules apply to API route files:

- Validate all inputs with Zod
- Return consistent error format
- Add OpenAPI annotations
<!-- /include -->
```

### AGENTS.md Parsing

```typescript
interface ParsedAgentsMd {
  /** Global rules (no conditions) */
  globalRules: string

  /** Conditional blocks */
  conditionalBlocks: ConditionalBlock[]

  /** Source file path */
  sourcePath: string

  /** Directory depth (for priority) */
  depth: number
}

interface ConditionalBlock {
  /** Glob pattern from include directive */
  pattern: string

  /** Rule content */
  content: string

  /** Line range in source file */
  lineStart: number
  lineEnd: number
}
```

### Rule Schema

```typescript
interface ConditionalRule {
  /** Unique identifier */
  id: string

  /** Human-readable name */
  name: string

  /** Rule source */
  source: RuleSource

  /** Match conditions (ALL must match) */
  conditions: RuleCondition[]

  /** Rule content to inject */
  content: string

  /** Priority (higher = injected first) */
  priority: number

  /** Whether rule is enabled */
  enabled: boolean
}

type RuleSource =
  | { type: "agents-md"; path: string; depth: number }
  | { type: "config"; section: string }
  | { type: "inline" }
```

### Condition Types

```typescript
type RuleCondition =
  | GlobCondition
  | DirectoryCondition
  | ContentCondition
  | ContextCondition

/** Match files by glob pattern */
interface GlobCondition {
  type: "glob"

  /** Glob pattern (e.g., "**/*.tsx", "src/api/**") */
  pattern: string

  /** Match any file (true) or all files (false) */
  matchAny?: boolean  // default: true
}

/** Match by directory path */
interface DirectoryCondition {
  type: "directory"

  /** Directory path relative to project root */
  path: string

  /** Include subdirectories */
  recursive?: boolean  // default: true
}

/** Match by file content */
interface ContentCondition {
  type: "content"

  /** Regex pattern to match in file content */
  pattern: string

  /** Only check files in current context */
  relevantFilesOnly?: boolean  // default: true
}

/** Match by execution context */
interface ContextCondition {
  type: "context"

  /** Context matcher */
  match: ContextMatcher
}

type ContextMatcher =
  | { agent: string }                                    // Specific agent
  | { category: string }                                 // Delegation category
  | { task: "planning" | "implementation" | "review" }   // Task phase
  | { skill: string }                                    // Active skill
```

### Matching Engine

```typescript
class RuleMatcher {
  private rules: ConditionalRule[]
  private globCache: Map<string, RegExp>

  constructor(rules: ConditionalRule[]) {
    // Sort by priority (descending)
    this.rules = [...rules].sort((a, b) => b.priority - a.priority)
    this.globCache = new Map()
  }

  /**
   * Find all rules matching the current context
   */
  match(context: RuleMatchContext): MatchedRule[] {
    const results: MatchedRule[] = []

    for (const rule of this.rules) {
      if (!rule.enabled) continue

      const match = this.matchRule(rule, context)
      if (match) {
        results.push(match)
      }
    }

    return results
  }

  private matchRule(
    rule: ConditionalRule,
    context: RuleMatchContext
  ): MatchedRule | null {
    // ALL conditions must match (AND logic)
    const matchedConditions: RuleCondition[] = []
    const matchedFiles = new Set<string>()

    for (const condition of rule.conditions) {
      const result = this.matchCondition(condition, context)

      if (!result.matched) {
        return null  // Early exit on first non-match
      }

      matchedConditions.push(condition)
      result.files?.forEach(f => matchedFiles.add(f))
    }

    return {
      rule,
      matchedConditions,
      matchedFiles: Array.from(matchedFiles)
    }
  }
}

interface RuleMatchContext {
  /** Files currently being worked on */
  files: string[]

  /** Current working directory */
  cwd: string

  /** Current agent (if any) */
  agent?: string

  /** Current delegation category (if any) */
  category?: string

  /** Current task phase */
  taskPhase?: "planning" | "implementation" | "review"

  /** Active skill (if any) */
  skill?: string
}
```

### Discovery and Loading

```typescript
/**
 * Load all conditional rules from:
 * 1. AGENTS.md files in project tree
 * 2. Configuration file
 */
async function loadAllRules(
  projectRoot: string,
  config: ConditionalRulesConfig
): Promise<ConditionalRule[]> {
  const rules: ConditionalRule[] = []

  // 1. Discover AGENTS.md files
  if (config.agents_md.enabled) {
    const agentsMdFiles = await discoverAgentsMdFiles(
      projectRoot,
      config.agents_md.ignore
    )

    for (const parsed of agentsMdFiles) {
      // Global rules from this AGENTS.md
      if (parsed.globalRules.trim()) {
        rules.push({
          id: `agents-md:${parsed.sourcePath}:global`,
          name: `Global rules from ${basename(dirname(parsed.sourcePath))}`,
          source: { type: "agents-md", path: parsed.sourcePath, depth: parsed.depth },
          conditions: [{
            type: "directory",
            path: dirname(relative(projectRoot, parsed.sourcePath)),
            recursive: true
          }],
          content: parsed.globalRules,
          priority: 100 - parsed.depth,  // Deeper = lower priority
          enabled: true
        })
      }

      // Conditional blocks from this AGENTS.md
      for (const block of parsed.conditionalBlocks) {
        rules.push({
          id: `agents-md:${parsed.sourcePath}:${block.lineStart}`,
          name: `Conditional rules for ${block.pattern}`,
          source: { type: "agents-md", path: parsed.sourcePath, depth: parsed.depth },
          conditions: [
            {
              type: "directory",
              path: dirname(relative(projectRoot, parsed.sourcePath)),
              recursive: true
            },
            {
              type: "glob",
              pattern: block.pattern
            }
          ],
          content: block.content,
          priority: 100 - parsed.depth,
          enabled: true
        })
      }
    }
  }

  // 2. Load config-defined rules
  if (config.conditional_rules) {
    for (const ruleConfig of config.conditional_rules) {
      rules.push({
        ...ruleConfig,
        source: { type: "config", section: "conditional_rules" },
        enabled: ruleConfig.enabled ?? true,
        priority: ruleConfig.priority ?? 0
      })
    }
  }

  return rules
}
```

### Hook Integration

```typescript
export function createConditionalRulesHook(config: ConditionalRulesConfig) {
  let matcher: RuleMatcher | null = null
  let lastLoadTime = 0

  // Reload rules periodically (config may change)
  async function getMatcher(projectRoot: string): Promise<RuleMatcher> {
    const now = Date.now()
    if (!matcher || now - lastLoadTime > 30_000) {
      const rules = await loadAllRules(projectRoot, config)
      matcher = new RuleMatcher(rules)
      lastLoadTime = now
    }
    return matcher
  }

  return {
    name: "conditional-rules",

    // Inject rules before file operations
    "tool.execute.before": async (params) => {
      const { tool, args, sessionId, context } = params

      // Only process file-related tools
      if (!["Read", "Edit", "Write"].includes(tool)) return

      const filePath = args.file_path || args.path
      if (!filePath) return

      const m = await getMatcher(context.cwd)
      const matchContext: RuleMatchContext = {
        files: [relative(context.cwd, filePath)],
        cwd: context.cwd,
        agent: context.agent,
        category: context.category,
        taskPhase: context.taskPhase
      }

      const matched = m.match(matchContext)
      if (matched.length === 0) return

      // Inject matched rules
      const injection = formatRulesForInjection(matched)
      injectHookMessage(sessionId, injection, {
        agent: context.agent || "general",
        priority: "normal"
      })
    },

    // Inject rules into delegated tasks
    "tool.execute.before:delegate_task": async (params) => {
      const { args, sessionId, context } = params
      const { category, prompt } = args

      const m = await getMatcher(context.cwd)

      // Extract file mentions from prompt
      const mentionedFiles = extractFileMentions(prompt)

      const matchContext: RuleMatchContext = {
        files: mentionedFiles,
        cwd: context.cwd,
        category,
        taskPhase: "implementation"
      }

      const matched = m.match(matchContext)
      if (matched.length === 0) return

      // Append rules to delegate prompt
      const rulesContent = formatRulesForDelegation(matched)
      return {
        args: {
          ...args,
          prompt: `${args.prompt}\n\n---\n\n## Applicable Rules\n\n${rulesContent}`
        }
      }
    }
  }
}
```

### Injection Format

When multiple rules match, the injection includes conflict resolution hints:

```markdown
## Applicable Rules

The following rules apply to your current task:

*Multiple rules matched. Conflict resolution guidance:*
*Specificity hint: "React Components" is from a deeper directory and may be more specific to current context.*
*Priority hint: "TypeScript Strict" has highest priority (20). When rules conflict, prefer higher-priority rules.*

### React Components (from src/components/AGENTS.md) [priority: 15]
*Applies to: src/components/Button.tsx*

- Use functional components with hooks
- Props interfaces must be exported
- Use React.memo for expensive renders
- Follow naming: ComponentName.tsx for components

### TypeScript Strict (from config) [priority: 20]
*Applies to: all .ts/.tsx files*

- No 'any' types allowed
- Explicit return types on exported functions
- Use 'unknown' with type guards instead of 'any'

---
```

### Conflict Resolution

When multiple rules match the same context, the system provides guidance:

1. **Priority-based precedence**: Rules are sorted by priority (higher first). When rules conflict, higher-priority rules should be preferred.

2. **Specificity hints**: For AGENTS.md rules, deeper directory rules are considered more specific. A rule from `src/components/AGENTS.md` is more specific than one from `src/AGENTS.md`.

3. **Conflict hints format**:
   - When multiple rules match, a "Conflict resolution guidance" section is added
   - Shows which rule is from a deeper (more specific) directory
   - Shows priority values to help the LLM decide precedence

This allows the LLM to make informed decisions when rules provide conflicting guidance.

### Configuration

```typescript
interface ConditionalRulesConfig {
  /** AGENTS.md discovery settings */
  agents_md: {
    /** Enable AGENTS.md file discovery */
    enabled: boolean  // default: true

    /** Directories to ignore */
    ignore: string[]  // default: ["node_modules", ".git", "dist", "coverage"]
  }

  /** Config-defined rules */
  conditional_rules?: ConfigRule[]
}

interface ConfigRule {
  /** Unique rule ID */
  id: string

  /** Human-readable name */
  name: string

  /** Match conditions */
  conditions: RuleCondition[]

  /** Rule content (string or file reference) */
  content: string | { file: string }

  /** Priority (default: 0) */
  priority?: number

  /** Enabled (default: true) */
  enabled?: boolean
}
```

### Example Configuration

```jsonc
{
  "conditional_rules": {
    "agents_md": {
      "enabled": true,
      "ignore": ["node_modules", ".git", "dist", "coverage", "vendor"]
    },

    "conditional_rules": [
      {
        "id": "typescript-strict",
        "name": "TypeScript Strict Mode",
        "conditions": [
          { "type": "glob", "pattern": "**/*.{ts,tsx}" }
        ],
        "content": "- Use strict TypeScript\n- No 'any' types\n- Explicit return types on exports",
        "priority": 10
      },
      {
        "id": "react-hooks",
        "name": "React Hooks Guidelines",
        "conditions": [
          { "type": "glob", "pattern": "src/**/*.tsx" },
          { "type": "content", "pattern": "use[A-Z]\\w+\\(" }
        ],
        "content": { "file": ".opencode/rules/react-hooks.md" },
        "priority": 20
      },
      {
        "id": "api-validation",
        "name": "API Input Validation",
        "conditions": [
          { "type": "directory", "path": "src/api" },
          { "type": "context", "match": { "category": "backend" } }
        ],
        "content": "- Validate ALL inputs with Zod\n- Return RFC 7807 error format\n- Log validation failures",
        "priority": 25
      },
      {
        "id": "test-patterns",
        "name": "Test File Standards",
        "conditions": [
          { "type": "glob", "pattern": "**/*.{test,spec}.{ts,tsx}" }
        ],
        "content": "- Use describe/it structure\n- One assertion per test\n- Mock external dependencies\n- Test edge cases explicitly",
        "priority": 15
      }
    ]
  }
}
```

---

## Integration Architecture

### Module Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Integration Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │ Session Handoff  │───────────────────▶│ Session Reference│               │
│  │                  │   provides data    │ (@session:id)    │               │
│  │ - extractor      │                    │                  │               │
│  │ - storage        │                    │ - parser         │               │
│  │ - inject hook    │                    │ - resolver       │               │
│  └────────┬─────────┘                    │ - inject hook    │               │
│           │                              └────────┬─────────┘               │
│           │                                       │                          │
│           │   ┌───────────────────────────────────┘                          │
│           │   │                                                              │
│           ▼   ▼                                                              │
│  ┌─────────────────────────────────────────────────────────┐                │
│  │                 Shared Infrastructure                    │                │
│  │                                                          │                │
│  │  ┌─────────────────┐  ┌─────────────────┐               │                │
│  │  │   user-memory   │  │ session-manager │               │                │
│  │  │   (embeddings)  │  │ (messages, info)│               │                │
│  │  └─────────────────┘  └─────────────────┘               │                │
│  │                                                          │                │
│  │  ┌─────────────────┐  ┌─────────────────┐               │                │
│  │  │  summarizer     │  │hook-message-    │               │                │
│  │  │  (LLM calls)    │  │injector         │               │                │
│  │  └─────────────────┘  └─────────────────┘               │                │
│  │                                                          │                │
│  │  ┌─────────────────────────────────────────────────────┐│                │
│  │  │         session-state-coordinator                    ││                │
│  │  │         (lifecycle events)                           ││                │
│  │  └─────────────────────────────────────────────────────┘│                │
│  └─────────────────────────────────────────────────────────┘                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────┐               │
│  │                  Conditional Rules                        │               │
│  │                                                           │               │
│  │  ┌─────────────────┐  ┌─────────────────┐                │               │
│  │  │  AGENTS.md      │  │  Config Rules   │                │               │
│  │  │  Parser         │  │  (JSON/JSONC)   │                │               │
│  │  └────────┬────────┘  └────────┬────────┘                │               │
│  │           │                    │                          │               │
│  │           ▼                    ▼                          │               │
│  │  ┌─────────────────────────────────────────┐             │               │
│  │  │          Rule Matcher Engine            │             │               │
│  │  │          (glob, content, context)       │             │               │
│  │  └─────────────────────────────────────────┘             │               │
│  └──────────────────────────────────────────────────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Complete Data Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SESSION END                                                                 │
│  ──────────                                                                  │
│                                                                              │
│  Session Messages ──▶ Handoff Extractor ──▶ HandoffPackage ──▶ Storage      │
│                              │                     │                         │
│                              ▼                     ▼                         │
│                       LLM Summarizer         Embedding Index                 │
│                                                                              │
│  ═══════════════════════════════════════════════════════════════════════    │
│                                                                              │
│  SESSION START                                                               │
│  ─────────────                                                               │
│                                                                              │
│  User Prompt ──┬──▶ @session Parser ──▶ Reference Resolver ──┬──▶ Inject    │
│                │                                              │              │
│                ├──▶ Handoff Finder ──▶ Relevant Handoffs ─────┘              │
│                │         │                                                   │
│                │         ▼                                                   │
│                │    Project Filter                                           │
│                │    Semantic Ranking                                         │
│                │                                                             │
│                └──▶ Rule Matcher ──▶ Matched Rules ──────────────▶ Inject   │
│                         │                                                    │
│                         ▼                                                    │
│                   AGENTS.md Discovery                                        │
│                   Config Rules Load                                          │
│                                                                              │
│  ═══════════════════════════════════════════════════════════════════════    │
│                                                                              │
│  DURING SESSION (file operations)                                            │
│  ────────────────────────────────                                            │
│                                                                              │
│  Tool Call (Edit/Read) ──▶ Rule Matcher ──▶ Context Rules ──▶ Inject        │
│         │                       │                                            │
│         ▼                       ▼                                            │
│    File Path              Match Context                                      │
│                           (files, agent,                                     │
│                            category)                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hook Execution Order

```
user.prompt.submit (first message)
    │
    ├─1─▶ user-memory hook (baseline injection)
    │
    └─2─▶ session-handoff hook (auto-inject + resolve @session references)

tool.execute.before (Edit/Read/Write)
    │
    └─1─▶ conditional-rules hook (file-specific rules)

tool.execute.before:delegate_task
    │
    └─1─▶ conditional-rules hook (append rules to delegation prompt)

session.idle (primary)
    │
    └─1─▶ session-handoff hook (extract and store handoff)

session.deleted (fallback)
    │
    └─1─▶ session-handoff hook (extract if needed, cleanup)
```

---

## Configuration Summary

### Complete Configuration Example

```jsonc
// .opencode/oh-my-opencode.json
{
  // ═══════════════════════════════════════════════════════════════════
  // Session Handoff Configuration
  // ═══════════════════════════════════════════════════════════════════
  "session_handoff": {
    "enabled": true,
    "auto_extract": true,
    "auto_inject": true,
    "min_messages_for_extract": 5,
    "max_inject_count": 3,
    "expiry_days": 7,
    "extractor": {
      "model": "haiku",
      "max_decisions": 10,
      "max_artifacts": 20,
      "generate_embeddings": true
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Session Reference Configuration
  // ═══════════════════════════════════════════════════════════════════
  "session_reference": {
    "enabled": true,
    "strip_from_prompt": false,
    "resolve_options": {
      "prefer_handoff": true,
      "allow_session_fallback": true,
      "create_handoff_if_missing": false,
      "max_results": 5,
      "min_relevance": 0.3
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // Conditional Rules Configuration
  // ═══════════════════════════════════════════════════════════════════
  "conditional_rules": {
    "agents_md": {
      "enabled": true,
      "ignore": ["node_modules", ".git", "dist", "coverage"]
    },

    "conditional_rules": [
      {
        "id": "typescript-strict",
        "name": "TypeScript Strict Mode",
        "conditions": [
          { "type": "glob", "pattern": "**/*.{ts,tsx}" }
        ],
        "content": "- Use strict TypeScript, no 'any' types\n- Explicit return types on exported functions",
        "priority": 10
      },
      {
        "id": "react-components",
        "name": "React Component Standards",
        "conditions": [
          { "type": "glob", "pattern": "src/components/**/*.tsx" }
        ],
        "content": { "file": ".opencode/rules/react.md" },
        "priority": 20
      }
    ]
  }
}
```

### Default Values

| Setting | Default | Description |
|---------|---------|-------------|
| `session_handoff.enabled` | `true` | Enable handoff feature |
| `session_handoff.auto_extract` | `true` | Extract on session idle |
| `session_handoff.auto_inject` | `true` | Inject on session start |
| `session_handoff.min_messages_for_extract` | `5` | Min messages to trigger |
| `session_handoff.max_inject_count` | `3` | Max handoffs to inject |
| `session_handoff.expiry_days` | `7` | Days until expiration |
| `session_handoff.extractor.model` | `"haiku"` | Extraction model |
| `session_reference.enabled` | `true` | Enable @session syntax |
| `session_reference.strip_from_prompt` | `false` | Remove refs after resolution |
| `session_reference.resolve_options.max_results` | `5` | Semantic search limit |
| `conditional_rules.agents_md.enabled` | `true` | Discover AGENTS.md files |

---

## Implementation Priority

| Phase | Feature | Rationale | Dependencies |
|-------|---------|-----------|--------------|
| **P0** | Conditional Rules | Most independent, immediate value | config schema |
| **P1** | Session Handoff | Foundation for references | user-memory embeddings |
| **P2** | Session Reference | Requires handoff data | handoff + session-manager |

### P0: Conditional Rules (1-2 weeks)

1. ✅ AGENTS.md parser with conditional includes
2. ✅ Config schema for rules
3. ✅ Rule matcher engine
4. ✅ Hook for file operations
5. ✅ Hook for delegate_task

### P1: Session Handoff (2-3 weeks)

1. ✅ HandoffPackage types and schemas
2. ✅ Extraction prompt and LLM integration (with circuit breaker)
3. ✅ Storage layer (index + packages)
4. ✅ Session end hook for extraction
5. ✅ Session start hook for injection
6. ✅ CLI commands (as /handoff builtin skill)

### P2: Session Reference (1-2 weeks)

1. ✅ Reference syntax parser (in session-handoff/hook.ts)
2. ✅ Identifier resolver (in session-handoff/injector.ts)
3. ✅ Semantic search integration (embedding-based; falls back when embeddings unavailable)
4. ✅ Hook for prompt processing (in user.prompt.submit)
5. ❌ Tool interface (future work - not yet implemented)

---

## File Structure

```
src/features/
├── session-handoff/
│   ├── index.ts              # Public exports
│   ├── types.ts              # HandoffPackage, Decision, SessionReference types
│   ├── extractor.ts          # Extraction logic + prompts + zod schemas
│   ├── storage.ts            # Load/save/index
│   ├── embeddings.ts         # Embedding index build + similarity
│   ├── injector.ts           # Injection content generation + @session resolver
│   ├── hook.ts               # Session lifecycle hooks + @session parsing
│   └── summarizer.ts         # LLM integration with circuit breaker
│
│   # Note: Session Reference functionality is integrated into session-handoff
│   # rather than being a separate module. The @session:id syntax parsing
│   # and resolution is handled in hook.ts and injector.ts.
│   # CLI commands are implemented as a builtin skill (/handoff).
│
└── conditional-rules/
    ├── index.ts              # Public exports
    ├── types.ts              # ConditionalRule, RuleCondition
    ├── agents-md-parser.ts   # AGENTS.md parsing
    ├── matcher.ts            # Rule matching engine
    ├── loader.ts             # Discovery and loading
    └── hook.ts               # Injection hooks
```

### Implementation Notes

**Session Reference Integration:**
- Originally planned as a separate `session-reference/` module
- Merged into `session-handoff/` for simplicity since they share data structures
- `@session:id` syntax parsing in `hook.ts:parseSessionReferences()`
- Resolution logic in `injector.ts:resolveSessionReference()`
- Auto-parsing enabled in `user.prompt.submit` hook

**CLI Commands:**
- Implemented as builtin skill `/handoff` rather than separate commands.ts
- Located in `src/features/builtin-skills/skills.ts`

**Future: session_reference Tool:**
- Tool interface for programmatic session reference not yet implemented
- Can be added to allow agents to explicitly query session history

---

## Known Limitations

### Session Handoff

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| LLM extraction cost | Each session idle may incur API cost | Use haiku model, skip short sessions |
| Extraction quality | Depends on LLM's understanding | Structured prompt, fallback to metadata |
| Storage growth | Handoffs accumulate over time | Auto-expiry, cleanup command |
| Cross-project isolation | Handoffs filtered by project path | Could miss related work in different paths |

### Session Reference

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Missing handoff | Fallback to raw messages is slower | Option to create handoff on-demand |
| Semantic search accuracy | Depends on embedding quality | Hybrid search with BM25 |
| Reference in code blocks | May be incorrectly parsed | Context-aware parsing |
| Multiple references | Order may matter | Process in order, deduplicate |

### Conditional Rules

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Content matching cost | Reading files is slow | Cache, only check relevant files |
| Rule conflicts | Multiple rules may contradict | Priority ordering, last-wins |
| AGENTS.md discovery | May miss deeply nested files | Configurable depth limit |
| Glob performance | Complex patterns are slow | Cache compiled regexes |

---

## Testing Strategy

### Unit Tests

```bash
# Session Handoff
bun test src/features/session-handoff/

# Session Reference
bun test src/features/session-reference/

# Conditional Rules
bun test src/features/conditional-rules/
```

### Key Test Scenarios

**Session Handoff:**
- Extraction from various session types
- Fallback when LLM unavailable
- Storage persistence and retrieval
- Expiration and cleanup
- Embedding generation

**Session Reference:**
- Syntax parsing (all identifier types)
- Resolution priority (handoff vs session)
- Semantic search relevance
- Multiple references in one prompt
- Invalid reference handling

**Conditional Rules:**
- AGENTS.md parsing with conditionals
- Config rule loading
- Glob matching edge cases
- Content matching with regex
- Context condition matching
- Priority ordering

---

## Future Considerations

### Team Sharing (Future)

```typescript
// Potential future extension
interface SharedHandoff extends HandoffPackage {
  visibility: "private" | "team" | "public"
  sharedBy: string
  sharedAt: number
}
```

### Cross-Project References (Future)

```
@session:project:other-repo:~1
```

### Rule Inheritance (Future)

```markdown
<!-- extends: ../AGENTS.md -->
## Additional rules for this directory
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | TBD | Initial design document |
