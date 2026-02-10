import { describe, expect, test } from "bun:test"
import { createAtlasAgent } from "./agent"

describe("createAtlasAgent", () => {
  test("should deny task but not include deprecated call_omo_agent permission", () => {
    // #given
    const config = createAtlasAgent({})

    // #when
    const permission = config.permission as Record<string, string> | undefined

    // #then
    expect(permission?.task).toBe("deny")
    expect(permission?.question).toBe("allow")
    expect(permission).not.toHaveProperty("call_omo_agent")
  })
})
