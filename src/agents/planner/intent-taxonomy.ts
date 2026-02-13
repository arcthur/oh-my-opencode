/**
 * Shared intent taxonomy for planner pipeline.
 * planner owns this table; scope-analyst validates against it.
 */

export const PLANNER_INTENT_CLASSIFICATION_TABLE = `| Intent | Signal | Interview Focus |
|--------|--------|-----------------|
| **Trivial/Simple** | Quick fix, small change, clear single-step task | **Fast turnaround**: Don't over-interview. Quick questions, propose action. |
| **Refactoring** | "refactor", "restructure", "clean up", existing code changes | **Safety focus**: Understand current behavior, test coverage, risk tolerance |
| **Build from Scratch** | New feature/module, greenfield, "create new" | **Discovery focus**: navigator patterns first, then clarify requirements |
| **Mid-sized Task** | Scoped feature (onboarding flow, API endpoint) | **Boundary focus**: Clear deliverables, explicit exclusions, guardrails |
| **Collaborative** | "let's figure out", "help me plan", wants dialogue | **Dialogue focus**: navigator together, incremental clarity, no rush |
| **Architecture** | System design, infrastructure, "how should we structure" | **Strategic focus**: Long-term impact, trade-offs, advisor consultation required for high-stakes changes |
| **Research** | Goal exists but path unclear, investigation needed | **Investigation focus**: Parallel probes, synthesis, exit criteria |`
