import { describe, expect, test } from "bun:test"
import { EVENT_TOTAL_ORDER } from "./pipeline-order"

describe("EVENT_TOTAL_ORDER parity", () => {
  test("matches baseline event ordering snapshot", () => {
    expect(EVENT_TOTAL_ORDER).toMatchSnapshot()
  })
})
