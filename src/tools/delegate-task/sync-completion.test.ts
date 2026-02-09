import { describe, expect, test } from "bun:test"
import { getSyncCompletionState } from "./sync-completion"

describe("getSyncCompletionState", () => {
  test("returns complete when assistant has terminal finish and id greater than user", () => {
    // #given
    const messages = [
      { info: { id: "msg_001", role: "user" } },
      { info: { id: "msg_002", role: "assistant", finish: "end_turn" } },
    ]

    // #when
    const result = getSyncCompletionState(messages)

    // #then
    expect(result).toBe("complete")
  })

  test("returns incomplete when assistant finish is tool-calls", () => {
    // #given
    const messages = [
      { info: { id: "msg_001", role: "user" } },
      { info: { id: "msg_002", role: "assistant", finish: "tool-calls" } },
    ]

    // #when
    const result = getSyncCompletionState(messages)

    // #then
    expect(result).toBe("incomplete")
  })

  test("returns incomplete when latest user id is greater than assistant id", () => {
    // #given
    const messages = [
      { info: { id: "msg_001", role: "user" } },
      { info: { id: "msg_002", role: "assistant", finish: "end_turn" } },
      { info: { id: "msg_003", role: "user" } },
    ]

    // #when
    const result = getSyncCompletionState(messages)

    // #then
    expect(result).toBe("incomplete")
  })

  test("returns unknown when finish metadata is missing", () => {
    // #given
    const messages = [
      { info: { id: "msg_001", role: "user" } },
      { info: { id: "msg_002", role: "assistant" } },
    ]

    // #when
    const result = getSyncCompletionState(messages)

    // #then
    expect(result).toBe("unknown")
  })
})
