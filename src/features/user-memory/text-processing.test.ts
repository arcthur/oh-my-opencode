import { describe, expect, test } from "bun:test"
import { expandWithSynonyms, preprocessText } from "./text-processing"

describe("text-processing", () => {
  test("keeps meaningful 2-letter tokens like 'ci'", () => {
    //#given
    const text = "CI pipeline"

    //#when
    const tokens = preprocessText(text)

    //#then
    expect(tokens.has("ci")).toBe(true)
  })

  test("can disable synonym canonicalization and stemming", () => {
    //#given
    const text = "CI pipeline"

    //#when
    const tokens = preprocessText(text, { useSynonyms: false, useStemming: false })

    //#then
    expect(tokens.has("ci")).toBe(true)
    expect(tokens.has("pipeline")).toBe(true)
  })

  test("preserves compound tokens and also emits split parts", () => {
    //#given
    const text = "snake_case kebab-case"

    //#when
    const tokens = preprocessText(text, { useSynonyms: false, useStemming: false })

    //#then
    expect(tokens.has("snake_case")).toBe(true)
    expect(tokens.has("snake")).toBe(true)
    expect(tokens.has("case")).toBe(true)
    expect(tokens.has("kebab-case")).toBe(true)
    expect(tokens.has("kebab")).toBe(true)
  })

  test("does not split technical tokens like 'c++' and 'c#'", () => {
    //#given
    const text = "C++ C#"

    //#when
    const tokens = preprocessText(text, { useSynonyms: false, useStemming: true })

    //#then
    expect(tokens.has("c++")).toBe(true)
    expect(tokens.has("c#")).toBe(true)
    expect(tokens.has("c")).toBe(false)
  })

  test("expandWithSynonyms normalizes underscore/hyphen variants", () => {
    //#given
    const tokens = new Set(["snake_case"])

    //#when
    const expanded = expandWithSynonyms(tokens)

    //#then
    expect(expanded.has("snake_case")).toBe(true)
    expect(expanded.has("snakecase")).toBe(true)
    expect(expanded.has("underscore")).toBe(true)
  })

  test("preprocessText canonicalizes synonyms when enabled", () => {
    //#given
    const text = "underscore"

    //#when
    const tokens = preprocessText(text, { useSynonyms: true, useStemming: false })

    //#then
    expect(tokens.has("snake_case")).toBe(true)
  })
})
