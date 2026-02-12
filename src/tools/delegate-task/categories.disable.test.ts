import { describe, expect, test } from "bun:test"
import { resolveCategoryConfig } from "./categories"

const SYSTEM_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"

describe("resolveCategoryConfig disable behavior", () => {
  test("returns null when builtin category is disabled by user config", () => {
    // #when
    const result = resolveCategoryConfig("quick", {
      userCategories: {
        quick: { disable: true },
      },
      systemDefaultModel: SYSTEM_DEFAULT_MODEL,
    })

    // #then
    expect(result).toBeNull()
  })

  test("returns null when custom category is disable=true", () => {
    // #when
    const result = resolveCategoryConfig("my-custom", {
      userCategories: {
        "my-custom": { model: "openai/gpt-5.3-codex", disable: true },
      },
      systemDefaultModel: SYSTEM_DEFAULT_MODEL,
    })

    // #then
    expect(result).toBeNull()
  })

  test("returns config when disable is false", () => {
    // #when
    const result = resolveCategoryConfig("quick", {
      userCategories: {
        quick: { disable: false },
      },
      systemDefaultModel: SYSTEM_DEFAULT_MODEL,
    })

    // #then
    expect(result).not.toBeNull()
  })
})
