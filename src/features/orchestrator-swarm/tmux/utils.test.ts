import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import * as childProcess from "node:child_process"
import {
  isInsideTmux,
  hasTmuxBinary,
  isGitRepo,
  getCurrentSession,
  getCurrentWindow,
  slugify,
  STATUS_PATTERNS,
  detectStatus,
} from "./utils"

describe("tmux utils", () => {
  describe("isInsideTmux", () => {
    const originalTmux = process.env.TMUX

    afterEach(() => {
      if (originalTmux === undefined) {
        delete process.env.TMUX
      } else {
        process.env.TMUX = originalTmux
      }
    })

    it("returns true when TMUX env is set", () => {
      process.env.TMUX = "/tmp/tmux-1000/default,12345,0"
      expect(isInsideTmux()).toBe(true)
    })

    it("returns false when TMUX env is not set", () => {
      delete process.env.TMUX
      expect(isInsideTmux()).toBe(false)
    })

    it("returns false when TMUX is empty string", () => {
      process.env.TMUX = ""
      expect(isInsideTmux()).toBe(false)
    })
  })

  describe("slugify", () => {
    it("converts to lowercase", () => {
      expect(slugify("Hello World")).toBe("hello-world")
    })

    it("replaces non-alphanumeric with dashes", () => {
      expect(slugify("foo_bar.baz")).toBe("foo-bar-baz")
    })

    it("removes leading/trailing dashes", () => {
      expect(slugify("--hello--world--")).toBe("hello-world")
    })

    it("truncates to 20 characters", () => {
      const long = "this-is-a-very-long-string-that-should-be-truncated"
      expect(slugify(long).length).toBeLessThanOrEqual(20)
    })

    it("handles special characters", () => {
      expect(slugify("worker@#$%1")).toBe("worker-1")
    })

    it("handles coordinator-alpha style names", () => {
      expect(slugify("coordinator-alpha")).toBe("coordinator-alpha")
    })

    it("handles worker-1 style names", () => {
      expect(slugify("worker-1")).toBe("worker-1")
    })
  })

  describe("STATUS_PATTERNS", () => {
    it("detects error patterns", () => {
      expect(STATUS_PATTERNS.error.test("Error: something went wrong")).toBe(true)
      expect(STATUS_PATTERNS.error.test("Traceback (most recent call last)")).toBe(true)
      expect(STATUS_PATTERNS.error.test("FAILED: test case")).toBe(true)
      expect(STATUS_PATTERNS.error.test("Permission denied")).toBe(true)
    })

    it("detects paused patterns", () => {
      expect(STATUS_PATTERNS.paused.test("Continue? (y/n)")).toBe(true)
      expect(STATUS_PATTERNS.paused.test("Proceed? [Y/n]")).toBe(true)
      expect(STATUS_PATTERNS.paused.test("confirm this action")).toBe(true)
      expect(STATUS_PATTERNS.paused.test("AskUserQuestion")).toBe(true)
    })

    it("detects working patterns", () => {
      expect(STATUS_PATTERNS.working.test("Reading file...")).toBe(true)
      expect(STATUS_PATTERNS.working.test("Writing to disk")).toBe(true)
      expect(STATUS_PATTERNS.working.test("Bash(ls -la)")).toBe(true)
      expect(STATUS_PATTERNS.working.test("executing command")).toBe(true)
      expect(STATUS_PATTERNS.working.test("Searching for files")).toBe(true)
    })
  })

  describe("detectStatus", () => {
    it("detects error status", () => {
      expect(detectStatus("Error: file not found\n$ ")).toBe("error")
    })

    it("detects paused status", () => {
      expect(detectStatus("Do you want to continue? (y/n)")).toBe("paused")
    })

    it("detects working status", () => {
      expect(detectStatus("Reading src/index.ts...\n")).toBe("working")
    })

    it("detects done status from shell prompt", () => {
      expect(detectStatus("user@host:~/project$")).toBe("done")
      expect(detectStatus("~/project$ ")).toBe("done")
      expect(detectStatus("user@host> ")).toBe("done")
    })

    it("returns idle for unknown content", () => {
      expect(detectStatus("some random text")).toBe("idle")
    })

    it("prioritizes error over other statuses", () => {
      // Error should be detected even if prompt is present
      expect(detectStatus("Error: something failed\nuser@host$")).toBe("error")
    })

    it("handles empty content", () => {
      expect(detectStatus("")).toBe("idle")
    })

    it("handles whitespace-only content", () => {
      expect(detectStatus("   \n\n   ")).toBe("idle")
    })
  })
})
