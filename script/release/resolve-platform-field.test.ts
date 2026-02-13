import { describe, expect, it } from "bun:test"

import { PLATFORM_TARGETS } from "./platforms"

describe("resolve platform field", () => {
  it("can resolve target for every known platform", () => {
    // #given
    const platforms = PLATFORM_TARGETS

    // #when / #then
    for (const platform of platforms) {
      expect(platform.target.startsWith("bun-")).toBe(true)
    }
  })

  it("can resolve binary for every known platform", () => {
    // #given
    const platforms = PLATFORM_TARGETS

    // #when / #then
    for (const platform of platforms) {
      if (platform.dir.startsWith("windows")) {
        expect(platform.binary).toBe("oh-my-opencode.exe")
      } else {
        expect(platform.binary).toBe("oh-my-opencode")
      }
    }
  })
})
