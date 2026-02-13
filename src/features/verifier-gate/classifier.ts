import type { VerificationEvidence } from "./types"

const LSP_TOOL_NAMES = new Set([
  "lsp_diagnostics",
  "lspdiagnostics",
])

const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "notebookedit",
])

const TEST_OR_BUILD_PATTERNS: RegExp[] = [
  /\b(test|tests|vitest|jest|pytest|go test|cargo test)\b/i,
  /\b(build|typecheck|tsc|mypy|ruff|eslint)\b/i,
]

function getCommandFromArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return ""
  const command = args.command ?? args.cmd ?? args.script
  return typeof command === "string" ? command : ""
}

function inferSuccess(metadata: Record<string, unknown> | undefined, output: string): boolean {
  if (typeof metadata?.success === "boolean") {
    return metadata.success
  }
  if (typeof metadata?.exitCode === "number") {
    return metadata.exitCode === 0
  }

  const lowered = output.toLowerCase()
  if (lowered.includes("error:") || lowered.includes("failed") || lowered.includes("failures")) {
    return false
  }
  return true
}

function isLspCleanOutput(output: string): boolean {
  return /\bno diagnostics found\b/i.test(output)
}

function isUnfilteredLspSeverity(args: Record<string, unknown> | undefined): boolean {
  if (!args) return true
  const severity = args.severity
  if (severity === undefined || severity === null) return true
  if (typeof severity !== "string") return false
  const normalized = severity.trim().toLowerCase()
  return normalized === "" || normalized === "all"
}

export function isWriteMutationTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName.toLowerCase())
}

export function classifyVerificationEvidence(input: {
  now: number
  tool: string
  args?: Record<string, unknown>
  output?: string
  metadata?: Record<string, unknown>
}): VerificationEvidence[] {
  const toolName = input.tool.toLowerCase()
  const output = typeof input.output === "string" ? input.output : ""
  const success = inferSuccess(input.metadata, output)
  if (!success) return []

  const evidence: VerificationEvidence[] = []

  if (LSP_TOOL_NAMES.has(toolName) && isUnfilteredLspSeverity(input.args) && isLspCleanOutput(output)) {
    evidence.push({
      kind: "lsp_clean",
      timestamp: input.now,
      tool: input.tool,
      detail: "lsp diagnostics clean",
    })
  }

  if (toolName === "bash" || toolName === "shell") {
    const command = getCommandFromArgs(input.args)
    if (command && TEST_OR_BUILD_PATTERNS.some((pattern) => pattern.test(command))) {
      evidence.push({
        kind: "test_or_build_passed",
        timestamp: input.now,
        tool: input.tool,
        detail: command.slice(0, 200),
      })
    }
  }

  return evidence
}
