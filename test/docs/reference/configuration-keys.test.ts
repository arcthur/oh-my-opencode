import { describe, expect, it } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"
import { OhMyOpenCodeConfigSchema } from "../../../src/config/schema"

function getTopLevelConfigKeys(): string[] {
  const schema = OhMyOpenCodeConfigSchema as unknown as {
    shape?: Record<string, unknown>
    _def?: { shape?: () => Record<string, unknown> }
  }

  const shape = schema.shape ?? schema._def?.shape?.()
  if (!shape || typeof shape !== "object") {
    throw new Error("Unable to introspect OhMyOpenCodeConfigSchema shape")
  }

  return Object.keys(shape)
}

describe("docs/reference configuration coverage", () => {
  it("documents all top-level OhMyOpenCode config keys", () => {
    // #given top-level config keys from schema
    const repoRoot = resolve(import.meta.dirname, "../../..")
    const keys = getTopLevelConfigKeys()
    const markdownPath = resolve(repoRoot, "docs/reference/configuration.md")
    const markdown = readFileSync(markdownPath, "utf-8")

    // #when checking for key mentions in the configuration contract
    const missing = keys.filter((key) => !markdown.includes(`\`${key}\``))

    // #then every key should be documented at least once
    expect(missing, `Missing keys in docs/reference/configuration.md: ${missing.join(", ")}`).toEqual([])
  })
})
