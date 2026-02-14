import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GovernanceConfig } from "../../../src/config"
import type { ExecutionContract } from "../../../src/contracts"
import {
  DEFAULT_GOVERNANCE_CONFIG,
  GovernanceLedgerWriter,
  cleanupGovernanceSession,
  getGovernanceSession,
  loadTrace,
  persistGovernanceTraceSnapshot,
  resetBudgetMonitorManager,
  resetCheckpointRegistry,
  resetLedgerManager,
  resetTracerManager,
} from "../../../src/features/governance"
import { ORCHESTRATOR_HOME_DIR_ENV } from "../../../src/features/governance/storage-paths"
import {
  PolicyLedgerStore,
  createPolicyEventWriter,
  createPolicyRuntime,
} from "../../../src/features/policy-runtime"
import { buildToolExecuteAfterNodes } from "../../../src/hooks/runtime/assembly/tool-execute-after"
import { buildToolExecuteBeforeNodes } from "../../../src/hooks/runtime/assembly/tool-execute-before"
import type {
  RuntimeAssemblyContext,
  ToolExecuteAfterOutput,
  ToolExecuteBeforeOutput,
} from "../../../src/hooks/runtime/assembly/types"
import { HookRuntimeDispatcher } from "../../../src/hooks/runtime/dispatcher"
import { EVENT_TOTAL_ORDER } from "../../../src/hooks/runtime/pipeline-order"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function hookPipelineContract(toolName: string): ExecutionContract {
  return {
    taskId: "hook-pipeline-test",
    clauses: [
      {
        id: "before-inject-arg",
        description: "Injects a marker field into tool args before execution.",
        hookPoints: ["tool.execute.before"],
        enforcement: "soft",
        selector: { toolName },
        condition: {},
        action: {
          type: "modify",
          mutation: { args: { injectedByPolicy: true } },
          message: "Injected marker into args.",
        },
        priority: 1,
        conflictResolution: "most-restrictive",
        enabled: true,
        version: 1,
        provenance: { author: "test", source: "integration", createdAt: 1 },
        reasonCode: "INJECT_ARG",
      },
      {
        id: "after-sanitize-output",
        description: "Sanitizes tool output and records metadata after execution.",
        hookPoints: ["tool.execute.after"],
        enforcement: "soft",
        selector: { toolName },
        condition: {},
        action: {
          type: "modify",
          mutation: {
            title: "POLICY_TITLE",
            output: "POLICY_OUTPUT",
            metadata: { policyApplied: true },
          },
          message: "Sanitized tool output.",
        },
        priority: 1,
        conflictResolution: "most-restrictive",
        enabled: true,
        version: 1,
        provenance: { author: "test", source: "integration", createdAt: 1 },
        reasonCode: "SANITIZE_OUTPUT",
      },
    ],
    defaultConflictResolution: "most-restrictive",
    budgets: {
      contextProfile: "profile_400",
      contextTokensTarget: 240000,
      contextTokensHardLimit: 320000,
      reasoningBudget: "medium",
      maxToolCalls: 30,
      wallClockMs: 120000,
    },
    modelPolicy: {
      primary: "openai/gpt-5.3-codex",
      providerPriority: ["openai", "google", "anthropic"],
      allowFallback: true,
      minContextWindow: 400000,
    },
  }
}

afterEach(() => {
  resetBudgetMonitorManager()
  resetTracerManager()
  resetLedgerManager()
  resetCheckpointRegistry()

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("hook pipeline integration (policy runtime + governance)", () => {
  test("persists correlated trace + governance ledger + policy observed ledger for one tool call", async () => {
    // #given
    const cwd = createTempDir("hook-pipeline-cwd-")
    const orchestratorHome = createTempDir("hook-pipeline-orchestrator-home-")
    const policyLedgerDir = createTempDir("hook-pipeline-policy-ledger-")

    const tool = "Write"
    const sessionID = "hook-pipeline-s1"
    const callID = "hook-pipeline-c1"
    const expectedTraceNodeId = `tool:${callID}`

    const prevOrchestratorHome = process.env[ORCHESTRATOR_HOME_DIR_ENV]
    process.env[ORCHESTRATOR_HOME_DIR_ENV] = orchestratorHome

    const governanceConfig: GovernanceConfig = {
      ...DEFAULT_GOVERNANCE_CONFIG,
      enabled: true,
      budget_monitor: {
        ...DEFAULT_GOVERNANCE_CONFIG.budget_monitor,
        context_window_size: 2000,
        warn_threshold: 0.2,
        hard_limit: 0.5,
      },
    }

    const policyLedger = new PolicyLedgerStore({
      enabled: true,
      baseDir: policyLedgerDir,
      retentionDays: 7,
      maxFileBytes: 1024 * 1024,
    })

    const policyRuntime = createPolicyRuntime({
      contract: hookPipelineContract(tool),
      eventWriter: createPolicyEventWriter({
        policyLedger,
        resolveGovernanceLedger: (id) => getGovernanceSession(id, cwd, governanceConfig).ledger,
      }),
    })

    const context: RuntimeAssemblyContext = {
      directory: cwd,
      governanceEnabled: true,
      governanceConfig,
      policyRuntime,
      getSessionAgent: () => "integration-test-agent",
    }

    const dispatcher = new HookRuntimeDispatcher({ order: EVENT_TOTAL_ORDER })
    const toolInput = { tool, sessionID, callID }
    const beforeOutput: ToolExecuteBeforeOutput = {
      args: {
        filePath: "a.txt",
        content: "x",
      },
    }

    const afterOutput: ToolExecuteAfterOutput = {
      title: "raw",
      output: "raw output",
      metadata: {
        success: false,
        usage: { total_tokens: 1500 },
      },
    }

    try {
      // #when - dispatch the real hook pipelines
      await dispatcher.dispatch(
        "tool.execute.before",
        buildToolExecuteBeforeNodes(context, toolInput, beforeOutput)
      )
      await dispatcher.dispatch(
        "tool.execute.after",
        buildToolExecuteAfterNodes(context, toolInput, afterOutput)
      )

      // #then - observable policy mutations happened
      expect(beforeOutput.args.injectedByPolicy).toBe(true)
      expect(afterOutput.title).toBe("POLICY_TITLE")
      expect(afterOutput.output).toContain("POLICY_OUTPUT")
      expect(afterOutput.metadata.policyApplied).toBe(true)

      // #then - persisted governance trace is correlated to hook pipeline id
      expect(persistGovernanceTraceSnapshot(sessionID)).toBe(true)
      const trace = loadTrace(sessionID)
      expect(trace).not.toBeNull()
      const toolNode = trace!.nodes.find((n) => n.id === expectedTraceNodeId)
      expect(toolNode?.name).toBe(tool)
      expect(toolNode?.status).toBe("failed")

      // #then - policy observed ledger records the same trace correlation id
      const observedEntries = policyLedger.readSession(sessionID)
      expect(observedEntries).toHaveLength(2)
      for (const entry of observedEntries) {
        expect(entry.observed.traceNodeId).toBe(expectedTraceNodeId)
      }

      // #then - governance ledger contains budget + policy events correlated to the same trace node id
      const ledger = new GovernanceLedgerWriter(sessionID)
      const budgetEvents = ledger.query({ type: "budget-event" })
      expect(budgetEvents.length).toBeGreaterThanOrEqual(2)
      expect(
        budgetEvents.some(
          (e) => e.traceNodeId === expectedTraceNodeId && e.actionTaken.includes("Pre-tool:")
        )
      ).toBe(true)
      expect(
        budgetEvents.some(
          (e) => e.traceNodeId === expectedTraceNodeId && e.actionTaken.includes("Post-tool:")
        )
      ).toBe(true)

      const policyDecisions = ledger.query({ type: "policy-decision" })
      expect(policyDecisions.length).toBeGreaterThanOrEqual(2)
      expect(policyDecisions.every((e) => e.traceNodeId === expectedTraceNodeId)).toBe(true)

      const policyOutcomes = ledger.query({ type: "policy-outcome" })
      expect(policyOutcomes.length).toBeGreaterThanOrEqual(2)
      expect(policyOutcomes.every((e) => e.traceNodeId === expectedTraceNodeId)).toBe(true)
    } finally {
      cleanupGovernanceSession(sessionID)
      if (prevOrchestratorHome === undefined) {
        delete process.env[ORCHESTRATOR_HOME_DIR_ENV]
      } else {
        process.env[ORCHESTRATOR_HOME_DIR_ENV] = prevOrchestratorHome
      }
    }
  })
})
