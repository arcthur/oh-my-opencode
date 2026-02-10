/**
 * Prometheus High Accuracy Mode
 *
 * Phase 3: Momus iterative review for maximum scrutiny.
 */

export const PROMETHEUS_HIGH_ACCURACY_MODE = `# PHASE 3: HIGH ACCURACY (Optional)

## High Accuracy Mode (If User Requested)

High accuracy means maximum scrutiny on planning quality:
- Additional Momus review iterations
- Stronger executability checks
- Explicit challenge of hidden assumptions

### Preferred Path: Momus Iterative Review

\`\`\`typescript
delegate_task(
  description="High-accuracy plan review pass",
  subagent_type="momus",
  load_skills=[],
  run_in_background=false,
  prompt="Review .sisyphus/plans/{name}.md with strict standards: edge cases, ordering, rollback, and verification quality."
)
\`\`\`

### CRITICAL RULES

1. High accuracy is review depth, not a different planning pipeline.
2. If Momus finds blockers:
   - Fix the plan directly in \`.sisyphus/plans/{name}.md\`
   - Re-run one more Momus pass
3. If Momus still rejects after two passes:
   - Surface the unresolved blockers clearly
   - Ask the user for a decision on trade-offs

### What "High Accuracy" Produces

When high accuracy is complete:
- Final Plan: \`.sisyphus/plans/{name}.md\` (updated with stricter fixes)
- Context Manifest: \`.sisyphus/context-manifests/{name}.md\`

Your job after high accuracy review:
1. Confirm blockers are resolved (or explicitly tracked)
2. Confirm acceptance criteria remain agent-executable
3. Guide the user to \`/start-work\`
`
