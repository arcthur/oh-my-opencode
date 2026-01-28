/**
 * Semantic Checkpoint Manager
 *
 * Implements semantic checkpoints for development task recovery.
 * Uses layered state model to track environment changes and
 * determine appropriate recovery strategies.
 *
 * @see docs/governance-orchestration-design.md Section 2.1
 */

import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import type {
  SemanticCheckpoint,
  TaskIntent,
  FileState,
  FileRole,
  CriticalDeps,
  GitContext,
  PhaseRecord,
  ExportFingerprint,
  ChangeAnalysis,
  ChangeType,
  ConfidenceLevel,
  FileChangeResult,
  RecoveryDecision,
  ChangeReport,
  LayerChangeSummary,
  CheckpointEvent,
  CheckpointConfig,
  CreateCheckpointOptions,
  CheckpointValidation,
  SerializedCheckpoint,
  FingerprintMode,
} from "./checkpoint-types"
import {
  DEFAULT_CHECKPOINT_CONFIG,
  RECOVERY_STRATEGY_TABLE,
  CHECKPOINT_SCHEMA_VERSION,
} from "./checkpoint-types"
import { getLedgerManager } from "./ledger"

// ============================================================================
// Fingerprint Strategy
// ============================================================================

/**
 * Strategy interface for fingerprinting files
 */
export interface FingerprintStrategy {
  /**
   * Fast mode: mtime-based change detection
   */
  detectChangeFast(file: string, lastKnown: FileState): Promise<boolean>

  /**
   * Precise mode: content + AST comparison
   */
  detectChangePrecise(file: string, lastKnown: FileState): Promise<ChangeAnalysis>

  /**
   * Compute file state
   */
  computeFileState(file: string, role: FileRole): Promise<FileState>

  /**
   * Compute content hash
   */
  computeContentHash(content: string): string

  /**
   * Compute semantic hash (AST-based, ignores formatting)
   */
  computeSemanticHash?(content: string, fileType: string): string

  /**
   * Compute export fingerprint
   */
  computeExportFingerprint?(content: string, fileType: string): ExportFingerprint
}

/**
 * File system adapter interface
 */
export interface FileSystemAdapter {
  readFile(path: string): Promise<string>
  stat(path: string): Promise<{ mtime: number; size: number }>
  exists(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<string[]>
  unlink(path: string): Promise<void>
}

/**
 * Git adapter interface
 */
export interface GitAdapter {
  getCurrentBranch(): Promise<string>
  getHeadCommit(): Promise<string>
  hasUncommittedChanges(): Promise<boolean>
  getCommitsSince(commit: string): Promise<string[]>
}

/**
 * Default fingerprint strategy implementation
 * Uses content hashing, with optional AST-based semantic hashing
 */
export class DefaultFingerprintStrategy implements FingerprintStrategy {
  constructor(
    private fs: FileSystemAdapter,
    private config: Partial<CheckpointConfig> = {}
  ) {}

  async detectChangeFast(file: string, lastKnown: FileState): Promise<boolean> {
    try {
      const stat = await this.fs.stat(file)
      return stat.mtime !== lastKnown.mtime
    } catch {
      // File doesn't exist or can't be read - definitely changed
      return true
    }
  }

  async detectChangePrecise(file: string, lastKnown: FileState): Promise<ChangeAnalysis> {
    try {
      const exists = await this.fs.exists(file)
      if (!exists) {
        return {
          isSignificant: true,
          changeType: "file-deleted",
          confidence: "high",
        }
      }

      const content = await this.fs.readFile(file)
      const currentHash = this.computeContentHash(content)

      // No change in content
      if (currentHash === lastKnown.contentHash) {
        return {
          isSignificant: false,
          changeType: "formatting-only",
          confidence: "high",
        }
      }

      // Content changed - check semantic hash if available
      if (this.config.enableSemanticHash && this.computeSemanticHash) {
        const fileType = this.getFileType(file)
        const currentSemanticHash = this.computeSemanticHash(content, fileType)

        if (currentSemanticHash === lastKnown.semanticHash) {
          return {
            isSignificant: false,
            changeType: "formatting-only",
            confidence: "high",
          }
        }
      }

      // Check export fingerprint if available
      if (
        this.config.enableExportFingerprint &&
        this.computeExportFingerprint &&
        lastKnown.exportFingerprint
      ) {
        const fileType = this.getFileType(file)
        const currentFingerprint = this.computeExportFingerprint(content, fileType)

        const apiChanged = !this.fingerprintsEqual(
          currentFingerprint,
          lastKnown.exportFingerprint
        )

        if (apiChanged) {
          return {
            isSignificant: true,
            changeType: "api-change",
            affectedConsumers: lastKnown.consumers,
            confidence: "high",
          }
        }

        // API unchanged but content changed
        return {
          isSignificant: false,
          changeType: "internal-refactor",
          confidence: "high",
        }
      }

      // Content changed, can't determine if it's significant
      return {
        isSignificant: true,
        changeType: "value-change",
        confidence: "medium",
      }
    } catch (error) {
      return {
        isSignificant: true,
        changeType: "value-change",
        confidence: "low",
      }
    }
  }

  async computeFileState(file: string, role: FileRole): Promise<FileState> {
    const content = await this.fs.readFile(file)
    const stat = await this.fs.stat(file)
    const contentHash = this.computeContentHash(content)

    let semanticHash = contentHash
    let exportFingerprint: ExportFingerprint | undefined

    if (this.config.enableSemanticHash && this.computeSemanticHash) {
      const fileType = this.getFileType(file)
      semanticHash = this.computeSemanticHash(content, fileType)
    }

    if (this.config.enableExportFingerprint && this.computeExportFingerprint) {
      const fileType = this.getFileType(file)
      exportFingerprint = this.computeExportFingerprint(content, fileType)
    }

    return {
      contentHash,
      semanticHash,
      exportFingerprint,
      role,
      validity: "valid", // Newly computed state is always valid
      mtime: stat.mtime,
    }
  }

  computeContentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex").substring(0, 16)
  }

  // Placeholder for AST-based semantic hashing
  // Real implementation would use a parser like @babel/parser or ts-morph
  computeSemanticHash?(content: string, fileType: string): string {
    // For now, just use content hash
    // Real implementation would parse AST and hash structure
    return this.computeContentHash(content)
  }

  // Placeholder for export fingerprinting
  // Real implementation would extract exports from AST
  computeExportFingerprint?(content: string, fileType: string): ExportFingerprint {
    // For now, return empty fingerprint
    // Real implementation would parse exports
    return {
      functionSignatures: "",
      typeDefinitions: "",
      exportedValues: "",
      exportedNames: [],
    }
  }

  private getFileType(file: string): string {
    const ext = file.split(".").pop() || ""
    return ext.toLowerCase()
  }

  private fingerprintsEqual(a: ExportFingerprint, b: ExportFingerprint): boolean {
    return (
      a.functionSignatures === b.functionSignatures &&
      a.typeDefinitions === b.typeDefinitions &&
      a.exportedValues === b.exportedValues &&
      JSON.stringify(a.exportedNames.sort()) === JSON.stringify(b.exportedNames.sort())
    )
  }
}

// ============================================================================
// Semantic Checkpoint Manager
// ============================================================================

type CheckpointEventHandler = (event: CheckpointEvent) => void

/**
 * Manages semantic checkpoints for development tasks
 */
export class SemanticCheckpointManager extends EventEmitter {
  private checkpoints = new Map<string, SemanticCheckpoint>()
  private config: CheckpointConfig
  private fingerprintStrategy: FingerprintStrategy
  private fs: FileSystemAdapter
  private git?: GitAdapter
  private sessionId: string

  constructor(
    sessionId: string,
    options: {
      config?: Partial<CheckpointConfig>
      fingerprintStrategy?: FingerprintStrategy
      fs: FileSystemAdapter
      git?: GitAdapter
    }
  ) {
    super()
    this.sessionId = sessionId
    this.config = { ...DEFAULT_CHECKPOINT_CONFIG, ...options.config }
    this.fs = options.fs
    this.git = options.git
    this.fingerprintStrategy =
      options.fingerprintStrategy || new DefaultFingerprintStrategy(this.fs, this.config)
  }

  // ===========================================================================
  // Core API
  // ===========================================================================

  /**
   * Create a new checkpoint
   */
  async createCheckpoint(options: CreateCheckpointOptions): Promise<SemanticCheckpoint> {
    const id = this.generateId()

    // Layer 0: Task intent
    const taskIntent = this.createTaskIntent(options.taskDescription)

    // Layer 1: Affected files
    const affectedFiles = new Map<string, FileState>()
    for (const file of options.files) {
      try {
        const state = await this.fingerprintStrategy.computeFileState(file, "both")
        affectedFiles.set(file, state)
      } catch {
        // File doesn't exist yet, skip
      }
    }

    // Layer 2: Critical dependencies
    const criticalDeps = await this.computeCriticalDeps()

    // Layer 3: Git context
    const gitContext = await this.computeGitContext()

    const checkpoint: SemanticCheckpoint = {
      id,
      createdAt: Date.now(),
      taskIntent,
      affectedFiles,
      criticalDeps,
      gitContext,
      completedPhases: [],
      pendingPhases: options.initialPhase ? [options.initialPhase] : [],
    }

    this.checkpoints.set(id, checkpoint)

    // Emit event
    this.emitEvent({
      type: "checkpoint-created",
      checkpointId: id,
      taskSummary: taskIntent.summary,
      trackedFiles: affectedFiles.size,
    })

    // Log to ledger
    this.logToLedger("created", checkpoint)

    return checkpoint
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(id: string): SemanticCheckpoint | undefined {
    return this.checkpoints.get(id)
  }

  /**
   * Validate a checkpoint against current environment
   */
  async validateCheckpoint(id: string): Promise<CheckpointValidation> {
    const checkpoint = this.checkpoints.get(id)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`)
    }

    const layerChanges: LayerChangeSummary[] = []
    const changeReports: ChangeReport[] = []

    // Check Layer 0: Task intent (rarely changes during execution)
    // Typically validated externally

    // Check Layer 1: Affected files
    const fileChanges = await this.detectFileChanges(checkpoint)
    if (fileChanges.length > 0) {
      const writeChanges = fileChanges.filter(
        (c) => c.previousState?.role === "write" || c.previousState?.role === "both"
      )
      const readChanges = fileChanges.filter((c) => c.previousState?.role === "read")
      const apiChanges = fileChanges.filter((c) => c.analysis?.changeType === "api-change")

      layerChanges.push({
        layer: 1,
        layerName: "affected-files",
        hasChanges: true,
        changedItems: fileChanges.map((c) => c.path),
        impact: apiChanges.length > 0 ? "major" : writeChanges.length > 0 ? "major" : "minor",
      })

      if (writeChanges.length > 0) {
        const decision = RECOVERY_STRATEGY_TABLE["1:write-modified"](
          writeChanges.map((c) => c.path)
        )
        changeReports.push({
          layer: 1,
          description: `Write files modified: ${writeChanges.map((c) => c.path).join(", ")}`,
          affectedPhases: this.findAffectedPhases(checkpoint, writeChanges),
          recommendation: decision,
        })
      }

      if (apiChanges.length > 0) {
        const decision = RECOVERY_STRATEGY_TABLE["1:api-change"](apiChanges.map((c) => c.path))
        changeReports.push({
          layer: 1,
          description: `API changed: ${apiChanges.map((c) => c.path).join(", ")}`,
          affectedPhases: this.findConsumerPhases(checkpoint, apiChanges),
          recommendation: decision,
        })
      }
    } else {
      layerChanges.push({
        layer: 1,
        layerName: "affected-files",
        hasChanges: false,
        changedItems: [],
        impact: "none",
      })
    }

    // Check Layer 2: Dependencies
    const depChanges = await this.detectDependencyChanges(checkpoint)
    if (depChanges.length > 0) {
      layerChanges.push({
        layer: 2,
        layerName: "dependencies",
        hasChanges: true,
        changedItems: depChanges,
        impact: "major",
      })

      const decision = RECOVERY_STRATEGY_TABLE["2:dependency"](depChanges)
      changeReports.push({
        layer: 2,
        description: `Dependencies changed: ${depChanges.join(", ")}`,
        affectedPhases: ["all"],
        recommendation: decision,
      })
    } else {
      layerChanges.push({
        layer: 2,
        layerName: "dependencies",
        hasChanges: false,
        changedItems: [],
        impact: "none",
      })
    }

    // Check Layer 3: Git context
    const gitChanges = await this.detectGitChanges(checkpoint)
    if (gitChanges.type !== "none") {
      layerChanges.push({
        layer: 3,
        layerName: "git-context",
        hasChanges: true,
        changedItems: [gitChanges.description],
        impact: gitChanges.type === "branch-switched" ? "critical" : "minor",
      })

      const strategyKey =
        gitChanges.type === "branch-switched" ? "3:branch-switch" : "3:new-commits"
      const decision = RECOVERY_STRATEGY_TABLE[strategyKey]([gitChanges.description])
      changeReports.push({
        layer: 3,
        description: gitChanges.description,
        affectedPhases: gitChanges.type === "branch-switched" ? ["all"] : ["validation"],
        recommendation: decision,
      })
    } else {
      layerChanges.push({
        layer: 3,
        layerName: "git-context",
        hasChanges: false,
        changedItems: [],
        impact: "none",
      })
    }

    // Determine overall validity and recommendation
    const hasChanges = layerChanges.some((l) => l.hasChanges)
    const recommendedAction = this.determineRecoveryAction(changeReports, this.config.recoveryStrategy)

    // Emit event if invalid
    if (hasChanges) {
      this.emitEvent({
        type: "checkpoint-invalidated",
        checkpointId: id,
        reason: changeReports.map((r) => r.description).join("; "),
        layerChanges,
      })
    }

    return {
      valid: !hasChanges,
      layerChanges,
      recommendedAction,
      changeReports,
    }
  }

  /**
   * Record phase completion
   */
  recordPhaseCompletion(
    checkpointId: string,
    phaseId: string,
    outputSummary: string,
    outputFiles: string[] = []
  ): void {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    const record: PhaseRecord = {
      phaseId,
      completedAt: Date.now(),
      outputSummary,
      outputFiles,
    }

    checkpoint.completedPhases.push(record)
    checkpoint.pendingPhases = checkpoint.pendingPhases.filter((p) => p !== phaseId)

    this.logToLedger("phase-completed", checkpoint, { phaseId })
  }

  /**
   * Add pending phase
   */
  addPendingPhase(checkpointId: string, phaseId: string): void {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    if (!checkpoint.pendingPhases.includes(phaseId)) {
      checkpoint.pendingPhases.push(phaseId)
    }
  }

  /**
   * Update file state in checkpoint
   */
  async updateFileState(checkpointId: string, file: string, role: FileRole): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    const state = await this.fingerprintStrategy.computeFileState(file, role)
    checkpoint.affectedFiles.set(file, state)
  }

  /**
   * Propagate impact when a file's API changes
   * Marks consumers as stale/invalid based on change severity
   */
  propagateImpact(
    checkpointId: string,
    changedFile: string,
    severity: "minor" | "major" = "major"
  ): string[] {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    const affected: string[] = []
    const fileState = checkpoint.affectedFiles.get(changedFile)
    if (!fileState?.consumers) return affected

    for (const consumer of fileState.consumers) {
      const consumerState = checkpoint.affectedFiles.get(consumer)
      if (consumerState) {
        // Mark consumer validity based on severity (NOT role - role is access intent)
        // - minor change (internal refactor): consumers become stale (should re-read)
        // - major change (API change): consumers become invalid (must re-perceive)
        consumerState.validity = severity === "major" ? "invalid" : "stale"
        affected.push(consumer)

        // Recursively propagate (severity degrades to minor for transitive deps)
        const nested = this.propagateImpact(checkpointId, consumer, "minor")
        affected.push(...nested)
      }
    }

    return affected
  }

  /**
   * Set file consumers (dependency graph)
   */
  setFileConsumers(checkpointId: string, file: string, consumers: string[]): void {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    const fileState = checkpoint.affectedFiles.get(file)
    if (fileState) {
      fileState.consumers = consumers
    }
  }

  /**
   * Delete checkpoint
   */
  deleteCheckpoint(id: string): boolean {
    return this.checkpoints.delete(id)
  }

  /**
   * List all checkpoints
   */
  listCheckpoints(): string[] {
    return Array.from(this.checkpoints.keys())
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Save checkpoint to storage
   */
  async saveCheckpoint(id: string): Promise<void> {
    const checkpoint = this.checkpoints.get(id)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`)
    }

    const serialized = this.serializeCheckpoint(checkpoint)
    const path = `${this.config.storageDir}/${id}.json`

    await this.fs.mkdir(this.config.storageDir, { recursive: true })
    await this.fs.writeFile(path, JSON.stringify(serialized, null, 2))
  }

  /**
   * Load checkpoint from storage
   */
  async loadCheckpoint(id: string): Promise<SemanticCheckpoint> {
    const path = `${this.config.storageDir}/${id}.json`
    const content = await this.fs.readFile(path)
    const serialized: SerializedCheckpoint = JSON.parse(content)

    const checkpoint = this.deserializeCheckpoint(serialized)
    this.checkpoints.set(id, checkpoint)

    this.emitEvent({
      type: "checkpoint-restored",
      checkpointId: id,
      recoveryDecision: { action: "continue", reason: "Loaded from storage" },
    })

    return checkpoint
  }

  /**
   * List saved checkpoints
   */
  async listSavedCheckpoints(): Promise<string[]> {
    try {
      const files = await this.fs.readdir(this.config.storageDir)
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))
    } catch {
      return []
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `cp-${timestamp}-${random}`
  }

  private createTaskIntent(description: string): TaskIntent {
    const hash = createHash("sha256").update(description).digest("hex").substring(0, 16)

    // Extract summary (first line or first 100 chars)
    const summary = description.split("\n")[0].substring(0, 100)

    // Extract affected scope from description (glob patterns)
    const scopePatterns: string[] = []
    const globRegex = /(?:src|lib|test|tests)\/[\w/*.-]+/g
    const matches = description.match(globRegex)
    if (matches) {
      scopePatterns.push(...matches)
    }

    return {
      hash,
      summary,
      affectedScope: scopePatterns.length > 0 ? scopePatterns : this.config.trackPatterns,
    }
  }

  private async computeCriticalDeps(): Promise<CriticalDeps> {
    const configHashes = new Map<string, string>()

    for (const configFile of this.config.configFiles) {
      try {
        const content = await this.fs.readFile(configFile)
        const hash = this.fingerprintStrategy.computeContentHash(content)
        configHashes.set(configFile, hash)
      } catch {
        // File doesn't exist, skip
      }
    }

    // Extract lockfile hash
    let lockfileHash: string | undefined
    const lockfiles = ["bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]
    for (const lockfile of lockfiles) {
      if (configHashes.has(lockfile)) {
        lockfileHash = configHashes.get(lockfile)
        configHashes.delete(lockfile)
        break
      }
    }

    return {
      lockfileHash,
      configHashes,
    }
  }

  private async computeGitContext(): Promise<GitContext> {
    if (!this.git) {
      return {
        branch: "unknown",
        baseCommit: "unknown",
        hasUncommittedChanges: false,
      }
    }

    const [branch, baseCommit, hasUncommittedChanges] = await Promise.all([
      this.git.getCurrentBranch(),
      this.git.getHeadCommit(),
      this.git.hasUncommittedChanges(),
    ])

    return {
      branch,
      baseCommit,
      hasUncommittedChanges,
    }
  }

  private async detectFileChanges(checkpoint: SemanticCheckpoint): Promise<FileChangeResult[]> {
    const changes: FileChangeResult[] = []

    for (const [path, previousState] of checkpoint.affectedFiles) {
      // Fast check first
      const changed = await this.fingerprintStrategy.detectChangeFast(path, previousState)

      if (changed) {
        // Precise analysis
        const analysis = await this.fingerprintStrategy.detectChangePrecise(path, previousState)

        if (analysis.isSignificant || analysis.changeType !== "formatting-only") {
          let currentState: FileState | undefined
          try {
            currentState = await this.fingerprintStrategy.computeFileState(
              path,
              previousState.role
            )
          } catch {
            // File deleted
          }

          changes.push({
            path,
            changed: true,
            analysis,
            previousState,
            currentState,
          })
        }
      }
    }

    return changes
  }

  private async detectDependencyChanges(checkpoint: SemanticCheckpoint): Promise<string[]> {
    const changes: string[] = []
    const currentDeps = await this.computeCriticalDeps()

    // Check lockfile
    if (checkpoint.criticalDeps.lockfileHash !== currentDeps.lockfileHash) {
      changes.push("lockfile")
    }

    // Check config files
    for (const [file, hash] of checkpoint.criticalDeps.configHashes) {
      const currentHash = currentDeps.configHashes.get(file)
      if (currentHash !== hash) {
        changes.push(file)
      }
    }

    return changes
  }

  private async detectGitChanges(
    checkpoint: SemanticCheckpoint
  ): Promise<{ type: "none" | "branch-switched" | "new-commits"; description: string }> {
    if (!this.git) {
      return { type: "none", description: "" }
    }

    const currentContext = await this.computeGitContext()

    // Branch switched
    if (currentContext.branch !== checkpoint.gitContext.branch) {
      return {
        type: "branch-switched",
        description: `Branch switched from ${checkpoint.gitContext.branch} to ${currentContext.branch}`,
      }
    }

    // New commits
    if (currentContext.baseCommit !== checkpoint.gitContext.baseCommit) {
      const commits = await this.git.getCommitsSince(checkpoint.gitContext.baseCommit)
      return {
        type: "new-commits",
        description: `${commits.length} new commit(s) since checkpoint`,
      }
    }

    return { type: "none", description: "" }
  }

  private findAffectedPhases(
    checkpoint: SemanticCheckpoint,
    changes: FileChangeResult[]
  ): string[] {
    const affected = new Set<string>()

    for (const change of changes) {
      for (const phase of checkpoint.completedPhases) {
        if (phase.outputFiles.includes(change.path)) {
          affected.add(phase.phaseId)
        }
      }
    }

    return Array.from(affected)
  }

  private findConsumerPhases(
    checkpoint: SemanticCheckpoint,
    changes: FileChangeResult[]
  ): string[] {
    const affected = new Set<string>()

    for (const change of changes) {
      const consumers = change.analysis?.affectedConsumers || []
      for (const consumer of consumers) {
        for (const phase of checkpoint.completedPhases) {
          if (phase.outputFiles.includes(consumer)) {
            affected.add(phase.phaseId)
          }
        }
      }
    }

    return Array.from(affected)
  }

  private determineRecoveryAction(
    reports: ChangeReport[],
    strategy: CheckpointConfig["recoveryStrategy"]
  ): RecoveryDecision {
    if (reports.length === 0) {
      return { action: "continue", reason: "No changes detected" }
    }

    // Find most severe recommendation
    const severityOrder: RecoveryDecision["action"][] = [
      "full-rerun",
      "partial-rerun",
      "user-decision",
      "continue",
    ]

    let mostSevere = reports[0].recommendation

    for (const report of reports) {
      const currentSeverity = severityOrder.indexOf(report.recommendation.action)
      const mostSevereSeverity = severityOrder.indexOf(mostSevere.action)

      if (currentSeverity < mostSevereSeverity) {
        mostSevere = report.recommendation
      }
    }

    // Apply strategy
    if (strategy === "conservative") {
      // Be more cautious
      if (mostSevere.action === "continue" && reports.length > 1) {
        return { action: "user-decision", changes: reports[0] }
      }
    } else if (strategy === "aggressive") {
      // Be more permissive
      if (mostSevere.action === "user-decision") {
        return (mostSevere as any).changes?.recommendation || mostSevere
      }
    }

    return mostSevere
  }

  private serializeCheckpoint(checkpoint: SemanticCheckpoint): SerializedCheckpoint {
    return {
      checkpoint: {
        ...checkpoint,
        affectedFiles: Array.from(checkpoint.affectedFiles.entries()),
        criticalDeps: {
          lockfileHash: checkpoint.criticalDeps.lockfileHash,
          configHashes: Array.from(checkpoint.criticalDeps.configHashes.entries()),
        },
      },
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      serializedAt: Date.now(),
    }
  }

  private deserializeCheckpoint(serialized: SerializedCheckpoint): SemanticCheckpoint {
    const { checkpoint } = serialized

    return {
      ...checkpoint,
      affectedFiles: new Map(checkpoint.affectedFiles),
      criticalDeps: {
        lockfileHash: checkpoint.criticalDeps.lockfileHash,
        configHashes: new Map(checkpoint.criticalDeps.configHashes),
      },
    }
  }

  private emitEvent(event: CheckpointEvent): void {
    this.emit(event.type, event)
    this.emit("checkpoint-event", event)
  }

  private logToLedger(
    subtype: string,
    checkpoint: SemanticCheckpoint,
    extra: Record<string, unknown> = {}
  ): void {
    try {
      const ledger = getLedgerManager().getLedger(this.sessionId)

      ledger.logCheckpointEvent({
        subtype: subtype as any,
        checkpointId: checkpoint.id,
        reason: extra.reason as string || subtype,
        trackedFiles: Array.from(checkpoint.affectedFiles.keys()),
      })
    } catch {
      // Ledger may not be initialized - ignore
    }
  }
}

// ============================================================================
// Manager (Multi-session)
// ============================================================================

/**
 * Manages checkpoint managers across multiple sessions
 */
export class CheckpointManagerRegistry {
  private managers = new Map<string, SemanticCheckpointManager>()
  private config: Partial<CheckpointConfig>
  private fs: FileSystemAdapter
  private git?: GitAdapter

  constructor(options: {
    config?: Partial<CheckpointConfig>
    fs: FileSystemAdapter
    git?: GitAdapter
  }) {
    this.config = options.config || {}
    this.fs = options.fs
    this.git = options.git
  }

  /**
   * Get or create manager for session
   */
  getManager(sessionId: string): SemanticCheckpointManager {
    let manager = this.managers.get(sessionId)
    if (!manager) {
      manager = new SemanticCheckpointManager(sessionId, {
        config: this.config,
        fs: this.fs,
        git: this.git,
      })
      this.managers.set(sessionId, manager)
    }
    return manager
  }

  /**
   * Check if session has manager
   */
  hasManager(sessionId: string): boolean {
    return this.managers.has(sessionId)
  }

  /**
   * Remove manager for session
   */
  removeManager(sessionId: string): boolean {
    return this.managers.delete(sessionId)
  }

  /**
   * List all sessions
   */
  listSessions(): string[] {
    return Array.from(this.managers.keys())
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalRegistry: CheckpointManagerRegistry | undefined

/**
 * Get global checkpoint manager registry
 */
export function getCheckpointRegistry(options?: {
  config?: Partial<CheckpointConfig>
  fs: FileSystemAdapter
  git?: GitAdapter
}): CheckpointManagerRegistry {
  if (!globalRegistry) {
    if (!options?.fs) {
      throw new Error("FileSystemAdapter is required for initial registry creation")
    }
    globalRegistry = new CheckpointManagerRegistry(options)
  }
  return globalRegistry
}

/**
 * Reset global registry (for testing)
 */
export function resetCheckpointRegistry(): void {
  globalRegistry = undefined
}
