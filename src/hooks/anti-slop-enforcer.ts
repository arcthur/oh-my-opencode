import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../shared/logger"

const HOOK_NAME = "anti-slop-enforcer"

interface SlopPattern {
  pattern: RegExp
  message: string
  severity: "error" | "warning"
}

const DEFAULT_SLOP_PATTERNS: SlopPattern[] = [
  // Type safety violations
  {
    pattern: /\bas\s+any\b/g,
    message: "Type suppression: `as any` - use proper typing or `unknown`",
    severity: "error",
  },
  {
    pattern: /@ts-ignore\b/g,
    message: "Type suppression: `@ts-ignore` - fix the type error instead",
    severity: "error",
  },
  {
    pattern: /@ts-expect-error\b/g,
    message: "Type suppression: `@ts-expect-error` - fix the type error instead",
    severity: "warning",
  },
  {
    pattern: /:\s*any\b(?!\s*\))/g,
    message: "Explicit `any` type - use a specific type or `unknown`",
    severity: "warning",
  },

  // Error handling violations
  {
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
    message: "Empty catch block - at minimum log the error",
    severity: "error",
  },

  // Debug artifacts
  {
    pattern: /console\.log\s*\(/g,
    message: "Debug logging: `console.log` - remove or use proper logging",
    severity: "warning",
  },
  {
    pattern: /debugger\s*;?/g,
    message: "Debugger statement left in code",
    severity: "error",
  },

  // TODO/FIXME in new code
  {
    pattern: /\/\/\s*TODO(?!:)/gi,
    message: "TODO comment without context - use TodoWrite tool instead",
    severity: "warning",
  },
]

const MONITORED_TOOLS = ["Write", "Edit", "write", "edit"]

export interface AntiSlopEnforcerOptions {
  customPatterns?: Array<{
    pattern: string
    message: string
    severity?: "error" | "warning"
  }>
  disabled?: boolean
}

export function createAntiSlopEnforcerHook(
  _ctx: PluginInput,
  options?: AntiSlopEnforcerOptions
) {
  if (options?.disabled) {
    return {}
  }

  const patterns = [...DEFAULT_SLOP_PATTERNS]

  if (options?.customPatterns) {
    for (const custom of options.customPatterns) {
      try {
        patterns.push({
          pattern: new RegExp(custom.pattern, "g"),
          message: custom.message,
          severity: custom.severity ?? "warning",
        })
      } catch (err) {
        log(`[${HOOK_NAME}] Invalid custom pattern: ${custom.pattern}`, { error: String(err) })
      }
    }
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!MONITORED_TOOLS.includes(input.tool)) return

    const content = output.output
    if (!content || typeof content !== "string") return

    const violations: Array<{ message: string; severity: "error" | "warning" }> = []

    for (const { pattern, message, severity } of patterns) {
      pattern.lastIndex = 0
      if (pattern.test(content)) {
        violations.push({ message, severity })
      }
    }

    if (violations.length === 0) return

    const errors = violations.filter((v) => v.severity === "error")
    const warnings = violations.filter((v) => v.severity === "warning")

    const warningBlock = [
      "",
      "",
      "─".repeat(50),
      "[ANTI-SLOP DETECTION]",
      "",
    ]

    if (errors.length > 0) {
      warningBlock.push("ERRORS (must fix):")
      for (const { message } of errors) {
        warningBlock.push(`  ✗ ${message}`)
      }
    }

    if (warnings.length > 0) {
      if (errors.length > 0) warningBlock.push("")
      warningBlock.push("WARNINGS (should fix):")
      for (const { message } of warnings) {
        warningBlock.push(`  ⚠ ${message}`)
      }
    }

    warningBlock.push("")
    warningBlock.push("Fix these issues before proceeding.")
    warningBlock.push("─".repeat(50))

    output.output += warningBlock.join("\n")

    log(`[${HOOK_NAME}] Detected ${violations.length} slop patterns`, {
      sessionID: input.sessionID,
      tool: input.tool,
      errors: errors.length,
      warnings: warnings.length,
    })
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
