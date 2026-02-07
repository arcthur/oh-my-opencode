import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createWorkStateManager } from "../../features/work-state"
import {
  parseContextManifestFromMarkdown,
  renderContextPacksForPrompt,
  getContextManifestPath,
} from "../../features/context-manifests"
import { log } from "../../shared/logger"
import { contextBudgetArbiter } from "../../features/context-budget"

export const HOOK_NAME = "context-manifest-injector"

interface ToolExecuteBeforeInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

const INJECTED_MARKER = "## CONTEXT PACKS (auto-injected)"

const DEFAULTS = {
  maxTotalChars: 6000,
  maxCharsPerPack: 2500,
  maxItemsPerPack: 20,
}

function isSafePlanId(planId: string): boolean {
  // Allow the same character set as pack IDs, just with a longer cap.
  // This prevents path traversal like "../x" or "a/b".
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(planId)
}

function isSafePackId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)
}

function splitPackIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isSafePackId(s))
}

export function extractRequestedContextPackIds(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/g)
  const ids: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const match = line.match(/^\s*Context Packs?\s*:\s*(.*?)\s*$/i)
    if (!match) continue

    const remainder = (match[1] ?? "").trim()
    if (remainder.length > 0) {
      ids.push(...splitPackIds(remainder))
      continue
    }

    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? "").trim()
      if (next.length === 0) break

      const bullet = next.match(/^[-*]\s*([a-zA-Z0-9][a-zA-Z0-9._-]{0,63})\s*$/)
      if (!bullet) break
      ids.push(bullet[1]!)
    }
  }

  const seen = new Set<string>()
  return ids.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export interface ContextManifestInjectorOptions {
  max_total_chars?: number
  max_chars_per_pack?: number
  max_items_per_pack?: number
}

export function createContextManifestInjectorHook(
  ctx: PluginInput,
  options: ContextManifestInjectorOptions = {}
) {
  const workStateManager = createWorkStateManager(ctx.directory)
  const maxTotalChars = options.max_total_chars ?? DEFAULTS.maxTotalChars
  const maxCharsPerPack = options.max_chars_per_pack ?? DEFAULTS.maxCharsPerPack
  const maxItemsPerPack = options.max_items_per_pack ?? DEFAULTS.maxItemsPerPack

  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      if (input.tool !== "delegate_task") return

      const prompt = output.args.prompt
      if (typeof prompt !== "string" || prompt.trim().length === 0) return
      if (prompt.includes(INJECTED_MARKER)) return

      const requestedPackIds = extractRequestedContextPackIds(prompt)
      if (requestedPackIds.length === 0) return

      const state = workStateManager.load()
      const planId = state?.plan_id?.trim()
      if (!planId) return

      if (!isSafePlanId(planId)) {
        log(`[${HOOK_NAME}] Unsafe plan_id (skipping injection)`, {
          planId,
        })
        return
      }

      const manifestPath = join(ctx.directory, getContextManifestPath(planId))
      if (!existsSync(manifestPath)) {
        log(`[${HOOK_NAME}] Manifest missing`, { manifestPath, planId })
        return
      }

      let markdown: string
      try {
        markdown = readFileSync(manifestPath, "utf-8")
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to read manifest`, {
          manifestPath,
          error: String(err),
        })
        return
      }

      const manifest = parseContextManifestFromMarkdown(markdown)
      if (!manifest) {
        log(`[${HOOK_NAME}] Failed to parse manifest`, { manifestPath, planId })
        return
      }

      const snippet = renderContextPacksForPrompt(manifest, requestedPackIds, {
        maxTotalChars,
        maxCharsPerPack,
        maxItemsPerPack,
      })
      if (!snippet.trim()) return

      const appendBlock = `\n\n${snippet}\n`
      const decision = contextBudgetArbiter.decide({
        sessionID: input.sessionID ?? "unknown-session",
        source: "context-manifest-injector",
        channel: "delegate-prompt",
        id: `${planId}:${requestedPackIds.join(",")}`,
        priority: "high",
        content: appendBlock,
      })
      if (!decision.accepted) return

      output.args.prompt = `${prompt.trimEnd()}${decision.finalContent}`
      log(`[${HOOK_NAME}] Injected context packs`, {
        planId,
        manifestPath,
        packs: requestedPackIds,
      })
    },
  }
}
