import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { resolveCategoryConfig, createConfigHandler } from "./config-handler"
import type { CategoryConfig } from "../config/schema"
import type { OhMyOpenCodeConfig } from "../config"

import * as agents from "../agents"
import * as specialist from "../agents/specialist"
import * as commandLoader from "../features/claude-code-command-loader"
import * as builtinCommands from "../features/builtin-commands"
import * as skillLoader from "../features/opencode-skill-loader"
import * as agentLoader from "../features/claude-code-agent-loader"
import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as pluginLoader from "../features/claude-code-plugin-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"
import * as permissionCompat from "../shared/permission-compat"

type Spy = ReturnType<typeof spyOn>

const spies: Spy[] = []

function track<T extends Spy>(spy: T): T {
  spies.push(spy)
  return spy
}

beforeEach(() => {
  track(spyOn(agents, "createBuiltinAgents")).mockResolvedValue({
    orchestrator: { name: "orchestrator", prompt: "test", mode: "primary" },
    advisor: { name: "advisor", prompt: "test", mode: "subagent" },
  })

  track(spyOn(specialist, "createSpecialistAgentWithOverrides")).mockReturnValue({
    name: "specialist",
    prompt: "test",
    mode: "subagent",
  })

  track(spyOn(commandLoader, "loadUserCommands")).mockResolvedValue({})
  track(spyOn(commandLoader, "loadProjectCommands")).mockResolvedValue({})
  track(spyOn(commandLoader, "loadOpencodeGlobalCommands")).mockResolvedValue({})
  track(spyOn(commandLoader, "loadOpencodeProjectCommands")).mockResolvedValue({})

  track(spyOn(builtinCommands, "loadBuiltinCommands")).mockReturnValue({})

  track(spyOn(skillLoader, "loadUserSkills")).mockResolvedValue({})
  track(spyOn(skillLoader, "loadProjectSkills")).mockResolvedValue({})
  track(spyOn(skillLoader, "loadOpencodeGlobalSkills")).mockResolvedValue({})
  track(spyOn(skillLoader, "loadOpencodeProjectSkills")).mockResolvedValue({})
  track(spyOn(skillLoader, "discoverUserClaudeSkills")).mockResolvedValue([])
  track(spyOn(skillLoader, "discoverProjectClaudeSkills")).mockResolvedValue([])
  track(spyOn(skillLoader, "discoverOpencodeGlobalSkills")).mockResolvedValue([])
  track(spyOn(skillLoader, "discoverOpencodeProjectSkills")).mockResolvedValue([])

  track(spyOn(agentLoader, "loadUserAgents")).mockReturnValue({})
  track(spyOn(agentLoader, "loadProjectAgents")).mockReturnValue({})

  track(spyOn(mcpLoader, "loadMcpConfigs")).mockResolvedValue({ servers: {} })

  track(spyOn(pluginLoader, "loadAllPluginComponents")).mockResolvedValue({
    commands: {},
    skills: {},
    agents: {},
    mcpServers: {},
    hooksConfigs: [],
    plugins: [],
    errors: [],
  })

  track(spyOn(mcpModule, "createBuiltinMcps")).mockReturnValue({})

  track(spyOn(shared, "log")).mockImplementation(() => {})
  track(spyOn(shared, "fetchAvailableModels")).mockResolvedValue(new Set(["anthropic/claude-opus-4-6"]))
  track(spyOn(shared, "readConnectedProvidersCache")).mockReturnValue(null)

  track(spyOn(permissionCompat, "migrateAgentConfig")).mockImplementation(
    (config: Record<string, unknown>) => config
  )
})

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore()
  }
  spies.splice(0, spies.length)
})

describe("specialist model inheritance", () => {
  test("does not pass UI-selected system model into specialist defaults", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "opencode/kimi-k2.5-free",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    expect(specialist.createSpecialistAgentWithOverrides).toHaveBeenCalledWith(
      undefined,
      undefined
    )
  })

  test("passes explicit specialist override while keeping system model undefined", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      agents: {
        "specialist": {
          model: "openai/gpt-5.3-codex",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "opencode/kimi-k2.5-free",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    expect(specialist.createSpecialistAgentWithOverrides).toHaveBeenCalledWith(
      { model: "openai/gpt-5.3-codex" },
      undefined
    )
  })
})

describe("Plan agent demote behavior", () => {
  test("orders core agents as orchestrator -> workflow-automator -> executor -> planner", async () => {
    // #given
    track(spyOn(agents, "createBuiltinAgents")).mockResolvedValue({
      orchestrator: { name: "orchestrator", prompt: "test", mode: "primary" },
      "workflow-automator": { name: "workflow-automator", prompt: "test", mode: "primary" },
      executor: { name: "executor", prompt: "test", mode: "primary" },
      advisor: { name: "advisor", prompt: "test", mode: "subagent" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const keys = Object.keys(config.agent as Record<string, unknown>)
    const coreAgents = ["orchestrator", "workflow-automator", "executor", "planner"]
    const ordered = keys.filter((key) => coreAgents.includes(key))
    expect(ordered).toEqual(coreAgents)
  })

  test("plan agent should be demoted to subagent mode when replacePlan is true", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
        replace_plan: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {
        plan: {
          name: "plan",
          mode: "primary",
          prompt: "original plan prompt",
        },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { mode?: string; name?: string }>
    expect(agentConfig.plan).toBeDefined()
    expect(agentConfig.plan.mode).toBe("subagent")
    expect(agentConfig.plan.name).toBe("plan")
  })

  test("planner should have mode 'all' to be callable via delegate_task", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { mode?: string }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.mode).toBe("all")
  })
})

describe("Agent permission defaults", () => {
  test("executor should allow delegate_task", async () => {
    // #given
    track(spyOn(agents, "createBuiltinAgents")).mockResolvedValue({
      orchestrator: { name: "orchestrator", prompt: "test", mode: "primary" },
      executor: { name: "executor", prompt: "test", mode: "primary" },
      advisor: { name: "advisor", prompt: "test", mode: "subagent" },
    })
    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { permission?: Record<string, string> }>
    expect(agentConfig.executor).toBeDefined()
    expect(agentConfig.executor.permission?.delegate_task).toBe("allow")
  })

  test("specialist must deny task but allow delegate_task (research-scoped)", async () => {
    // #given
    track(spyOn(specialist, "createSpecialistAgentWithOverrides")).mockReturnValue({
      name: "specialist",
      prompt: "test",
      mode: "subagent",
      permission: { delegate_task: "allow", task: "allow" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then - task is denied, delegate_task is allowed (research scope enforced by tool)
    const agentConfig = config.agent as Record<string, { permission?: Record<string, string> }>
    expect(agentConfig["specialist"]).toBeDefined()
    expect(agentConfig["specialist"].permission?.task).toBe("deny")
    // delegate_task is allowed for research-scoped access (scope enforced at tool execution level)
    expect(agentConfig["specialist"].permission?.delegate_task).toBe("allow")
  })
})

describe("planner category config resolution", () => {
  test("resolves ultrabrain category config", () => {
    // #given
    const categoryName = "ultrabrain"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.3-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("resolves visual-engineering category config", () => {
    // #given
    const categoryName = "visual-engineering"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/gemini-3-pro")
  })

  test("user categories override default categories", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        model: "google/antigravity-claude-opus-4-5-thinking",
        temperature: 0.1,
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    expect(config?.temperature).toBe(0.1)
  })

  test("returns undefined when builtin category is disabled in user config", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      ultrabrain: {
        disable: true,
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeUndefined()
  })

  test("returns undefined when custom category is disable=true", () => {
    // #given
    const categoryName = "my-custom"
    const userCategories: Record<string, CategoryConfig> = {
      "my-custom": {
        model: "openai/gpt-5.3-codex",
        disable: true,
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeUndefined()
  })

  test("returns undefined for unknown category", () => {
    // #given
    const categoryName = "nonexistent-category"

    // #when
    const config = resolveCategoryConfig(categoryName)

    // #then
    expect(config).toBeUndefined()
  })

  test("falls back to default when user category has no entry", () => {
    // #given
    const categoryName = "ultrabrain"
    const userCategories: Record<string, CategoryConfig> = {
      "visual-engineering": {
        model: "custom/visual-model",
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("openai/gpt-5.3-codex")
    expect(config?.variant).toBe("xhigh")
  })

  test("preserves all category properties (temperature, top_p, tools, etc.)", () => {
    // #given
    const categoryName = "custom-category"
    const userCategories: Record<string, CategoryConfig> = {
      "custom-category": {
        model: "test/model",
        temperature: 0.5,
        top_p: 0.9,
        maxTokens: 32000,
        tools: { tool1: true, tool2: false },
      },
    }

    // #when
    const config = resolveCategoryConfig(categoryName, userCategories)

    // #then
    expect(config).toBeDefined()
    expect(config?.model).toBe("test/model")
    expect(config?.temperature).toBe(0.5)
    expect(config?.top_p).toBe(0.9)
    expect(config?.maxTokens).toBe(32000)
    expect(config?.tools).toEqual({ tool1: true, tool2: false })
  })
})

describe("planner direct override priority over category", () => {
  test("direct reasoningEffort takes priority over category reasoningEffort", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
      categories: {
        "test-planning": {
          model: "openai/gpt-5.2",
          reasoningEffort: "xhigh",
        },
      },
      agents: {
        planner: {
          category: "test-planning",
          reasoningEffort: "low",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.reasoningEffort).toBe("low")
  })

  test("category reasoningEffort applied when no direct override", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
      categories: {
        "reasoning-cat": {
          model: "openai/gpt-5.2",
          reasoningEffort: "high",
        },
      },
      agents: {
        planner: {
          category: "reasoning-cat",
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { reasoningEffort?: string }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.reasoningEffort).toBe("high")
  })

  test("direct temperature takes priority over category temperature", async () => {
    // #given
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
      categories: {
        "temp-cat": {
          model: "openai/gpt-5.2",
          temperature: 0.8,
        },
      },
      agents: {
        planner: {
          category: "temp-cat",
          temperature: 0.1,
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { temperature?: number }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.temperature).toBe(0.1)
  })

  test("planner prompt_append is appended to base prompt", async () => {
    // #given
    const customInstructions = "## Custom Project Rules\nUse max 2 commits."
    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
      agents: {
        planner: {
          prompt_append: customInstructions,
        },
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { prompt?: string }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.prompt).toContain("planner")
    expect(agentConfig.planner.prompt).toContain(customInstructions)
    expect(agentConfig.planner.prompt!.endsWith(customInstructions)).toBe(true)
  })
})

describe("Fork-only behavior", () => {
  test("planner model array is ignored for runtime safety", async () => {
    // #given
    const pluginConfig = {
      orchestrator_agent: { planner_enabled: true },
      agents: {
        planner: {
          model: ["openai/gpt-5.2", "anthropic/claude-opus-4-6"],
        },
      },
    } as unknown as OhMyOpenCodeConfig
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { model?: unknown }>
    expect(agentConfig.planner).toBeDefined()
    expect(agentConfig.planner.model).toBe("anthropic/claude-opus-4-6")
  })

  test("config.agent should not override builtin agent definitions", async () => {
    // #given
    track(spyOn(agents, "createBuiltinAgents")).mockResolvedValue({
      orchestrator: { name: "orchestrator", prompt: "test", mode: "primary" },
      advisor: { name: "advisor", prompt: "builtin advisor", mode: "subagent" },
    })

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {
        advisor: { name: "advisor", prompt: "config advisor", mode: "subagent" },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const agentConfig = config.agent as Record<string, { prompt?: string }>
    expect(agentConfig.advisor).toBeDefined()
    expect(agentConfig.advisor.prompt).toBe("builtin advisor")
  })

  test("config.mcp should override builtin mcp definitions", async () => {
    // #given
    track(spyOn(mcpModule, "createBuiltinMcps")).mockReturnValue({
      websearch: {
        type: "remote",
        url: "builtin",
        enabled: true,
        oauth: false,
      },
    })

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
      mcp: {
        websearch: {
          type: "remote",
          url: "override",
          enabled: true,
          oauth: false,
        },
      },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const mcpConfig = config.mcp as Record<string, { url?: string }>
    expect(mcpConfig.websearch.url).toBe("override")
  })
})

describe("Plugin validation summary logging", () => {
  test("logs validation summary when plugin loader provides validation data", async () => {
    // #given
    track(spyOn(pluginLoader, "loadAllPluginComponents")).mockResolvedValue({
      commands: {},
      skills: {},
      agents: {},
      mcpServers: {},
      hooksConfigs: [],
      plugins: [],
      errors: [],
      validation: {
        totalPlugins: 2,
        validPlugins: 1,
        skippedPlugins: 1,
        errorCount: 2,
        warningCount: 1,
      },
    })

    const pluginConfig: OhMyOpenCodeConfig = {}
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp" },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    const logSpy = shared.log as unknown as { mock: { calls: Array<[string, { validation?: unknown } | undefined]> } }
    const hasValidationSummaryLog = logSpy.mock.calls.some(
      ([message, payload]) =>
        message.includes("Plugin validation summary")
        && payload?.validation !== undefined
    )
    expect(hasValidationSummaryLog).toBe(true)
  })
})

describe("Deadlock prevention - fetchAvailableModels must not receive client", () => {
  test("fetchAvailableModels should be called with undefined client to prevent deadlock during plugin init", async () => {
    // #given
    const fetchSpy = track(spyOn(shared, "fetchAvailableModels")).mockResolvedValue(new Set<string>())

    const pluginConfig: OhMyOpenCodeConfig = {
      orchestrator_agent: {
        planner_enabled: true,
      },
    }
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-6",
      agent: {},
    }
    const mockClient = {
      provider: { list: () => Promise.resolve({ data: { connected: [] } }) },
      model: { list: () => Promise.resolve({ data: [] }) },
    }
    const handler = createConfigHandler({
      ctx: { directory: "/tmp", client: mockClient },
      pluginConfig,
      modelCacheState: {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: new Map(),
      },
    })

    // #when
    await handler(config)

    // #then
    expect(fetchSpy).toHaveBeenCalled()
    const firstCallArgs = fetchSpy.mock.calls[0]
    expect(firstCallArgs[0]).toBeUndefined()
  })
})
