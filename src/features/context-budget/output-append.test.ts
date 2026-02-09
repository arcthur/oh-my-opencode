import { describe, expect, test } from "bun:test"
import { ContextBudgetArbiter } from "./arbiter"
import { appendBudgetedOutput, pushBudgetedContext, injectBudgetedPrompt } from "./output-append"

describe("appendBudgetedOutput", () => {
  test("appends content when budget allows", () => {
    // #given
    const arbiter = new ContextBudgetArbiter()
    const output = { output: "base" }

    // #when
    const decision = appendBudgetedOutput(
      {
        output,
        sessionID: "session-1",
        source: "test-source",
        id: "append-1",
        content: "\n\nextra",
      },
      arbiter
    )

    // #then
    expect(decision.accepted).toBe(true)
    expect(output.output).toBe("base\n\nextra")
  })

  test("drops content when budget is exhausted", () => {
    // #given
    const arbiter = new ContextBudgetArbiter()
    arbiter.setBudgetConfig({
      total_budget: 1,
      reserved_budget: 0,
      overflow_strategy: "drop-low-priority",
    })
    const output = { output: "base" }

    // #when
    const decision = appendBudgetedOutput(
      {
        output,
        sessionID: "session-2",
        source: "test-source",
        id: "append-2",
        content: "this should be dropped",
      },
      arbiter
    )

    // #then
    expect(decision.accepted).toBe(false)
    expect(output.output).toBe("base")
  })

  test("pushes context when budget allows", () => {
    // #given
    const arbiter = new ContextBudgetArbiter()
    const output = { context: [] as string[] }

    // #when
    const decision = pushBudgetedContext(
      {
        output,
        sessionID: "session-3",
        source: "test-source",
        id: "context-1",
        content: "compaction reminder",
      },
      arbiter
    )

    // #then
    expect(decision.accepted).toBe(true)
    expect(output.context).toEqual(["compaction reminder"])
  })

  test("prepends prompt content when budget allows", () => {
    // #given
    const arbiter = new ContextBudgetArbiter()
    const output = { args: { prompt: "original prompt" } as Record<string, unknown> }

    // #when
    const decision = injectBudgetedPrompt(
      {
        output,
        sessionID: "session-4",
        source: "test-source",
        id: "prompt-1",
        content: "[prefix] ",
      },
      arbiter
    )

    // #then
    expect(decision?.accepted).toBe(true)
    expect(output.args.prompt).toBe("[prefix] original prompt")
  })

  test("keeps prompt untouched when budget rejects injection", () => {
    // #given
    const arbiter = new ContextBudgetArbiter()
    arbiter.setBudgetConfig({
      total_budget: 0,
      reserved_budget: 0,
      overflow_strategy: "drop-low-priority",
    })
    const output = { args: { prompt: "original prompt" } as Record<string, unknown> }

    // #when
    const decision = injectBudgetedPrompt(
      {
        output,
        sessionID: "session-5",
        source: "test-source",
        id: "prompt-2",
        content: "[prefix] ",
      },
      arbiter
    )

    // #then
    expect(decision?.accepted).toBe(false)
    expect(output.args.prompt).toBe("original prompt")
  })
})
