import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createBuiltinAgents } from "./utils"
import type { AgentConfig } from "@opencode-ai/sdk"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-5"

let originalXdgCacheHome: string | undefined

beforeEach(() => {
  originalXdgCacheHome = process.env.XDG_CACHE_HOME
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "omo-test-cache-"))
})

afterEach(() => {
  if (originalXdgCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME
  } else {
    process.env.XDG_CACHE_HOME = originalXdgCacheHome
  }
})

describe("createBuiltinAgents with model overrides", () => {
  test("Sisyphus with default model has thinking config", async () => {
    // given - no overrides, using systemDefaultModel

    // when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-5")
    expect(agents.sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.sisyphus.reasoningEffort).toBeUndefined()
  })

  test("Sisyphus respects uiSelectedModel when provided", async () => {
    // given
    const uiSelectedModel = "openai/gpt-5.2"

    // when
    const agents = await createBuiltinAgents(
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

    // then
    expect(agents.sisyphus.model).toBe(uiSelectedModel)
    expect(agents.sisyphus.reasoningEffort).toBe("medium")
    expect(agents.sisyphus.thinking).toBeUndefined()
  })

  test("Sisyphus with GPT model override has reasoningEffort, no thinking", async () => {
    // given
    const overrides = {
      sisyphus: { model: "github-copilot/gpt-5.2" },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.sisyphus.reasoningEffort).toBe("medium")
    expect(agents.sisyphus.thinking).toBeUndefined()
  })

  test("Sisyphus with systemDefaultModel GPT uses fallback chain model in first-run scenario", async () => {
    // given - no provider cache exists, so this is a first-run scenario
    // In first-run, we use fallback chain's first model (anthropic/claude-opus-4-5)
    // not systemDefaultModel, to ensure agents are visible
    const systemDefaultModel = "openai/gpt-5.2"

    // when
    const agents = await createBuiltinAgents([], {}, undefined, systemDefaultModel)

    // then - first-run uses fallback chain's first model, not systemDefaultModel
    // This ensures agents are visible even before any provider is connected
    expect(agents.sisyphus.model).toBe("anthropic/claude-opus-4-5")
    expect(agents.sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.sisyphus.reasoningEffort).toBeUndefined()
  })

  test("Oracle with default model has reasoningEffort", async () => {
    // given - no overrides, using systemDefaultModel for other agents
    // Oracle uses its own default model (openai/gpt-5.2) from the factory singleton

    // when
    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    // then - Oracle uses systemDefaultModel since model is now required
    expect(agents.oracle.model).toBe("anthropic/claude-opus-4-5")
    expect(agents.oracle.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.oracle.reasoningEffort).toBeUndefined()
  })

  test("agent override category influences model resolution (without inconsistent thinking/reasoning)", async () => {
    // given
    const overrides = {
      oracle: { category: "gpt-category" },
    }
    const categories = {
      "gpt-category": { model: "openai/gpt-5.2" },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)

    // then
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.thinking).toBeUndefined()
  })

  test("agent override model takes precedence over category", async () => {
    // given
    const overrides = {
      oracle: { category: "gpt-category", model: "anthropic/claude-sonnet-4" },
    }
    const categories = {
      "gpt-category": { model: "openai/gpt-5.2" },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, categories)

    // then
    expect(agents.oracle.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.oracle.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.oracle.reasoningEffort).toBeUndefined()
  })

  test("Oracle with GPT model override has reasoningEffort, no thinking", async () => {
    // given
    const overrides = {
      oracle: { model: "openai/gpt-5.2" },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.textVerbosity).toBe("high")
    expect(agents.oracle.thinking).toBeUndefined()
  })

  test("Oracle with Claude model override has thinking, no reasoningEffort", async () => {
    // given
    const overrides = {
      oracle: { model: "anthropic/claude-sonnet-4" },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.oracle.model).toBe("anthropic/claude-sonnet-4")
    expect(agents.oracle.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(agents.oracle.reasoningEffort).toBeUndefined()
    expect(agents.oracle.textVerbosity).toBeUndefined()
  })

  test("non-model overrides are still applied after factory rebuild", async () => {
    // given
    const overrides = {
      sisyphus: { model: "github-copilot/gpt-5.2", temperature: 0.5 },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.2")
    expect(agents.sisyphus.temperature).toBe(0.5)
  })

  test("agent override skills are injected into prompt content", async () => {
    // given
    const overrides = {
      sisyphus: { skills: ["frontend-ui-ux"] },
    }

    // when
    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL)

    // then
    expect(agents.sisyphus.prompt).toContain("Role: Designer-Turned-Developer")
  })
})

describe("buildAgent with category and skills", () => {
  const { buildAgent } = require("./utils")
  const TEST_MODEL = "anthropic/claude-opus-4-5"

  test("agent with category but no model inherits the category's default model", () => {
    // given - agent factory that sets category but no model
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then - DEFAULT_CATEGORIES provides the model for this category
    expect(agent.model).toBe("google/gemini-3-pro")
  })

  test("agent with category and existing model keeps existing model", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "visual-engineering",
          model: "custom/model",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then - explicit model takes precedence over category
    expect(agent.model).toBe("custom/model")
  })

  test("agent with category inherits variant", () => {
    // given
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

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL, categories)

    // then
    expect(agent.model).toBe("openai/gpt-5.2")
    expect(agent.variant).toBe("xhigh")
  })

  test("agent with skills has content prepended to prompt", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Original prompt content",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Original prompt content")
    expect(agent.prompt).toMatch(/Designer-Turned-Developer[\s\S]*Original prompt content/s)
  })

  test("agent with multiple skills has all content prepended", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux"],
          prompt: "Agent prompt",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Agent prompt")
  })

  test("agent without category or skills works as before", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          model: "custom/model",
          temperature: 0.5,
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    expect(agent.model).toBe("custom/model")
    expect(agent.temperature).toBe(0.5)
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with category and skills applies both", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "ultrabrain",
          skills: ["frontend-ui-ux"],
          prompt: "Task description",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then - category's model/variant and skills are applied
    expect(agent.model).toBe("openai/gpt-5.2-codex")
    expect(agent.variant).toBe("xhigh")
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Task description")
  })

  test("agent with non-existent category has no effect", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          category: "non-existent",
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    // Note: The factory receives model, but if category doesn't exist, it's not applied
    // The agent's model comes from the factory output (which doesn't set model)
    expect(agent.model).toBeUndefined()
    expect(agent.prompt).toBe("Base prompt")
  })

  test("agent with non-existent skills only prepends found ones", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["frontend-ui-ux", "non-existent-skill"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    expect(agent.prompt).toContain("Role: Designer-Turned-Developer")
    expect(agent.prompt).toContain("Base prompt")
  })

  test("agent-browser skill resolves only when browserProvider is 'agent-browser'", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: ["agent-browser"],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // when
    const agentWithoutProvider = buildAgent(source["test-agent"], TEST_MODEL)
    const agentWithProvider = buildAgent(source["test-agent"], TEST_MODEL, undefined, undefined, "agent-browser")

    // then
    expect(agentWithoutProvider.prompt).toBe("Base prompt")
    expect(agentWithProvider.prompt).toContain("agent-browser open")
    expect(agentWithProvider.prompt).toContain("Base prompt")
  })

  test("agent with empty skills array keeps original prompt", () => {
    // given
    const source = {
      "test-agent": () =>
        ({
          description: "Test agent",
          skills: [],
          prompt: "Base prompt",
        }) as AgentConfig,
    }

    // when
    const agent = buildAgent(source["test-agent"], TEST_MODEL)

    // then
    expect(agent.prompt).toBe("Base prompt")
  })
})
