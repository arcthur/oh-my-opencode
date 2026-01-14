# User Memory: RAPTOR-style Hierarchical Memory

## Overview

User Memory implements a **RAPTOR-inspired** (Recursive Abstractive Processing for Tree-Organized Retrieval) hierarchical memory system that enables long-term knowledge retention across sessions.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Memory Hierarchy                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  L3: LongTermKnowledge[]     │ Permanent │ Distilled insights, patterns     │
│      (max 50 entries)        │           │ Extracted quarterly              │
├──────────────────────────────┼───────────┼──────────────────────────────────┤
│  L2: MonthlySummary[]        │ ~1 year   │ Monthly work overview            │
│      (max 12 months)         │           │ Aggregated at month boundary     │
├──────────────────────────────┼───────────┼──────────────────────────────────┤
│  L1: WeeklySummary[]         │ ~3 months │ Weekly progress snapshots        │
│      (max 12 weeks)          │           │ Aggregated at week boundary      │
├──────────────────────────────┼───────────┼──────────────────────────────────┤
│  L0: WorkHistoryEntry[]      │ ~7 days   │ Raw session summaries            │
│      (max 50 entries)        │           │ Captured on session.summarized   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌──────────────┐    session.summarized    ┌──────────────┐
│   Session    │ ───────────────────────► │ WorkHistory  │ (L0)
│   Summary    │                          │   Entry      │
└──────────────┘                          └──────┬───────┘
                                                 │
                                                 │ crossedWeekBoundary?
                                                 ▼
                                          ┌──────────────┐
                                          │   Weekly     │ (L1)
                                          │   Summary    │
                                          └──────┬───────┘
                                                 │
                                                 │ crossedMonthBoundary?
                                                 ▼
                                          ┌──────────────┐
                                          │   Monthly    │ (L2)
                                          │   Summary    │
                                          └──────┬───────┘
                                                 │
                                                 │ crossedKnowledgeBoundary?
                                                 │ (every 3 months)
                                                 ▼
                                          ┌──────────────┐
                                          │  Long-term   │ (L3)
                                          │  Knowledge   │
                                          └──────────────┘
```

## Complete Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SESSION LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐                                                           │
│  │ Session Start│                                                           │
│  └──────┬───────┘                                                           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐    tool.execute.after    ┌──────────────┐                │
│  │ First Tool   │ ───────────────────────► │ Inject Memory│                │
│  │    Use       │                          │  (once/session)               │
│  └──────────────┘                          └──────────────┘                │
│         │                                         │                         │
│         │                                         ▼                         │
│         │                                  getMemorySummary()               │
│         │                                  L3→L2→L1→L0 priority             │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │   Session    │                                                           │
│  │   Working    │ ◄─── user.prompt.submit ─── detect "remember X"          │
│  └──────┬───────┘                              → addExplicitMemory()        │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐    session.summarized    ┌──────────────┐                │
│  │   Session    │ ───────────────────────► │    Add L0    │                │
│  │  Compaction  │                          │ WorkHistory  │                │
│  └──────┬───────┘                          └──────┬───────┘                │
│         │                                         │                         │
│         │ session.compacted                       │                         │
│         │ session.deleted                         │                         │
│         ▼                                         ▼                         │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │                    triggerAggregation()                      │           │
│  ├─────────────────────────────────────────────────────────────┤           │
│  │  1. Check: lastWeeklyAggregation undefined?                  │           │
│  │     → Yes: Initialize timestamps, return (skip this time)    │           │
│  │                                                              │           │
│  │  2. Check: crossedWeekBoundary?                              │           │
│  │     → Yes: Loop ALL missed weeks, aggregate L0→L1            │           │
│  │            Clean workHistory (keep current week only)        │           │
│  │                                                              │           │
│  │  3. Check: crossedMonthBoundary?                             │           │
│  │     → Yes: Loop ALL missed months, aggregate L1→L2           │           │
│  │                                                              │           │
│  │  4. Check: crossedKnowledgeBoundary? (every 3 months)        │           │
│  │     → Yes: Extract L2→L3, cluster & merge knowledge          │           │
│  │                                                              │           │
│  │  5. Save if any changes detected                             │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Trigger Points

Aggregation is triggered on these events:

| Event | Action |
|-------|--------|
| `session.summarized` | Add WorkHistoryEntry (L0), then trigger aggregation |
| `session.deleted` | Trigger aggregation only |
| `session.compacted` | Trigger aggregation only |

**Note**: `session.summarized` is fired when the session summary is generated (during compaction). This is when work history is captured.

## Boundary Detection

### Week Boundary (ISO Week: Monday-Sunday)

```typescript
function crossedWeekBoundary(lastAggregation: number | undefined, now: number): boolean {
  if (!lastAggregation) return false  // New user, skip until initialized
  const lastWeekStart = getWeekStart(lastAggregation)
  const currentWeekStart = getWeekStart(now)
  return currentWeekStart > lastWeekStart
}
```

**Key behavior**: Returns `false` if `lastAggregation` is undefined. This prevents premature aggregation for new users before timestamps are initialized.

### Month Boundary

```typescript
function crossedMonthBoundary(lastAggregation: number | undefined, now: number): boolean {
  if (!lastAggregation) return false
  return formatMonth(lastAggregation) !== formatMonth(now)  // "YYYY-MM" comparison
}
```

### Knowledge Extraction Boundary

```typescript
function crossedKnowledgeExtractionBoundary(
  lastExtraction: number | undefined,
  now: number,
  intervalMonths: number = 3
): boolean {
  if (!lastExtraction) return false
  const monthsSince = (now - lastExtraction) / (30 * 24 * 60 * 60 * 1000)
  return monthsSince >= intervalMonths
}
```

## Multi-Period Gap Handling

**Critical design decision**: When users skip multiple periods (e.g., 2 weeks vacation), ALL intermediate periods are aggregated, not just the last one.

### Weekly Gap Example

```
User last active: Jan 6 (Week 1)
User returns: Jan 20 (Week 3)

Old behavior (BUG):
  - Only aggregates Week 1
  - Week 2 data LOST

New behavior (CORRECT):
  - Loop: Week 1 → Week 2 → stop at Week 3
  - Both Week 1 and Week 2 aggregated
  - No data loss
```

### Implementation

```typescript
// L0 → L1: Aggregate ALL missed weeks
if (crossedWeekBoundary(lastWeeklyAggregation, now)) {
  const currentWeekStart = getWeekStart(now)
  let iterWeekStart = getWeekStart(lastWeeklyAggregation)

  while (iterWeekStart < currentWeekStart) {
    const iterWeekEnd = getWeekEnd(iterWeekStart)
    const weeklySummary = await aggregateToWeekly(workHistory, iterWeekStart, iterWeekEnd, summarize)

    if (weeklySummary.entryCount > 0) {
      weeklySummaries.unshift(weeklySummary)
    }

    // DST-safe: recalculate week start instead of adding milliseconds
    const nextWeekApprox = iterWeekStart + 7 * 24 * 60 * 60 * 1000
    iterWeekStart = getWeekStart(nextWeekApprox)
  }

  // Clean up: keep only current week's entries
  workHistory = workHistory.filter(e => e.timestamp >= currentWeekStart)

  // Update timestamp AFTER all aggregations complete
  lastWeeklyAggregation = now
}
```

**DST handling**: Simple `+7 days` in milliseconds can land on wrong time during DST transitions (23:00 or 01:00 instead of 00:00). Using `getWeekStart()` ensures we always land on Monday 00:00:00 local time.

## Summarization Strategy

### LLM Summarization

When available, LLM generates rich summaries with:
- Summary text
- Key achievements
- Lessons learned
- Tech stack evolution (monthly)

### Fallback Strategy

When LLM returns empty/invalid response OR throws error:

```typescript
const createFallbackSummary = (): WeeklySummary => ({
  summary: `Completed ${entries.length} work sessions across ${projects.length} project(s).`,
  projects,
  keyAchievements: entries
    .filter(e => e.outcome === "success")
    .slice(0, 3)
    .map(e => e.summary),
  lessonsLearned: [],
  techStack,
  entryCount: entries.length,
})

// Check for empty LLM response
if (!response.summary || response.summary.trim().length === 0) {
  return createFallbackSummary()  // Use fallback instead of empty string
}
```

**Key insight**: Empty string check is critical because fallback summarizer returns `{ summary: "" }` which doesn't throw an error.

## Knowledge Extraction (L2 → L3)

### Clustering Algorithm

Similar lessons are clustered using word overlap:

```typescript
function clusterSimilarLessons(lessons: Array<{content: string, month: string}>): LessonCluster[] {
  const threshold = 0.4  // 40% word overlap

  for (const lesson of lessons) {
    const words = new Set(lesson.content.toLowerCase().split(/\s+/).filter(w => w.length > 3))

    // Find matching cluster
    for (const cluster of clusters) {
      const similarity = calculateWordOverlap(words, cluster.words)
      if (similarity >= threshold) {
        cluster.occurrences++
        cluster.lastMonth = lesson.month
        // Keep longer content as representative
        if (lesson.content.length > cluster.representativeContent.length) {
          cluster.representativeContent = lesson.content
        }
        break
      }
    }
  }
}
```

### Confidence Scoring

Two-stage filtering ensures only **stable cross-month patterns** are retained:

**Stage 1: Extraction Threshold** (in `extractLongTermKnowledge`)
```typescript
// Must appear in at least 2 DIFFERENT months to be extracted
// This filters out single-month noise
const stablePatterns = clusters.filter(c => c.months.length >= 2)
```

**Stage 2: Injection Threshold** (in `getMemorySummary`)
```typescript
// Must have confidence >= 0.6 to be injected
const highConfidenceKnowledge = memory.longTermKnowledge?.filter(k => k.confidence >= 0.6)
```

**Confidence formula** (based on unique months, NOT total occurrences):
```typescript
confidence = Math.min(months.length / 5, 1.0)  // Based on unique months
```

**Practical implication**:
| Unique Months | Confidence | Extracted? | Injected? |
|---------------|------------|------------|-----------|
| 1 | 0.2 | No | No |
| 2 | 0.4 | Yes | No |
| 3 | 0.6 | Yes | Yes |
| 4 | 0.8 | Yes | Yes |
| 5+ | 1.0 | Yes | Yes |

**Key insight**: A lesson must appear in at least **3 different months** to be injected. Same-month repetitions do NOT increase confidence - this ensures we capture stable long-term patterns, not temporary noise.

### Knowledge Categories

```typescript
type Category = "lesson" | "pattern" | "preference" | "skill"

function categorizeKnowledge(content: string): Category {
  const lower = content.toLowerCase()
  if (lower.includes("prefer") || lower.includes("style")) return "preference"
  if (lower.includes("pattern") || lower.includes("approach")) return "pattern"
  if (lower.includes("learned") || lower.includes("skill")) return "skill"
  return "lesson"
}
```

## Injection Strategy

Memory is injected into context with priority ordering (matches code in `getMemorySummary`):

```
[User Memory - Hierarchical Context]

## User Rules                    ← Highest priority: explicit user rules
- ...

## Remembered Context            ← Explicit "remember X" requests (last 10)
- ...

## Long-term Learnings           ← L3: High-confidence knowledge (≥0.6, max 5)
- [lesson] ...
- [pattern] ...

## Last Month (2025-01)          ← L2: Most recent month only
...
Projects: proj-a, proj-b, proj-c (max 3)

## This Week                     ← L1: Most recent week only
...
Key: achievement1; achievement2 (max 2)

## User Preferences              ← Static preferences
- key: value

## Environment                   ← OS, Shell, Editor
OS: darwin, Shell: zsh, Editor: vscode

## Recent Work                   ← L0: Only if NO weekly summary exists
- [date] summary (project)       (max 3 entries)

## Frequent Operations           ← Tool usage patterns (max 10)
- Read: src/features/* (15 uses)

[End User Memory]
```

**Key designs**:
1. L0 (Recent Work) is only shown when L1 (Weekly Summary) doesn't exist, avoiding redundancy
2. L3 limited to 5 entries to control token usage
3. L2/L1 only show the most recent period (not all stored summaries)

## Timestamp Initialization

### For New Users

```typescript
// In hook.ts - triggerAggregation
if (!memory.lastWeeklyAggregation && memory.workHistory.length > 0) {
  // Initialize timestamps to NOW
  // This prevents immediate aggregation of first entry
  memory.lastWeeklyAggregation = now
  memory.lastMonthlyAggregation = now
  memory.lastKnowledgeExtraction = now
  return  // Skip aggregation this time
}
```

### For Migrated Users (v1 → v2)

```typescript
// In storage.ts - migrateUserMemory
if ((data.schemaVersion === undefined || data.schemaVersion === 1) && workHistory.length > 0) {
  // Set timestamps to NOW to avoid retroactive aggregation
  migrated.lastWeeklyAggregation = now
  migrated.lastMonthlyAggregation = now
  migrated.lastKnowledgeExtraction = now
}
```

## Configuration

```typescript
interface HierarchicalMemoryConfig {
  enabled: boolean                    // Default: true
  weekly_summaries_limit: number      // Default: 12 (3 months)
  monthly_summaries_limit: number     // Default: 12 (1 year)
  long_term_knowledge_limit: number   // Default: 50
  aggregation_model: "haiku" | "sonnet" | "opus"  // Default: haiku
  auto_aggregate: boolean             // Default: true
}
```

## Storage

All memory is stored in `~/.opencode/memory/`:

```
~/.opencode/memory/
├── user.json          # Main memory file (UserMemory)
└── pattern-stats.json # Tool usage patterns (PatternStats)
```

### Atomic Write

File writes use atomic write pattern to prevent corruption:

```typescript
function atomicWriteFileSync(filePath: string, content: string): void {
  const tempPath = filePath + ".tmp"
  writeFileSync(tempPath, content, "utf-8")
  renameSync(tempPath, filePath)  // rename is atomic on POSIX systems
}
```

This prevents:
- Partial writes on crash/interrupt
- Corrupted JSON from concurrent writes (last-write-wins, but always valid JSON)

**Note**: This does not provide file locking. Multiple processes may still overwrite each other's changes, but the file will never be corrupted.

## Schema Migration

Current schema version: **2**

| Version | Changes |
|---------|---------|
| 1 | Original: preferences, workHistory, customRules, etc. |
| 2 | Added RAPTOR fields: weeklySummaries, monthlySummaries, longTermKnowledge, timestamps |

Migration is automatic and non-destructive.

## Edge Cases

### Cross-Month Week

When a week spans two months (e.g., Jan 27 - Feb 2):

```typescript
// Week is assigned to the month of its START date
const monthWeeks = weeklySummaries.filter(w => formatMonth(w.weekStart) === month)
```

This week would be assigned to January.

### Week Entry Filtering

Entries are filtered using inclusive bounds:

```typescript
// In aggregateToWeekly
const weekEntries = entries.filter(
  (e) => e.timestamp >= weekStart && e.timestamp <= weekEnd  // Note: <= not <
)
```

**Why `<=`**: `weekEnd` is Sunday 23:59:59.999. Using `<` would exclude entries at exactly that millisecond. Using `<=` ensures the boundary is inclusive.

### Empty Weeks/Months

Empty periods (no work entries) are NOT added to summaries:

```typescript
if (weeklySummary.entryCount > 0) {
  weeklySummaries.unshift(weeklySummary)
}
```

### Concurrent Access

A flag prevents concurrent aggregations within the same process:

```typescript
let aggregationInProgress = false

const triggerAggregation = async () => {
  if (aggregationInProgress) return
  aggregationInProgress = true
  try {
    // ... aggregation logic
  } finally {
    aggregationInProgress = false
  }
}
```

**Note**: This does not protect against multi-process concurrent access (e.g., multiple terminal windows).

## Testing

Key test scenarios:

1. **Multi-week gap**: Verify all intermediate weeks are aggregated
2. **Empty summarizer response**: Verify fallback is used
3. **Multi-month gap**: Verify all intermediate months are aggregated
4. **Boundary detection**: Verify week/month boundaries are correctly identified
5. **Knowledge clustering**: Verify similar lessons are merged

Run tests:
```bash
bun test src/features/user-memory/
```

## File Structure

```
src/features/user-memory/
├── types.ts           # Type definitions, defaults, schema version
├── storage.ts         # Load/save, migration, injection
├── aggregation.ts     # Core RAPTOR algorithms
├── prompts.ts         # LLM prompt templates
├── hook.ts            # Event handlers, trigger logic
├── index.ts           # Public exports
└── aggregation.test.ts # Test suite
```
