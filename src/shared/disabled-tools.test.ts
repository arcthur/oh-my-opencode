import { describe, expect, test } from "bun:test"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { filterDisabledTools } from "./disabled-tools"

const DUMMY_TOOL: ToolDefinition = {
  description: "dummy",
  args: {},
  execute: async () => "ok",
}

describe("filterDisabledTools", () => {
  test("returns original tools when disabled_tools is undefined", () => {
    //#given
    const tools: Record<string, ToolDefinition> = {
      foo: DUMMY_TOOL,
      bar: DUMMY_TOOL,
    }

    //#when
    const filtered = filterDisabledTools(tools, undefined)

    //#then
    expect(Object.keys(filtered).sort()).toEqual(["bar", "foo"])
  })

  test("removes tools listed in disabled_tools", () => {
    //#given
    const tools: Record<string, ToolDefinition> = {
      foo: DUMMY_TOOL,
      bar: DUMMY_TOOL,
      baz: DUMMY_TOOL,
    }

    //#when
    const filtered = filterDisabledTools(tools, ["bar", "baz"])

    //#then
    expect(Object.keys(filtered).sort()).toEqual(["foo"])
  })

  test("matches tool names exactly", () => {
    //#given
    const tools: Record<string, ToolDefinition> = {
      call_omo_agent: DUMMY_TOOL,
      call: DUMMY_TOOL,
    }

    //#when
    const filtered = filterDisabledTools(tools, ["call"])

    //#then
    expect(Object.keys(filtered).sort()).toEqual(["call_omo_agent"])
  })
})
