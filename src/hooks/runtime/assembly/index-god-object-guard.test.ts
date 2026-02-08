import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("runtime assembly guard", () => {
  test("index.ts delegates event node assembly to runtime builders", () => {
    // #given
    const root = join(import.meta.dir, "../../../")
    const source = readFileSync(join(root, "index.ts"), "utf-8")

    // #then
    expect(source.includes("nodes.push(")).toBe(false)
    expect(source.includes("buildChatMessageNodes(")).toBe(true)
    expect(source.includes("buildUserPromptSubmitNodes(")).toBe(true)
    expect(source.includes("buildToolExecuteBeforeNodes(")).toBe(true)
    expect(source.includes("buildToolExecuteAfterNodes(")).toBe(true)
    expect(source.includes("buildEventNodes(")).toBe(true)
    expect(source.includes("buildExperimentalChatTransformNodes(")).toBe(true)
    expect(source.includes("buildExperimentalSessionCompactingNodes(")).toBe(true)
  })
})
