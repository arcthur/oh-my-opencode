/**
 * planner High Accuracy Mode
 *
 * Phase 3: reviewer iterative review for maximum scrutiny.
 */

export const PLANNER_HIGH_ACCURACY_MODE = `# PHASE 3: HIGH ACCURACY (Optional)

## High Accuracy Mode (If User Requested)

High accuracy means maximum scrutiny on planning quality:
- Additional reviewer review iterations
- Stronger executability checks
- Explicit challenge of hidden assumptions

### Preferred Path: reviewer Iterative Review

\`\`\`typescript
delegate_task(
  description="High-accuracy plan review pass",
  subagent_type="reviewer",
  load_skills=[],
  run_in_background=false,
  prompt="Review .orchestrator/plans/{plan-id}/plan.md with strict standards: edge cases, ordering, rollback, and verification quality."
)
\`\`\`

### CRITICAL RULES

1. High accuracy is review depth, not a different planning pipeline.
2. If reviewer finds blockers:
   - Fix the plan directly in \`.orchestrator/plans/{plan-id}/plan.md\`
   - Re-run one more reviewer pass
3. If reviewer still rejects after two passes:
   - Surface the unresolved blockers clearly
   - Ask the user for a decision on trade-offs

### What "High Accuracy" Produces

When high accuracy is complete:
- Final Plan: \`.orchestrator/plans/{plan-id}/plan.md\` (updated with stricter fixes)
- Context Manifest: \`.orchestrator/context-manifests/{plan-id}.md\`

Your job after high accuracy review:
1. Confirm blockers are resolved (or explicitly tracked)
2. Confirm acceptance criteria remain agent-executable
3. Guide the user to \`/start-work\`
`
