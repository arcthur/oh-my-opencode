import { beforeEach, describe, expect, test } from "bun:test"
import { contextBudgetArbiter } from "../../features/context-view"

const { createTaskResumeInfoHook } = await import("./index")

describe("createTaskResumeInfoHook", () => {
  beforeEach(() => {
    contextBudgetArbiter.resetForTesting()
  })

  const hook = createTaskResumeInfoHook()
  const afterHook = hook["tool.execute.after"]

  const createInput = (tool: string) => ({
    tool,
    sessionID: "test-session",
    callID: "test-call-id",
  })

  test("does not crash when output.output is undefined", async () => {
    // #given
    const input = createInput("task")
    const output = {
      title: "task",
      output: undefined as unknown as string,
      metadata: {},
    }

    // #when
    await afterHook(input, output)

    // #then
    expect(output.output).toBeUndefined()
  })

  test("appends continuation guidance when session id exists", async () => {
    // #given
    const input = createInput("delegate_task")
    const output = {
      title: "delegate_task",
      output: "Task completed.\nSession ID: ses_abc123",
      metadata: {},
    }

    // #when
    await afterHook(input, output)

    // #then
    expect(output.output).toContain("to continue: delegate_task")
    expect(output.output).toContain('session_id="ses_abc123"')
  })
})
