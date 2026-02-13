import { describe, expect, test } from "bun:test"
import { createWorkflowAutomatorAgent } from "./agent"

describe("createWorkflowAutomatorAgent", () => {
  test("should deny task but not include deprecated call_omo_agent permission", () => {
    // #given
    const config = createWorkflowAutomatorAgent({})

    // #when
    const permission = config.permission as Record<string, string> | undefined

    // #then
    expect(permission?.task).toBe("deny")
    expect(permission?.question).toBe("allow")
    expect(permission).not.toHaveProperty("call_omo_agent")
  })
})
