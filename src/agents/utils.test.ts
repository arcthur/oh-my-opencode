import { describe, test, expect, spyOn } from "bun:test"
import { createBuiltinAgents } from "./utils"
import type { AgentConfig } from "@opencode-ai/sdk"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"

async function withModelStubs<T>(
  stubs: { connectedProviders: string[] | null; availableModels: Set<string> },
  fn: () => Promise<T>
): Promise<T> {
  const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(
    stubs.connectedProviders
  )
  const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(stubs.availableModels)

  try {
    return await fn()
  } finally {
    cacheSpy.mockRestore()
    fetchSpy.mockRestore()
  }
}

describe("createBuiltinAgents with model overrides", () => {
  test("workflow-automator is registered as a primary orchestrator agent", async () => {
    // #given
    const availableModels = new Set(["anthropic/claude-opus-4-6"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents["workflow-automator"]).toBeDefined()
    expect(agents["workflow-automator"]?.mode).toBe("primary")
  })

  test("orchestrator with default model has thinking config when all models available", async () => {
    // #given
    const availableModels = new Set([
      "anthropic/claude-opus-4-6",
      "kimi-for-coding/k2p5",
      "opencode/kimi-k2.5-free",
      "zai-coding-plan/glm-4.7",
      "opencode/glm-4.7-free",
    ])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.orchestrator.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.orchestrator.reasoningEffort).toBeUndefined()
  })

  test("orchestrator respects uiSelectedModel when provided (first run)", async () => {
    // #given
    const uiSelectedModel = "openai/gpt-5.2"

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () =>
        createBuiltinAgents(
          [],
          {},
          undefined,
          TEST_DEFAULT_MODEL,
          undefined,
          undefined,
          [],
          undefined,
          undefined,
          uiSelectedModel
        )
    )

    // #then
    expect(agents.orchestrator.model).toBe(uiSelectedModel)
    expect(agents.orchestrator.reasoningEffort).toBe("medium")
    expect(agents.orchestrator.thinking).toBeUndefined()
  })

  test("orchestrator with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      orchestrator: { model: "github-copilot/gpt-5.2" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator.model).toBe("github-copilot/gpt-5.2")
    expect(agents.orchestrator.reasoningEffort).toBe("medium")
    expect(agents.orchestrator.thinking).toBeUndefined()
  })

  test("orchestrator with systemDefaultModel GPT uses fallback chain model in first-run scenario", async () => {
    // #given
    const systemDefaultModel = "openai/gpt-5.2"

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, systemDefaultModel)
    )

    // #then
    expect(agents.orchestrator.model).toBe("anthropic/claude-opus-4-6")
    expect(agents.orchestrator.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.orchestrator.reasoningEffort).toBeUndefined()
  })

  test("advisor uses connected provider fallback when availableModels is empty and cache exists", async () => {
    // #given
    const connectedProviders = ["openai"]

    // #when
    const agents = await withModelStubs(
      { connectedProviders, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor.model).toBe("openai/gpt-5.2")
    expect(agents.advisor.reasoningEffort).toBe("medium")
    expect(agents.advisor.textVerbosity).toBe("high")
    expect(agents.advisor.thinking).toBeUndefined()
  })

  test("advisor created with systemDefaultModel when no cache exists (first run scenario)", async () => {
    // #given
    const connectedProviders = null

    // #when
    const agents = await withModelStubs(
      { connectedProviders, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor.model).toBe(TEST_DEFAULT_MODEL)
    expect(agents.advisor.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.advisor.reasoningEffort).toBeUndefined()
  })

  test("advisor with GPT model override has reasoningEffort, no thinking", async () => {
    // #given
    const overrides = {
      advisor: { model: "openai/gpt-5.2" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor.model).toBe("openai/gpt-5.2")
    expect(agents.advisor.reasoningEffort).toBe("medium")
    expect(agents.advisor.textVerbosity).toBe("high")
    expect(agents.advisor.thinking).toBeUndefined()
  })

  test("advisor with Claude model override has thinking, no reasoningEffort", async () => {
    // #given
    const overrides = {
      advisor: { model: "anthropic/claude-sonnet-4" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.advisor.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.advisor.reasoningEffort).toBeUndefined()
    expect(agents.advisor.textVerbosity).toBeUndefined()
  })

  test("non-model overrides are still applied after factory rebuild", async () => {
    // #given
    const overrides = {
      orchestrator: { model: "github-copilot/gpt-5.2", temperature: 0.5 },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator.model).toBe("github-copilot/gpt-5.2")
    expect(agents.orchestrator.temperature).toBe(0.5)
  })

  test("agent override skills are injected into prompt content", async () => {
    // #given
    const overrides = {
      orchestrator: { skills: ["frontend-ui-ux"] },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator.prompt).toContain("Role: Designer-Turned-Developer")
  })

  test("disabledSkills filter removes discovered skills from generated prompt context", async () => {
    // #given
    const discoveredSkills = [
      {
        name: "my-custom-skill",
        definition: {
          name: "my-custom-skill",
          description: "UNIQUE_DISABLED_SKILL_MARKER",
          template: "unused",
        },
        scope: "project",
      },
    ]

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () =>
        createBuiltinAgents(
          [],
          {},
          undefined,
          TEST_DEFAULT_MODEL,
          undefined,
          undefined,
          discoveredSkills,
          undefined,
          undefined,
          undefined,
          new Set(["my-custom-skill"])
        )
    )

    // #then
    expect(agents.orchestrator.prompt).not.toContain("UNIQUE_DISABLED_SKILL_MARKER")
  })
})

describe("createBuiltinAgents without systemDefaultModel", () => {
  test("agents created via connected cache fallback even without systemDefaultModel", async () => {
    // #given
    const connectedProviders = ["openai"]

    // #when
    const agents = await withModelStubs(
      { connectedProviders, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, undefined)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.model).toBe("openai/gpt-5.2")
  })

  test("agents NOT created when no cache and no systemDefaultModel (first run without defaults)", async () => {
    // #given
    const connectedProviders = null

    // #when
    const agents = await withModelStubs(
      { connectedProviders, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, undefined)
    )

    // #then
    expect(agents.advisor).toBeUndefined()
  })

  test("orchestrator created via connected cache fallback when all providers available", async () => {
    // #given
    const connectedProviders = ["anthropic", "kimi-for-coding", "opencode", "zai-coding-plan"]
    const availableModels = new Set([
      "anthropic/claude-opus-4-6",
      "kimi-for-coding/k2p5",
      "opencode/kimi-k2.5-free",
      "zai-coding-plan/glm-4.7",
      "opencode/glm-4.7-free",
    ])

    // #when
    const agents = await withModelStubs(
      { connectedProviders, availableModels },
      async () => createBuiltinAgents([], {}, undefined, undefined)
    )

    // #then
    expect(agents.orchestrator).toBeDefined()
    expect(agents.orchestrator.model).toBe("anthropic/claude-opus-4-6")
  })
})

describe("createBuiltinAgents with requiresProvider gating (executor)", () => {
  test("executor is registered as primary deep-worker agent", async () => {
    // #given
    const availableModels = new Set(["openai/gpt-5.3-codex"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
    expect(agents.executor.mode).toBe("primary")
  })

  test("executor is not created when no required provider is connected", async () => {
    // #given - only anthropic is connected (not in executor required providers)
    const availableModels = new Set(["anthropic/claude-opus-4-6"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: ["anthropic"], availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeUndefined()
  })

  test("executor is created when openai provider is connected", async () => {
    // #given
    const availableModels = new Set(["openai/gpt-5.3-codex"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
  })

  test("executor is created when github-copilot provider is connected", async () => {
    // #given
    const availableModels = new Set(["github-copilot/gpt-5.3-codex"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
  })

  test("executor is created when opencode provider is connected", async () => {
    // #given
    const availableModels = new Set(["opencode/gpt-5.3-codex"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
  })

  test("executor is created on first run when no availableModels or cache exist", async () => {
    // #given
    const availableModels = new Set<string>()

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
    expect(agents.executor.model).toBe("openai/gpt-5.3-codex")
  })

  test("executor is created when explicit config provided even if provider unavailable", async () => {
    // #given
    const availableModels = new Set(["anthropic/claude-opus-4-6"])
    const overrides = {
      executor: { model: "anthropic/claude-opus-4-6" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.executor).toBeDefined()
  })
})

describe("createBuiltinAgents with requiresAnyModel gating (orchestrator)", () => {
  test("orchestrator is created when at least one fallback model is available", async () => {
    // #given
    const availableModels = new Set(["anthropic/claude-opus-4-6"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator).toBeDefined()
  })

  test("orchestrator is created on first run when no availableModels or cache exist", async () => {
    // #given
    const availableModels = new Set<string>()

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator).toBeDefined()
    expect(agents.orchestrator.model).toBe("anthropic/claude-opus-4-6")
  })

  test("orchestrator is created when explicit config provided even if no models available", async () => {
    // #given
    const availableModels = new Set<string>()
    const overrides = {
      orchestrator: { model: "anthropic/claude-opus-4-6" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator).toBeDefined()
  })

  test("orchestrator is not created when no fallback model is available (unrelated model only)", async () => {
    // #given
    const availableModels = new Set(["openai/gpt-5.2"])

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator).toBeUndefined()
  })
})

describe("override.category expansion in createBuiltinAgents", () => {
  test("standard agent override with category expands category properties", async () => {
    // #given
    const overrides = {
      advisor: { category: "ultrabrain" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.model).toBe("openai/gpt-5.3-codex")
    expect(agents.advisor.variant).toBe("xhigh")
  })

  test("standard agent override with category AND direct variant - direct wins", async () => {
    // #given
    const overrides = {
      advisor: { category: "ultrabrain", variant: "max" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.variant).toBe("max")
  })

  test("standard agent override with category AND direct reasoningEffort - direct wins", async () => {
    // #given
    const categories = {
      "test-cat": {
        model: "openai/gpt-5.2",
        reasoningEffort: "xhigh" as const,
      },
    }
    const overrides = {
      advisor: { category: "test-cat", reasoningEffort: "low" as const },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.reasoningEffort).toBe("low")
  })

  test("standard agent override with category applies reasoningEffort from category when no direct override", async () => {
    // #given
    const categories = {
      "reasoning-cat": {
        model: "openai/gpt-5.2",
        reasoningEffort: "high" as const,
      },
    }
    const overrides = {
      advisor: { category: "reasoning-cat" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.reasoningEffort).toBe("high")
  })

  test("standard agent override with category appends prompt_append to base prompt", async () => {
    // #given
    const categories = {
      "prompt-cat": {
        model: "openai/gpt-5.2",
        prompt_append: "CATEGORY_PROMPT_APPEND_MARKER",
      },
    }
    const overrides = {
      advisor: { category: "prompt-cat" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)
    )

    // #then
    expect(agents.advisor).toBeDefined()
    expect(agents.advisor.prompt).toContain("CATEGORY_PROMPT_APPEND_MARKER")
  })

  test("orchestrator override with category expands category properties", async () => {
    // #given
    const overrides = {
      orchestrator: { category: "ultrabrain" },
    }

    // #when
    const agents = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agents.orchestrator).toBeDefined()
    expect(agents.orchestrator.model).toBe("openai/gpt-5.3-codex")
    expect(agents.orchestrator.variant).toBe("xhigh")
  })

  test("override with non-existent category has no effect on config", async () => {
    // #given
    const overrides = {
      advisor: { category: "non-existent-category" },
    }

    // #when
    const agentsWithOverride = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)
    )
    const agentsWithoutOverride = await withModelStubs(
      { connectedProviders: null, availableModels: new Set() },
      async () => createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)
    )

    // #then
    expect(agentsWithOverride.advisor).toBeDefined()
    expect(agentsWithoutOverride.advisor).toBeDefined()
    expect(agentsWithOverride.advisor.model).toBe(agentsWithoutOverride.advisor.model)
  })
})

describe("Deadlock prevention - fetchAvailableModels must not receive client", () => {
  test("createBuiltinAgents should call fetchAvailableModels with undefined client to prevent deadlock", async () => {
    // #given
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set<string>())
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

    const mockClient = {
      provider: { list: () => Promise.resolve({ data: { connected: [] } }) },
      model: { list: () => Promise.resolve({ data: [] }) },
    }

    try {
      // #when
      await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined)

      // #then
      expect(fetchSpy).toHaveBeenCalled()
      const firstCallArgs = fetchSpy.mock.calls[0]
      expect(firstCallArgs[0]).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
      cacheSpy.mockRestore()
    }
  })
})

describe("buildAgent with category and skills", () => {
  const { buildAgent } = require("./utils")
  const TEST_MODEL = "anthropic/claude-opus-4-6"

  test("agent with category but no model inherits the category's default model", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("google/gemini-3-pro")
  })

  test("agent with category and existing model keeps existing model", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
          model: "custom/model",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("custom/model")
  })

  test("agent with category inherits variant", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "custom-category",
        }) as AgentConfig,
    }

    const categories = {
      "custom-category": {
        model: "openai/gpt-5.2",
        variant: "xhigh",
      },
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL, categories)

    // #then
    expect(agent.model).toBe("openai/gpt-5.2")
    expect(agent.variant).toBe("xhigh")
  })

  test("agent with skills has content prepended to prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Original prompt content",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Original prompt content")
    expect(agent.prompt).toMatch(/Designer-Turned-Developer[\s\S]*Original prompt content/s)
  })

  test("agent with multiple skills has all content prepended", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Agent prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Agent prompt")
  })

  test("agent without category or skills works as before", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          model: "custom/model",
          temperature: 0.5,
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("custom/model")
    expect(agent.temperature).toBe(0.5)
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with category and skills applies both", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "ultrabrain",
          skills: ["frontend-ui-ux"],
          prompt: "Task description",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBe("openai/gpt-5.3-codex")
    expect(agent.variant).toBe("xhigh")
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Task description")
  })

  test("agent with non-existent category has no effect", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "non-existent",
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.model).toBeUndefined()
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with non-existent skills only prepends found ones", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux", "non-existent-skill"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Base prompt")
  })

  test("agent-browser skill resolves only when browserProvider is 'agent-browser'", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["agent-browser"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agentWithoutProvider = buildAgent(source["test-agent"], TEST_MODEL)
    const agentWithProvider = buildAgent(
      source["test-agent"],
      TEST_MODEL,
      undefined,
      undefined,
      "agent-browser"
    )

    // #then
    expect(agentWithoutProvider.prompt).toBe("Base prompt")
    expect(agentWithProvider.prompt).toContain("agent-browser open")
    expect(agentWithProvider.prompt).toContain("Base prompt")
  })

  test("agent with empty skills array keeps original prompt", () => {
    // #given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: [],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // #when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // #then
    expect(agent.prompt).toBe("Base prompt")
  })
})
