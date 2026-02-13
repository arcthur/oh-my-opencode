import { afterEach, describe, expect, test, mock } from "bun:test"
import { createCartographyTool } from "./tools"

const runCartographyMock = mock(async () => ({
  mode: "update",
  analyzedDirs: ["src"],
  createdCodemaps: ["src"],
  updatedCodemaps: [],
  skippedDirs: [],
  errors: [],
  durationMs: 123,
}))

afterEach(() => {
  runCartographyMock.mockClear()
})

describe("cartography tool", () => {
  test("runs update mode by default", async () => {
    // #given
    const tool = createCartographyTool({
      directory: "/repo",
      cartographyConfig: {
        enabled: true,
        max_depth: 4,
        min_files: 3,
        max_parallel_explorers: 5,
        include_patterns: ["**/*.ts"],
        exclude_patterns: ["**/node_modules/**"],
      },
      runCartographyFn: runCartographyMock as never,
    })

    // #when
    const result = await tool.execute({}, {} as never)

    // #then
    expect(runCartographyMock).toHaveBeenCalledTimes(1)
    expect(result).toContain("Mode: update")
    expect(result).toContain("created: 1")
  })

  test("runs changes mode and returns report summary", async () => {
    // #given
    runCartographyMock.mockResolvedValueOnce({
      changedDirs: ["src/a"],
      newDirs: ["src/b"],
      deletedDirs: ["src/c"],
      staleCodemaps: [],
      stats: {
        totalDirs: 3,
        changedCount: 1,
        newCount: 1,
        deletedCount: 1,
        upToDateCount: 0,
      },
    })

    const tool = createCartographyTool({
      directory: "/repo",
      cartographyConfig: {
        enabled: true,
        max_depth: 4,
        min_files: 3,
        max_parallel_explorers: 5,
        include_patterns: ["**/*.ts"],
        exclude_patterns: ["**/node_modules/**"],
      },
      runCartographyFn: runCartographyMock as never,
    })

    // #when
    const result = await tool.execute({ mode: "changes" }, {} as never)

    // #then
    expect(result).toContain("Mode: changes")
    expect(result).toContain("changed: 1")
    expect(result).toContain("deleted: 1")
  })
})
