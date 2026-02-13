import { tool, type ToolDefinition, type PluginInput } from "@opencode-ai/plugin"
import { runCartography } from "../../features/cartography/service"
import {
  DEFAULT_CARTOGRAPHY_CONFIG,
  type CartographyConfig,
  type CartographyResult,
  type ChangeReport,
} from "../../features/cartography/types"

interface CartographyArgs {
  mode?: "init" | "update" | "changes"
  force?: boolean
  max_depth?: number
  min_files?: number
  include_patterns?: string[]
  exclude_patterns?: string[]
}

type RunCartographyFn = typeof runCartography

export interface CreateCartographyToolOptions {
  directory: string
  pluginInput?: PluginInput
  cartographyConfig?: Partial<CartographyConfig>
  runCartographyFn?: RunCartographyFn
}

function formatList(title: string, items: string[], maxItems: number = 10): string[] {
  const lines: string[] = [title]
  if (items.length === 0) {
    lines.push("- (none)")
    return lines
  }

  for (const item of items.slice(0, maxItems)) {
    lines.push(`- ${item}`)
  }
  if (items.length > maxItems) {
    lines.push(`- ... ${items.length - maxItems} more`)
  }
  return lines
}

function isChangeReport(result: CartographyResult | ChangeReport): result is ChangeReport {
  return "changedDirs" in result
}

function formatChangeReport(result: ChangeReport): string {
  const lines: string[] = [
    "## Cartography",
    "",
    "Mode: changes",
    "",
    `Stats: total: ${result.stats.totalDirs}, changed: ${result.stats.changedCount}, new: ${result.stats.newCount}, deleted: ${result.stats.deletedCount}, up_to_date: ${result.stats.upToDateCount}`,
    "",
    ...formatList("Changed directories:", result.changedDirs),
    "",
    ...formatList("New directories:", result.newDirs),
    "",
    ...formatList("Deleted directories:", result.deletedDirs),
    "",
    ...formatList("Stale codemaps:", result.staleCodemaps),
  ]
  return lines.join("\n")
}

function formatCartographyResult(result: CartographyResult): string {
  const lines: string[] = [
    "## Cartography",
    "",
    `Mode: ${result.mode}`,
    "",
    `Summary: analyzed: ${result.analyzedDirs.length}, created: ${result.createdCodemaps.length}, updated: ${result.updatedCodemaps.length}, skipped: ${result.skippedDirs.length}, errors: ${result.errors.length}, duration_ms: ${result.durationMs}`,
    "",
    ...formatList("Created codemaps:", result.createdCodemaps),
    "",
    ...formatList("Updated codemaps:", result.updatedCodemaps),
  ]

  if (result.errors.length > 0) {
    lines.push("")
    lines.push("Errors:")
    for (const error of result.errors.slice(0, 10)) {
      lines.push(`- [${error.phase}] ${error.directory}: ${error.message}`)
    }
    if (result.errors.length > 10) {
      lines.push(`- ... ${result.errors.length - 10} more`)
    }
  }

  return lines.join("\n")
}

export function createCartographyTool(options: CreateCartographyToolOptions): ToolDefinition {
  const runCartographyFn = options.runCartographyFn ?? runCartography

  return tool({
    description:
      "Generate and update codemap artifacts deterministically. Use this instead of prompt-only cartography instructions.",
    args: {
      mode: tool.schema
        .enum(["init", "update", "changes"])
        .optional()
        .describe("Cartography mode (default: update)"),
      force: tool.schema
        .boolean()
        .optional()
        .describe("Force regeneration even when hashes are unchanged"),
      max_depth: tool.schema
        .number()
        .min(1)
        .max(12)
        .optional()
        .describe("Directory traversal depth override"),
      min_files: tool.schema
        .number()
        .min(1)
        .max(200)
        .optional()
        .describe("Minimum files required for non-root codemap generation"),
      include_patterns: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Include glob patterns override"),
      exclude_patterns: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Exclude glob patterns override"),
    },
    async execute(args: CartographyArgs) {
      const mode = args.mode ?? "update"
      const baseConfig: CartographyConfig = {
        ...DEFAULT_CARTOGRAPHY_CONFIG,
        ...(options.cartographyConfig ?? {}),
      }

      if (!baseConfig.enabled) {
        return "Cartography is disabled by config (`cartography.enabled=false`)."
      }

      const result = await runCartographyFn(options.directory, mode, {
        ctx: options.pluginInput,
        config: baseConfig,
        force: args.force,
        maxDepth: args.max_depth,
        minFiles: args.min_files,
        includePatterns: args.include_patterns,
        excludePatterns: args.exclude_patterns,
      })

      return isChangeReport(result)
        ? formatChangeReport(result)
        : formatCartographyResult(result)
    },
  })
}
