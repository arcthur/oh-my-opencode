import type {
  VerificationEvidence,
  VerificationEvidenceKind,
  VerificationEvidenceWindow,
  VerificationVerdict,
  VerifierSessionState,
} from "./types"

export interface VerifierGateRuntimeConfig {
  enabled: boolean
  evidenceTtlMs: number
  requireLspClean: boolean
  requireTestOrBuild: boolean
  allowNoCodeChange: boolean
}

const MAX_TRACKED_WRITES = 20

function emptySessionState(): VerifierSessionState {
  return {
    recentWrites: [],
    evidence: [],
    consecutiveDenials: 0,
  }
}

export class VerifierGateStateStore {
  private readonly sessions = new Map<string, VerifierSessionState>()
  private readonly now: () => number

  constructor(
    private readonly config: VerifierGateRuntimeConfig,
    now?: () => number
  ) {
    this.now = now ?? (() => Date.now())
  }

  markWrite(sessionID: string, filePath?: string): void {
    const state = this.getState(sessionID)
    state.lastWriteAt = this.now()
    if (typeof filePath === "string" && filePath.trim().length > 0) {
      state.recentWrites = [...state.recentWrites, filePath].slice(-MAX_TRACKED_WRITES)
    }
  }

  recordEvidence(sessionID: string, evidence: VerificationEvidence[]): void {
    if (evidence.length === 0) return
    const state = this.getState(sessionID)
    this.pruneExpiredEvidence(state)
    state.evidence.push(...evidence)
  }

  clearSession(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  evaluateCompletion(sessionID: string): VerificationVerdict {
    const state = this.getState(sessionID)
    this.pruneExpiredEvidence(state)

    if (!this.config.enabled) {
      state.consecutiveDenials = 0
      return this.buildVerdict(state, [])
    }

    const hasCodeChanges = Boolean(state.lastWriteAt)
    if (!hasCodeChanges && this.config.allowNoCodeChange) {
      state.consecutiveDenials = 0
      return this.buildVerdict(state, [])
    }

    const missingEvidence: string[] = []
    const window = this.buildEvidenceWindow(state)

    if (this.config.requireLspClean && window.lspEvidence.length === 0) {
      missingEvidence.push("lsp_diagnostics")
    }

    if (
      this.config.requireTestOrBuild
      && hasCodeChanges
      && window.testOrBuildEvidence.length === 0
    ) {
      missingEvidence.push("test_or_build")
    }

    if (missingEvidence.length > 0) {
      state.consecutiveDenials += 1
    } else {
      state.consecutiveDenials = 0
    }

    return this.buildVerdict(state, missingEvidence)
  }

  getConsecutiveDenials(sessionID: string): number {
    return this.getState(sessionID).consecutiveDenials
  }

  private buildVerdict(
    state: VerifierSessionState,
    missingEvidence: string[]
  ): VerificationVerdict {
    return {
      blocked: missingEvidence.length > 0,
      reasonCode:
        missingEvidence.length > 0
          ? "VERIFIER_EVIDENCE_MISSING"
          : "VERIFIER_EVIDENCE_OK",
      missingEvidence,
      denialCount: state.consecutiveDenials,
      details: this.buildEvidenceWindow(state),
    }
  }

  private buildEvidenceWindow(state: VerifierSessionState): VerificationEvidenceWindow {
    const hasCodeChanges = Boolean(state.lastWriteAt)
    const startAt = state.lastWriteAt ?? 0

    return {
      hasCodeChanges,
      lastWriteAt: state.lastWriteAt,
      lspEvidence: this.findEvidence(state, "lsp_clean", startAt),
      testOrBuildEvidence: this.findEvidence(state, "test_or_build_passed", startAt),
    }
  }

  private findEvidence(
    state: VerifierSessionState,
    kind: VerificationEvidenceKind,
    startAt: number
  ): VerificationEvidence[] {
    return state.evidence.filter((entry) => entry.kind === kind && entry.timestamp >= startAt)
  }

  private pruneExpiredEvidence(state: VerifierSessionState): void {
    const now = this.now()
    state.evidence = state.evidence.filter(
      (entry) => now - entry.timestamp <= this.config.evidenceTtlMs
    )
  }

  private getState(sessionID: string): VerifierSessionState {
    let state = this.sessions.get(sessionID)
    if (!state) {
      state = emptySessionState()
      this.sessions.set(sessionID, state)
    }
    return state
  }
}
