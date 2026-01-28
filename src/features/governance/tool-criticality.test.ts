import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  ToolCriticalityRegistry,
  getToolCriticalityRegistry,
  resetToolCriticalityRegistry,
} from "./tool-criticality"

describe("ToolCriticalityRegistry", () => {
  let registry: ToolCriticalityRegistry

  beforeEach(() => {
    registry = new ToolCriticalityRegistry()
  })

  describe("default criticality definitions", () => {
    it("includes Bash with dynamic criticality", () => {
      expect(registry.has("Bash")).toBe(true)
      expect(registry.getCategory("Bash")).toBe("irreversible")
    })

    it("includes Write with dynamic criticality", () => {
      expect(registry.has("Write")).toBe(true)
      expect(registry.getCategory("Write")).toBe("destructive")
    })

    it("includes Edit", () => {
      expect(registry.has("Edit")).toBe(true)
    })

    it("includes Task", () => {
      expect(registry.has("Task")).toBe(true)
      expect(registry.getCategory("Task")).toBe("external")
    })

    it("includes delegate_task", () => {
      expect(registry.has("delegate_task")).toBe(true)
      expect(registry.getCategory("delegate_task")).toBe("external")
    })
  })

  describe("isCritical", () => {
    describe("Bash commands", () => {
      it("returns true for rm -rf", () => {
        expect(registry.isCritical("Bash", { command: "rm -rf /tmp/test" })).toBe(true)
      })

      it("returns true for rm -r (without f)", () => {
        expect(registry.isCritical("Bash", { command: "rm -r /tmp/test" })).toBe(true)
      })

      it("returns true for rm -R (capital)", () => {
        expect(registry.isCritical("Bash", { command: "rm -R /tmp/test" })).toBe(true)
      })

      it("returns true for rm --recursive", () => {
        expect(registry.isCritical("Bash", { command: "rm --recursive /tmp/test" })).toBe(true)
      })

      it("returns true for sudo commands", () => {
        expect(registry.isCritical("Bash", { command: "sudo apt install foo" })).toBe(true)
      })

      it("returns true for git push --force", () => {
        expect(registry.isCritical("Bash", { command: "git push --force origin main" })).toBe(true)
      })

      it("returns true for git reset --hard", () => {
        expect(registry.isCritical("Bash", { command: "git reset --hard HEAD~5" })).toBe(true)
      })

      it("returns true for chmod 777", () => {
        expect(registry.isCritical("Bash", { command: "chmod 777 /tmp/file" })).toBe(true)
      })

      it("returns true for docker rm", () => {
        expect(registry.isCritical("Bash", { command: "docker rm container-name" })).toBe(true)
      })

      it("returns true for kubectl delete", () => {
        expect(registry.isCritical("Bash", { command: "kubectl delete pod my-pod" })).toBe(true)
      })

      it("returns false for safe commands", () => {
        expect(registry.isCritical("Bash", { command: "ls -la" })).toBe(false)
        expect(registry.isCritical("Bash", { command: "cat file.txt" })).toBe(false)
        expect(registry.isCritical("Bash", { command: "git status" })).toBe(false)
        expect(registry.isCritical("Bash", { command: "npm install" })).toBe(false)
      })
    })

    describe("Write tool", () => {
      it("returns true for system paths", () => {
        expect(registry.isCritical("Write", { file_path: "/etc/hosts" })).toBe(true)
        expect(registry.isCritical("Write", { file_path: "/usr/local/bin/script" })).toBe(true)
      })

      it("returns true for hidden files at root", () => {
        expect(registry.isCritical("Write", { file_path: "/.bashrc" })).toBe(true)
      })

      it("returns false for project files (non-existent)", () => {
        expect(
          registry.isCritical("Write", { file_path: "/tmp/non-existent-file-12345.txt" })
        ).toBe(false)
      })
    })

    describe("Edit tool", () => {
      it("returns true for system paths", () => {
        expect(registry.isCritical("Edit", { file_path: "/etc/passwd" })).toBe(true)
      })

      it("returns false for regular project files", () => {
        expect(registry.isCritical("Edit", { file_path: "/home/user/project/src/index.ts" })).toBe(false)
      })
    })

    describe("Task/delegate_task", () => {
      it("returns true for prompts with destructive keywords", () => {
        expect(registry.isCritical("Task", { prompt: "Delete all test files" })).toBe(true)
        expect(registry.isCritical("Task", { prompt: "Remove the database" })).toBe(true)
        expect(registry.isCritical("Task", { prompt: "Force push to main" })).toBe(true)
        expect(registry.isCritical("delegate_task", { prompt: "Destroy the old config" })).toBe(true)
      })

      it("returns false for safe prompts", () => {
        expect(registry.isCritical("Task", { prompt: "Create a new component" })).toBe(false)
        expect(registry.isCritical("Task", { prompt: "Search for files" })).toBe(false)
        expect(registry.isCritical("delegate_task", { prompt: "Run the tests" })).toBe(false)
      })
    })

    describe("unregistered tools", () => {
      it("returns false for unknown tools", () => {
        expect(registry.isCritical("UnknownTool", { any: "args" })).toBe(false)
      })
    })
  })

  describe("getPreview", () => {
    it("returns preview for Bash", () => {
      const preview = registry.getPreview("Bash", { command: "rm -rf /tmp/test" })

      expect(preview).toBeDefined()
      expect(preview?.title).toBe("Shell Command Execution")
      expect(preview?.affectedItems).toBeDefined()
    })

    it("returns preview for Write", () => {
      const preview = registry.getPreview("Write", {
        file_path: "/tmp/test.txt",
        content: "Hello World",
      })

      expect(preview).toBeDefined()
      expect(preview?.title).toMatch(/File/)
      expect(preview?.affectedItems).toHaveLength(1)
      expect(preview?.affectedItems[0].type).toBe("file")
    })

    it("returns preview for Task", () => {
      const preview = registry.getPreview("Task", {
        subagent_type: "explore",
        prompt: "Search for files",
      })

      expect(preview).toBeDefined()
      expect(preview?.title).toBe("Delegate Task")
      expect(preview?.affectedItems[0].identifier).toBe("explore")
    })

    it("returns undefined for unknown tools", () => {
      expect(registry.getPreview("UnknownTool", {})).toBeUndefined()
    })
  })

  describe("register and unregister", () => {
    it("registers new tool criticality", () => {
      registry.register("CustomTool", {
        critical: true,
        reason: "Custom reason",
        category: "expensive",
      })

      expect(registry.has("CustomTool")).toBe(true)
      expect(registry.isCritical("CustomTool", {})).toBe(true)
      expect(registry.getReason("CustomTool")).toBe("Custom reason")
      expect(registry.getCategory("CustomTool")).toBe("expensive")
    })

    it("unregisters tool", () => {
      registry.register("TempTool", {
        critical: true,
        reason: "Temp",
        category: "external",
      })

      expect(registry.has("TempTool")).toBe(true)
      expect(registry.unregister("TempTool")).toBe(true)
      expect(registry.has("TempTool")).toBe(false)
    })

    it("returns false when unregistering non-existent tool", () => {
      expect(registry.unregister("NonExistent")).toBe(false)
    })
  })

  describe("registerBulk", () => {
    it("registers multiple tools at once", () => {
      registry.registerBulk({
        Tool1: { critical: true, reason: "Reason 1", category: "destructive" },
        Tool2: { critical: false, reason: "Reason 2", category: "external" },
      })

      expect(registry.has("Tool1")).toBe(true)
      expect(registry.has("Tool2")).toBe(true)
      expect(registry.isCritical("Tool1", {})).toBe(true)
      expect(registry.isCritical("Tool2", {})).toBe(false)
    })
  })

  describe("listTools", () => {
    it("returns all registered tool names", () => {
      const tools = registry.listTools()

      expect(tools).toContain("Bash")
      expect(tools).toContain("Write")
      expect(tools).toContain("Edit")
      expect(tools).toContain("Task")
      expect(tools).toContain("delegate_task")
    })
  })

  describe("reset", () => {
    it("resets to default definitions", () => {
      registry.register("CustomTool", {
        critical: true,
        reason: "Custom",
        category: "external",
      })
      registry.unregister("Bash")

      expect(registry.has("CustomTool")).toBe(true)
      expect(registry.has("Bash")).toBe(false)

      registry.reset()

      expect(registry.has("CustomTool")).toBe(false)
      expect(registry.has("Bash")).toBe(true)
    })
  })
})

describe("getToolCriticalityRegistry", () => {
  afterEach(() => {
    resetToolCriticalityRegistry()
  })

  it("returns singleton instance", () => {
    const instance1 = getToolCriticalityRegistry()
    const instance2 = getToolCriticalityRegistry()

    expect(instance1).toBe(instance2)
  })

  it("creates new instance after reset", () => {
    const instance1 = getToolCriticalityRegistry()
    resetToolCriticalityRegistry()
    const instance2 = getToolCriticalityRegistry()

    expect(instance1).not.toBe(instance2)
  })
})
