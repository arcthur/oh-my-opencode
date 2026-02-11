import { describe, expect, test } from "bun:test"
import { EXECUTION_OWNER, getExecutionOwner } from "./owner"

describe("execution owner", () => {
  test("uses atlas as the execution owner", () => {
    // #given / #when / #then
    expect(EXECUTION_OWNER).toBe("atlas")
    expect(getExecutionOwner()).toBe("atlas")
  })
})
