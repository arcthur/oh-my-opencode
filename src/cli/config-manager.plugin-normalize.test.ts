import { describe, expect, test } from "bun:test"
import { normalizePluginList } from "./config-manager"

describe("normalizePluginList", () => {
  test("returns empty array when plugin value is not an array", () => {
    // #given
    const pluginValue: unknown = "oh-my-opencode"

    // #when
    const result = normalizePluginList(pluginValue)

    // #then
    expect(result).toEqual([])
  })

  test("returns only string entries when plugin array contains mixed types", () => {
    // #given
    const pluginValue: unknown = ["oh-my-opencode", 123, { name: "bad" }, "opencode-antigravity-auth"] as const

    // #when
    const result = normalizePluginList(pluginValue)

    // #then
    expect(result).toEqual(["oh-my-opencode", "opencode-antigravity-auth"])
  })
})
