export interface ToolCallSignature {
  toolName: string
  signature: string
  callID: string
  turn: number
}

export interface FileOperation {
  callID: string
  tool: string
  filePath: string
  turn: number
}

export interface ErroredToolCall {
  callID: string
  toolName: string
  turn: number
  errorAge: number
}

export type PruneReason =
  | "deduplication"
  | "clear_tool_results"
  | "supersede_writes"
  | "purge_errors"

export interface ToolPruneAction {
  pruneInput: boolean
  pruneOutput: boolean
  reasons: Set<PruneReason>
}

export interface PruningResult {
  itemsPruned: number
  totalTokensSaved: number
  strategies: {
    deduplication: number
    supersedeWrites: number
    purgeErrors: number
    clearToolResults: number
  }
}

export interface PruningState {
  toolPruneActions: Map<string, ToolPruneAction>
  currentTurn: number
  fileOperations: Map<string, FileOperation[]>
  toolSignatures: Map<string, ToolCallSignature[]>
  erroredTools: Map<string, ErroredToolCall>
}

export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function markToolForPruning(
  state: PruningState,
  callID: string,
  action: { pruneInput?: boolean; pruneOutput?: boolean; reason: PruneReason }
): void {
  const existing = state.toolPruneActions.get(callID) ?? {
    pruneInput: false,
    pruneOutput: false,
    reasons: new Set<PruneReason>(),
  }

  if (action.pruneInput) existing.pruneInput = true
  if (action.pruneOutput) existing.pruneOutput = true
  existing.reasons.add(action.reason)

  state.toolPruneActions.set(callID, existing)
}
