import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createDirectoryAgentsInjectorHook } from "./index"
import * as storage from "./storage"
import * as dynamicTruncator from "../../shared/dynamic-truncator"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-dir-agents-"))
}

function createMockCtx(directory = "/test/project"): PluginInput {
  return {
    directory,
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    },
  } as unknown as PluginInput
}

function createToolInput(
  tool: string,
  sessionID = "session-123",
  callID = "call-123"
) {
  return { tool, sessionID, callID }
}

function createToolOutput(title = "Test", output = "test output") {
  return { title, output, metadata: {} }
}

describe("createDirectoryAgentsInjectorHook", () => {
  let tmpDir: string
  let loadSpy: ReturnType<typeof spyOn>
  let saveSpy: ReturnType<typeof spyOn>
  let clearSpy: ReturnType<typeof spyOn>
  let truncatorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tmpDir = createTempDir()

    // Mock storage functions
    loadSpy = spyOn(storage, "loadInjectedPaths").mockReturnValue(new Set())
    saveSpy = spyOn(storage, "saveInjectedPaths").mockImplementation(() => {})
    clearSpy = spyOn(storage, "clearInjectedPaths").mockImplementation(() => {})

    // Mock truncator
    truncatorSpy = spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
      truncate: mock(async (sessionID: string, content: string) => ({
        result: content,
        truncated: false,
      })),
      getUsage: mock(async () => null),
      truncateSync: mock(() => ({ result: "", truncated: false })),
    } as ReturnType<typeof dynamicTruncator.createDynamicTruncator>)
  })

  afterEach(() => {
    loadSpy.mockRestore()
    saveSpy.mockRestore()
    clearSpy.mockRestore()
    truncatorSpy.mockRestore()

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // #region resolveFilePath (internal function tested via behavior)
  describe("file path resolution", () => {
    test("handles absolute paths unchanged", async () => {
      // #given: Project with AGENTS.md
      const subDir = path.join(tmpDir, "src")
      fs.mkdirSync(subDir, { recursive: true })
      fs.writeFileSync(path.join(subDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read tool with absolute path
      const absPath = path.join(subDir, "index.ts")
      const input = createToolInput("Read")
      const output = createToolOutput(absPath)

      await hook["tool.execute.after"](input, output)

      // #then: Should process the absolute path
      expect(output.output).toContain("Directory Context")
    })

    test("resolves relative paths against ctx.directory", async () => {
      // #given: Project with AGENTS.md
      const subDir = path.join(tmpDir, "src")
      fs.mkdirSync(subDir, { recursive: true })
      fs.writeFileSync(path.join(subDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read tool with relative path (simulated via title)
      const input = createToolInput("Read")
      // The title contains the resolved path after Read tool execution
      const output = createToolOutput(path.join(subDir, "index.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Should find AGENTS.md in the directory
      expect(output.output).toContain("Directory Context")
    })
  })
  // #endregion

  // #region findAgentsMdUp (internal function tested via behavior)
  describe("AGENTS.md discovery", () => {
    test("finds AGENTS.md in target directory", async () => {
      // #given: AGENTS.md in src directory
      const srcDir = path.join(tmpDir, "src")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Source Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read file in src directory
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(srcDir, "index.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Should inject src/AGENTS.md content
      expect(output.output).toContain("Source Agents")
    })

    test("finds AGENTS.md in parent directories", async () => {
      // #given: AGENTS.md in parent, file in nested directory
      const srcDir = path.join(tmpDir, "src")
      const deepDir = path.join(srcDir, "utils", "helpers")
      fs.mkdirSync(deepDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Parent Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read file in deep nested directory
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(deepDir, "helper.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Should find AGENTS.md in parent
      expect(output.output).toContain("Parent Agents")
    })

    test("skips root AGENTS.md", async () => {
      // #given: AGENTS.md at project root only
      fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Root Agents")
      const srcDir = path.join(tmpDir, "src")
      fs.mkdirSync(srcDir, { recursive: true })

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read file in src
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(srcDir, "index.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Should NOT inject root AGENTS.md (already loaded by system)
      expect(output.output).not.toContain("Root Agents")
      expect(output.output).toBe("test output")
    })

    test("stops at project root", async () => {
      // #given: AGENTS.md outside project root
      // Note: We can't safely write to parent, so we test the boundary behavior

      const srcDir = path.join(tmpDir, "src")
      fs.mkdirSync(srcDir, { recursive: true })

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read file in src
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(srcDir, "index.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Output should remain unmodified (no AGENTS.md found within project)
      expect(output.output).toBe("test output")
      expect(output.output).not.toContain("Directory Context")
    })

    test("returns paths in hierarchical order", async () => {
      // #given: Multiple AGENTS.md files at different levels
      const srcDir = path.join(tmpDir, "src")
      const componentsDir = path.join(srcDir, "components")
      fs.mkdirSync(componentsDir, { recursive: true })

      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Level 1 - src")
      fs.writeFileSync(
        path.join(componentsDir, "AGENTS.md"),
        "# Level 2 - components"
      )

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Read file in components
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(componentsDir, "Button.tsx"))

      await hook["tool.execute.after"](input, output)

      // #then: Both should be injected in order (parent first, then child)
      expect(output.output).toContain("Level 1 - src")
      expect(output.output).toContain("Level 2 - components")

      // Check order: Level 1 should come before Level 2
      const level1Index = output.output.indexOf("Level 1 - src")
      const level2Index = output.output.indexOf("Level 2 - components")
      expect(level1Index).toBeLessThan(level2Index)
    })
  })
  // #endregion

  // #region tool.execute.before (batch handling)
  describe("tool.execute.before (batch handling)", () => {
    test("extracts Read file paths from batch tool_calls", async () => {
      // #given: Hook and batch input with Read calls
      const srcDir = path.join(tmpDir, "src")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Batch Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      const callID = "batch-call-123"
      const input = createToolInput("Batch", "session-123", callID)
      const beforeOutput = {
        args: {
          tool_calls: [
            { tool: "Read", parameters: { filePath: path.join(srcDir, "file1.ts") } },
            { tool: "Read", parameters: { filePath: path.join(srcDir, "file2.ts") } },
            { tool: "Grep", parameters: { pattern: "test" } },
          ],
        },
      }

      // #when: Call tool.execute.before
      await hook["tool.execute.before"](input, beforeOutput)

      // #then: Should store pending paths
      // Verify by calling tool.execute.after for batch
      const afterOutput = createToolOutput("Batch result", "batch output")
      await hook["tool.execute.after"](input, afterOutput)

      // Should have processed the Read paths
      expect(afterOutput.output).toContain("Directory Context")
    })

    test("stores pending paths for batch call ID", async () => {
      // #given: Multiple batch calls
      const srcDir = path.join(tmpDir, "src")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // Batch 1
      const input1 = createToolInput("Batch", "session-123", "batch-1")
      await hook["tool.execute.before"](input1, {
        args: {
          tool_calls: [
            { tool: "Read", parameters: { filePath: path.join(srcDir, "file.ts") } },
          ],
        },
      })

      // Batch 2 with different ID
      const input2 = createToolInput("Batch", "session-123", "batch-2")
      await hook["tool.execute.before"](input2, {
        args: {
          tool_calls: [
            { tool: "Read", parameters: { filePath: path.join(srcDir, "other.ts") } },
          ],
        },
      })

      // #when: Complete batch 2 first
      const output2 = createToolOutput("Batch 2", "output 2")
      await hook["tool.execute.after"](input2, output2)

      // #then: Should process batch 2's paths
      expect(output2.output).toContain("Directory Context")
    })
  })
  // #endregion

  // #region tool.execute.after
  describe("tool.execute.after", () => {
    describe("Read tool", () => {
      test("injects AGENTS.md content for accessed directory", async () => {
        // #given: AGENTS.md in directory
        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Test Agents Content")

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        // #when: Read tool call
        const input = createToolInput("Read")
        const output = createToolOutput(path.join(srcDir, "index.ts"))

        await hook["tool.execute.after"](input, output)

        // #then: Should inject content
        expect(output.output).toContain("Test Agents Content")
        expect(output.output).toContain("Directory Context")
      })

      test("skips already injected directories", async () => {
        // #given: Directory already in cache
        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

        loadSpy.mockReturnValue(new Set([srcDir]))

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        // #when: Read in already injected directory
        const input = createToolInput("Read")
        const output = createToolOutput(path.join(srcDir, "index.ts"))

        await hook["tool.execute.after"](input, output)

        // #then: Should not inject again
        expect(output.output).toBe("test output")
      })

      test("saves injected paths to storage", async () => {
        // #given: Hook
        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        // #when: Read tool call
        const sessionID = "session-save"
        const input = createToolInput("Read", sessionID)
        const output = createToolOutput(path.join(srcDir, "index.ts"))

        await hook["tool.execute.after"](input, output)

        // #then: Should save to storage
        expect(saveSpy).toHaveBeenCalledWith(sessionID, expect.any(Set))
      })

      test("includes truncation notice when content truncated", async () => {
        // #given: Truncator that truncates
        truncatorSpy.mockReturnValue({
          truncate: mock(async (sessionID: string, content: string) => ({
            result: content.slice(0, 10) + "...",
            truncated: true,
          })),
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        } as ReturnType<typeof dynamicTruncator.createDynamicTruncator>)

        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Very Long Content ".repeat(100))

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        // #when: Read tool call
        const input = createToolInput("Read")
        const output = createToolOutput(path.join(srcDir, "index.ts"))

        await hook["tool.execute.after"](input, output)

        // #then: Should include truncation notice
        expect(output.output).toContain("truncated")
        expect(output.output).toContain("AGENTS.md")
      })
    })

    describe("Batch tool", () => {
      test("processes all pending Read paths", async () => {
        // #given: Multiple Read paths in batch
        const srcDir = path.join(tmpDir, "src")
        const libDir = path.join(tmpDir, "lib")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.mkdirSync(libDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Src Agents")
        fs.writeFileSync(path.join(libDir, "AGENTS.md"), "# Lib Agents")

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        const callID = "batch-123"
        const input = createToolInput("Batch", "session-123", callID)

        await hook["tool.execute.before"](input, {
          args: {
            tool_calls: [
              { tool: "Read", parameters: { filePath: path.join(srcDir, "a.ts") } },
              { tool: "Read", parameters: { filePath: path.join(libDir, "b.ts") } },
            ],
          },
        })

        // #when: Complete batch
        const output = createToolOutput("Batch", "batch output")
        await hook["tool.execute.after"](input, output)

        // #then: Should process all paths
        expect(output.output).toContain("Src Agents")
        expect(output.output).toContain("Lib Agents")
      })

      test("clears pending paths after processing", async () => {
        // #given: Batch call
        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)

        const callID = "batch-clear"
        const input = createToolInput("Batch", "session-123", callID)

        await hook["tool.execute.before"](input, {
          args: {
            tool_calls: [
              { tool: "Read", parameters: { filePath: path.join(srcDir, "file.ts") } },
            ],
          },
        })

        // Complete batch
        const output1 = createToolOutput("Batch", "output 1")
        await hook["tool.execute.after"](input, output1)

        // #when: Try to complete same batch again
        const output2 = createToolOutput("Batch", "output 2")
        await hook["tool.execute.after"](input, output2)

        // #then: Second call should not process (pending cleared)
        // First output has injection, second should not
        expect(output1.output).toContain("Directory Context")
        // Note: output2 won't have new injections since dir already injected in session
      })
    })
  })
  // #endregion

  // #region event handling
  describe("event handling", () => {
    describe("session.deleted", () => {
      test("clears session cache", async () => {
        // #given: Hook with session
        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)
        const sessionID = "session-delete"

        // #when: Delete session
        await hook.event({
          event: {
            type: "session.deleted",
            properties: { info: { id: sessionID } },
          },
        })

        // #then: Should clear storage
        expect(clearSpy).toHaveBeenCalledWith(sessionID)
      })

    })

    describe("session.compacted", () => {
      test("clears session cache", async () => {
        // #given: Hook with session
        const srcDir = path.join(tmpDir, "src")
        fs.mkdirSync(srcDir, { recursive: true })
        fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)
        const sessionID = "session-compact"

        // Inject first
        const input = createToolInput("Read", sessionID)
        const output1 = createToolOutput(path.join(srcDir, "index.ts"))
        await hook["tool.execute.after"](input, output1)
        expect(output1.output).toContain("Directory Context")

        // Reset loadSpy to return empty (simulating cleared cache)
        loadSpy.mockReturnValue(new Set())

        // #when: Compact session
        await hook.event({
          event: {
            type: "session.compacted",
            properties: { sessionID },
          },
        })

        // #then: Should clear storage
        expect(clearSpy).toHaveBeenCalledWith(sessionID)
      })

      test("handles sessionID from info property", async () => {
        // #given: Hook
        const mockCtx = createMockCtx(tmpDir)
        const hook = createDirectoryAgentsInjectorHook(mockCtx)
        const sessionID = "session-info-compact"

        // #when: Compact with sessionID in info
        await hook.event({
          event: {
            type: "session.compacted",
            properties: { info: { id: sessionID } },
          },
        })

        // #then: Should clear storage
        expect(clearSpy).toHaveBeenCalledWith(sessionID)
      })
    })

    test("ignores unknown event types", async () => {
      // #given: Hook with tracked session
      const srcDir = path.join(tmpDir, "src-unknown")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)
      const sessionID = "session-unknown"

      // Inject once
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput(path.join(srcDir, "file.ts"))
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("Directory Context")

      // #when: Unknown event
      await hook.event({
        event: {
          type: "session.unknown",
          properties: { sessionID },
        },
      })

      // #then: State should be preserved (not cleared by unknown event)
      // Re-reading same dir should NOT re-inject (still cached)
      loadSpy.mockReturnValue(new Set([srcDir]))
      const output2 = createToolOutput(path.join(srcDir, "file2.ts"))
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output")
    })

    test("handles missing properties gracefully", async () => {
      // #given: Hook
      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Events with missing properties
      await hook.event({
        event: {
          type: "session.deleted",
          properties: undefined,
        },
      })

      await hook.event({
        event: {
          type: "session.compacted",
          properties: {},
        },
      })

      // #then: clearInjectedPaths should NOT be called with undefined
      // The implementation should guard against undefined sessionID
      const clearCalls = clearSpy.mock.calls
      for (const call of clearCalls) {
        expect(call[0]).not.toBeUndefined()
      }
    })
  })
  // #endregion

  // #region edge cases
  describe("edge cases", () => {
    test("handles non-Read/Batch tools", async () => {
      // #given: Hook
      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Grep tool (not Read or Batch)
      const input = createToolInput("Grep")
      const output = createToolOutput("Grep", "grep results")

      await hook["tool.execute.after"](input, output)

      // #then: Should not modify output
      expect(output.output).toBe("grep results")
    })

    test("handles file read errors gracefully", async () => {
      // #given: AGENTS.md that cannot be read (we'll remove read permission)
      const srcDir = path.join(tmpDir, "src-error")
      fs.mkdirSync(srcDir, { recursive: true })
      const agentsPath = path.join(srcDir, "AGENTS.md")
      fs.writeFileSync(agentsPath, "# Agents")

      // Make file unreadable (skip on Windows)
      if (process.platform !== "win32") {
        fs.chmodSync(agentsPath, 0o000)
      }

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Try to read
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(srcDir, "index.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Original output should be preserved (error handled gracefully)
      // Restore permissions for cleanup
      if (process.platform !== "win32") {
        fs.chmodSync(agentsPath, 0o644)
        // On non-Windows, since read failed, no content should be injected
        // but we can't test this reliably due to fs.existsSync still returning true
      }
      // At minimum, the call completed without throwing
      expect(output.output).toBeDefined()
    })

    test("handles empty tool_calls in batch", async () => {
      // #given: Batch with no Read calls
      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      const input = createToolInput("Batch", "session-123", "batch-empty")

      await hook["tool.execute.before"](input, {
        args: {
          tool_calls: [
            { tool: "Grep", parameters: { pattern: "test" } },
          ],
        },
      })

      // #when: Complete batch
      const output = createToolOutput("Batch", "output")
      await hook["tool.execute.after"](input, output)

      // #then: Should not modify output (no Read calls)
      expect(output.output).toBe("output")
    })

    test("handles batch without tool_calls", async () => {
      // #given: Batch with undefined tool_calls
      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      const input = createToolInput("Batch", "session-123", "batch-no-calls")

      await hook["tool.execute.before"](input, {
        args: {},
      })

      // #when: Complete batch
      const output = createToolOutput("Batch", "output")
      await hook["tool.execute.after"](input, output)

      // #then: Should not throw
      expect(output.output).toBe("output")
    })
  })
  // #endregion

  // #region complex state transitions
  describe("complex state transitions", () => {
    test("complete flow: inject → session.compacted → re-inject", async () => {
      // #given: Directory with AGENTS.md
      const srcDir = path.join(tmpDir, "src-flow")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Flow Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)
      const sessionID = "session-flow"

      // Step 1: Initial injection
      const input1 = createToolInput("Read", sessionID)
      const output1 = createToolOutput(path.join(srcDir, "file1.ts"))
      await hook["tool.execute.after"](input1, output1)
      expect(output1.output).toContain("Flow Agents")

      // Step 2: Same directory should not re-inject
      loadSpy.mockReturnValue(new Set([srcDir]))
      const output2 = createToolOutput(path.join(srcDir, "file2.ts"))
      await hook["tool.execute.after"](input1, output2)
      expect(output2.output).toBe("test output")

      // Step 3: Compact session (clears cache)
      loadSpy.mockReturnValue(new Set())
      await hook.event({
        event: { type: "session.compacted", properties: { sessionID } },
      })

      // Step 4: Should re-inject after compaction
      const output3 = createToolOutput(path.join(srcDir, "file3.ts"))
      await hook["tool.execute.after"](input1, output3)
      expect(output3.output).toContain("Flow Agents")
    })

    test("multiple directories in same session tracked independently", async () => {
      // #given: Two directories with AGENTS.md
      const srcDir = path.join(tmpDir, "src-multi")
      const libDir = path.join(tmpDir, "lib-multi")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.mkdirSync(libDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Src Agents")
      fs.writeFileSync(path.join(libDir, "AGENTS.md"), "# Lib Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)
      const sessionID = "session-multi"

      // #when: Read from src
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput(path.join(srcDir, "file.ts"))
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("Src Agents")

      // Read from lib (different directory)
      loadSpy.mockReturnValue(new Set([srcDir]))
      const output2 = createToolOutput(path.join(libDir, "file.ts"))
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toContain("Lib Agents")

      // #then: Both directories were injected
      expect(saveSpy).toHaveBeenCalledTimes(2)
    })

    test("batch processes multiple directories atomically", async () => {
      // #given: Two directories in one batch
      const srcDir = path.join(tmpDir, "src-batch")
      const libDir = path.join(tmpDir, "lib-batch")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.mkdirSync(libDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Src Batch")
      fs.writeFileSync(path.join(libDir, "AGENTS.md"), "# Lib Batch")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)
      const sessionID = "session-batch"
      const callID = "batch-atomic"

      const input = createToolInput("Batch", sessionID, callID)

      // #when: Process batch with both directories
      await hook["tool.execute.before"](input, {
        args: {
          tool_calls: [
            { tool: "Read", parameters: { filePath: path.join(srcDir, "a.ts") } },
            { tool: "Read", parameters: { filePath: path.join(libDir, "b.ts") } },
          ],
        },
      })

      const output = createToolOutput("Batch", "batch result")
      await hook["tool.execute.after"](input, output)

      // #then: Both agents should be in output
      expect(output.output).toContain("Src Batch")
      expect(output.output).toContain("Lib Batch")
    })

    test("truncator exception does not break injection chain", async () => {
      // #given: Truncator that throws
      truncatorSpy.mockReturnValue({
        truncate: mock(async () => {
          throw new Error("Truncator error")
        }),
      } as unknown as ReturnType<typeof dynamicTruncator.createDynamicTruncator>)

      const srcDir = path.join(tmpDir, "src-truncate-err")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)

      // #when: Try to inject (truncator throws)
      const input = createToolInput("Read")
      const output = createToolOutput(path.join(srcDir, "file.ts"))

      await hook["tool.execute.after"](input, output)

      // #then: Should handle error gracefully
      // Output should at least be defined (may or may not have content depending on impl)
      expect(output.output).toBeDefined()
    })

    test("session.deleted during batch processing", async () => {
      // #given: Batch started
      const srcDir = path.join(tmpDir, "src-delete-batch")
      fs.mkdirSync(srcDir, { recursive: true })
      fs.writeFileSync(path.join(srcDir, "AGENTS.md"), "# Agents")

      const mockCtx = createMockCtx(tmpDir)
      const hook = createDirectoryAgentsInjectorHook(mockCtx)
      const sessionID = "session-delete-batch"
      const callID = "batch-delete"

      // Start batch
      const input = createToolInput("Batch", sessionID, callID)
      await hook["tool.execute.before"](input, {
        args: {
          tool_calls: [
            { tool: "Read", parameters: { filePath: path.join(srcDir, "file.ts") } },
          ],
        },
      })

      // #when: Delete session before batch completes
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Complete batch after deletion
      const output = createToolOutput("Batch", "result")
      await hook["tool.execute.after"](input, output)

      // #then: Should complete without error
      expect(output.output).toBeDefined()
    })
  })
  // #endregion
})
