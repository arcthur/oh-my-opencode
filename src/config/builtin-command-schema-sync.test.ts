import { describe, expect, test } from "bun:test"
import { loadBuiltinCommands } from "../features/builtin-commands"
import { BuiltinCommandNameSchema } from "./schema"

describe("BuiltinCommandNameSchema sync", () => {
  test("schema enum matches builtin command registry", () => {
    //#given
    const schemaNames = [...BuiltinCommandNameSchema.options].sort()
    const builtinNames = Object.keys(loadBuiltinCommands()).sort()

    //#when / #then
    expect(schemaNames).toEqual(builtinNames)
  })
})
