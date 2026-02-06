import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as yaml from "js-yaml"
import { createStartWorkHook } from "./index"
import type { WorkState } from "../../features/work-state"
import * as sessionState from "../../features/claude-code-session-state"

function createPlan(directory: string, planId: string, body: string): string {
  const planDir = join(directory, ".sisyphus", "plans", planId)
  mkdirSync(planDir, { recursive: true })

  const planPath = join(planDir, "plan.md")
  writeFileSync(planPath, body, "utf-8")

  const ledgerPath = join(planDir, "ledger.yaml")
  writeFileSync(
    ledgerPath,
    `schema_version: 1\nplan_id: ${planId}\nerrors: []\nblockers: []\ndecisions: []\nupdated_at: \"2026-02-06T00:00:00Z\"\n`,
    "utf-8"
  )

  return planPath
}

function writeWorkState(directory: string, state: Partial<WorkState>): void {
  const sisyphusDir = join(directory, ".sisyphus")
  if (!existsSync(sisyphusDir)) {
    mkdirSync(sisyphusDir, { recursive: true })
  }

  const planId = state.plan_id ?? "demo"
  const fullState: WorkState = {
    schema_version: 2,
    plan_id: planId,
    execution_plan_path: state.execution_plan_path ?? `.sisyphus/plans/${planId}/plan.md`,
    runtime_ledger_path: state.runtime_ledger_path ?? `.sisyphus/plans/${planId}/ledger.yaml`,
    started_at: state.started_at ?? new Date().toISOString(),
    session_ids: state.session_ids ?? [],
    research_ops: state.research_ops ?? 0,
    last_findings_mtime: state.last_findings_mtime ?? 0,
    errors: state.errors ?? [],
    blockers: state.blockers ?? [],
    phase_completions: state.phase_completions ?? [],
    decisions: state.decisions ?? [],
    task_snapshot: state.task_snapshot,
    last_updated: state.last_updated,
  }

  writeFileSync(join(sisyphusDir, "work.yaml"), yaml.dump(fullState, { indent: 2 }))
}

describe("start-work hook", () => {
  let testDir: string

  function createMockPluginInput() {
    return {
      directory: testDir,
      client: {},
    } as Parameters<typeof createStartWorkHook>[0]
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, ".sisyphus"), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("chat.message handler", () => {
    test("should ignore non-start-work commands", async () => {
      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "Just a regular message" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toBe("Just a regular message")
    })

    test("should detect start-work command via session-context tag", async () => {
      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context>Some context here</session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("---")
    })

    test("should inject resume info when existing work state found", async () => {
      createPlan(
        testDir,
        "test-plan",
        "# Plan: test-plan\n\n## TODOs\n\n- [ ] 1. Task 1\n- [x] 2. Task 2\n"
      )

      writeWorkState(testDir, {
        plan_id: "test-plan",
        execution_plan_path: ".sisyphus/plans/test-plan/plan.md",
        runtime_ledger_path: ".sisyphus/plans/test-plan/ledger.yaml",
        started_at: "2026-01-02T10:00:00Z",
        session_ids: ["session-1"],
      })

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context></session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("RESUMING")
      expect(output.parts[0].text).toContain("test-plan")
    })

    test("should replace $SESSION_ID placeholder", async () => {
      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context>Session: $SESSION_ID</session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "ses-abc123" }, output)

      expect(output.parts[0].text).toContain("ses-abc123")
      expect(output.parts[0].text).not.toContain("$SESSION_ID")
    })

    test("should replace $TIMESTAMP placeholder", async () => {
      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context>Time: $TIMESTAMP</session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).not.toContain("$TIMESTAMP")
      expect(output.parts[0].text).toMatch(/\d{4}-\d{2}-\d{2}T/)
    })

    test("should auto-select when only one incomplete plan among multiple plans", async () => {
      createPlan(
        testDir,
        "plan-complete",
        "# Plan: plan-complete\n\n## TODOs\n\n- [x] 1. Task 1\n- [x] 2. Task 2\n"
      )
      createPlan(
        testDir,
        "plan-incomplete",
        "# Plan: plan-incomplete\n\n## TODOs\n\n- [ ] 1. Task 1\n- [x] 2. Task 2\n"
      )

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context></session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("Auto-Selected Plan")
      expect(output.parts[0].text).toContain("plan-incomplete")
      expect(output.parts[0].text).not.toContain("Multiple Plans Found")
    })

    test("should wrap multiple plans message in system-reminder tag", async () => {
      createPlan(testDir, "plan-a", "# Plan: plan-a\n\n## TODOs\n\n- [ ] 1. Task 1\n")
      createPlan(testDir, "plan-b", "# Plan: plan-b\n\n## TODOs\n\n- [ ] 1. Task 2\n")

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context></session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("<system-reminder>")
      expect(output.parts[0].text).toContain("</system-reminder>")
      expect(output.parts[0].text).toContain("Multiple Plans Found")
    })

    test("should use 'ask user' prompt style for multiple plans", async () => {
      createPlan(testDir, "plan-x", "# Plan: plan-x\n\n## TODOs\n\n- [ ] 1. Task 1\n")
      createPlan(testDir, "plan-y", "# Plan: plan-y\n\n## TODOs\n\n- [ ] 1. Task 2\n")

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context></session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("Ask the user")
      expect(output.parts[0].text).not.toContain("Which plan would you like to work on?")
    })

    test("should select explicitly specified plan name from user-request, ignoring existing work state", async () => {
      createPlan(testDir, "old-plan", "# Plan: old-plan\n\n## TODOs\n\n- [ ] 1. Old Task\n")
      createPlan(testDir, "new-plan", "# Plan: new-plan\n\n## TODOs\n\n- [ ] 1. New Task\n")

      writeWorkState(testDir, {
        plan_id: "old-plan",
        execution_plan_path: ".sisyphus/plans/old-plan/plan.md",
        runtime_ledger_path: ".sisyphus/plans/old-plan/ledger.yaml",
        started_at: "2026-01-01T10:00:00Z",
        session_ids: ["old-session"],
      })

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [
          {
            type: "text",
            text: `<session-context>\n<user-request>new-plan</user-request>\n</session-context>`,
          },
        ],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("new-plan")
      expect(output.parts[0].text).not.toContain("RESUMING")
      expect(output.parts[0].text).not.toContain("old-plan")
    })

    test("should strip ultrawork/ulw keywords from plan name argument", async () => {
      createPlan(testDir, "my-feature-plan", "# Plan: my-feature-plan\n\n## TODOs\n\n- [ ] 1. Task 1\n")

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [
          {
            type: "text",
            text: `<session-context>\n<user-request>my-feature-plan ultrawork</user-request>\n</session-context>`,
          },
        ],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("my-feature-plan")
      expect(output.parts[0].text).toContain("Auto-Selected Plan")
    })

    test("should strip ulw keyword from plan name argument", async () => {
      createPlan(testDir, "api-refactor", "# Plan: api-refactor\n\n## TODOs\n\n- [ ] 1. Task 1\n")

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [
          {
            type: "text",
            text: `<session-context>\n<user-request>api-refactor ulw</user-request>\n</session-context>`,
          },
        ],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("api-refactor")
      expect(output.parts[0].text).toContain("Auto-Selected Plan")
    })

    test("should match plan by partial name", async () => {
      createPlan(
        testDir,
        "2026-01-15-feature-implementation",
        "# Plan: 2026-01-15-feature-implementation\n\n## TODOs\n\n- [ ] 1. Task 1\n"
      )

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [
          {
            type: "text",
            text: `<session-context>\n<user-request>feature-implementation</user-request>\n</session-context>`,
          },
        ],
      }

      await hook["chat.message"]({ sessionID: "session-123" }, output)

      expect(output.parts[0].text).toContain("2026-01-15-feature-implementation")
      expect(output.parts[0].text).toContain("Auto-Selected Plan")
    })
  })

  describe("session agent management", () => {
    test("should update session agent to sisyphus when start-work command is triggered", async () => {
      const updateSpy = spyOn(sessionState, "updateSessionAgent")

      const hook = createStartWorkHook(createMockPluginInput())
      const output = {
        parts: [{ type: "text", text: "<session-context></session-context>" }],
      }

      await hook["chat.message"]({ sessionID: "ses-prometheus-to-sisyphus" }, output)

      expect(updateSpy).toHaveBeenCalledWith("ses-prometheus-to-sisyphus", "sisyphus")
      updateSpy.mockRestore()
    })
  })
})
