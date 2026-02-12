import { appendBudgetedOutput } from "../../../features/context-budget"
import { ContextBudgetArbiter } from "../../../features/context-budget"
import { formatContextLimit } from "../../../shared/context-limits"
import { createSystemDirective, SystemDirectiveTypes } from "../../../shared/system-directive"
import type { ContextWindowSnapshot } from "../types"

function buildReminder(snapshot: ContextWindowSnapshot): string {
  const limitLabel = formatContextLimit(snapshot.limitTokens)
  const modelLabel = snapshot.modelID ? `${snapshot.providerID}/${snapshot.modelID}` : snapshot.providerID
  return `${createSystemDirective(SystemDirectiveTypes.CONTEXT_WINDOW_MONITOR)}

[SYSTEM REMINDER - ${limitLabel} Context Window]

You are using ${modelLabel} with ${limitLabel} context window.
You have plenty of context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`
}

export function appendContextWindowWarning(
  sessionID: string,
  output: { output: string },
  snapshot: ContextWindowSnapshot
): void {
  const usedPct = (snapshot.usageRatio * 100).toFixed(1)
  const remainingPct = ((1 - snapshot.usageRatio) * 100).toFixed(1)
  const usedTokens = snapshot.usedInputCacheTokens.toLocaleString()
  const limitTokens = snapshot.limitTokens.toLocaleString()

  appendBudgetedOutput({
    output,
    sessionID,
    source: "context-window-governor",
    id: "context-window-warning",
    priority: "high",
    content: `\n\n${buildReminder(snapshot)}\n[Context Status: ${usedPct}% used (${usedTokens}/${limitTokens} tokens), ${remainingPct}% remaining]`,
  }, new ContextBudgetArbiter())
}
