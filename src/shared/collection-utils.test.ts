import { describe, it, expect } from "bun:test"
import { toRecord, toOpenCodeDefinition, toDefinitionRecord } from "./collection-utils"
import type { CommandDefinition } from "../features/claude-code-command-loader/types"

describe("toRecord", () => {
  it("converts empty array to empty record", () => {
    const result = toRecord([], (x) => x, (x) => x)
    expect(result).toEqual({})
  })

  it("converts array with simple key/value extraction", () => {
    const items = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ]
    const result = toRecord(items, (item) => item.id, (item) => item.value)

    expect(result).toEqual({ a: 1, b: 2 })
  })

  it("uses custom key function", () => {
    const items = [{ name: "Alice" }, { name: "Bob" }]
    const result = toRecord(
      items,
      (item) => item.name.toLowerCase(),
      (item) => item
    )

    expect(result).toEqual({
      alice: { name: "Alice" },
      bob: { name: "Bob" },
    })
  })

  it("uses custom value function", () => {
    const items = [
      { key: "x", data: { nested: true } },
      { key: "y", data: { nested: false } },
    ]
    const result = toRecord(
      items,
      (item) => item.key,
      (item) => item.data.nested
    )

    expect(result).toEqual({ x: true, y: false })
  })

  it("last item wins for duplicate keys", () => {
    const items = [
      { id: "same", value: "first" },
      { id: "same", value: "second" },
    ]
    const result = toRecord(items, (item) => item.id, (item) => item.value)

    expect(result).toEqual({ same: "second" })
  })

  it("works with complex objects", () => {
    interface Agent {
      name: string
      config: { description: string; mode: string }
    }
    const agents: Agent[] = [
      { name: "explorer", config: { description: "Explores", mode: "subagent" } },
      { name: "planner", config: { description: "Plans", mode: "subagent" } },
    ]

    const result = toRecord(agents, (a) => a.name, (a) => a.config)

    expect(result).toEqual({
      explorer: { description: "Explores", mode: "subagent" },
      planner: { description: "Plans", mode: "subagent" },
    })
  })
})

describe("toOpenCodeDefinition", () => {
  it("strips name field from definition", () => {
    const definition: CommandDefinition = {
      name: "my-command",
      description: "A command",
      template: "Do something",
    }

    const result = toOpenCodeDefinition(definition)

    expect(result.name).toBeUndefined()
    expect(result.description).toBe("A command")
    expect(result.template).toBe("Do something")
  })

  it("strips argumentHint field from definition", () => {
    const definition: CommandDefinition = {
      name: "my-command",
      description: "A command",
      template: "Do something",
      argumentHint: "<file>",
    }

    const result = toOpenCodeDefinition(definition)

    expect(result.argumentHint).toBeUndefined()
  })

  it("preserves other fields", () => {
    const definition: CommandDefinition = {
      name: "my-command",
      description: "A command",
      template: "Do something",
      agent: "explorer",
      model: "sonnet",
      subtask: true,
      argumentHint: "<file>",
    }

    const result = toOpenCodeDefinition(definition)

    expect(result.description).toBe("A command")
    expect(result.template).toBe("Do something")
    expect(result.agent).toBe("explorer")
    expect(result.model).toBe("sonnet")
    expect(result.subtask).toBe(true)
  })

  it("handles definition with only required fields", () => {
    const definition: CommandDefinition = {
      name: "minimal",
      template: "Do it",
    }

    const result = toOpenCodeDefinition(definition)

    expect(result.template).toBe("Do it")
    expect(result.name).toBeUndefined()
    expect(result.argumentHint).toBeUndefined()
  })
})

describe("toDefinitionRecord", () => {
  it("converts empty array to empty record", () => {
    const result = toDefinitionRecord([])
    expect(result).toEqual({})
  })

  it("converts items to record with stripped definitions", () => {
    const items = [
      {
        name: "cmd1",
        definition: {
          name: "cmd1",
          description: "Command 1",
          template: "Do 1",
          argumentHint: "<arg>",
        } as CommandDefinition,
      },
      {
        name: "cmd2",
        definition: {
          name: "cmd2",
          description: "Command 2",
          template: "Do 2",
        } as CommandDefinition,
      },
    ]

    const result = toDefinitionRecord(items)

    expect(Object.keys(result)).toEqual(["cmd1", "cmd2"])
    expect(result.cmd1.name).toBeUndefined()
    expect(result.cmd1.argumentHint).toBeUndefined()
    expect(result.cmd1.description).toBe("Command 1")
    expect(result.cmd2.description).toBe("Command 2")
  })

  it("works with items that have extra properties", () => {
    interface LoadedCommand {
      name: string
      path: string
      definition: CommandDefinition
      scope: string
    }

    const items: LoadedCommand[] = [
      {
        name: "test",
        path: "/path/to/test.md",
        definition: { name: "test", description: "Test", template: "T" } as CommandDefinition,
        scope: "user",
      },
    ]

    const result = toDefinitionRecord(items)

    expect(result.test.description).toBe("Test")
    expect(result.test.name).toBeUndefined()
  })
})
