import { describe, expect, test } from "bun:test"
import { parseDiscoveryMarkers } from "./parser"

describe("discovery-channel parser", () => {
  test("parses xml and prefix markers in hybrid mode", () => {
    const text = `
<discovery>Potential null pointer in auth cache</discovery>
DISCOVERY: Missing integration test for retry path
`

    const parsed = parseDiscoveryMarkers(text, "hybrid")
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toContain("Potential null pointer")
    expect(parsed[1]).toContain("Missing integration test")
  })

  test("dedupes repeated markers", () => {
    const text = `
DISCOVERY:   Duplicate item
DISCOVERY: duplicate   item
`

    const parsed = parseDiscoveryMarkers(text, "prefix")
    expect(parsed).toEqual(["Duplicate item"])
  })
})
