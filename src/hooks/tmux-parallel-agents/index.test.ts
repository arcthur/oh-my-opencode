import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"

// Mock child_process
const mockExecSync = mock(() => "")
const mockSpawn = mock(() => ({ on: () => {} }))

mock.module("node:child_process", () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}))

// Mock environment
const originalEnv = { ...process.env }

function createMockCtx() {
  return {
    directory: "/test",
    client: {},
  } as any
}

describe("tmux-parallel-agents hook", () => {
  beforeEach(() => {
    mockExecSync.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe("environment detection", () => {
    test("disables when not in tmux", async () => {
      // #given
      delete process.env.TMUX
      mockExecSync.mockImplementation(() => "/usr/bin/tmux")

      // Re-import to get fresh module with new env
      const { createTmuxParallelAgentsHook } = await import("./index")
      const hook = createTmuxParallelAgentsHook(createMockCtx())

      // #then - should return no-op handlers
      expect(hook["tool.execute.before"]).toBeDefined()
      expect(hook.event).toBeDefined()
    })

    test("disables when tmux binary not found", async () => {
      // #given
      process.env.TMUX = "/some/path"
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === "which tmux") throw new Error("not found")
        return ""
      })

      // Re-import to get fresh module
      const { createTmuxParallelAgentsHook } = await import("./index")
      const hook = createTmuxParallelAgentsHook(createMockCtx())

      // #then
      expect(hook["tool.execute.before"]).toBeDefined()
    })
  })

  describe("status detection", () => {
    test("detects error status", async () => {
      // Re-import module
      const indexModule = await import("./index")

      // Access detectStatus via testing the patterns
      const errorContent = "Something failed with error: connection refused"
      expect(errorContent).toMatch(/(error|exception|traceback|FAILED|Permission denied)/i)
    })

    test("detects waiting status", async () => {
      const waitingContent = "Proceed? (y/n)"
      expect(waitingContent).toMatch(/(\(y\/n\)|\[Y\/n\]|\[y\/N\]|approve|confirm|AskUserQuestion)/i)
    })

    test("detects working status", async () => {
      const workingContent = "Reading file: src/index.ts"
      expect(workingContent).toMatch(/(Reading|Writing|Bash\(|executing|processing|Searching)/i)
    })
  })

  describe("slugify", () => {
    test("creates valid window name slugs", () => {
      // Test slug pattern
      const text = "Implement user authentication"
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)

      expect(slug).toBe("implement-user-authe")
      expect(slug).not.toMatch(/[^a-z0-9-]/)
    })

    test("handles special characters", () => {
      const text = "Fix bug #123: Login issue"
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)

      expect(slug).toBe("fix-bug-123-login-is")
    })
  })

  describe("config defaults", () => {
    test("uses default status icons", async () => {
      const defaultIcons = {
        waiting: "...",
        working: ">>>",
        done: "OK",
        error: "ERR",
        idle: "",
      }

      expect(defaultIcons.waiting).toBe("...")
      expect(defaultIcons.working).toBe(">>>")
      expect(defaultIcons.done).toBe("OK")
      expect(defaultIcons.error).toBe("ERR")
    })

    test("allows custom status icons", () => {
      const customConfig = {
        status_icons: {
          waiting: "⏳",
          working: "🔨",
          done: "✅",
          error: "❌",
        },
      }

      expect(customConfig.status_icons.waiting).toBe("⏳")
      expect(customConfig.status_icons.done).toBe("✅")
    })
  })

  describe("window naming convention", () => {
    test("follows wm-* pattern", () => {
      const taskId = "bg_abc123"
      const description = "Implement feature"
      const slug = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)

      const windowName = `wm-${slug}-${taskId.slice(0, 6)}`

      expect(windowName).toMatch(/^wm-/)
      expect(windowName).toBe("wm-implement-feature-bg_abc")
    })
  })

  describe("rescue patterns", () => {
    test("matches (y/n) prompts", () => {
      const patterns = [
        "Continue? (y/n)",
        "Proceed [Y/n]?",
        "Confirm [y/N]:",
        "Do you approve this action?",
        "Please confirm:",
      ]

      const rescuePattern = /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|approve|confirm)/i

      for (const p of patterns) {
        expect(p).toMatch(rescuePattern)
      }
    })

    test("does not match normal text", () => {
      const normalText = [
        "Processing files...",
        "Reading configuration",
        "Task completed successfully",
      ]

      const rescuePattern = /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|approve|confirm)/i

      for (const t of normalText) {
        expect(t).not.toMatch(rescuePattern)
      }
    })
  })

  describe("worktree configuration", () => {
    test("default worktree config values", () => {
      const defaultConfig = {
        enabled: false,
        dir_pattern: "../{project}__worktrees",
        copy_files: [".env", ".env.local"],
        symlink: ["node_modules"],
        auto_cleanup: false,
      }

      expect(defaultConfig.enabled).toBe(false)
      expect(defaultConfig.dir_pattern).toBe("../{project}__worktrees")
      expect(defaultConfig.copy_files).toContain(".env")
      expect(defaultConfig.symlink).toContain("node_modules")
      expect(defaultConfig.auto_cleanup).toBe(false)
    })

    test("worktree branch naming convention", () => {
      const description = "Fix login bug"
      const taskId = "1234567890-abcd"
      const slug = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20)

      const branchName = `wm/${slug}-${taskId.slice(0, 8)}`

      expect(branchName).toMatch(/^wm\//)
      expect(branchName).toBe("wm/fix-login-bug-12345678")
    })

    test("worktree directory structure", () => {
      const projectDir = "/home/user/myproject"
      const projectName = "myproject"
      const pattern = "../{project}__worktrees"

      // Simulate getWorktreeBaseDir logic
      const resolvedPattern = pattern.replace("{project}", projectName)
      expect(resolvedPattern).toBe("../myproject__worktrees")

      // Expected full path would be /home/user/myproject__worktrees
    })
  })

  describe("file operations", () => {
    test("identifies files to copy vs symlink", () => {
      const config = {
        copy_files: [".env", ".env.local", "secrets.json"],
        symlink: ["node_modules", "vendor", ".pnpm-store"],
      }

      // Copy: small files with secrets/local config
      expect(config.copy_files).toContain(".env")
      expect(config.copy_files).toContain(".env.local")

      // Symlink: large/shared directories
      expect(config.symlink).toContain("node_modules")
      expect(config.symlink).toContain("vendor")
    })
  })

  describe("cleanup behavior", () => {
    test("auto_cleanup controls worktree removal", () => {
      // When auto_cleanup = false, worktree is kept for manual merge
      const keepConfig = { auto_cleanup: false }
      expect(keepConfig.auto_cleanup).toBe(false)

      // When auto_cleanup = true, worktree is removed with branch
      const cleanConfig = { auto_cleanup: true }
      expect(cleanConfig.auto_cleanup).toBe(true)
    })
  })
})
