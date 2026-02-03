# Cartography: Intelligent Code Map Generation System

Cartography is an automated documentation generation system that analyzes codebase structure, patterns, and dependencies to generate hierarchical `codemap.md` files, enabling AI assistants and developers to quickly understand codebase architecture.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Command Reference](#command-reference)
- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [Output Format](#output-format)
- [Automatic Context Injection](#automatic-context-injection)
- [Session Handoff Integration](#session-handoff-integration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

## Overview

### Problem Statement

In large codebases, AI assistants often spend significant time exploring code structure before understanding context. Cartography addresses these challenges through pre-generated structured code maps:

- **Insufficient Context**: AI lacks understanding of overall codebase architecture
- **High Exploration Cost**: Each session requires re-exploration of code structure
- **Knowledge Loss**: Architectural understanding cannot be preserved across sessions
- **Navigation Difficulty**: Uncertainty about where to find relevant code

### Core Features

| Feature | Description |
|---------|-------------|
| **Intelligent Scoring** | Automatically determines which directories warrant codemaps based on complexity |
| **Incremental Updates** | Only updates changed directories, efficiently conserving resources |
| **Auto-Injection** | Automatically injects relevant codemap context when reading files |
| **Session Persistence** | Preserves architectural knowledge across sessions via handoff mechanism |
| **Multi-Source Analysis** | Combines static analysis and pattern detection (Explorer deep analysis is currently stubbed) |

## Quick Start

### Initialize Code Maps

```bash
# Full initialization - generate codemaps for entire project
/cartography init

# Check which directories have changes
/cartography changes

# Update changed directories only
/cartography update
```

### Generated Files

After initialization, your project will contain:

```
your-project/
├── codemap.md          # Root codemap (project overview)
├── atlas.md            # Project map index
├── src/
│   ├── codemap.md      # src directory codemap
│   ├── features/
│   │   └── codemap.md  # features directory codemap
│   └── hooks/
│       └── codemap.md  # hooks directory codemap
└── .opencode/
    └── cartography.json  # State file (hashes, metadata)
```

## Command Reference

### `/cartography`

Default mode, equivalent to `/cartography update`.

### `/cartography init`

Full initialization, generates codemaps for all qualifying directories.

**Options:**
- `--force`: Ignore hashes, force regeneration of all codemaps
- `--max-depth=N`: Limit directory depth (default: 4)

**Examples:**
```bash
/cartography init --max-depth=3
/cartography init --force
```

### `/cartography update`

Incremental update, only regenerates codemaps for changed directories.

**Example:**
```bash
/cartography update
```

### `/cartography changes`

Reports which directories have changes without actually generating. Useful for previewing update scope.

**Example Output:**
```
Change Report:
- Changed: src/features/auth (5 files modified)
- New: src/features/billing
- Stale: src/hooks (30% files changed)

Stats:
  Total directories: 25
  Changed: 2
  New: 1
  Up to date: 22
```

## How It Works

### 1. Directory Discovery

Cartography scans project directories, applying include/exclude pattern filters:

```typescript
// Default includes
"**/*.ts", "**/*.tsx", "**/*.py", "**/*.go", "**/*.rs", "**/*.js"

// Default excludes
"**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
"**/*.test.ts", "**/*.spec.ts", "**/tests/**"
```

### 2. Complexity Scoring

Each directory receives a complexity score based on multiple factors:

| Factor | Weight | High Threshold | Description |
|--------|--------|----------------|-------------|
| File Count | 3x | >20 | More files indicate higher complexity |
| Subdirectory Count | 2x | >5 | Deeper nesting requires documentation |
| Code Ratio | 2x | >70% | Code-dense areas need explanation |
| Module Boundary | 2x | Has index file | Independent modules need separate docs |
| Symbol Density | 2x | >30 symbols | Many symbols indicate complex logic |
| Export Count | 2x | >10 exports | Many public APIs need documentation |
| Reference Centrality | 3x | >20 references | Core modules need detailed docs |

**Decision Rules:**
- **Root directory**: Always generate
- **Score >= 15**: Always generate
- **Score 8-15**: Generate if distinct domain
- **Score < 8**: Skip (parent directory covers it)

### 3. Analysis Pipeline

For each qualifying directory, the analysis pipeline executes:

```
┌─────────────────┐
│ Static Analysis │ Symbol extraction, pattern detection
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│ Integration     │  │ Explorer        │ (optional)
│ Point Detection │  │ Analysis        │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └──────────┬─────────┘
                    ▼
         ┌─────────────────┐
         │  Result Merge   │
         └─────────────────┘
```

### 4. Codemap Generation

Analysis results are merged to generate structured markdown documentation:

- **Responsibility**: Module purpose (1-2 sentences)
- **Design**: Design patterns, core abstractions, architectural decisions
- **Flow**: Entry points, data flow, outputs
- **Integration**: Dependencies, dependents, external integrations

## Configuration

Configure in `oh-my-opencode.json`:

```json
{
  "cartography": {
    "enabled": true,
    "max_depth": 4,
    "min_files": 3,
    "max_parallel_explorers": 5,
    "include_patterns": [
      "**/*.ts",
      "**/*.tsx",
      "**/*.py"
    ],
    "exclude_patterns": [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.test.ts"
    ]
  },
  "codemap_injector": {
    "enabled": true,
    "budget": 600,
    "max_per_codemap": 400,
    "suggest_cartography": true,
    "semantic_search": false
  }
}
```

### Cartography Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable cartography |
| `max_depth` | number | `4` | Maximum directory depth |
| `min_files` | number | `3` | Minimum files required to generate codemap |
| `max_parallel_explorers` | number | `5` | Number of parallel Explorers |
| `include_patterns` | string[] | See above | File patterns to include |
| `exclude_patterns` | string[] | See above | File patterns to exclude |

### Codemap Injector Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic injection |
| `budget` | number | `600` | Token budget for injection |
| `max_per_codemap` | number | `400` | Maximum tokens per codemap |
| `suggest_cartography` | boolean | `true` | Suggest running cartography for unmapped directories |
| `semantic_search` | boolean | `false` | Use semantic search to select relevant codemaps |

## Output Format

### Root Codemap (50-150 lines)

```markdown
# PROJECT CODEMAP

> Generated: 2026-02-03T10:30:00Z
> Branch: main
> Commit: abc1234

## RESPONSIBILITY

[Core purpose and functionality overview of the project]

## STRUCTURE

```
project/
├── src/           # Source code
├── docs/          # Documentation
└── package.json
```

## DESIGN

**Patterns:** Observer, Factory, Singleton
**Abstractions:**
- Interfaces: Plugin, Hook, Agent
- Types: Config, Options

**Decisions:**
- Plugin architecture for extensibility
- Hook pattern for tool interception

## FLOW

**Entry points:** src/index.ts, src/cli/index.ts
**Outputs:** CLI command responses, tool call results

## INTEGRATION

**Dependencies:** @opencode-ai/plugin, zod, picomatch
**External:**
- API: Claude API
- hook: tool.execute.after
```

### Subdirectory Codemap (30-80 lines)

```markdown
# CODEMAP: hooks

> Generated: 2026-02-03T10:30:00Z
> Branch: main
> Commit: abc1234

## RESPONSIBILITY

Implements Claude Code hooks for tool interception, context injection,
and session lifecycle management.

## DESIGN

**Patterns:** Observer, Chain of Responsibility
**Abstractions:**
- Interfaces: HookHandler, HookResult

## FLOW

**Entry points:** createHook, registerHook
**Outputs:** Modified tool outputs, injected context

## INTEGRATION

**Dependencies:** @opencode-ai/plugin, node:fs
```

### Root Atlas

```markdown
# PROJECT ATLAS

> Generated: 2026-02-03T10:30:00Z
> Codemaps: 8

## STRUCTURE

```
project/
  ├── src/ [codemap]
  ├── src/features/ [codemap]
  ├── src/hooks/ [codemap]
  └── src/tools/ [codemap]
```

## CODEMAPS

| Directory | Lines | Generated |
|-----------|-------|-----------|
| . | 120 | 2026-02-03 |
| src | 65 | 2026-02-03 |
| src/features | 55 | 2026-02-03 |
| src/hooks | 48 | 2026-02-03 |
```

## Automatic Context Injection

Cartography includes a hook (`codemap-injector`) that automatically injects relevant codemap context when files are read.

### Trigger Rules

| Query Type | Example Keywords | Injection Strategy |
|------------|------------------|-------------------|
| **Architecture** | "architecture", "design", "how does X work" | Root Atlas + related module codemaps |
| **Navigation** | "where", "which file", "find" | Current directory codemap |
| **Refactoring** | "refactor", "move", "split" | All affected module codemaps |
| **Implementation** | (default) | Working directory codemap |

### Workflow

1. User sends message
2. Hook detects query type
3. When reading files, locates the nearest codemap (prefers an exact directory codemap; falls back to parent codemaps)
4. If found and not yet injected in this session, appends to tool output
5. If a directory has no **exact** codemap and is accessed multiple times, suggests running `/cartography init`

### Example

```
User: Read src/hooks/codemap-injector/index.ts

Output:
[File contents...]

[Codemap Context: src/hooks]
**hooks:** Implements Claude Code hooks for tool interception and context injection.
Patterns: Observer, Chain of Responsibility
Entry: createHook, registerHook
```

## Session Handoff Integration

Cartography is designed to integrate with Session Handoff to preserve architectural knowledge across sessions (types are present; wiring is pending).

### HandoffPayload Extension

```typescript
interface HandoffPayload {
  // ... existing fields ...

  /** Codemap references accessed during session */
  codemapReferences?: CodemapReference[]
}

interface CodemapReference {
  directory: string
  sections: ('responsibility' | 'design' | 'flow' | 'integration')[]
  relevance: 'primary' | 'supporting'
}
```

### Knowledge Preservation Flow

1. **During session**: Track which codemaps were accessed
2. **Session end**: Add codemap references to handoff artifacts
3. **New session restore**: Automatically load previously used codemap context

## Best Practices

### When to Run Cartography

- **After project initialization**: Immediately run `/cartography init`
- **After significant code changes**: Run `/cartography update`
- **At new session start**: If you see a suggestion, run `/cartography`

### Maintenance Recommendations

1. **Regular updates**: Update codemaps when code changes exceed 30%
2. **Check staleness**: Use `/cartography changes` to see what needs updating
3. **Version control**: Add `codemap.md` and `atlas.md` to git

### Performance Expectations

| Project Size | init Duration | update Duration | changes Duration |
|--------------|---------------|-----------------|------------------|
| Small (~100 files) | <30s | <10s | <3s |
| Medium (~500 files) | <2min | <30s | <5s |
| Large (~2000 files) | <5min | <1min | <10s |

### Integration with Other Features

- **AGENTS.md**: Cartography-generated codemaps complement static rules in AGENTS.md
- **Session Handoff**: Planned preservation of architectural context across sessions
- **/init-deep**: Can run init-deep first to generate AGENTS.md, then run cartography for codemaps

## Troubleshooting

### Codemap Generation Failure

**Symptom**: Some directories don't have generated codemaps

**Causes**:
1. Directory has fewer files than `min_files`
2. Directory matches an exclude pattern
3. Complexity score below threshold

**Solution**:
```bash
# Check configuration
cat oh-my-opencode.json | jq '.cartography'

# Force regeneration
/cartography init --force
```

### Context Injection Not Working

**Symptom**: No codemap context visible when reading files

**Causes**:
1. `codemap_injector.enabled` is false
2. Directory has no codemap
3. Token budget exhausted

**Solution**:
```bash
# Check if directory has codemap
ls -la src/your-dir/codemap.md

# If not, generate it
/cartography init
```

### Corrupted State File

**Symptom**: Cartography commands error or behave unexpectedly

**Solution**:
```bash
# Delete state file, reinitialize
rm .opencode/cartography.json
/cartography init
```

## API Reference

### CartographyService

```typescript
import { createCartographyService } from './features/cartography'

const service = createCartographyService(projectRoot, {
  ctx: pluginContext,
  config: customConfig,
  onProgress: (phase, message) => console.log(`[${phase}] ${message}`)
})

// Full initialization
const result = await service.init({ force: true })

// Incremental update
const result = await service.update()

// Check changes
const report = await service.changes()
```

### CodemapCache

```typescript
import { createCodemapCache } from './features/codemap-injector'

const cache = createCodemapCache(projectRoot)

// Find codemap for directory
const entry = cache.findForDirectory('/path/to/dir')

// Get root atlas
const atlas = cache.getRootAtlas()

// Check staleness
const staleness = cache.checkStaleness(entry)
```

### Type Definitions

```typescript
interface CartographyResult {
  mode: 'init' | 'update' | 'changes'
  analyzedDirs: string[]
  createdCodemaps: string[]
  updatedCodemaps: string[]
  skippedDirs: string[]
  errors: CartographyError[]
  durationMs: number
}

interface ChangeReport {
  changedDirs: string[]
  newDirs: string[]
  deletedDirs: string[]
  staleCodemaps: string[]
  stats: {
    totalDirs: number
    changedCount: number
    newCount: number
    deletedCount: number
    upToDateCount: number
  }
}

interface DirectoryScore {
  path: string
  score: number
  breakdown: ScoreBreakdown
  shouldGenerate: boolean
  reason: string
}
```

## Related Documentation

- [Session Handoff Design](./cross-session-continuity-design.md)
- [Configuration Guide](./configurations.md)
- [Orchestration System Guide](./orchestration-guide.md)
