import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("get-local-version source guard", () => {
  it("imports getLocalDevVersion from checker", () => {
    // #given
    const source = readFileSync(join(import.meta.dir, "index.ts"), "utf-8")

    // #when / #then
    expect(source).toContain("getLocalDevVersion")
  })

  it("prefers local-dev version with cached fallback", () => {
    // #given
    const source = readFileSync(join(import.meta.dir, "index.ts"), "utf-8")

    // #when / #then
    expect(source).toContain("getLocalDevVersion(directory) ?? getCachedVersion()")
  })
})
