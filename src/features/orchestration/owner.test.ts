import { describe, expect, test } from "bun:test"
import { EXECUTION_OWNER, getExecutionOwner } from "./owner"

describe("execution owner", () => {
  test("uses workflow-automator as the execution owner", () => {
    // #given / #when / #then
    expect(EXECUTION_OWNER).toBe("workflow-automator")
    expect(getExecutionOwner()).toBe("workflow-automator")
  })
})
