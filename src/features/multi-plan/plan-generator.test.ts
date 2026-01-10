import { describe, test, expect, afterEach } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { BackgroundManager } from "../background-agent"
import type { PlanGenerationTask } from "./types"
import { PlanGenerator } from "./plan-generator"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-multi-plan-"))
}

function createPlanGenerator(directory: string, manager: BackgroundManager): PlanGenerator {
  return new PlanGenerator(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { client: {} as any, directory } as any,
    manager
  )
}

describe("PlanGenerator.waitForCompletion", () => {
  let tmpDir: string | undefined

  afterEach(() => {
    if (!tmpDir) return
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  test("marks task completed when BackgroundManager evicts but output file exists", async () => {
    // #given
    tmpDir = createTempDir()

    const outputPath = ".sisyphus/plans/test-claude.md"
    fs.mkdirSync(path.join(tmpDir, ".sisyphus", "plans"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, outputPath), "# Plan\n", "utf-8")

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = { getTask: () => undefined } as any as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "claude",
        taskId: "bg_123",
        sessionId: "session_123",
        status: "running",
        outputPath,
        startedAt: new Date(),
      },
    ]

    // #when
    await generator.waitForCompletion(tasks, 1000)

    // #then
    expect(tasks[0].status).toBe("completed")
  })

  test("marks task error when BackgroundManager evicts and output file is missing", async () => {
    // #given
    tmpDir = createTempDir()

    const outputPath = ".sisyphus/plans/missing.md"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = { getTask: () => undefined } as any as BackgroundManager
    const generator = createPlanGenerator(tmpDir, manager)

    const tasks: PlanGenerationTask[] = [
      {
        modelName: "claude",
        taskId: "bg_456",
        sessionId: "session_456",
        status: "running",
        outputPath,
        startedAt: new Date(),
      },
    ]

    // #when
    await generator.waitForCompletion(tasks, 1000)

    // #then
    expect(tasks[0].status).toBe("error")
    expect(tasks[0].error).toContain("output file missing")
  })
})
