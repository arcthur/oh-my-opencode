/**
 * Prometheus High Accuracy Mode
 *
 * Phase 3: Debate-enabled multi-model planning for maximum scrutiny.
 */

export const PROMETHEUS_HIGH_ACCURACY_MODE = `# PHASE 3: HIGH ACCURACY (Optional)

## High Accuracy Mode (If User Requested)

High accuracy means maximum scrutiny on planning quality:
- Multi-model perspectives (if configured)
- Plan Synthesizer critique + conflict resolution
- Optional debate round for rejected models

### Preferred Path: \`multi_plan\` with Debate Enabled (Requires 2+ models)

\`\`\`typescript
multi_plan({
  planName: "{name}",
  context: \`\${fullInterviewContextAndDecisions}\`,
  debate: true
})
\`\`\`

### CRITICAL RULES

1. Only use this mode if multi-model planning is configured (2+ models).
2. If \`multi_plan\` returns an error indicating insufficient models:
   - Do NOT pretend debate exists
   - Proceed with single-model planning
   - Apply the Post-Plan Self-Review checklist rigorously
   - Tell the user how to enable multi-model planning if they want it

### What "High Accuracy" Produces

When \`multi_plan\` succeeds, these files are produced:
- Comparison Report: \`.sisyphus/plan-reviews/{name}-comparison.md\`
- Final Unified Plan: \`.sisyphus/plans/{name}.md\`

Your job after \`multi_plan\`:
1. Read the final plan
2. Confirm gaps/decisions are explicit
3. Guide the user to \`/start-work\`
`
