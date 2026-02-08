import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("runtime lifecycle surfaces", () => {
  test("registers command.execute.before runtime ordering", () => {
    expect(EVENT_TOTAL_ORDER["command.execute.before"]).toContain(
      "auto-slash-command:command.execute.before"
    )
  })

  test("registers chat.headers runtime ordering", () => {
    expect(EVENT_TOTAL_ORDER["chat.headers"]).toEqual([
      "internal:copilot-anthropic-beta:chat.headers",
      "internal:copilot-subagent-initiator:chat.headers",
    ])
  })

  test("registers shell.env runtime ordering", () => {
    expect(EVENT_TOTAL_ORDER["shell.env"]).toContain(
      "internal:non-interactive-env:shell.env"
    )
  })
})
