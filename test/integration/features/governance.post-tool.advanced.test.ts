import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GovernanceConfig } from "../../../src/config/schema"
import {
  cleanupGovernanceSession,
  executePostToolGovernance,
  executePreToolGovernance,
  getGovernanceSession,
  initGovernanceSession,
} from "../../../src/features/governance/integration"
import { BudgetMonitor, resetBudgetMonitorManager } from "../../../src/features/governance/budget-monitor"
import { resetCheckpointRegistry } from "../../../src/features/governance/checkpoint"
import { resetLedgerManager } from "../../../src/features/governance/ledger"
import { ORCHESTRATOR_HOME_DIR_ENV } from "../../../src/features/governance/storage-paths"
import { resetTracerManager } from "../../../src/features/governance/tracer"

describe("governance post-tool advanced integration", () => {
  const sessionId = "governance-post-tool-advanced"
  const testCwd = "/test/cwd"
  let governanceHomeDir = ""
  let previousHomeDir: string | undefined

  beforeEach(() => {
    previousHomeDir = process.env[ORCHESTRATOR_HOME_DIR_ENV]
    governanceHomeDir = mkdtempSync(join(tmpdir(), "governance-post-tool-"))
    process.env[ORCHESTRATOR_HOME_DIR_ENV] = governanceHomeDir
  })

  afterEach(() => {
    cleanupGovernanceSession(sessionId)
    resetBudgetMonitorManager()
    resetTracerManager()
    resetLedgerManager()
    resetCheckpointRegistry()

    if (previousHomeDir === undefined) {
      delete process.env[ORCHESTRATOR_HOME_DIR_ENV]
    } else {
      process.env[ORCHESTRATOR_HOME_DIR_ENV] = previousHomeDir
    }

    if (existsSync(governanceHomeDir)) {
      rmSync(governanceHomeDir, { recursive: true, force: true })
    }
  })

  test("creates auto-checkpoint when tool call count reaches configured interval", async () => {
    // #given
    const config: Partial<GovernanceConfig> = {
      enabled: true,
      tracer: { enabled: false },
      budget_monitor: { enabled: false },
      ledger: { enabled: false },
      checkpoint: {
        enabled: true,
        auto_checkpoint_interval: 1,
      },
    }
    initGovernanceSession(sessionId, testCwd, config)

    executePreToolGovernance({
      sessionId,
      toolName: "Write",
      toolInput: { file_path: "/tmp/a.ts" },
      toolUseId: "tool-auto-checkpoint-1",
      cwd: testCwd,
      config,
    })

    // #when
    const result = await executePostToolGovernance({
      sessionId,
      toolName: "Write",
      toolInput: { file_path: "/tmp/a.ts" },
      toolOutput: { success: true },
      toolUseId: "tool-auto-checkpoint-1",
      success: true,
      cwd: testCwd,
      config,
    })

    // #then
    expect(result.checkpointCreated).toBe(true)
    const session = getGovernanceSession(sessionId, testCwd, config)
    expect(session.checkpointManager?.listCheckpoints().length).toBe(1)
  })

  test("converts unexpected budget monitor errors into warnings without blocking", async () => {
    // #given
    class FaultyBudgetMonitor extends BudgetMonitor {
      async recordConsumption(_tokens: number): Promise<void> {
        throw new Error("injected budget monitor failure")
      }
    }

    const config: Partial<GovernanceConfig> = {
      enabled: true,
      tracer: { enabled: false },
      ledger: { enabled: false },
      checkpoint: { enabled: false },
      budget_monitor: {
        enabled: true,
        context_window_size: 1000,
        hard_limit: 0.95,
      },
    }
    initGovernanceSession(sessionId, testCwd, config, {
      budgetMonitor: new FaultyBudgetMonitor(sessionId, { allocated: config.budget_monitor?.context_window_size }),
    })

    // #when
    const result = await executePostToolGovernance({
      sessionId,
      toolName: "Read",
      toolInput: { file_path: "/tmp/a.ts" },
      toolOutput: { ok: true },
      success: true,
      tokensUsed: 120,
      cwd: testCwd,
      config,
    })

    // #then
    expect(result.block).toBe(false)
    expect(
      result.warnings.some((warning) => warning.includes("Budget monitor error (ignored): injected budget monitor failure"))
    ).toBe(true)
  })
})
