import { describe, test, expect } from "bun:test"
import { truncateDescription } from "./truncate-description"

describe("truncateDescription", () => {
  test("returns empty string as-is", () => {
    //#given
    const description = ""

    //#when
    const result = truncateDescription(description)

    //#then
    expect(result).toBe("")
  })

  test("returns short description as-is", () => {
    //#given
    const description = "A short description"

    //#when
    const result = truncateDescription(description)

    //#then
    expect(result).toBe("A short description")
  })

  test("returns description at exact max length as-is", () => {
    //#given
    const description = "a".repeat(120)

    //#when
    const result = truncateDescription(description)

    //#then
    expect(result).toBe(description)
  })

  test("truncates description exceeding max length", () => {
    //#given
    const description = "a".repeat(200)

    //#when
    const result = truncateDescription(description)

    //#then
    expect(result).toBe("a".repeat(120) + "...")
    expect(result.length).toBe(123)
  })

  test("respects custom max length", () => {
    //#given
    const description = "This is a longer description that exceeds limit"

    //#when
    const result = truncateDescription(description, 20)

    //#then
    expect(result).toBe("This is a longer des...")
  })
})
