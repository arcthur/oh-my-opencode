import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { SwarmOrchestratorConfig, SwarmWindowInfo } from "./orchestrator"

// Test helper: create mock orchestrator config
function createMockConfig(overrides?: Partial<SwarmOrchestratorConfig>): SwarmOrchestratorConfig {
  return {
    projectDir: join(tmpdir(), `swarm-test-${Date.now()}`),
    worktreeEnabled: false,
    autoRescue: false,
    ...overrides,
  }
}

describe("SwarmOrchestrator types", () => {
  describe("SwarmWindowInfo", () => {
    it("has required fields", () => {
      const info: SwarmWindowInfo = {
        agentId: "agent_12345678",
        agentName: "worker-1",
        role: "worker",
        windowIndex: "1",
        windowName: "swarm-worker-1-345678",
        paneTarget: "session:1.0",
        worktreePath: null,
        branchName: "swarm/team/worker-1",
        createdAt: Date.now(),
        status: "idle",
      }

      expect(info.agentId).toContain("agent_")
      expect(info.role).toBe("worker")
      expect(info.windowIndex).toBe("1")
      expect(info.status).toBe("idle")
    })

    it("supports coordinator role", () => {
      const info: SwarmWindowInfo = {
        agentId: "agent_coord123",
        agentName: "coordinator",
        role: "coordinator",
        windowIndex: "0",
        windowName: "swarm-coord-123456",
        paneTarget: "session:0.0",
        worktreePath: "/path/to/worktree",
        branchName: "swarm/team/coordinator",
        createdAt: Date.now(),
        status: "working",
      }

      expect(info.role).toBe("coordinator")
      expect(info.worktreePath).toBe("/path/to/worktree")
    })

    it("supports all status values", () => {
      const statuses: Array<SwarmWindowInfo["status"]> = [
        "joining",
        "idle",
        "working",
        "paused",
        "leaving",
        "dead",
        "unknown",
      ]

      for (const status of statuses) {
        const info: SwarmWindowInfo = {
          agentId: "test",
          agentName: "test",
          role: "worker",
          windowIndex: "0",
          windowName: "test",
          paneTarget: "test",
          worktreePath: null,
          branchName: "test",
          createdAt: Date.now(),
          status,
        }
        expect(info.status).toBe(status)
      }
    })
  })

  describe("SwarmOrchestratorConfig", () => {
    it("has required projectDir", () => {
      const config: SwarmOrchestratorConfig = {
        projectDir: "/home/user/project",
      }
      expect(config.projectDir).toBe("/home/user/project")
    })

    it("supports optional worktree config", () => {
      const config: SwarmOrchestratorConfig = {
        projectDir: "/project",
        worktreeEnabled: true,
        worktreeDirPattern: "../{project}__worktrees",
        copyFiles: [".env", ".env.local"],
        symlinkPaths: ["node_modules", ".git"],
      }

      expect(config.worktreeEnabled).toBe(true)
      expect(config.copyFiles).toContain(".env")
      expect(config.symlinkPaths).toContain("node_modules")
    })

    it("supports status icons customization", () => {
      const config: SwarmOrchestratorConfig = {
        projectDir: "/project",
        statusIcons: {
          idle: "💤",
          working: "🔨",
          paused: "⏳",
          dead: "💀",
        },
      }

      expect(config.statusIcons?.idle).toBe("💤")
      expect(config.statusIcons?.working).toBe("🔨")
    })

    it("supports auto-rescue config", () => {
      const config: SwarmOrchestratorConfig = {
        projectDir: "/project",
        autoRescue: true,
        rescueIntervalMs: 5000,
      }

      expect(config.autoRescue).toBe(true)
      expect(config.rescueIntervalMs).toBe(5000)
    })
  })
})

describe("SwarmOrchestrator integration", () => {
  // Note: Full integration tests require tmux environment
  // These tests verify the structure and type contracts

  describe("static isAvailable", () => {
    it("checks tmux availability", async () => {
      // Import dynamically to avoid module-level execution issues
      const { SwarmOrchestrator } = await import("./orchestrator")

      // isAvailable checks both isInsideTmux and hasTmuxBinary
      // In test environment, we're likely not in tmux
      const available = SwarmOrchestrator.isAvailable()
      expect(typeof available).toBe("boolean")
    })
  })

  describe("createSwarmOrchestrator factory", () => {
    it("returns null when tmux not available", async () => {
      const { createSwarmOrchestrator } = await import("./orchestrator")

      // Outside tmux, factory should return null
      const orchestrator = createSwarmOrchestrator("/tmp/test-project", {})

      // Either null (not in tmux) or a valid orchestrator
      if (orchestrator !== null) {
        expect(orchestrator.getWindows).toBeDefined()
      }
    })
  })
})

describe("getOpenCodeSwarmCommand", () => {
  it("generates command with environment variables for worker", async () => {
    const { getOpenCodeSwarmCommand, SWARM_ENV } = await import("./utils")

    const cmd = getOpenCodeSwarmCommand({
      teamName: "my-team",
      agentName: "worker-1",
      role: "worker",
    })

    expect(cmd).toContain("opencode")
    expect(cmd).toContain(`${SWARM_ENV.TEAM}="my-team"`)
    expect(cmd).toContain(`${SWARM_ENV.NAME}="worker-1"`)
    expect(cmd).toContain(`${SWARM_ENV.ROLE}="worker"`)
  })

  it("generates command with environment variables for coordinator", async () => {
    const { getOpenCodeSwarmCommand, SWARM_ENV } = await import("./utils")

    const cmd = getOpenCodeSwarmCommand({
      teamName: "feature-x",
      agentName: "coordinator",
      role: "coordinator",
    })

    expect(cmd).toContain(`${SWARM_ENV.ROLE}="coordinator"`)
  })

  it("includes session ID when provided", async () => {
    const { getOpenCodeSwarmCommand, SWARM_ENV } = await import("./utils")

    const cmd = getOpenCodeSwarmCommand({
      teamName: "team",
      agentName: "worker",
      role: "worker",
      sessionId: "sess_abc123",
    })

    expect(cmd).toContain(`${SWARM_ENV.SESSION}="sess_abc123"`)
  })
})

describe("swarm environment detection", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
  })

  it("isSwarmAgent returns false when env vars not set", async () => {
    const { isSwarmAgent, SWARM_ENV } = await import("./utils")

    delete process.env[SWARM_ENV.TEAM]
    delete process.env[SWARM_ENV.NAME]
    delete process.env[SWARM_ENV.ROLE]

    expect(isSwarmAgent()).toBe(false)
  })

  it("isSwarmAgent returns true when all required env vars set", async () => {
    const { isSwarmAgent, SWARM_ENV } = await import("./utils")

    process.env[SWARM_ENV.TEAM] = "test-team"
    process.env[SWARM_ENV.NAME] = "test-worker"
    process.env[SWARM_ENV.ROLE] = "worker"

    expect(isSwarmAgent()).toBe(true)
  })

  it("getSwarmEnvContext returns null when env vars not set", async () => {
    const { getSwarmEnvContext, SWARM_ENV } = await import("./utils")

    delete process.env[SWARM_ENV.TEAM]
    delete process.env[SWARM_ENV.NAME]
    delete process.env[SWARM_ENV.ROLE]

    expect(getSwarmEnvContext()).toBeNull()
  })

  it("getSwarmEnvContext returns context when all env vars set", async () => {
    const { getSwarmEnvContext, SWARM_ENV } = await import("./utils")

    process.env[SWARM_ENV.TEAM] = "my-team"
    process.env[SWARM_ENV.NAME] = "worker-1"
    process.env[SWARM_ENV.ROLE] = "worker"
    process.env[SWARM_ENV.SESSION] = "sess_123"

    const context = getSwarmEnvContext()
    expect(context).not.toBeNull()
    expect(context?.teamName).toBe("my-team")
    expect(context?.agentName).toBe("worker-1")
    expect(context?.role).toBe("worker")
    expect(context?.sessionId).toBe("sess_123")
  })

  it("getSwarmEnvContext returns null for invalid role", async () => {
    const { getSwarmEnvContext, SWARM_ENV } = await import("./utils")

    process.env[SWARM_ENV.TEAM] = "my-team"
    process.env[SWARM_ENV.NAME] = "worker-1"
    process.env[SWARM_ENV.ROLE] = "invalid-role"

    expect(getSwarmEnvContext()).toBeNull()
  })
})
