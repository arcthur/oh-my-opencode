import { describe, test, expect, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import {
  AGENT_NAME_MAP,
  HOOK_NAME_MAP,
  MODEL_VERSION_MAP,
  migrateAgentNames,
  migrateHookNames,
  migrateModelVersions,
  migrateConfigFile,
  migrateAgentConfigToCategory,
  shouldDeleteAgentConfig,
} from "./migration"

describe("migrateAgentNames", () => {
  test("migrates legacy OmO names to Sisyphus", () => {
    // given: Config with legacy OmO agent names
    const agents = {
      omo: { model: "anthropic/claude-opus-4-5" },
      OmO: { temperature: 0.5 },
      "OmO-Plan": { prompt: "custom prompt" },
    }

    // when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // then: Legacy names should be migrated to Sisyphus only
    expect(changed).toBe(true)
    expect(migrated["sisyphus"]).toEqual({ temperature: 0.5 })
    expect(migrated["omo"]).toBeUndefined()
    expect(migrated["OmO"]).toBeUndefined()
    expect(migrated["OmO-Plan"]).toEqual({ prompt: "custom prompt" })
  })

  test("preserves current agent names unchanged", () => {
    // given: Config with current agent names
    const agents = {
      oracle: { model: "openai/gpt-5.2" },
      librarian: { model: "google/gemini-3-flash" },
      explore: { model: "opencode/grok-code" },
    }

    // when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // then: Current names should remain unchanged
    expect(changed).toBe(false)
    expect(migrated["oracle"]).toEqual({ model: "openai/gpt-5.2" })
    expect(migrated["librarian"]).toEqual({ model: "google/gemini-3-flash" })
    expect(migrated["explore"]).toEqual({ model: "opencode/grok-code" })
  })

  test("handles case-insensitive migration", () => {
    // given: Config with mixed case agent names
    const agents = {
      SISYPHUS: { model: "test" },
      "planner-sisyphus": { prompt: "test" },
      "Orchestrator-Sisyphus": { model: "openai/gpt-5.2" },
    }

    // when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // then: Case-insensitive lookup should migrate correctly
    // last write wins when multiple legacy keys normalize to the same canonical key
    expect(migrated["sisyphus"]).toEqual({ model: "openai/gpt-5.2" })
    expect(migrated["planner-sisyphus"]).toEqual({ prompt: "test" })
  })

  test("passes through unknown agent names unchanged", () => {
    // given: Config with unknown agent name
    const agents = {
      "custom-agent": { model: "custom/model" },
    }

    // when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // then: Unknown names should pass through
    expect(changed).toBe(false)
    expect(migrated["custom-agent"]).toEqual({ model: "custom/model" })
  })

  test("migrates orchestrator-sisyphus to sisyphus", () => {
    // given: Config with legacy orchestrator-sisyphus agent name
    const agents = {
      "orchestrator-sisyphus": { model: "anthropic/claude-opus-4-5" },
    }

    // when: Migrate agent names
    const { migrated, changed } = migrateAgentNames(agents)

    // then: orchestrator-sisyphus should be migrated to sisyphus
    expect(changed).toBe(true)
    expect(migrated["sisyphus"]).toEqual({ model: "anthropic/claude-opus-4-5" })
    expect(migrated["orchestrator-sisyphus"]).toBeUndefined()
  })
})

describe("migrateHookNames", () => {
  test("leaves unknown hooks unchanged (including old context-window hooks)", () => {
    // given: Config with unsupported legacy hooks
    const hooks = [
      "anthropic-auto-compact",
      "anthropic-context-window-limit-recovery",
      "context-window-limit-recovery",
      "context-window-monitor",
      "preemptive-compaction",
      "compaction-context-injector",
      "comment-checker",
    ]

    // when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // then: No compatibility mapping should run for removed context-window hooks
    expect(changed).toBe(false)
    expect(migrated).toEqual(hooks)
    expect(removed).toEqual([])
  })

  test("handles empty hooks array", () => {
    // given: Empty hooks array
    const hooks: string[] = []

    // when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // then: Should return empty array with no changes
    expect(changed).toBe(false)
    expect(migrated).toEqual([])
    expect(removed).toEqual([])
  })

  test("migrates sisyphus-orchestrator to execution-orchestrator", () => {
    // given: Config with legacy sisyphus-orchestrator hook
    const hooks = ["sisyphus-orchestrator", "comment-checker"]

    // when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // then: sisyphus-orchestrator should be migrated to execution-orchestrator
    expect(changed).toBe(true)
    expect(migrated).toContain("execution-orchestrator")
    expect(migrated).toContain("comment-checker")
    expect(migrated).not.toContain("sisyphus-orchestrator")
    expect(removed).toEqual([])
  })

  test("removes obsolete hooks and returns them in removed array", () => {
    // given: Config with removed hooks from v3.0.0
    const hooks = [
      "empty-message-sanitizer",
      "grep-output-truncator",
      "tasks-todowrite-disabler",
      "comment-checker",
    ]

    // when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // then: Removed hooks should be filtered out
    expect(changed).toBe(true)
    expect(migrated).toEqual(["comment-checker"])
    expect(removed).toContain("empty-message-sanitizer")
    expect(removed).toContain("grep-output-truncator")
    expect(removed).toContain("tasks-todowrite-disabler")
    expect(removed).toHaveLength(3)
  })

  test("handles mixed migration and removal", () => {
    // given: Config with both legacy rename and removed hooks
    const hooks = ["tasks-todowrite-disabler", "sisyphus-orchestrator"]

    // when: Migrate hook names
    const { migrated, changed, removed } = migrateHookNames(hooks)

    // then: Legacy should be removed, only supported migration should remain
    expect(changed).toBe(true)
    expect(migrated).toEqual(["execution-orchestrator"])
    expect(removed).toEqual(["tasks-todowrite-disabler"])
  })
})

describe("migrateConfigFile", () => {
  const testConfigPath = "/tmp/nonexistent-path-for-test.json"

  test("migrates omo_agent to sisyphus_agent", () => {
    // given: Config with legacy omo_agent key
    const rawConfig: Record<string, unknown> = {
      omo_agent: { disabled: false },
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: omo_agent should be migrated to sisyphus_agent
    expect(needsWrite).toBe(true)
    expect(rawConfig.sisyphus_agent).toEqual({ disabled: false })
    expect(rawConfig.omo_agent).toBeUndefined()
  })

  test("migrates legacy agent names in agents object", () => {
    // given: Config with legacy agent names
    const rawConfig: Record<string, unknown> = {
      agents: {
        omo: { model: "test" },
        OmO: { temperature: 0.5 },
      },
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: Agent names should be migrated
    expect(needsWrite).toBe(true)
    const agents = rawConfig.agents as Record<string, unknown>
    expect(agents["sisyphus"]).toBeDefined()
  })

  test("does not migrate legacy context-window hooks in disabled_hooks", () => {
    // given: Config with removed context-window hook names
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: ["anthropic-auto-compact", "comment-checker"],
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No compatibility migration should run
    expect(needsWrite).toBe(false)
    expect(rawConfig.disabled_hooks).toContain("anthropic-auto-compact")
    expect(rawConfig.disabled_hooks).toContain("comment-checker")
  })

  test("keeps deleted context-window hooks unchanged in disabled_hooks", () => {
    // given: Config with deleted hook names
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: ["context-window-monitor", "preemptive-compaction", "comment-checker"],
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No compatibility migration should run
    expect(needsWrite).toBe(false)
    expect(rawConfig.disabled_hooks).toContain("context-window-monitor")
    expect(rawConfig.disabled_hooks).toContain("preemptive-compaction")
    expect(rawConfig.disabled_hooks).toContain("comment-checker")
  })

  test("keeps upstream deleted hooks unchanged in disabled_hooks", () => {
    // given: Config with upstream hook names
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: [
        "anthropic-context-window-limit-recovery",
        "comment-checker",
      ],
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No compatibility migration should run
    expect(needsWrite).toBe(false)
    expect(rawConfig.disabled_hooks).toContain(
      "anthropic-context-window-limit-recovery",
    )
    expect(rawConfig.disabled_hooks).toContain("comment-checker")
  })

  test("does not write if no migration needed", () => {
    // given: Config with current names
    const rawConfig: Record<string, unknown> = {
      sisyphus_agent: { disabled: false },
      agents: {
        sisyphus: { model: "test" },
      },
      disabled_hooks: ["context-window-governor"],
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No write should be needed
    expect(needsWrite).toBe(false)
  })

  test("handles migration of all legacy items together", () => {
    // given: Config with all legacy items
    const rawConfig: Record<string, unknown> = {
      omo_agent: { disabled: false },
      agents: {
        omo: { model: "test" },
        "OmO-Plan": { prompt: "custom" },
      },
      disabled_hooks: ["anthropic-auto-compact"],
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: All legacy items should be migrated
    expect(needsWrite).toBe(true)
    expect(rawConfig.sisyphus_agent).toEqual({ disabled: false })
    expect(rawConfig.omo_agent).toBeUndefined()
    const agents = rawConfig.agents as Record<string, unknown>
    expect(agents["sisyphus"]).toBeDefined()
    expect(agents["OmO-Plan"]).toBeDefined()
    expect(rawConfig.disabled_hooks).toEqual(["anthropic-auto-compact"])
  })

  test("migrates model versions in agents", () => {
    // given: Config with old model version in agents
    const rawConfig: Record<string, unknown> = {
      agents: {
        sisyphus: { model: "openai/gpt-5.2-codex", temperature: 0.1 },
      },
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: Model version should be migrated
    expect(needsWrite).toBe(true)
    const agents = rawConfig.agents as Record<string, Record<string, unknown>>
    expect(agents["sisyphus"].model).toBe("openai/gpt-5.3-codex")
  })

  test("migrates model versions in categories", () => {
    // given: Config with old model version in categories
    const rawConfig: Record<string, unknown> = {
      categories: {
        "my-category": { model: "anthropic/claude-opus-4-5", temperature: 0.2 },
      },
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: Model version should be migrated
    expect(needsWrite).toBe(true)
    const categories = rawConfig.categories as Record<string, Record<string, unknown>>
    expect(categories["my-category"].model).toBe("anthropic/claude-opus-4-6")
  })

  test("does not set needsWrite when no model versions need migration", () => {
    // given: Config with current model versions
    const rawConfig: Record<string, unknown> = {
      agents: {
        sisyphus: { model: "openai/gpt-5.3-codex" },
      },
      categories: {
        "my-category": { model: "anthropic/claude-opus-4-6" },
      },
    }

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No write should be needed
    expect(needsWrite).toBe(false)
  })
})

describe("migration maps", () => {
  test("AGENT_NAME_MAP contains all expected legacy mappings", () => {
    // given/#when: Check AGENT_NAME_MAP
    // then: Should contain all legacy → current mappings
    expect(AGENT_NAME_MAP["omo"]).toBe("sisyphus")
    expect(AGENT_NAME_MAP["OmO"]).toBe("sisyphus")
    expect(AGENT_NAME_MAP["OmO-Plan"]).toBeUndefined()
    expect(AGENT_NAME_MAP["omo-plan"]).toBeUndefined()
    expect(AGENT_NAME_MAP["Planner-Sisyphus"]).toBeUndefined()
  })

  test("HOOK_NAME_MAP migrates sisyphus-orchestrator", () => {
    // given/#when: Check HOOK_NAME_MAP
    // then: Should preserve only supported migration entries
    expect(HOOK_NAME_MAP["sisyphus-orchestrator"]).toBe("execution-orchestrator")
  })

  test("HOOK_NAME_MAP does not include removed context-window compatibility aliases", () => {
    // given/#when: Check HOOK_NAME_MAP
    // then: Removed context-window hooks should not be migrated
    expect(HOOK_NAME_MAP["anthropic-auto-compact"]).toBeUndefined()
    expect(HOOK_NAME_MAP["anthropic-context-window-limit-recovery"]).toBeUndefined()
    expect(HOOK_NAME_MAP["context-window-monitor"]).toBeUndefined()
    expect(HOOK_NAME_MAP["preemptive-compaction"]).toBeUndefined()
  })
})

describe("MODEL_VERSION_MAP", () => {
  test("maps openai/gpt-5.2-codex to openai/gpt-5.3-codex", () => {
    // given/when: Check MODEL_VERSION_MAP
    // then: Should contain correct mapping
    expect(MODEL_VERSION_MAP["openai/gpt-5.2-codex"]).toBe("openai/gpt-5.3-codex")
  })

  test("maps anthropic/claude-opus-4-5 to anthropic/claude-opus-4-6", () => {
    // given/when: Check MODEL_VERSION_MAP
    // then: Should contain correct mapping
    expect(MODEL_VERSION_MAP["anthropic/claude-opus-4-5"]).toBe("anthropic/claude-opus-4-6")
  })
})

describe("migrateModelVersions", () => {
  test("replaces old model string in agent config", () => {
    // given: Agent config with old model version
    const agents = {
      sisyphus: { model: "openai/gpt-5.2-codex", temperature: 0.1 },
    }

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Model should be updated, other fields preserved
    expect(changed).toBe(true)
    const sisyphus = migrated["sisyphus"] as Record<string, unknown>
    expect(sisyphus.model).toBe("openai/gpt-5.3-codex")
    expect(sisyphus.temperature).toBe(0.1)
  })

  test("replaces anthropic model version", () => {
    // given: Agent config with old anthropic model
    const agents = {
      prometheus: { model: "anthropic/claude-opus-4-5" },
    }

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Model should be updated
    expect(changed).toBe(true)
    const prometheus = migrated["prometheus"] as Record<string, unknown>
    expect(prometheus.model).toBe("anthropic/claude-opus-4-6")
  })

  test("leaves unknown model strings untouched", () => {
    // given: Agent config with unknown model
    const agents = {
      oracle: { model: "openai/gpt-5.2", temperature: 0.5 },
    }

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Config should remain unchanged
    expect(changed).toBe(false)
    const oracle = migrated["oracle"] as Record<string, unknown>
    expect(oracle.model).toBe("openai/gpt-5.2")
  })

  test("handles agent config with no model field", () => {
    // given: Agent config without model field
    const agents = {
      sisyphus: { temperature: 0.1, prompt: "custom" },
    }

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Config should remain unchanged
    expect(changed).toBe(false)
    const sisyphus = migrated["sisyphus"] as Record<string, unknown>
    expect(sisyphus.temperature).toBe(0.1)
  })

  test("handles agent config with non-string model", () => {
    // given: Agent config with non-string model
    const agents = {
      sisyphus: { model: 123, temperature: 0.1 },
    }

    // when: Migrate model versions
    const { changed } = migrateModelVersions(agents)

    // then: Config should remain unchanged
    expect(changed).toBe(false)
  })

  test("migrates multiple agents in one pass", () => {
    // given: Multiple agents with old models
    const agents = {
      sisyphus: { model: "openai/gpt-5.2-codex" },
      prometheus: { model: "anthropic/claude-opus-4-5" },
      oracle: { model: "openai/gpt-5.2" },
    }

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Only mapped models should be updated
    expect(changed).toBe(true)
    expect((migrated["sisyphus"] as Record<string, unknown>).model).toBe("openai/gpt-5.3-codex")
    expect((migrated["prometheus"] as Record<string, unknown>).model).toBe("anthropic/claude-opus-4-6")
    expect((migrated["oracle"] as Record<string, unknown>).model).toBe("openai/gpt-5.2")
  })

  test("handles empty object", () => {
    // given: Empty agents object
    const agents = {}

    // when: Migrate model versions
    const { migrated, changed } = migrateModelVersions(agents)

    // then: Should return empty with no change
    expect(changed).toBe(false)
    expect(Object.keys(migrated)).toHaveLength(0)
  })
})

describe("migrateAgentConfigToCategory", () => {
  test("migrates model to category when mapping exists", () => {
    // given: Config with a model that has a category mapping
    const config = {
      model: "google/gemini-3-pro-preview",
      temperature: 0.5,
      top_p: 0.9,
    }

    // when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // then: Model should be replaced with category
    expect(changed).toBe(true)
    expect(migrated.category).toBe("visual-engineering")
    expect(migrated.model).toBeUndefined()
    expect(migrated.temperature).toBe(0.5)
    expect(migrated.top_p).toBe(0.9)
  })

  test("does not migrate when model is not in map", () => {
    // given: Config with a model that has no mapping
    const config = {
      model: "custom/model",
      temperature: 0.5,
    }

    // when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // then: Config should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(config)
  })

  test("does not migrate when model is not a string", () => {
    // given: Config with non-string model
    const config = {
      model: { name: "test" },
      temperature: 0.5,
    }

    // when: Migrate agent config to category
    const { migrated, changed } = migrateAgentConfigToCategory(config)

    // then: Config should remain unchanged
    expect(changed).toBe(false)
    expect(migrated).toEqual(config)
  })

  test("handles all mapped models correctly", () => {
    // given: Configs for each mapped model
    const configs = [
      { model: "google/gemini-3-pro-preview" },
      { model: "openai/gpt-5.2" },
      { model: "anthropic/claude-haiku-4-5" },
      { model: "anthropic/claude-opus-4-5" },
      { model: "anthropic/claude-sonnet-4-5" },
    ]

    const expectedCategories = ["visual-engineering", "ultrabrain", "quick", "unspecified-high", "unspecified-low"]

    // when: Migrate each config
    const results = configs.map(migrateAgentConfigToCategory)

    // then: Each model should map to correct category
    results.forEach((result, index) => {
      expect(result.changed).toBe(true)
      expect(result.migrated.category).toBe(expectedCategories[index])
      expect(result.migrated.model).toBeUndefined()
    })
  })

  test("preserves non-model fields during migration", () => {
    // given: Config with multiple fields
    const config = {
      model: "openai/gpt-5.2",
      temperature: 0.1,
      top_p: 0.95,
      maxTokens: 4096,
      prompt_append: "custom instruction",
    }

    // when: Migrate agent config to category
    const { migrated } = migrateAgentConfigToCategory(config)

    // then: All non-model fields should be preserved
    expect(migrated.category).toBe("ultrabrain")
    expect(migrated.temperature).toBe(0.1)
    expect(migrated.top_p).toBe(0.95)
    expect(migrated.maxTokens).toBe(4096)
    expect(migrated.prompt_append).toBe("custom instruction")
  })
})

describe("shouldDeleteAgentConfig", () => {
  test("returns true when config only has category field", () => {
    // given: Config with only category field (no overrides)
    const config = { category: "visual-engineering" }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return true (matches category defaults)
    expect(shouldDelete).toBe(true)
  })

  test("returns false when category does not exist", () => {
    // given: Config with unknown category
    const config = { category: "unknown" }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "unknown")

    // then: Should return false (category not found)
    expect(shouldDelete).toBe(false)
  })

  test("returns false when config has extra fields not in defaults", () => {
    // given: Config with model field, but DEFAULT_CATEGORIES no longer has models
    const config = {
      category: "visual-engineering",
      model: "google/gemini-3-pro-preview",
    }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return false (config has model, but defaults don't)
    expect(shouldDelete).toBe(false)
  })

  test("returns true when config has only category (empty defaults)", () => {
    // given: Config with only category, matching empty defaults
    const config = {
      category: "visual-engineering",
    }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return true (no extra fields beyond category)
    expect(shouldDelete).toBe(true)
  })

  test("returns false when fields differ from category defaults", () => {
    // given: Config with custom model override
    const config = {
      category: "visual-engineering",
      model: "anthropic/claude-opus-4-5",
    }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return false (has custom override)
    expect(shouldDelete).toBe(false)
  })

  test("handles different categories with their defaults", () => {
    // given: Configs for different categories
    const configs = [
      { category: "ultrabrain" },
      { category: "quick" },
      { category: "unspecified-high" },
      { category: "unspecified-low" },
    ]

    // when: Check each config
    const results = configs.map((config) => shouldDeleteAgentConfig(config, config.category as string))

    // then: All should be true (all match defaults)
    results.forEach((result) => {
      expect(result).toBe(true)
    })
  })

  test("returns false when additional fields are present", () => {
    // given: Config with extra fields
    const config = {
      category: "visual-engineering",
      temperature: 0.7,
      custom_field: "value", // Extra field not in defaults
    }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return false (has extra field)
    expect(shouldDelete).toBe(false)
  })

  test("handles complex config with multiple overrides", () => {
    // given: Config with multiple custom overrides
    const config = {
      category: "visual-engineering",
      temperature: 0.5, // Different from default
      top_p: 0.8, // Different from default
      prompt_append: "custom prompt", // Custom field
    }

    // when: Check if config should be deleted
    const shouldDelete = shouldDeleteAgentConfig(config, "visual-engineering")

    // then: Should return false (has overrides)
    expect(shouldDelete).toBe(false)
  })
})

describe("migrateConfigFile with backup", () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    cleanupPaths.forEach((p) => {
      try {
        fs.unlinkSync(p)
      } catch {
      }
    })
  })

  test("creates backup file with timestamp when legacy migration needed", () => {
    // given: Config file path with legacy agent names needing migration
    const testConfigPath = "/tmp/test-config-migration.json"
    const testConfigContent = globalThis.JSON.stringify({ agents: { omo: { model: "test" } } }, null, 2)
    const rawConfig: Record<string, unknown> = {
      agents: {
        omo: { model: "test" },
      },
    }

    fs.writeFileSync(testConfigPath, testConfigContent)
    cleanupPaths.push(testConfigPath)

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: Backup file should be created with timestamp
    expect(needsWrite).toBe(true)

    const dir = path.dirname(testConfigPath)
    const basename = path.basename(testConfigPath)
    const files = fs.readdirSync(dir)
    const backupFiles = files.filter((f) => f.startsWith(`${basename}.bak.`))
    expect(backupFiles.length).toBeGreaterThan(0)

    const backupFile = backupFiles[0]
    const backupPath = path.join(dir, backupFile)
    cleanupPaths.push(backupPath)

    expect(backupFile).toMatch(/test-config-migration\.json\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)

    const backupContent = fs.readFileSync(backupPath, "utf-8")
    expect(backupContent).toBe(testConfigContent)
  })

  test("preserves model setting without auto-conversion to category", () => {
    // given: Config with model setting (should NOT be converted to category)
    const testConfigPath = "/tmp/test-config-preserve-model.json"
    const rawConfig: Record<string, unknown> = {
      agents: {
        "multimodal-looker": { model: "anthropic/claude-haiku-4-5" },
        oracle: { model: "openai/gpt-5.2" },
        "my-custom-agent": { model: "google/gemini-3-pro-preview" },
      },
    }

    fs.writeFileSync(testConfigPath, globalThis.JSON.stringify(rawConfig, null, 2))
    cleanupPaths.push(testConfigPath)

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No migration needed - model settings should be preserved as-is
    expect(needsWrite).toBe(false)

    const agents = rawConfig.agents as Record<string, Record<string, unknown>>
    expect(agents["multimodal-looker"].model).toBe("anthropic/claude-haiku-4-5")
    expect(agents.oracle.model).toBe("openai/gpt-5.2")
    expect(agents["my-custom-agent"].model).toBe("google/gemini-3-pro-preview")
  })

  test("preserves category setting when explicitly set", () => {
    // given: Config with explicit category setting
    const testConfigPath = "/tmp/test-config-preserve-category.json"
    const rawConfig: Record<string, unknown> = {
      agents: {
        "multimodal-looker": { category: "quick" },
        oracle: { category: "ultrabrain" },
      },
    }

    fs.writeFileSync(testConfigPath, globalThis.JSON.stringify(rawConfig, null, 2))
    cleanupPaths.push(testConfigPath)

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: No migration needed - category settings should be preserved as-is
    expect(needsWrite).toBe(false)

    const agents = rawConfig.agents as Record<string, Record<string, unknown>>
    expect(agents["multimodal-looker"].category).toBe("quick")
    expect(agents.oracle.category).toBe("ultrabrain")
  })

  test("does not write when no migration needed", () => {
    // given: Config with no migrations needed
    const testConfigPath = "/tmp/test-config-no-migration.json"
    const dir = path.dirname(testConfigPath)
    const basename = path.basename(testConfigPath)

    // Clean up any leftover backup files from previous test runs
    const existingFiles = fs.readdirSync(dir)
    for (const f of existingFiles) {
      if (f.startsWith(`${basename}.bak.`)) {
        fs.unlinkSync(path.join(dir, f))
      }
    }

    const rawConfig: Record<string, unknown> = {
      agents: {
        sisyphus: { model: "test" },
      },
    }

    fs.writeFileSync(testConfigPath, globalThis.JSON.stringify({ agents: { sisyphus: { model: "test" } } }, null, 2))
    cleanupPaths.push(testConfigPath)

    // when: Migrate config file
    const needsWrite = migrateConfigFile(testConfigPath, rawConfig)

    // then: Should not write or create backup
    expect(needsWrite).toBe(false)

    const files = fs.readdirSync(dir)
    const backupFiles = files.filter((f) => f.startsWith(`${basename}.bak.`))
    expect(backupFiles.length).toBe(0)
  })


})
