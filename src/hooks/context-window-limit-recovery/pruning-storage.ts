import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PruningState } from "./pruning-types"
import { estimateTokens } from "./pruning-types"
import { log } from "../../shared/logger"
import { PART_STORAGE } from "../../features/hook-message-injector"
import { getMessageDir } from "./pruning-shared"

interface ToolPart {
  type: string
  callID?: string
  tool?: string
  state?: {
    input?: unknown
    output?: string
    status?: string
    time?: {
      compacted?: number  // upstream SessionCompaction.prune() marker
      [key: string]: unknown
    }
  }
  id?: string
}

interface MessageData {
  parts?: ToolPart[]
  [key: string]: unknown
}

function isAlreadyPrunedInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false
  return (input as Record<string, unknown>).__pruned === true
}

/**
 * Check if a part was already pruned by upstream SessionCompaction.prune().
 * Upstream sets `state.time.compacted` timestamp and dynamically replaces
 * output with "[Old tool result content cleared]" when reading messages.
 */
function isUpstreamPruned(part: ToolPart): boolean {
  return typeof part.state?.time?.compacted === "number"
}

export async function applyPruning(
  sessionID: string,
  state: PruningState
): Promise<number> {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) {
    log("[pruning-storage] message dir not found", { sessionID })
    return 0
  }

  let totalTokensSaved = 0
  let filesModified = 0

  try {
    const messageFiles = readdirSync(messageDir).filter((f) => f.endsWith(".json"))

    for (const messageFile of messageFiles) {
      const messageID = messageFile.replace(/\.json$/, "")
      const partDir = join(PART_STORAGE, messageID)
      if (!existsSync(partDir)) continue

      const partFiles = readdirSync(partDir).filter((f) => f.endsWith(".json"))
      for (const partFile of partFiles) {
        const partPath = join(partDir, partFile)

        let part: ToolPart
        try {
          const content = readFileSync(partPath, "utf-8")
          part = JSON.parse(content) as ToolPart
        } catch {
          continue
        }

        if (part.type !== "tool" || !part.callID) continue

        // Skip parts already pruned by upstream SessionCompaction.prune()
        // to avoid redundant processing and potential conflicts
        if (isUpstreamPruned(part)) continue

        const action = state.toolPruneActions.get(part.callID)
        if (!action) continue

        let modified = false

        if (action.pruneInput && part.state?.input && !isAlreadyPrunedInput(part.state.input)) {
          const inputStr = JSON.stringify(part.state.input)
          totalTokensSaved += estimateTokens(inputStr)
          part.state.input = { __pruned: true, reason: "DCP" }
          modified = true
        }

        if (
          action.pruneOutput &&
          part.state?.output &&
          !part.state.output.includes("[Content pruned by Dynamic Context Pruning]")
        ) {
          totalTokensSaved += estimateTokens(part.state.output)
          part.state.output = "[Content pruned by Dynamic Context Pruning]"
          // Also set time.compacted so upstream SessionCompaction.prune() will
          // recognize this part as already pruned and skip it (break loop)
          if (part.state.time) {
            part.state.time.compacted = Date.now()
          } else {
            part.state.time = { compacted: Date.now() }
          }
          modified = true
        }

        if (modified) {
          writeFileSync(partPath, JSON.stringify(part, null, 2), "utf-8")
          filesModified++
        }
      }
    }
  } catch (error) {
    log("[pruning-storage] error applying pruning", {
      sessionID,
      error: String(error),
    })
  }

  log("[pruning-storage] applied pruning", {
    sessionID,
    filesModified,
    totalTokensSaved,
  })

  return totalTokensSaved
}
