import { describe, expect, test } from "bun:test"
import { parseJsonc } from "../../shared"
import { modifyProviderInJsonc } from "./jsonc-provider-editor"

describe("modifyProviderInJsonc", () => {
  test("preserves comments and updates provider object", () => {
    // #given
    const original = `{
  // keep this comment
  "provider": {
    "custom": {
      "enabled": true
    }
  },
  "plugin": []
}
`
    const nextProvider = {
      custom: {
        enabled: true,
      },
      google: {
        name: "Google",
      },
    }

    // #when
    const updated = modifyProviderInJsonc(original, nextProvider)
    const parsed = parseJsonc<{
      provider?: {
        custom?: { enabled?: boolean }
        google?: { name?: string }
      }
      plugin?: unknown[]
    }>(updated)

    // #then
    expect(updated).toContain("// keep this comment")
    expect(parsed.provider?.custom?.enabled).toBe(true)
    expect(parsed.provider?.google?.name).toBe("Google")
    expect(Array.isArray(parsed.plugin)).toBe(true)
  })
})
