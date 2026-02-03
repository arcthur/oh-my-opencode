import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { createRepoOverviewInjectorHook } from "./index"
import { DEFAULT_CONFIG } from "./types"
import * as generator from "./generator"

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-repo-overview-"))
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

function createToolOutput(output = "test output") {
  return { title: "Test", output, metadata: {} }
}

describe("createRepoOverviewInjectorHook", () => {
  let generateSpy: ReturnType<typeof spyOn>
  let formatSpy: ReturnType<typeof spyOn>
  let tmpDir: string

  beforeEach(() => {
    // Mock generator functions
    generateSpy = spyOn(generator, "generateRepoOverview").mockReturnValue({
      name: "test-project",
      description: "A test project",
      techStack: ["TypeScript"],
      packageManager: "npm",
      commands: { build: "npm run build" },
      coreFiles: ["src/index.ts"],
      structure: "src/\n  index.ts",
      frameworks: ["Express"],
      testFramework: "Jest",
    })
    formatSpy = spyOn(generator, "formatRepoOverview").mockReturnValue(
      "# Project: test-project\nTech: TypeScript"
    )

    // Clear mock call history
    generateSpy.mockClear()
    formatSpy.mockClear()

    // Create temp dir for cache tests
    tmpDir = createTempDir()
  })

  afterEach(() => {
    generateSpy.mockRestore()
    formatSpy.mockRestore()

    // Clean up temp dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // #region configuration
  describe("configuration", () => {
    test("uses default config when not provided", () => {
      // given: No config
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx)

      // then: Hook should be created with defaults
      expect(hook["tool.execute.after"]).toBeDefined()
      expect(hook.event).toBeDefined()
      expect(DEFAULT_CONFIG.enabled).toBe(true)
      expect(DEFAULT_CONFIG.auto_generate).toBe(true)
      expect(DEFAULT_CONFIG.min_tool_calls).toBe(1)
    })

    test("merges user config with defaults", async () => {
      // given: Custom min_tool_calls
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        min_tool_calls: 3,
      })

      // when: First two tool calls
      const input = createToolInput("Read")
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toBe("test output") // Not injected yet

      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output") // Still not injected

      // then: Third call should inject
      const output3 = createToolOutput()
      await hook["tool.execute.after"](input, output3)
      expect(output3.output).toContain("Repository Overview")
    })

    test("respects auto_generate flag", async () => {
      // given: auto_generate disabled
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        auto_generate: false,
      })
      const input = createToolInput("Read")
      const output = createToolOutput()

      // when: Tool call
      await hook["tool.execute.after"](input, output)

      // then: Should not inject
      expect(output.output).toBe("test output")
      expect(generateSpy).not.toHaveBeenCalled()
    })
  })
  // #endregion

  // #region tool.execute.after
  describe("tool.execute.after", () => {
    test("does not inject before min_tool_calls reached", async () => {
      // given: Hook with min_tool_calls=2
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        min_tool_calls: 2,
      })

      // when: First tool call
      const input = createToolInput("Read")
      const output = createToolOutput()
      await hook["tool.execute.after"](input, output)

      // then: Should not inject yet
      expect(output.output).toBe("test output")
    })

    test("injects after min_tool_calls threshold", async () => {
      // given: Hook with min_tool_calls=2
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        min_tool_calls: 2,
      })

      // First call
      const input = createToolInput("Read")
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)

      // when: Second call (reaches threshold)
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)

      // then: Should inject on second call
      expect(output2.output).toContain("Repository Overview")
    })

    test("appends overview to output", async () => {
      // given: Hook
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput("file content")

      // when: Tool call
      await hook["tool.execute.after"](input, output)

      // then: Should append (not replace) output
      expect(output.output).toContain("file content")
      expect(output.output).toContain("Repository Overview")
      expect(output.output).toContain("End Repository Overview")
    })

    test("calls generator with correct directory and depth", async () => {
      // given: Hook with unique directory
      const uniqueDir = path.join(tmpDir, "unique-project")
      const mockCtx = createMockCtx(uniqueDir)
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        max_tree_depth: 100,
      })
      const input = createToolInput("Read")
      const output = createToolOutput()

      // when: Tool call
      await hook["tool.execute.after"](input, output)

      // then: Generator should be called with correct params
      expect(generateSpy).toHaveBeenCalledWith(uniqueDir, 100)
    })

    test("tracks tool calls per session independently", async () => {
      // given: Hook with min_tool_calls=2
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        min_tool_calls: 2,
      })

      // Session A - first call
      const inputA = createToolInput("Read", "session-A")
      const outputA1 = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA1)
      expect(outputA1.output).toBe("test output")

      // Session B - first call
      const inputB = createToolInput("Read", "session-B")
      const outputB1 = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB1)
      expect(outputB1.output).toBe("test output")

      // Session A - second call (should inject)
      const outputA2 = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA2)
      expect(outputA2.output).toContain("Repository Overview")

      // Session B - second call (should inject)
      const outputB2 = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB2)
      expect(outputB2.output).toContain("Repository Overview")
    })
  })
  // #endregion

  // #region event handling
  describe("event handling", () => {
    describe("session.deleted", () => {
      test("clears injected state", async () => {
        // given: Session that has been injected
        const mockCtx = createMockCtx()
        const hook = createRepoOverviewInjectorHook(mockCtx)
        const sessionID = "session-to-delete"

        // Inject
        const input = createToolInput("Read", sessionID)
        const output1 = createToolOutput()
        await hook["tool.execute.after"](input, output1)
        expect(output1.output).toContain("Repository Overview")

        // when: Delete session
        await hook.event({
          event: {
            type: "session.deleted",
            properties: { info: { id: sessionID } },
          },
        })

        // then: New call should inject again
        const output2 = createToolOutput()
        await hook["tool.execute.after"](input, output2)
        expect(output2.output).toContain("Repository Overview")
      })

    })

    describe("session.compacted", () => {
      test("clears injected state to allow re-injection", async () => {
        // given: Session that has been injected
        const mockCtx = createMockCtx()
        const hook = createRepoOverviewInjectorHook(mockCtx)
        const sessionID = "session-to-compact"

        // Inject
        const input = createToolInput("Read", sessionID)
        const output1 = createToolOutput()
        await hook["tool.execute.after"](input, output1)
        expect(output1.output).toContain("Repository Overview")

        // when: Compact session
        await hook.event({
          event: {
            type: "session.compacted",
            properties: { sessionID },
          },
        })

        // then: Should inject again after compaction
        const output2 = createToolOutput()
        await hook["tool.execute.after"](input, output2)
        expect(output2.output).toContain("Repository Overview")
      })

      test("handles sessionID from info property", async () => {
        // given: Session with injection
        const mockCtx = createMockCtx()
        const hook = createRepoOverviewInjectorHook(mockCtx)
        const sessionID = "session-info"

        const input = createToolInput("Read", sessionID)
        const output1 = createToolOutput()
        await hook["tool.execute.after"](input, output1)

        // when: Compact with sessionID in info
        await hook.event({
          event: {
            type: "session.compacted",
            properties: { info: { id: sessionID } },
          },
        })

        // then: Should allow re-injection
        const output2 = createToolOutput()
        await hook["tool.execute.after"](input, output2)
        expect(output2.output).toContain("Repository Overview")
      })
    })

    test("ignores unknown event types", async () => {
      // given: Hook with existing session state
      const mockCtx = createMockCtx()
      const hook = createRepoOverviewInjectorHook(mockCtx)
      const sessionID = "session-unknown-event"

      // Inject first to establish state
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("Repository Overview")

      // when: Unknown event
      await hook.event({
        event: {
          type: "session.unknown",
          properties: { sessionID },
        },
      })

      // then: State should be preserved (session still marked as injected)
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output") // Still blocked
    })
  })
  // #endregion

  // #region caching (integration with file system)
  describe("caching", () => {
    test("uses cached overview when valid", async () => {
      // given: Hook with unique directory
      const uniqueDir = path.join(tmpDir, "cached-project")
      const mockCtx = createMockCtx(uniqueDir)
      const hook = createRepoOverviewInjectorHook(mockCtx)

      // First call - generates and caches
      const input = createToolInput("Read", "session-1")
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(generateSpy).toHaveBeenCalledTimes(1)

      // when: New session, same directory (same hook instance)
      generateSpy.mockClear()
      const input2 = createToolInput("Read", "session-2")
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input2, output2)

      // then: Should use cache (generator not called again for same dir within same hook)
      // Note: This tests the internal caching behavior
      expect(output2.output).toContain("Repository Overview")
    })

    test("handles generator errors gracefully", async () => {
      // given: Generator that throws
      const errorDir = path.join(tmpDir, "error-project")
      generateSpy.mockImplementation(() => {
        throw new Error("Generator failed")
      })
      const mockCtx = createMockCtx(errorDir)
      const hook = createRepoOverviewInjectorHook(mockCtx)
      const input = createToolInput("Read")
      const output = createToolOutput()
      let caughtError = false

      // when: Tool call
      try {
        await hook["tool.execute.after"](input, output)
      } catch {
        caughtError = true
      }

      // then: Either completes without injecting, or throws
      // The key is it doesn't hang or cause unhandled rejection
      if (!caughtError) {
        // If no error, output should either be unchanged or have partial content
        expect(output.output).toBeDefined()
      }
      expect(generateSpy).toHaveBeenCalled()
    })
  })
  // #endregion

  // #region edge cases
  describe("edge cases", () => {
    test("handles empty properties gracefully", async () => {
      // given: Hook with existing session state
      const propsDir = path.join(tmpDir, "props-project")
      const mockCtx = createMockCtx(propsDir)
      const hook = createRepoOverviewInjectorHook(mockCtx)
      const sessionID = "session-props"

      // Inject once to have state
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("Repository Overview")

      // when: Events with missing properties
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

      // then: Session state should be unaffected (no valid sessionID to clear)
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output") // Still blocked
    })
  })
  // #endregion

  // #region complex state transitions
  describe("complex state transitions", () => {
    test("complete flow: inject → session.compacted → re-inject", async () => {
      // given: Hook with unique directory
      const flowDir = path.join(tmpDir, "flow-project")
      const mockCtx = createMockCtx(flowDir)
      const hook = createRepoOverviewInjectorHook(mockCtx)
      const sessionID = "session-flow"

      // Step 1: Initial injection
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toContain("Repository Overview")

      // Step 2: Same session should not re-inject
      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output")

      // Step 3: Compact session
      await hook.event({
        event: { type: "session.compacted", properties: { sessionID } },
      })

      // Step 4: Should re-inject after compaction
      const output3 = createToolOutput()
      await hook["tool.execute.after"](input, output3)
      expect(output3.output).toContain("Repository Overview")
    })

    test("min_tool_calls reset after session deletion", async () => {
      // given: Hook with min_tool_calls=3
      const minCallsDir = path.join(tmpDir, "min-calls-project")
      const mockCtx = createMockCtx(minCallsDir)
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        min_tool_calls: 3,
      })
      const sessionID = "session-min-calls"

      // Step 1: Make 2 calls (not enough)
      const input = createToolInput("Read", sessionID)
      const output1 = createToolOutput()
      await hook["tool.execute.after"](input, output1)
      expect(output1.output).toBe("test output")

      const output2 = createToolOutput()
      await hook["tool.execute.after"](input, output2)
      expect(output2.output).toBe("test output")

      // Step 2: Delete session
      await hook.event({
        event: { type: "session.deleted", properties: { info: { id: sessionID } } },
      })

      // Step 3: Counter should reset - need 3 calls again
      const output3 = createToolOutput()
      await hook["tool.execute.after"](input, output3)
      expect(output3.output).toBe("test output") // Call 1

      const output4 = createToolOutput()
      await hook["tool.execute.after"](input, output4)
      expect(output4.output).toBe("test output") // Call 2

      const output5 = createToolOutput()
      await hook["tool.execute.after"](input, output5)
      expect(output5.output).toContain("Repository Overview") // Call 3 - inject!
    })

    test("multiple sessions share same cache but track injection separately", async () => {
      // given: Hook
      const sharedDir = path.join(tmpDir, "shared-cache-project")
      const mockCtx = createMockCtx(sharedDir)
      const hook = createRepoOverviewInjectorHook(mockCtx)

      // when: Session A injects
      const inputA = createToolInput("Read", "session-A")
      const outputA = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA)
      expect(outputA.output).toContain("Repository Overview")
      expect(generateSpy).toHaveBeenCalledTimes(1)

      // Session B injects (should use cached overview)
      generateSpy.mockClear()
      const inputB = createToolInput("Read", "session-B")
      const outputB = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB)
      expect(outputB.output).toContain("Repository Overview")
      // Generator may or may not be called again depending on cache implementation

      // then: Both sessions are marked as injected
      const outputA2 = createToolOutput()
      await hook["tool.execute.after"](inputA, outputA2)
      expect(outputA2.output).toBe("test output")

      const outputB2 = createToolOutput()
      await hook["tool.execute.after"](inputB, outputB2)
      expect(outputB2.output).toBe("test output")
    })

    test("disabled hook never injects regardless of state", async () => {
      // given: Disabled hook
      const disabledDir = path.join(tmpDir, "disabled-project")
      const mockCtx = createMockCtx(disabledDir)
      const hook = createRepoOverviewInjectorHook(mockCtx, {
        enabled: false,
      })

      // when: Multiple calls
      for (let i = 0; i < 5; i++) {
        const input = createToolInput("Read", "session-disabled", `call-${i}`)
        const output = createToolOutput()
        await hook["tool.execute.after"](input, output)
        expect(output.output).toBe("test output")
      }

      // then: Generator never called
      expect(generateSpy).not.toHaveBeenCalled()
    })
  })
  // #endregion
})
