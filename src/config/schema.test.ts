import { describe, expect, test } from "bun:test"
import {
  AgentOverrideConfigSchema,
  BuiltinCategoryNameSchema,
  CategoryConfigSchema,
  OhMyOpenCodeConfigSchema,
  SessionReferenceConfigSchema,
} from "./schema"

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    //#given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    //#given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    //#given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    //#given
    const config = {
      disabled_mcps: [],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    //#given
    const config = {
      disabled_mcps: [123, true, null],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    //#given
    const config = {}

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    //#given
    const config = {
      disabled_mcps: [""],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    //#given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ])
    }
  })
})

describe("user_memory schema", () => {
  test("should accept hierarchical_memory/entity_memory overrides", () => {
    //#given
    const config = {
      user_memory: {
        enabled: true,
        hierarchical_memory: {
          enabled: false,
          weekly_summaries_limit: 5,
          aggregation_model: "sonnet",
        },
        entity_memory: {
          enabled: true,
          max_entities: 10,
          extract_types: ["person", "project"],
        },
        temporal_validity: {
          enabled: true,
          staleness_threshold: 0.6,
        },
        consolidation: {
          enabled: true,
          work_history_threshold: 10,
        },
        semantic_clustering: {
          enabled: true,
          use_synonyms: false,
          use_stemming: false,
        },
        disclosure_level: "full",
      },
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.user_memory?.hierarchical_memory).toEqual({
        enabled: false,
        weekly_summaries_limit: 5,
        aggregation_model: "sonnet",
      })
      expect(result.data.user_memory?.entity_memory).toEqual({
        enabled: true,
        max_entities: 10,
        extract_types: ["person", "project"],
      })
      expect(result.data.user_memory?.temporal_validity).toEqual({
        enabled: true,
        staleness_threshold: 0.6,
      })
      expect(result.data.user_memory?.consolidation).toEqual({
        enabled: true,
        work_history_threshold: 10,
      })
      expect(result.data.user_memory?.semantic_clustering).toEqual({
        enabled: true,
        use_synonyms: false,
        use_stemming: false,
      })
      expect(result.data.user_memory?.disclosure_level).toBe("full")
    }
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("model field", () => {
    test("rejects model as array (only Prometheus supports multi-model)", () => {
      // #given
      const config = { model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("category field", () => {
    test("accepts category as optional string", () => {
      // #given
      const config = { category: "visual-engineering" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
      }
    })

    test("accepts config without category", () => {
      // #given
      const config = { temperature: 0.5 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // #given
      const config = { category: 123 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // #given
      const config = { variant: "high" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // #given
      const config = { variant: 123 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // #given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // #given
      const config = { skills: [] }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // #given
      const config = { temperature: 0.5 }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // #given
      const config = { skills: "frontend-ui-ux" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // #given
      const config = { model: "openai/gpt-5.2" }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // #given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.2",
        category: "ultrabrain"
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
        expect(result.data.category).toBe("ultrabrain")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // #given
      const config = { 
        category: "visual-engineering",
        skills: ["frontend-ui-ux"]
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // #given
      const config = { 
        category: "ultrabrain",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // #when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // #then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("ultrabrain")
        expect(result.data.skills).toEqual(["code-reviewer"])
        expect(result.data.temperature).toBe(0.3)
        expect(result.data.prompt_append).toBe("Extra instructions")
      }
    })
  })
})

describe("Prometheus multi-model planning config", () => {
  test("accepts agents.Prometheus.model as string[] (2-5)", () => {
    // #given
    const config = {
      agents: {
        Prometheus: {
          model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.Prometheus?.model).toEqual([
        "anthropic/claude-opus-4-5",
        "openai/gpt-5.2",
      ])
    }
  })

  test("rejects model array for non-Prometheus agents", () => {
    // #given
    const config = {
      agents: {
        Sisyphus: {
          model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(false)
  })
})

describe("org_memory schema", () => {
  test("should accept org_memory config", () => {
    // #given
    const config = {
      org_memory: {
        enabled: true,
        auto_inject: true,
        max_conventions: 10,
        max_decisions: 5,
        max_patterns: 5,
        max_terminology: 10,
        max_custom_rules: 20,
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.org_memory?.enabled).toBe(true)
      expect(result.data.org_memory?.auto_inject).toBe(true)
    }
  })

  test("should allow disabling org_memory", () => {
    // #given
    const config = {
      org_memory: {
        enabled: false,
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.org_memory?.enabled).toBe(false)
    }
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // #given
    const config = { model: "openai/gpt-5.2", variant: "xhigh" }

    // #when
    const result = CategoryConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("rejects non-string variant", () => {
    // #given
    const config = { model: "openai/gpt-5.2", variant: 123 }

    // #when
    const result = CategoryConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(false)
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // #given
    const categories = ["visual-engineering", "ultrabrain", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

    // #when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("Sisyphus-Junior agent override", () => {
  test("schema accepts agents['Sisyphus-Junior'] and retains the key after parsing", () => {
    // #given
    const config = {
      agents: {
        "Sisyphus-Junior": {
          model: "openai/gpt-5.2",
          temperature: 0.2,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["Sisyphus-Junior"]).toBeDefined()
      expect(result.data.agents?.["Sisyphus-Junior"]?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.["Sisyphus-Junior"]?.temperature).toBe(0.2)
    }
  })

  test("schema accepts Sisyphus-Junior with prompt_append", () => {
    // #given
    const config = {
      agents: {
        "Sisyphus-Junior": {
          prompt_append: "Additional instructions for Sisyphus-Junior",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["Sisyphus-Junior"]?.prompt_append).toBe(
        "Additional instructions for Sisyphus-Junior"
      )
    }
  })

  test("schema accepts Sisyphus-Junior with tools override", () => {
    // #given
    const config = {
      agents: {
        "Sisyphus-Junior": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["Sisyphus-Junior"]?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })
})

describe("SessionReferenceConfigSchema", () => {
  test("applies nested resolve_options defaults on parse({})", () => {
    // #given
    const input = {}

    // #when
    const parsed = SessionReferenceConfigSchema.parse(input)

    // #then
    expect(parsed).toEqual({
      enabled: true,
      strip_from_prompt: false,
      resolve_options: {
        prefer_handoff: true,
        allow_session_fallback: true,
        create_handoff_if_missing: false,
        max_results: 5,
        min_relevance: 0.3,
      },
    })
  })
})
