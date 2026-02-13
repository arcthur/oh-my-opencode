export type {
  VerificationEvidence,
  VerificationEvidenceKind,
  VerificationEvidenceWindow,
  VerificationVerdict,
  VerifierSessionState,
} from "./types"
export {
  classifyVerificationEvidence,
  isWriteMutationTool,
} from "./classifier"
export {
  VerifierGateStateStore,
  type VerifierGateRuntimeConfig,
} from "./state"

export function buildVerifierMissingEvidenceGuidance(missingEvidence: string[]): string {
  const commands: string[] = []

  if (missingEvidence.includes("lsp_diagnostics")) {
    commands.push("- Run `lsp_diagnostics` on changed files and ensure diagnostics are clean.")
  }
  if (missingEvidence.includes("test_or_build")) {
    commands.push("- Run a targeted test/build/typecheck command via `bash` and ensure success.")
  }

  return commands.join("\n")
}
