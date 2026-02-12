import { describe, expect, test } from "bun:test"
import { createDelegateTask } from "./tools"

describe("createDelegateTask category visibility", () => {
  test("does not expose disabled categories in tool description", () => {
    // #given
    const tool = createDelegateTask({
      manager: {} as never,
      client: {} as never,
      userCategories: {
        quick: { disable: true },
      },
    })

    // #when
    const description = tool.description

    // #then
    expect(description).not.toContain("quick:")
    expect(description).toContain("visual-engineering:")
  })
})
