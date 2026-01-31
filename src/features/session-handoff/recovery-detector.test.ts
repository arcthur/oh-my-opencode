import { describe, it, expect, beforeEach } from "bun:test"
import {
  RecoveryPatternDetector,
  classifyError,
  isSameIntent,
  shouldMergePatterns,
  addOrMergePattern,
  type ToolExecution,
} from "./recovery-detector"
import type { RecoveryPattern } from "./types"

describe("RecoveryPatternDetector", () => {
  describe("classifyError", () => {
    it("classifies type errors", () => {
      expect(classifyError("Type error: cannot assign string to number")).toBe("type-error")
      expect(classifyError("TS2322: Type 'string' is not assignable to type 'number'")).toBe(
        "type-error"
      )
    })

    it("classifies module not found errors", () => {
      expect(classifyError("Cannot find module '@/types'")).toBe("module-not-found")
      expect(classifyError("Error: ENOENT: no such file or directory")).toBe("module-not-found")
    })

    it("classifies syntax errors", () => {
      expect(classifyError("SyntaxError: Unexpected token '{'")).toBe("syntax-error")
      expect(classifyError("Parsing error: unterminated string")).toBe("syntax-error")
    })

    it("classifies permission errors", () => {
      expect(classifyError("Error: EACCES: permission denied")).toBe("permission-denied")
      expect(classifyError("Access denied to file")).toBe("permission-denied")
    })

    it("classifies network errors", () => {
      expect(classifyError("Error: ECONNREFUSED")).toBe("network-error")
      expect(classifyError("fetch failed: network error")).toBe("network-error")
    })

    it("returns unknown for unrecognized errors", () => {
      expect(classifyError("Something went wrong")).toBe("unknown")
    })
  })

  describe("isSameIntent", () => {
    it("returns true for same file edits", () => {
      const a: ToolExecution = {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        timestamp: 1000,
      }
      const b: ToolExecution = {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: true,
        timestamp: 2000,
      }
      expect(isSameIntent(a, b)).toBe(true)
    })

    it("returns false for different file edits", () => {
      const a: ToolExecution = {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        timestamp: 1000,
      }
      const b: ToolExecution = {
        tool: "Edit",
        args: { file_path: "src/bar.ts" },
        success: true,
        timestamp: 2000,
      }
      expect(isSameIntent(a, b)).toBe(false)
    })

    it("returns true for same bash command prefix", () => {
      const a: ToolExecution = {
        tool: "Bash",
        args: { command: "npm install foo" },
        success: false,
        timestamp: 1000,
      }
      const b: ToolExecution = {
        tool: "Bash",
        args: { command: "npm install bar" },
        success: true,
        timestamp: 2000,
      }
      expect(isSameIntent(a, b)).toBe(true)
    })

    it("returns false for different tools", () => {
      const a: ToolExecution = {
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        timestamp: 1000,
      }
      const b: ToolExecution = {
        tool: "Bash",
        args: { command: "npm install" },
        success: true,
        timestamp: 2000,
      }
      expect(isSameIntent(a, b)).toBe(false)
    })
  })

  describe("RecoveryPatternDetector", () => {
    let detector: RecoveryPatternDetector

    beforeEach(() => {
      detector = new RecoveryPatternDetector({ minFailures: 2, windowSize: 10 })
    })

    it("detects recovery pattern after 2 failures", () => {
      // First failure
      const result1 = detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        error: "Type error: cannot assign",
        timestamp: 1000,
      })
      expect(result1).toBeNull()

      // Second failure
      const result2 = detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        error: "Type error: still wrong",
        timestamp: 2000,
      })
      expect(result2).toBeNull()

      // Success - should trigger pattern detection
      const result3 = detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: true,
        result: "File updated",
        timestamp: 3000,
      })

      expect(result3).not.toBeNull()
      expect(result3!.failureSequence).toHaveLength(2)
      expect(result3!.resolution.tool).toBe("Edit")
      expect(result3!.contextSignature.errorCategory).toBe("type-error")
    })

    it("does not detect pattern with only 1 failure", () => {
      // One failure
      detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        error: "Type error",
        timestamp: 1000,
      })

      // Success - should NOT trigger (only 1 failure)
      const result = detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: true,
        result: "File updated",
        timestamp: 2000,
      })

      expect(result).toBeNull()
    })

    it("ignores failures with different intent", () => {
      // Failure on different file
      detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/other.ts" },
        success: false,
        error: "Error",
        timestamp: 1000,
      })

      // Failure on target file
      detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        error: "Error",
        timestamp: 2000,
      })

      // Success on target file - only 1 matching failure
      const result = detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: true,
        timestamp: 3000,
      })

      expect(result).toBeNull()
    })

    it("resets buffer on reset()", () => {
      detector.onToolExecuted({
        tool: "Edit",
        args: { file_path: "src/foo.ts" },
        success: false,
        error: "Error",
        timestamp: 1000,
      })

      expect(detector.getBufferSize()).toBe(1)

      detector.reset()

      expect(detector.getBufferSize()).toBe(0)
    })
  })

  describe("shouldMergePatterns", () => {
    const createPattern = (
      errorCategory: string,
      toolChain: string[],
      filePatterns: string[]
    ): RecoveryPattern => ({
      id: "test",
      failureSequence: [],
      resolution: { tool: "Edit", args: {}, result: "", timestamp: 0 },
      contextSignature: {
        errorCategory: errorCategory as any,
        toolChain,
        filePatterns,
      },
      stats: { occurrences: 1, firstSeen: 0, lastSeen: 0, successfulApplications: 0 },
    })

    it("returns true for identical patterns", () => {
      const a = createPattern("type-error", ["Edit"], ["*.ts"])
      const b = createPattern("type-error", ["Edit"], ["*.ts"])
      expect(shouldMergePatterns(a, b)).toBe(true)
    })

    it("returns false for different error categories", () => {
      const a = createPattern("type-error", ["Edit"], ["*.ts"])
      const b = createPattern("syntax-error", ["Edit"], ["*.ts"])
      expect(shouldMergePatterns(a, b)).toBe(false)
    })

    it("returns false for different tool chains", () => {
      const a = createPattern("type-error", ["Edit"], ["*.ts"])
      const b = createPattern("type-error", ["Bash"], ["*.ts"])
      expect(shouldMergePatterns(a, b)).toBe(false)
    })

    it("returns true for >50% file pattern overlap", () => {
      const a = createPattern("type-error", ["Edit"], ["*.ts", "*.tsx", "src/*"])
      const b = createPattern("type-error", ["Edit"], ["*.ts", "*.tsx"])
      expect(shouldMergePatterns(a, b)).toBe(true)
    })

    it("returns false for <50% file pattern overlap", () => {
      const a = createPattern("type-error", ["Edit"], ["*.ts", "*.tsx", "src/*", "lib/*"])
      const b = createPattern("type-error", ["Edit"], ["*.js"])
      expect(shouldMergePatterns(a, b)).toBe(false)
    })
  })

  describe("addOrMergePattern", () => {
    const createPattern = (id: string, occurrences: number): RecoveryPattern => ({
      id,
      failureSequence: [],
      resolution: { tool: "Edit", args: {}, result: "", timestamp: 0 },
      contextSignature: {
        errorCategory: "type-error",
        toolChain: ["Edit"],
        filePatterns: ["*.ts"],
      },
      stats: { occurrences, firstSeen: 0, lastSeen: 0, successfulApplications: 0 },
    })

    it("adds new pattern to empty list", () => {
      const result = addOrMergePattern([], createPattern("a", 1))
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("a")
    })

    it("merges duplicate pattern", () => {
      const existing = [createPattern("a", 2)]
      const incoming = createPattern("b", 1)
      const result = addOrMergePattern(existing, incoming)

      expect(result).toHaveLength(1)
      expect(result[0].stats.occurrences).toBe(3)
    })

    it("adds non-duplicate pattern", () => {
      const existing = [createPattern("a", 1)]
      const incoming: RecoveryPattern = {
        ...createPattern("b", 1),
        contextSignature: {
          errorCategory: "syntax-error", // Different category
          toolChain: ["Edit"],
          filePatterns: ["*.ts"],
        },
      }
      const result = addOrMergePattern(existing, incoming)

      expect(result).toHaveLength(2)
    })
  })
})
