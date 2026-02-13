import { describe, expect, test } from "bun:test"
import { classifyVerificationEvidence } from "./classifier"

describe("verifier-gate classifier", () => {
  test("records lsp_clean evidence only when diagnostics output is clean", () => {
    // #given
    const now = Date.now()

    // #when
    const evidence = classifyVerificationEvidence({
      now,
      tool: "lsp_diagnostics",
      args: { filePath: "src/index.ts" },
      output: "No diagnostics found",
      metadata: { success: true },
    })

    // #then
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.kind).toBe("lsp_clean")
  })

  test("does not record lsp_clean when diagnostics are present", () => {
    // #given
    const now = Date.now()

    // #when
    const evidence = classifyVerificationEvidence({
      now,
      tool: "lsp_diagnostics",
      args: { filePath: "src/index.ts" },
      output: "1:1 [error] missing semicolon",
      metadata: { success: true },
    })

    // #then
    expect(evidence).toHaveLength(0)
  })

  test("does not record lsp_clean when severity-filtered request is used", () => {
    // #given
    const now = Date.now()

    // #when
    const evidence = classifyVerificationEvidence({
      now,
      tool: "lsp_diagnostics",
      args: { filePath: "src/index.ts", severity: "error" },
      output: "No diagnostics found",
      metadata: { success: true },
    })

    // #then
    expect(evidence).toHaveLength(0)
  })
})

