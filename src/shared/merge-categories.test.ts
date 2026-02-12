import { describe, expect, test } from "bun:test"
import { mergeCategories } from "./merge-categories"
import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

describe("mergeCategories", () => {
  test("returns all default categories when user config is undefined", () => {
    // #when
    const result = mergeCategories(undefined)

    // #then
    expect(Object.keys(result)).toEqual(Object.keys(DEFAULT_CATEGORIES))
  })

  test("filters out builtin categories marked disable=true", () => {
    // #given
    const userCategories = {
      quick: { disable: true },
    }

    // #when
    const result = mergeCategories(userCategories)

    // #then
    expect(result.quick).toBeUndefined()
    expect(result["visual-engineering"]).toBeDefined()
  })

  test("keeps category when disable=false", () => {
    // #given
    const userCategories = {
      quick: { disable: false },
    }

    // #when
    const result = mergeCategories(userCategories)

    // #then
    expect(result.quick).toBeDefined()
  })

  test("supports custom category and can disable it", () => {
    // #given
    const userCategories = {
      "my-custom-enabled": { model: "openai/gpt-5.3-codex", description: "enabled custom" },
      "my-custom-disabled": { model: "openai/gpt-5.3-codex", disable: true },
    }

    // #when
    const result = mergeCategories(userCategories)

    // #then
    expect(result["my-custom-enabled"]).toBeDefined()
    expect(result["my-custom-disabled"]).toBeUndefined()
  })
})
