import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PolicyDecision } from "../../contracts"
import { AsyncPolicyEvaluator } from "./evaluator"

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createNonDirectoryPath(prefix: string): string {
  const dir = createTempDir(prefix)
  const filePath = join(dir, "locked-base")
  writeFileSync(filePath, "lock")
  return filePath
}

function sampleDecision(): PolicyDecision {
  return {
    decisionId: "d1",
    clauseId: "c1",
    matchedClauseIds: ["c1"],
    hookPoint: "tool.execute.before",
    enforcement: "hard",
    decision: "deny",
    reasonCode: "R1",
    timestamp: Date.now(),
    trace: {
      hookNodeId: "internal:policy-enforce:tool.execute.before",
      sessionID: "s1",
      toolName: "Write",
    },
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("AsyncPolicyEvaluator", () => {
  test("records evaluation asynchronously without blocking caller path", async () => {
    const baseDir = createTempDir("policy-eval-")
    const evaluator = new AsyncPolicyEvaluator({
      enabled: true,
      async: true,
      metrics: ["task_success", "latency"],
      baseDir,
    })

    evaluator.evaluate({
      sessionID: "s1",
      decision: sampleDecision(),
      outcome: "blocked",
      latencyMs: 42,
    })

    const filePath = join(baseDir, "s1.jsonl")
    expect(existsSync(filePath)).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, "utf-8")
    expect(content).toContain("\"decisionId\":\"d1\"")
    expect(content).toContain("\"latency\":42")
  })

  test("swallows asynchronous write failures (fail-open)", async () => {
    const nonDirectoryPath = createNonDirectoryPath("policy-eval-fail-open-")
    const evaluator = new AsyncPolicyEvaluator({
      enabled: true,
      async: true,
      metrics: ["task_success"],
      baseDir: join(nonDirectoryPath, "child"),
    })

    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {
      return
    })

    evaluator.evaluate({
      sessionID: "s1",
      decision: sampleDecision(),
      outcome: "applied",
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[oh-my-opencode][policy-evaluator] failed to persist policy evaluation",
      expect.any(Error),
    )

    consoleWarnSpy.mockRestore()
  })

  test("evaluate uses setImmediate not queueMicrotask for async writes", () => {
    // #given the evaluator source file
    const source = readFileSync(new URL("./evaluator.ts", import.meta.url), "utf-8")
    // #then it should use setImmediate (defers to next event loop tick)
    expect(source).toContain("setImmediate(writeFailOpen)")
    // #then it should NOT use queueMicrotask (starves event loop under burst)
    expect(source).not.toContain("queueMicrotask(writeFailOpen)")
  })

  test("swallows synchronous write failures when async mode is disabled", () => {
    const nonDirectoryPath = createNonDirectoryPath("policy-eval-fail-open-sync-")
    const evaluator = new AsyncPolicyEvaluator({
      enabled: true,
      async: false,
      metrics: ["task_success"],
      baseDir: join(nonDirectoryPath, "child"),
    })

    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {
      return
    })

    expect(() => {
      evaluator.evaluate({
        sessionID: "s1",
        decision: sampleDecision(),
        outcome: "applied",
      })
    }).not.toThrow()

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[oh-my-opencode][policy-evaluator] failed to persist policy evaluation",
      expect.any(Error),
    )

    consoleWarnSpy.mockRestore()
  })
})
