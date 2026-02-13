/**
 * Cartography Command Template
 *
 * Generates hierarchical codemap.md files for codebase understanding.
 */

export const CARTOGRAPHY_TEMPLATE = `# /cartography

Generate hierarchical codemap.md files for comprehensive codebase understanding.

## Deterministic Rule

This command MUST execute the \`cartography\` tool first.
Do not produce "simulated" codemap output from reasoning alone.

### Required first action

\`\`\`
cartography(mode="update")
\`\`\`

Use \`mode\` derived from user arguments:
- \`init\` => full generation
- \`changes\` => dry change report
- default => \`update\`

## Usage

\`\`\`
/cartography                    # Update mode: regenerate changed codemaps
/cartography init               # Full initialization: generate all codemaps
/cartography changes            # Report changes without generating
/cartography --force            # Force regeneration ignoring hashes
/cartography --max-depth=N      # Limit directory depth (default: 4)
\`\`\`

---

## Overview

Cartography creates structured documentation files (codemap.md) that capture:
- **Responsibility**: What each directory/module does
- **Design**: Patterns, abstractions, and architectural decisions
- **Flow**: Control flow, entry points, and outputs
- **Integration**: Dependencies and connections to other modules

## Workflow

1. **Discovery Phase**
   - Scan project structure
   - Identify directories qualifying for codemaps (based on complexity scoring)
   - Load existing state for incremental updates

2. **Analysis Phase**
   - Static analysis (symbol extraction, pattern detection)
   - Integration point detection
   - Optional: spawn background explorers for deep analysis

3. **Scoring Phase**
   - Score each directory by complexity metrics:
     - File count (3x weight)
     - Subdirectory count (2x weight)
     - Code ratio (2x weight)
     - Module boundaries (2x weight)
     - Symbol density (2x weight)
     - Export count (2x weight)
     - Reference centrality (3x weight)
   - Score >= 15: Always generate
   - Score 8-15: Generate if distinct domain
   - Score < 8: Skip (parent covers)

4. **Generation Phase**
   - Generate codemap.md for qualifying directories
   - Generate root project-map.md aggregating all codemaps
   - Update state file (.opencode/cartography.json)

## Output Structure

### Root Codemap (./codemap.md)
- Full project overview (50-150 lines)
- Directory structure
- Key entry points
- Overall patterns and conventions

### Subdirectory Codemaps (./path/to/dir/codemap.md)
- Focused module documentation (30-80 lines)
- Never repeats parent content
- Specific to this directory's domain

### Root Project Map (./project-map.md)
- Index of all codemaps
- Quick navigation structure
- Aggregated project view

## State Management

State is persisted in \`.opencode/cartography.json\`:
- File hashes for change detection
- Folder composite hashes
- Codemap metadata
- Configuration

## Integration

### Auto-Injection (codemap-injector hook)
When reading files, relevant codemaps are automatically injected:
- Working directory codemap for implementation context
- Root project map for architecture questions

### Session Handoff
Planned: codemap references preserved across sessions via handoff integration.

## Example Output

\`\`\`markdown
# CODEMAP: hooks

> Generated: 2026-02-03T10:30:00Z
> Branch: main
> Commit: abc123

## RESPONSIBILITY

Implements Claude Code hooks for tool interception, context injection,
and session lifecycle management.

## DESIGN

**Patterns:** Observer, Chain of Responsibility
**Abstractions:**
- Interfaces: HookHandler, HookResult, PluginInput
- Types: HookName, EventInput

**Decisions:**
- Uses Hook-based extension model for modularity

## FLOW

**Entry points:** createHook, registerHook
**Outputs:** Modified tool outputs, injected context

## INTEGRATION

**Dependencies:** @opencode-ai/plugin, node:fs, node:path
**External:**
- hook: tool.execute.after
- event: session.idle
\`\`\`

## Anti-Patterns

- **Over-documentation**: Not every directory needs a codemap
- **Redundancy**: Child never repeats parent content
- **Generic content**: Remove anything that applies to ALL projects
- **Stale codemaps**: Use \`/cartography changes\` to detect and update

## Commands

| Command | Description |
|---------|-------------|
| \`/cartography\` | Update changed codemaps |
| \`/cartography init\` | Full initialization |
| \`/cartography changes\` | Report changes |
| \`/cartography --force\` | Force regeneration |
`
