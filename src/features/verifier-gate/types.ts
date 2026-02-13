export type VerificationEvidenceKind =
  | "lsp_clean"
  | "test_or_build_passed"

export interface VerificationEvidence {
  kind: VerificationEvidenceKind
  timestamp: number
  tool: string
  detail?: string
}

export interface VerificationEvidenceWindow {
  hasCodeChanges: boolean
  lastWriteAt?: number
  lspEvidence: VerificationEvidence[]
  testOrBuildEvidence: VerificationEvidence[]
}

export interface VerificationVerdict {
  blocked: boolean
  reasonCode: string
  missingEvidence: string[]
  denialCount: number
  details: VerificationEvidenceWindow
}

export interface VerifierSessionState {
  lastWriteAt?: number
  recentWrites: string[]
  evidence: VerificationEvidence[]
  consecutiveDenials: number
}
