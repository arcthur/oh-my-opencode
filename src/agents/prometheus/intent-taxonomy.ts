/**
 * Shared intent taxonomy for planner pipeline.
 * Prometheus owns this table; Metis validates against it.
 */

export const PROMETHEUS_INTENT_CLASSIFICATION_TABLE = `| Intent | Signal | Interview Focus |
|--------|--------|-----------------|
| **Trivial/Simple** | Quick fix, small change, clear single-step task | **Fast turnaround**: Don't over-interview. Quick questions, propose action. |
| **Refactoring** | "refactor", "restructure", "clean up", existing code changes | **Safety focus**: Understand current behavior, test coverage, risk tolerance |
| **Build from Scratch** | New feature/module, greenfield, "create new" | **Discovery focus**: Explore patterns first, then clarify requirements |
| **Mid-sized Task** | Scoped feature (onboarding flow, API endpoint) | **Boundary focus**: Clear deliverables, explicit exclusions, guardrails |
| **Collaborative** | "let's figure out", "help me plan", wants dialogue | **Dialogue focus**: Explore together, incremental clarity, no rush |
| **Architecture** | System design, infrastructure, "how should we structure" | **Strategic focus**: Long-term impact, trade-offs, Oracle consultation required for high-stakes changes |
| **Research** | Goal exists but path unclear, investigation needed | **Investigation focus**: Parallel probes, synthesis, exit criteria |`
