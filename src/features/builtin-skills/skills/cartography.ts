import type { BuiltinSkill } from "../types"

export const cartographySkill: BuiltinSkill = {
  name: "cartography",
  description: "Generate hierarchical codemap.md files for codebase understanding",
  argumentHint: "[init|update|changes] [--force] [--max-depth=N]",
  template: `# Cartography Skill

Generate hierarchical codemap.md files that document codebase structure, patterns, and flows.

## Commands

\`\`\`
/cartography              # Update changed codemaps
/cartography init         # Full initialization
/cartography changes      # Report changes without generating
/cartography --force      # Force regeneration
/cartography --max-depth=N  # Limit depth (default: 4)
\`\`\`

## Execution Steps

### 1. Parse Arguments
Extract mode and options from user input:
- \`init\`: Full generation of all codemaps
- \`update\` (default): Only regenerate changed directories
- \`changes\`: Report what would be updated without generating
- \`--force\`: Ignore hashes, regenerate all
- \`--max-depth=N\`: Limit directory traversal depth

### 2. Discovery Phase
\`\`\`typescript
// Discover directories
const directories = await discoverDirectories(projectRoot, config)

// Report progress
console.log(\`Found \${directories.length} directories\`)
\`\`\`

### 3. Scoring Phase
Score each directory by complexity:

| Factor | Weight | High Threshold |
|--------|--------|----------------|
| File count | 3x | >20 files |
| Subdirectory count | 2x | >5 subdirs |
| Code ratio | 2x | >70% code |
| Module boundary | 2x | Has index file |
| Symbol density | 2x | >30 symbols |
| Export count | 2x | >10 exports |
| Reference centrality | 3x | >20 references |

**Decision Rules:**
- Root: ALWAYS generate
- Score >= 15: Generate
- Score 8-15: Generate if distinct domain
- Score < 8: Skip

### 4. Analysis Phase
For each qualifying directory:

\`\`\`typescript
// Static analysis
const symbols = extractSymbols(directory)
const patterns = detectPatterns(symbols)
const integrations = findIntegrations(directory)

// Optional: spawn explorer for deep analysis
if (config.use_explorers) {
  delegate_task({
    description: \`Analyze \${directory}\`,
    subagent_type: "explore",
    run_in_background: true,
    prompt: EXPLORER_PROMPT,
  })
}
\`\`\`

### 5. Generation Phase
Generate codemap.md with sections:

**Root Codemap (50-150 lines):**
- RESPONSIBILITY: Project overview
- STRUCTURE: Directory tree
- DESIGN: Patterns, abstractions
- FLOW: Entry points, data flow
- INTEGRATION: External connections
- CONVENTIONS: Project-specific rules
- ANTI-PATTERNS: Things to avoid

**Subdirectory Codemaps (30-80 lines):**
- RESPONSIBILITY: Module purpose
- DESIGN: Local patterns
- FLOW: Module flow
- INTEGRATION: Dependencies

### 6. State Management
Update \`.opencode/cartography.json\`:
- File hashes for change detection
- Folder composite hashes
- Codemap metadata

### 7. Generate Root Atlas
Aggregate all codemaps into \`atlas.md\`:
- Project structure overview
- Codemap index with navigation

## Quality Guidelines

### DO
- Be concise and specific
- Focus on what's unique to each directory
- Include actionable information
- Update state after generation

### DON'T
- Include generic advice that applies everywhere
- Repeat parent codemap content in children
- Over-document (not every dir needs a codemap)
- Generate stale codemaps (use \`changes\` to check)

## Output Format

\`\`\`markdown
# CODEMAP: [directory-name]

> Generated: [timestamp]
> Branch: [branch]
> Commit: [short-sha]

## RESPONSIBILITY

[1-2 sentences describing what this module does]

## DESIGN

**Patterns:** [detected patterns]
**Abstractions:** [key interfaces/types]
**Decisions:** [architectural choices]

## FLOW

**Entry points:** [main entry functions/files]
**Outputs:** [what this module produces]

## INTEGRATION

**Dependencies:** [external deps]
**External:** [API calls, events, hooks]
\`\`\`

## Completion Criteria

- [ ] All qualifying directories have codemap.md
- [ ] Root atlas.md is generated
- [ ] State file is updated
- [ ] No errors in generation
- [ ] Codemaps are within line limits`,
}
