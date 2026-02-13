/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { getGitDiffStats } from "./git-diff-stats"

let isGitRepo = true

const execFileSyncMock = mock((file: string, args: string[], _opts: { cwd?: string }) => {
  if (file !== "git") throw new Error(`unexpected file: ${file}`)
  const subcommand = args[0]

  if (subcommand === "rev-parse") {
    if (!isGitRepo) {
      throw new Error("not a git repository")
    }
    return "true\n"
  }

  if (subcommand === "diff") {
    return "1\t2\tfile.ts\n"
  }

  if (subcommand === "status") {
    return " M file.ts\n?? new-file.ts\n"
  }

  if (subcommand === "ls-files") {
    return "new-file.ts\n"
  }

  throw new Error(`unexpected args: ${args.join(" ")}`)
})

const readFileSyncMock = mock((_path: string, _encoding: string) => {
  return "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n"
})

describe("getGitDiffStats", () => {
  test("returns empty stats when directory is not a git worktree", () => {
    // #given
    isGitRepo = false
    execFileSyncMock.mockClear()

    // #when
    const result = getGitDiffStats("/tmp/not-git", {
      execFileSyncFn: execFileSyncMock as unknown as typeof import("node:child_process").execFileSync,
      readFileSyncFn: readFileSyncMock as unknown as typeof import("node:fs").readFileSync,
    })

    // #then
    expect(result).toEqual([])
    expect(execFileSyncMock).toHaveBeenCalledTimes(1)
    isGitRepo = true
  })

  test("collects tracked and untracked stats with safe arg-array execution", () => {
    // #given
    isGitRepo = true
    execFileSyncMock.mockClear()
    readFileSyncMock.mockClear()
    const directory = "/tmp/repo;touch /tmp/pwn"

    // #when
    const result = getGitDiffStats(directory, {
      execFileSyncFn: execFileSyncMock as unknown as typeof import("node:child_process").execFileSync,
      readFileSyncFn: readFileSyncMock as unknown as typeof import("node:fs").readFileSync,
    })

    // #then
    expect(execFileSyncMock).toHaveBeenCalledTimes(4)

    const [call1File, call1Args, call1Opts] = execFileSyncMock.mock.calls[0]! as unknown as [string, string[], { cwd?: string }]
    expect(call1File).toBe("git")
    expect(call1Args).toEqual(["rev-parse", "--is-inside-work-tree"])
    expect(call1Opts.cwd).toBe(directory)

    const [call2File, call2Args, call2Opts] = execFileSyncMock.mock.calls[1]! as unknown as [string, string[], { cwd?: string }]
    expect(call2File).toBe("git")
    expect(call2Args).toEqual(["diff", "--numstat", "HEAD"])
    expect(call2Opts.cwd).toBe(directory)

    const [call3File, call3Args, call3Opts] = execFileSyncMock.mock.calls[2]! as unknown as [string, string[], { cwd?: string }]
    expect(call3File).toBe("git")
    expect(call3Args).toEqual(["status", "--porcelain"])
    expect(call3Opts.cwd).toBe(directory)

    const [call4File, call4Args, call4Opts] = execFileSyncMock.mock.calls[3]! as unknown as [string, string[], { cwd?: string }]
    expect(call4File).toBe("git")
    expect(call4Args).toEqual(["ls-files", "--others", "--exclude-standard"])
    expect(call4Opts.cwd).toBe(directory)

    expect(readFileSyncMock).toHaveBeenCalled()
    expect(result).toEqual([
      { path: "file.ts", added: 1, removed: 2, status: "modified" },
      { path: "new-file.ts", added: 10, removed: 0, status: "added" },
    ])
  })
})
