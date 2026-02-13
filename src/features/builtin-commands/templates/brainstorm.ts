export const BRAINSTORM_TEMPLATE = `# Brainstorm Command

Start planner Phase 0 brainstorming workflow for this request.

## Required Behavior

1. Treat this as an explicit request to enter Brainstorming Mode.
2. Run recon before your first question:
   - inspect local codebase patterns
   - inspect relevant project docs
   - inspect recent commits for context
3. Ask exactly ONE question at a time.
4. Propose 2-3 approaches with trade-offs and a recommendation.
5. Validate design incrementally in 200-300 word sections.
6. Ensure design sections cover:
   - architecture
   - components
   - data flow
   - error handling
   - testing strategy
7. Write validated design doc to \`.orchestrator/designs/{topic-slug}.md\`.
8. Do NOT implement code. Continue Interview Mode toward plan generation.
`
