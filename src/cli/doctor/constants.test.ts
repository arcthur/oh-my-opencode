import { describe, expect, it } from "bun:test"
import { MINIMUM_OPENCODE_VERSION } from "../../shared/opencode-version"
import { MIN_OPENCODE_VERSION } from "./constants"

describe("doctor constants", () => {
  it("MIN_OPENCODE_VERSION matches shared minimum", () => {
    // #given MINIMUM_OPENCODE_VERSION is the canonical minimum in shared utils
    // #when doctor exports its minimum
    // #then the values should stay aligned (single source of truth)
    expect(MIN_OPENCODE_VERSION).toBe(MINIMUM_OPENCODE_VERSION)
  })
})

