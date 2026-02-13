import { describe, expect, test } from "bun:test"
import { START_WORK_TEMPLATE } from "./start-work"

describe("START_WORK_TEMPLATE", () => {
  test("documents work-state schema v6 fields and canonical plan paths", () => {
    // #given the builtin start-work template text
    const template = START_WORK_TEMPLATE

    // #then it should reflect work.yaml v6 invariants (no absolute plan paths)
    expect(template).toContain("schema_version: 6")
    expect(template).toContain("executor: workflow-automator")
    expect(template).toContain("runtime_ledger_path:")
    expect(template).toContain("execution_plan_path: .orchestrator/plans/")
    expect(template).toContain("protocol:")
    expect(template).toContain("stop_verification_last_prompt_at_by_session: {}")
    expect(template).not.toContain("/absolute/path/to/plan.md")
  })
})
