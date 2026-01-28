import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  SemanticCheckpointManager,
  DefaultFingerprintStrategy,
  CheckpointManagerRegistry,
  getCheckpointRegistry,
  resetCheckpointRegistry,
  type FileSystemAdapter,
  type GitAdapter,
  type FingerprintStrategy,
} from "./checkpoint"
import {
  DEFAULT_CHECKPOINT_CONFIG,
  RECOVERY_STRATEGY_TABLE,
  type SemanticCheckpoint,
  type FileState,
  type CheckpointConfig,
} from "./checkpoint-types"
import { resetLedgerManager } from "./ledger"

// ============================================================================
// Mock Implementations
// ============================================================================

function createMockFs(files: Record<string, { content: string; mtime: number }>): FileSystemAdapter {
  const fileStore = new Map(Object.entries(files))

  return {
    async readFile(path: string): Promise<string> {
      const file = fileStore.get(path)
      if (!file) throw new Error(`ENOENT: ${path}`)
      return file.content
    },
    async stat(path: string): Promise<{ mtime: number; size: number }> {
      const file = fileStore.get(path)
      if (!file) throw new Error(`ENOENT: ${path}`)
      return { mtime: file.mtime, size: file.content.length }
    },
    async exists(path: string): Promise<boolean> {
      return fileStore.has(path)
    },
    async writeFile(path: string, content: string): Promise<void> {
      fileStore.set(path, { content, mtime: Date.now() })
    },
    async mkdir(): Promise<void> {
      // No-op for mock
    },
    async readdir(path: string): Promise<string[]> {
      const prefix = path.endsWith("/") ? path : `${path}/`
      const files: string[] = []
      for (const key of fileStore.keys()) {
        if (key.startsWith(prefix)) {
          files.push(key.replace(prefix, "").split("/")[0])
        }
      }
      return [...new Set(files)]
    },
    async unlink(path: string): Promise<void> {
      fileStore.delete(path)
    },
  }
}

function createMockGit(options: {
  branch?: string
  commit?: string
  uncommitted?: boolean
  commitsSince?: string[]
} = {}): GitAdapter {
  return {
    async getCurrentBranch(): Promise<string> {
      return options.branch || "main"
    },
    async getHeadCommit(): Promise<string> {
      return options.commit || "abc123"
    },
    async hasUncommittedChanges(): Promise<boolean> {
      return options.uncommitted || false
    },
    async getCommitsSince(): Promise<string[]> {
      return options.commitsSince || []
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("SemanticCheckpointManager", () => {
  let manager: SemanticCheckpointManager
  let mockFs: FileSystemAdapter
  let mockGit: GitAdapter

  beforeEach(() => {
    mockFs = createMockFs({
      "src/index.ts": { content: 'export const foo = "bar"', mtime: 1000 },
      "src/utils.ts": { content: "export function helper() {}", mtime: 1000 },
      "package.json": { content: '{"name": "test"}', mtime: 1000 },
      "tsconfig.json": { content: '{"compilerOptions": {}}', mtime: 1000 },
    })
    mockGit = createMockGit({ branch: "main", commit: "abc123" })

    manager = new SemanticCheckpointManager("test-session", {
      fs: mockFs,
      git: mockGit,
    })
  })

  afterEach(() => {
    resetCheckpointRegistry()
    resetLedgerManager()
  })

  describe("createCheckpoint", () => {
    it("creates checkpoint with task intent", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Implement feature X in src/index.ts",
        files: ["src/index.ts"],
      })

      expect(checkpoint.id).toMatch(/^cp-/)
      expect(checkpoint.taskIntent.summary).toContain("Implement feature X")
      expect(checkpoint.taskIntent.hash).toHaveLength(16)
    })

    it("tracks affected files", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Update files",
        files: ["src/index.ts", "src/utils.ts"],
      })

      expect(checkpoint.affectedFiles.size).toBe(2)
      expect(checkpoint.affectedFiles.has("src/index.ts")).toBe(true)
      expect(checkpoint.affectedFiles.has("src/utils.ts")).toBe(true)
    })

    it("computes file state correctly", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      const fileState = checkpoint.affectedFiles.get("src/index.ts")
      expect(fileState).toBeDefined()
      expect(fileState!.contentHash).toHaveLength(16)
      expect(fileState!.mtime).toBe(1000)
      expect(fileState!.role).toBe("both")
    })

    it("captures git context", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      expect(checkpoint.gitContext.branch).toBe("main")
      expect(checkpoint.gitContext.baseCommit).toBe("abc123")
      expect(checkpoint.gitContext.hasUncommittedChanges).toBe(false)
    })

    it("captures critical dependencies", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      expect(checkpoint.criticalDeps.configHashes.has("package.json")).toBe(true)
      expect(checkpoint.criticalDeps.configHashes.has("tsconfig.json")).toBe(true)
    })

    it("handles missing files gracefully", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["nonexistent.ts"],
      })

      expect(checkpoint.affectedFiles.size).toBe(0)
    })

    it("sets initial phase", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
        initialPhase: "planning",
      })

      expect(checkpoint.pendingPhases).toContain("planning")
    })
  })

  describe("validateCheckpoint", () => {
    it("validates unchanged checkpoint as valid", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      const validation = await manager.validateCheckpoint(checkpoint.id)

      expect(validation.valid).toBe(true)
      expect(validation.layerChanges.every((l) => !l.hasChanges)).toBe(true)
    })

    it("detects file content changes", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      // Modify file
      await mockFs.writeFile("src/index.ts", 'export const foo = "changed"')

      const validation = await manager.validateCheckpoint(checkpoint.id)

      expect(validation.valid).toBe(false)
      const fileLayer = validation.layerChanges.find((l) => l.layer === 1)
      expect(fileLayer?.hasChanges).toBe(true)
      expect(fileLayer?.changedItems).toContain("src/index.ts")
    })

    it("detects dependency changes", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      // Modify package.json
      await mockFs.writeFile("package.json", '{"name": "changed"}')

      const validation = await manager.validateCheckpoint(checkpoint.id)

      expect(validation.valid).toBe(false)
      const depLayer = validation.layerChanges.find((l) => l.layer === 2)
      expect(depLayer?.hasChanges).toBe(true)
    })

    it("detects branch switch", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      // Create new manager with different git state
      const newGit = createMockGit({ branch: "feature", commit: "abc123" })
      const newManager = new SemanticCheckpointManager("test-session", {
        fs: mockFs,
        git: newGit,
      })

      // Copy checkpoint to new manager
      ;(newManager as any).checkpoints.set(checkpoint.id, checkpoint)

      const validation = await newManager.validateCheckpoint(checkpoint.id)

      expect(validation.valid).toBe(false)
      const gitLayer = validation.layerChanges.find((l) => l.layer === 3)
      expect(gitLayer?.hasChanges).toBe(true)
      expect(gitLayer?.impact).toBe("critical")
    })

    it("recommends full-rerun for branch switch", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      // Simulate branch switch
      const newGit = createMockGit({ branch: "feature", commit: "abc123" })
      const newManager = new SemanticCheckpointManager("test-session", {
        fs: mockFs,
        git: newGit,
      })
      ;(newManager as any).checkpoints.set(checkpoint.id, checkpoint)

      const validation = await newManager.validateCheckpoint(checkpoint.id)

      expect(validation.recommendedAction.action).toBe("full-rerun")
    })

    it("throws for nonexistent checkpoint", async () => {
      await expect(manager.validateCheckpoint("nonexistent")).rejects.toThrow(
        "Checkpoint not found"
      )
    })
  })

  describe("phase management", () => {
    it("records phase completion", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
        initialPhase: "planning",
      })

      manager.recordPhaseCompletion(checkpoint.id, "planning", "Created plan", ["plan.md"])

      const updated = manager.getCheckpoint(checkpoint.id)
      expect(updated?.completedPhases).toHaveLength(1)
      expect(updated?.completedPhases[0].phaseId).toBe("planning")
      expect(updated?.completedPhases[0].outputFiles).toContain("plan.md")
      expect(updated?.pendingPhases).not.toContain("planning")
    })

    it("adds pending phase", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      manager.addPendingPhase(checkpoint.id, "implementation")

      const updated = manager.getCheckpoint(checkpoint.id)
      expect(updated?.pendingPhases).toContain("implementation")
    })

    it("prevents duplicate pending phases", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      manager.addPendingPhase(checkpoint.id, "implementation")
      manager.addPendingPhase(checkpoint.id, "implementation")

      const updated = manager.getCheckpoint(checkpoint.id)
      expect(updated?.pendingPhases.filter((p) => p === "implementation")).toHaveLength(1)
    })
  })

  describe("file state management", () => {
    it("updates file state", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      const originalHash = checkpoint.affectedFiles.get("src/index.ts")?.contentHash

      // Modify and update
      await mockFs.writeFile("src/index.ts", "new content")
      await manager.updateFileState(checkpoint.id, "src/index.ts", "write")

      const updated = manager.getCheckpoint(checkpoint.id)
      const newHash = updated?.affectedFiles.get("src/index.ts")?.contentHash

      expect(newHash).not.toBe(originalHash)
      expect(updated?.affectedFiles.get("src/index.ts")?.role).toBe("write")
    })

    it("sets file consumers", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts", "src/utils.ts"],
      })

      manager.setFileConsumers(checkpoint.id, "src/utils.ts", ["src/index.ts"])

      const updated = manager.getCheckpoint(checkpoint.id)
      expect(updated?.affectedFiles.get("src/utils.ts")?.consumers).toContain("src/index.ts")
    })

    it("propagates impact to consumers", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts", "src/utils.ts"],
      })

      manager.setFileConsumers(checkpoint.id, "src/utils.ts", ["src/index.ts"])

      const affected = manager.propagateImpact(checkpoint.id, "src/utils.ts")

      expect(affected).toContain("src/index.ts")
    })
  })

  describe("persistence", () => {
    it("saves and loads checkpoint", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test persistence",
        files: ["src/index.ts"],
      })

      await manager.saveCheckpoint(checkpoint.id)

      // Create new manager and load
      const newManager = new SemanticCheckpointManager("test-session-2", {
        fs: mockFs,
        git: mockGit,
      })

      const loaded = await newManager.loadCheckpoint(checkpoint.id)

      expect(loaded.id).toBe(checkpoint.id)
      expect(loaded.taskIntent.summary).toBe(checkpoint.taskIntent.summary)
      expect(loaded.affectedFiles.size).toBe(checkpoint.affectedFiles.size)
    })

    it("lists saved checkpoints", async () => {
      const cp1 = await manager.createCheckpoint({
        taskDescription: "Test 1",
        files: [],
      })
      const cp2 = await manager.createCheckpoint({
        taskDescription: "Test 2",
        files: [],
      })

      await manager.saveCheckpoint(cp1.id)
      await manager.saveCheckpoint(cp2.id)

      const saved = await manager.listSavedCheckpoints()

      expect(saved).toContain(cp1.id)
      expect(saved).toContain(cp2.id)
    })
  })

  describe("checkpoint management", () => {
    it("gets checkpoint by id", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      const retrieved = manager.getCheckpoint(checkpoint.id)

      expect(retrieved).toBe(checkpoint)
    })

    it("returns undefined for missing checkpoint", () => {
      expect(manager.getCheckpoint("nonexistent")).toBeUndefined()
    })

    it("deletes checkpoint", async () => {
      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      expect(manager.deleteCheckpoint(checkpoint.id)).toBe(true)
      expect(manager.getCheckpoint(checkpoint.id)).toBeUndefined()
    })

    it("lists checkpoints", async () => {
      await manager.createCheckpoint({ taskDescription: "Test 1", files: [] })
      await manager.createCheckpoint({ taskDescription: "Test 2", files: [] })

      const list = manager.listCheckpoints()

      expect(list).toHaveLength(2)
    })
  })

  describe("events", () => {
    it("emits checkpoint-created event", async () => {
      const handler = vi.fn()
      manager.on("checkpoint-created", handler)

      await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "checkpoint-created",
          taskSummary: "Test",
          trackedFiles: 1,
        })
      )
    })

    it("emits checkpoint-invalidated event on validation failure", async () => {
      const handler = vi.fn()
      manager.on("checkpoint-invalidated", handler)

      const checkpoint = await manager.createCheckpoint({
        taskDescription: "Test",
        files: ["src/index.ts"],
      })

      await mockFs.writeFile("src/index.ts", "changed content")
      await manager.validateCheckpoint(checkpoint.id)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "checkpoint-invalidated",
          checkpointId: checkpoint.id,
        })
      )
    })

    it("emits checkpoint-event for all events", async () => {
      const handler = vi.fn()
      manager.on("checkpoint-event", handler)

      await manager.createCheckpoint({
        taskDescription: "Test",
        files: [],
      })

      expect(handler).toHaveBeenCalled()
    })
  })
})

describe("DefaultFingerprintStrategy", () => {
  let strategy: DefaultFingerprintStrategy
  let mockFs: FileSystemAdapter

  beforeEach(() => {
    mockFs = createMockFs({
      "test.ts": { content: "const x = 1", mtime: 1000 },
    })
    strategy = new DefaultFingerprintStrategy(mockFs)
  })

  describe("detectChangeFast", () => {
    it("detects mtime change", async () => {
      const lastKnown: FileState = {
        contentHash: "abc",
        semanticHash: "abc",
        role: "read",
        mtime: 500,
      }

      const changed = await strategy.detectChangeFast("test.ts", lastKnown)

      expect(changed).toBe(true)
    })

    it("returns false for same mtime", async () => {
      const lastKnown: FileState = {
        contentHash: "abc",
        semanticHash: "abc",
        role: "read",
        mtime: 1000,
      }

      const changed = await strategy.detectChangeFast("test.ts", lastKnown)

      expect(changed).toBe(false)
    })

    it("returns true for missing file", async () => {
      const lastKnown: FileState = {
        contentHash: "abc",
        semanticHash: "abc",
        role: "read",
        mtime: 1000,
      }

      const changed = await strategy.detectChangeFast("nonexistent.ts", lastKnown)

      expect(changed).toBe(true)
    })
  })

  describe("detectChangePrecise", () => {
    it("detects file deletion", async () => {
      const lastKnown: FileState = {
        contentHash: "abc",
        semanticHash: "abc",
        role: "read",
        mtime: 1000,
      }

      const analysis = await strategy.detectChangePrecise("nonexistent.ts", lastKnown)

      expect(analysis.changeType).toBe("file-deleted")
      expect(analysis.isSignificant).toBe(true)
    })

    it("detects no change when content unchanged", async () => {
      const content = "const x = 1"
      const hash = strategy.computeContentHash(content)

      const lastKnown: FileState = {
        contentHash: hash,
        semanticHash: hash,
        role: "read",
        mtime: 1000,
      }

      const analysis = await strategy.detectChangePrecise("test.ts", lastKnown)

      expect(analysis.changeType).toBe("formatting-only")
      expect(analysis.isSignificant).toBe(false)
    })

    it("detects value change when content changed", async () => {
      const lastKnown: FileState = {
        contentHash: "different",
        semanticHash: "different",
        role: "read",
        mtime: 1000,
      }

      const analysis = await strategy.detectChangePrecise("test.ts", lastKnown)

      expect(analysis.changeType).toBe("value-change")
      expect(analysis.isSignificant).toBe(true)
    })
  })

  describe("computeFileState", () => {
    it("computes file state", async () => {
      const state = await strategy.computeFileState("test.ts", "write")

      expect(state.contentHash).toHaveLength(16)
      expect(state.semanticHash).toHaveLength(16)
      expect(state.role).toBe("write")
      expect(state.mtime).toBe(1000)
    })
  })

  describe("computeContentHash", () => {
    it("produces consistent hashes", () => {
      const hash1 = strategy.computeContentHash("test content")
      const hash2 = strategy.computeContentHash("test content")

      expect(hash1).toBe(hash2)
    })

    it("produces different hashes for different content", () => {
      const hash1 = strategy.computeContentHash("content 1")
      const hash2 = strategy.computeContentHash("content 2")

      expect(hash1).not.toBe(hash2)
    })
  })
})

describe("CheckpointManagerRegistry", () => {
  let registry: CheckpointManagerRegistry
  let mockFs: FileSystemAdapter

  beforeEach(() => {
    mockFs = createMockFs({})
    registry = new CheckpointManagerRegistry({ fs: mockFs })
  })

  afterEach(() => {
    resetCheckpointRegistry()
  })

  it("creates manager for new session", () => {
    const manager = registry.getManager("session-1")

    expect(manager).toBeInstanceOf(SemanticCheckpointManager)
    expect(registry.hasManager("session-1")).toBe(true)
  })

  it("returns same manager for same session", () => {
    const manager1 = registry.getManager("session-1")
    const manager2 = registry.getManager("session-1")

    expect(manager1).toBe(manager2)
  })

  it("removes manager", () => {
    registry.getManager("session-1")
    expect(registry.hasManager("session-1")).toBe(true)

    registry.removeManager("session-1")
    expect(registry.hasManager("session-1")).toBe(false)
  })

  it("lists sessions", () => {
    registry.getManager("session-a")
    registry.getManager("session-b")

    const sessions = registry.listSessions()

    expect(sessions).toContain("session-a")
    expect(sessions).toContain("session-b")
  })
})

describe("getCheckpointRegistry singleton", () => {
  let mockFs: FileSystemAdapter

  beforeEach(() => {
    mockFs = createMockFs({})
  })

  afterEach(() => {
    resetCheckpointRegistry()
  })

  it("returns singleton", () => {
    const registry1 = getCheckpointRegistry({ fs: mockFs })
    const registry2 = getCheckpointRegistry({ fs: mockFs })

    expect(registry1).toBe(registry2)
  })

  it("throws without fs on first call", () => {
    expect(() => getCheckpointRegistry()).toThrow("FileSystemAdapter is required")
  })

  it("resets on resetCheckpointRegistry", () => {
    const registry1 = getCheckpointRegistry({ fs: mockFs })
    resetCheckpointRegistry()
    const registry2 = getCheckpointRegistry({ fs: mockFs })

    expect(registry1).not.toBe(registry2)
  })
})

describe("RECOVERY_STRATEGY_TABLE", () => {
  it("returns full-rerun for task intent change", () => {
    const decision = RECOVERY_STRATEGY_TABLE["0:any"]([])

    expect(decision.action).toBe("full-rerun")
  })

  it("returns partial-rerun for write file modified", () => {
    const decision = RECOVERY_STRATEGY_TABLE["1:write-modified"](["src/index.ts"])

    expect(decision.action).toBe("partial-rerun")
    expect((decision as any).fromPhase).toBe("affected")
  })

  it("returns continue for read file modified", () => {
    const decision = RECOVERY_STRATEGY_TABLE["1:read-modified"](["src/utils.ts"])

    expect(decision.action).toBe("continue")
  })

  it("returns partial-rerun for api change", () => {
    const decision = RECOVERY_STRATEGY_TABLE["1:api-change"](["src/api.ts"])

    expect(decision.action).toBe("partial-rerun")
  })

  it("returns user-decision for dependency change", () => {
    const decision = RECOVERY_STRATEGY_TABLE["2:dependency"](["package.json"])

    expect(decision.action).toBe("user-decision")
  })

  it("returns full-rerun for branch switch", () => {
    const decision = RECOVERY_STRATEGY_TABLE["3:branch-switch"]([])

    expect(decision.action).toBe("full-rerun")
  })

  it("returns user-decision for new commits", () => {
    const decision = RECOVERY_STRATEGY_TABLE["3:new-commits"](["commit-1"])

    expect(decision.action).toBe("user-decision")
  })
})
