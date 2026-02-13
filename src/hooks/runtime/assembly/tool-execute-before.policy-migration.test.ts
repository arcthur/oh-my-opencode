import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CURRENT_CONFIG_VERSION, type OhMyOpenCodeConfig } from "../../../config"
import {
  _resetForTesting as resetSessionStateForTesting,
  markSubagentSession,
} from "../../../features/claude-code-session-state"
import {
  buildExecutionContract,
  createPolicyRuntime,
  SessionExecutionBudgetManager,
  type PolicyEventWriter,
} from "../../../features/policy-runtime"
import type { OutcomeEvent } from "../../../features/policy-runtime/types"
import { HookRuntimeDispatcher } from "../dispatcher"
import { EVENT_TOTAL_ORDER } from "../pipeline-order"
import { buildToolExecuteBeforeNodes } from "./tool-execute-before"
import type { RuntimeAssemblyContext, ToolExecuteBeforeOutput } from "./types"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createPolicyContext(overrides?: Partial<RuntimeAssemblyContext>): RuntimeAssemblyContext {
  const config: OhMyOpenCodeConfig = {
    config_version: CURRENT_CONFIG_VERSION,
    architecture_version: 2,
  }
  const contract = buildExecutionContract({
    config,
    taskId: "phase-5a-test",
  })
  const writer: PolicyEventWriter = {
    appendObserved: () => {},
    appendDecision: () => {},
    appendOutcome: () => {},
  }

  return {
    pluginConfig: config,
    directory: process.cwd(),
    workOrchestrator: {
      stopContinuation: () => {},
      isContinuationStopped: () => false,
      getContinuationRound: () => undefined,
    },
    taskAutoContinuation: {
      cancelAllCountdowns: () => {},
    },
    policyRuntime: createPolicyRuntime({
      contract,
      eventWriter: writer,
    }),
    ...overrides,
  }
}

async function dispatchToolBefore(params: {
  context: RuntimeAssemblyContext
  input: { tool: string; sessionID: string; callID: string }
  output: ToolExecuteBeforeOutput
}): Promise<void> {
  const dispatcher = new HookRuntimeDispatcher({
    order: EVENT_TOTAL_ORDER,
  })
  const nodes = buildToolExecuteBeforeNodes(
    params.context,
    params.input,
    params.output
  )
  await dispatcher.dispatch("tool.execute.before", nodes)
}

afterEach(() => {
  resetSessionStateForTesting()
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("tool.execute.before policy migration", () => {
  test("blocks Write on existing file via policy clause", async () => {
    const cwd = createTempDir("phase5a-write-existing-")
    writeFileSync(join(cwd, "a.txt"), "x")
    const context = createPolicyContext({
      directory: cwd,
    })
    const output: ToolExecuteBeforeOutput = {
      args: {
        filePath: "a.txt",
      },
    }

    await expect(
      dispatchToolBefore({
        context,
        input: { tool: "Write", sessionID: "s1", callID: "c1" },
        output,
      })
    ).rejects.toThrow("File already exists. Use edit tool instead.")
  })

  test("blocks question tool in subagent session via policy clause", async () => {
    markSubagentSession("s-sub", "s-main")
    const context = createPolicyContext()
    const output: ToolExecuteBeforeOutput = { args: {} }

    await expect(
      dispatchToolBefore({
        context,
        input: { tool: "question", sessionID: "s-sub", callID: "c2" },
        output,
      })
    ).rejects.toThrow("Question tool is disabled for subagent sessions.")
  })

  test("blocks Prometheus writes outside .sisyphus/*.md via policy clause", async () => {
    const cwd = createTempDir("phase5a-prometheus-block-")
    mkdirSync(join(cwd, "src"), { recursive: true })
    const context = createPolicyContext({
      directory: cwd,
      getSessionAgent: () => "prometheus",
    })
    const output: ToolExecuteBeforeOutput = {
      args: {
        filePath: "src/main.ts",
      },
    }

    await expect(
      dispatchToolBefore({
        context,
        input: { tool: "Write", sessionID: "s3", callID: "c3" },
        output,
      })
    ).rejects.toThrow("Prometheus can only write/edit .md files inside .sisyphus/")
  })

  test("injects Prometheus task warning via policy modify clause", async () => {
    const context = createPolicyContext({
      getSessionAgent: () => "prometheus",
    })
    const output: ToolExecuteBeforeOutput = {
      args: {
        prompt: "analyze repository",
      },
    }

    await dispatchToolBefore({
      context,
      input: { tool: "task", sessionID: "s4", callID: "c4" },
      output,
    })

    const prompt = output.args.prompt as string
    expect(prompt).toContain("You are being invoked by Prometheus")
    expect(prompt).toContain("READ-ONLY planning agent")
  })

  test("appends plan workflow reminder for Prometheus .sisyphus plan writes", async () => {
    const cwd = createTempDir("phase5a-prometheus-plan-")
    mkdirSync(join(cwd, ".sisyphus", "plans", "p1"), { recursive: true })
    const context = createPolicyContext({
      directory: cwd,
      getSessionAgent: () => "prometheus",
    })
    const output: ToolExecuteBeforeOutput = {
      args: {
        filePath: ".sisyphus/plans/p1/plan.md",
      },
      message: "",
    }

    await dispatchToolBefore({
      context,
      input: { tool: "Write", sessionID: "s5", callID: "c5" },
      output,
    })

    expect(output.message).toContain("PROMETHEUS PLAN-WRITING CHECKLIST")
  })

  test("policy observe payload includes guardsVersion", async () => {
    let capturedPayload: Record<string, unknown> | undefined
    const context = createPolicyContext({
      policyRuntime: {
        observe: async (event) => {
          if (event.hookPoint === "tool.execute.before") {
            capturedPayload = event.payload as Record<string, unknown>
          }
        },
        enforce: async () => [],
      },
    })

    await dispatchToolBefore({
      context,
      input: { tool: "Read", sessionID: "s-gv", callID: "c-gv" },
      output: { args: {} },
    })

    expect(capturedPayload?.guardsVersion).toBe(1)
  })

  test("policy enforce payload includes guardsVersion", async () => {
    let capturedPayload: Record<string, unknown> | undefined
    const context = createPolicyContext({
      policyRuntime: {
        observe: async () => {},
        enforce: async (event) => {
          if (event.hookPoint === "tool.execute.before") {
            capturedPayload = event.payload as Record<string, unknown>
          }
          return []
        },
      },
    })

    await dispatchToolBefore({
      context,
      input: { tool: "Read", sessionID: "s-gv2", callID: "c-gv2" },
      output: { args: {} },
    })

    expect(capturedPayload?.guardsVersion).toBe(1)
  })

  test("enforces max_tool_calls execution budget", async () => {
    const context = createPolicyContext({
      executionBudgetManager: new SessionExecutionBudgetManager(),
      executionBudgetLimits: {
        maxToolCalls: 1,
        wallClockMs: 120000,
        contextTokensHardLimit: 320000,
      },
    })

    await dispatchToolBefore({
      context,
      input: { tool: "Read", sessionID: "s-budget", callID: "c-first" },
      output: { args: {} },
    })

    await expect(
      dispatchToolBefore({
        context,
        input: { tool: "Read", sessionID: "s-budget", callID: "c-second" },
        output: { args: {} },
      })
    ).rejects.toThrow("Execution budget exceeded: tool calls")
  })

  test("records superseded outcome when governance blocks after policy allows", async () => {
    // #given — a custom contract with an "audit" clause that matches Write (produces "applied")
    // plus governance that blocks
    const cwd = createTempDir("phase5a-superseded-")
    const outcomes: OutcomeEvent[] = []
    const writer: PolicyEventWriter = {
      appendObserved: () => {},
      appendDecision: () => {},
      appendOutcome: (event) => {
        outcomes.push(event)
      },
    }
    const config: OhMyOpenCodeConfig = {
      config_version: CURRENT_CONFIG_VERSION,
      architecture_version: 2,
      contracts: {
        clauses: [
          {
            id: "test:audit-all-writes",
            description: "Audit all Write calls",
            hook_points: ["tool.execute.before"],
            enforcement: "soft",
            selector: { tool_name: "Write" },
            condition: {},
            action: { type: "audit", message: "Auditing write" },
            priority: 1,
            conflict_resolution: "most-restrictive",
            enabled: true,
            version: 1,
            provenance: { author: "test", source: "unit", created_at: 1 },
            reason_code: "AUDIT_WRITE",
          },
        ],
      },
    }
    const contract = buildExecutionContract({ config, taskId: "superseded-test" })
    const policyRuntime = createPolicyRuntime({ contract, eventWriter: writer })

    const context = createPolicyContext({
      directory: cwd,
      governanceEnabled: true,
      governanceBlockPrefix: "Governance blocked:",
      policyRuntime,
    })

    const output: ToolExecuteBeforeOutput = {
      args: { filePath: "brand-new.txt", content: "hello" },
    }
    const input = { tool: "Write", sessionID: "s-gov", callID: "c-gov" }

    // #when — build nodes, execute policy-enforce to get decisions, then simulate governance block
    const nodes = buildToolExecuteBeforeNodes(context, input, output)

    const policyEnforceIdx = nodes.findIndex(
      (n) => n.id === "internal:policy-enforce:tool.execute.before"
    )
    expect(policyEnforceIdx).toBeGreaterThanOrEqual(0)

    for (let i = 0; i <= policyEnforceIdx; i++) {
      await nodes[i].invoke()
    }

    // Policy produced "applied" outcomes (audit clauses result in "applied")
    const appliedBefore = outcomes.filter((o) => o.outcome === "applied")
    expect(appliedBefore.length).toBeGreaterThan(0)

    // Simulate governance blocking by calling recordSuperseded as the governance node would
    policyRuntime.recordSuperseded({
      sessionID: "s-gov",
      hookPoint: "tool.execute.before",
      decisions: appliedBefore.map((o) => ({
        decisionId: o.decisionId,
        clauseId: o.clauseId,
        hookPoint: o.hookPoint,
        matchedClauseIds: [o.clauseId],
        enforcement: "soft" as const,
        decision: "audit" as const,
        message: "Auditing write",
        reasonCode: "AUDIT_WRITE",
        timestamp: Date.now(),
        trace: { hookNodeId: "internal:policy-enforce:tool.execute.before" as const, sessionID: "s-gov" },
      })),
      reason: "Governance blocked after policy allowed",
    })

    // #then — there should be superseded outcome events
    const supersededOutcomes = outcomes.filter((o) => o.outcome === "superseded")
    expect(supersededOutcomes.length).toBeGreaterThan(0)
    for (const o of supersededOutcomes) {
      expect(o.sessionID).toBe("s-gov")
      expect(o.hookPoint).toBe("tool.execute.before")
      expect(o.outcome).toBe("superseded")
    }
  })
})
