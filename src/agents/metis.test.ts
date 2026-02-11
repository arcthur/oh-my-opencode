import { describe, expect, test } from "bun:test"
import { METIS_SYSTEM_PROMPT } from "./metis"

describe("METIS_SYSTEM_PROMPT contract", () => {
  test("treats Prometheus intent as authoritative and only overrides on mismatch", () => {
    // #given
    const prompt = METIS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("prometheus intent classification is authoritative")
    expect(prompt).toContain("only override when evidence strongly contradicts")
  })

  test("requires explicit intent validation verdict in output", () => {
    // #given
    const prompt = METIS_SYSTEM_PROMPT.toLowerCase()

    // #when / #then
    expect(prompt).toContain("intent validation")
    expect(prompt).toContain("match | override")
  })
})
