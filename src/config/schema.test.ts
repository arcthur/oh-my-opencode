import { describe, expect, test } from "bun:test"
import {
  AgentOverrideConfigSchema,
  BuiltinCategoryNameSchema,
  CategoryConfigSchema,
  PlanningWithFilesConfigSchema,
  SisyphusTasksConfigSchema,
  HookNameSchema,
  OhMyOpenCodeConfigSchema,
  SessionReferenceConfigSchema,
} from "./schema"
import { CURRENT_CONFIG_VERSION } from "./version"

function withVersion(config: Record<string, unknown>): Record<string, unknown> {
  return {
    config_version: CURRENT_CONFIG_VERSION,
    architecture_version: 2,
    ...config,
  }
}

describe("config_version requirement", () => {
  test("rejects config without config_version", () => {
    // given
    const config = {
      disabled_mcps: ["context7"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects config without architecture_version", () => {
    // given
    const config = {
      config_version: CURRENT_CONFIG_VERSION,
      disabled_mcps: ["context7"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    // given
    const config = {
      disabled_mcps: [],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    // given
    const config = {
      disabled_mcps: [123, true, null],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    // given
    const config = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    // given
    const config = {
      disabled_mcps: [""],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    // given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
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
    // given
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

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
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

  test("should accept partial hybrid_weights override", () => {
    // given
    const config = {
      user_memory: {
        embeddings: {
          hybrid_weights: {
            vector: 0.7,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
  })

  test("should reject full hybrid_weights override when weights do not sum to 1.0", () => {
    // given
    const config = {
      user_memory: {
        embeddings: {
          hybrid_weights: {
            vector: 0.7,
            bm25: 0.3,
            jaccard: 0.3,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("should accept full hybrid_weights override when weights sum to 1.0", () => {
    // given
    const config = {
      user_memory: {
        embeddings: {
          hybrid_weights: {
            vector: 0.5,
            bm25: 0.25,
            jaccard: 0.25,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
  })
})

describe("disabled_skills schema", () => {
  test("should accept built-in skill names", () => {
    // given
    const config = {
      disabled_skills: [
        "playwright",
        "frontend-ui-ux",
        "git-master",
        "parallel-agents",
        "dev-browser",
        "cartography",
        "agent-browser",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_skills).toEqual([
        "playwright",
        "frontend-ui-ux",
        "git-master",
        "parallel-agents",
        "dev-browser",
        "cartography",
        "agent-browser",
      ])
    }
  })

  test("should reject unknown skill names", () => {
    // given
    const config = {
      disabled_skills: ["not-a-skill"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })
})

describe("repo_overview schema", () => {
  test("should accept min_tool_calls", () => {
    // given
    const config = {
      repo_overview: {
        min_tool_calls: 2,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.repo_overview?.min_tool_calls).toBe(2)
    }
  })
})

describe("cartography schema", () => {
  test("should accept cartography config", () => {
    // given
    const config = {
      cartography: {
        enabled: true,
        max_depth: 3,
        min_files: 4,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cartography?.enabled).toBe(true)
      expect(result.data.cartography?.max_depth).toBe(3)
      expect(result.data.cartography?.min_files).toBe(4)
    }
  })
})

describe("codemap_injector schema", () => {
  test("should accept codemap_injector config", () => {
    // given
    const config = {
      codemap_injector: {
        enabled: true,
        budget: 500,
        max_per_codemap: 300,
        suggest_cartography: true,
        semantic_search: false,
        inject_root_project_map: false,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.codemap_injector?.enabled).toBe(true)
      expect(result.data.codemap_injector?.budget).toBe(500)
      expect(result.data.codemap_injector?.max_per_codemap).toBe(300)
      expect(result.data.codemap_injector?.inject_root_project_map).toBe(false)
    }
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("model field", () => {
    test("rejects model as array", () => {
      // given
      const config = { model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("category field", () => {
    test("accepts category as optional string", () => {
      // given
      const config = { category: "visual-engineering" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
      }
    })

    test("accepts config without category", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // given
      const config = { category: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // given
      const config = { variant: "high" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // given
      const config = { variant: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // given
      const config = { skills: [] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // given
      const config = { skills: "frontend-ui-ux" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // given
      const config = { model: "openai/gpt-5.2" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.2",
        category: "ultrabrain"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.2")
        expect(result.data.category).toBe("ultrabrain")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // given
      const config = { 
        category: "visual-engineering",
        skills: ["frontend-ui-ux"]
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // given
      const config = { 
        category: "ultrabrain",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
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

describe("legacy multi-plan config cleanup", () => {
  test("rejects agents.prometheus.model as string[]", () => {
    // given
    const config = {
      agents: {
        prometheus: {
          model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("rejects model array for non-prometheus agents", () => {
    // given
    const config = {
      agents: {
        sisyphus: {
          model: ["anthropic/claude-opus-4-5", "openai/gpt-5.2"],
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("does not expose multi-plan-trigger hook name", () => {
    // then
    expect(HookNameSchema.options).not.toContain("multi-plan-trigger")
  })

  test("rejects legacy multi_plan_pipeline config", () => {
    // given
    const config = {
      multi_plan_pipeline: {
        auto_complexity_detection: true,
        smart_skip_interview: true,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })
})

describe("org_memory schema", () => {
  test("should accept org_memory config", () => {
    // given
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

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.org_memory?.enabled).toBe(true)
      expect(result.data.org_memory?.auto_inject).toBe(true)
    }
  })

  test("should allow disabling org_memory", () => {
    // given
    const config = {
      org_memory: {
        enabled: false,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.org_memory?.enabled).toBe(false)
    }
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("rejects non-string variant", () => {
    // given
    const config = { model: "openai/gpt-5.2", variant: 123 }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts disable as optional boolean", () => {
    // given
    const config = { model: "openai/gpt-5.2", disable: true }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disable).toBe(true)
    }
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // given
    const categories = ["visual-engineering", "ultrabrain", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

    // when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("Sisyphus-Junior agent override", () => {
  test("schema accepts agents['Sisyphus-Junior'] and retains the key after parsing", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          model: "openai/gpt-5.2",
          temperature: 0.2,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]).toBeDefined()
      expect(result.data.agents?.["sisyphus-junior"]?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.["sisyphus-junior"]?.temperature).toBe(0.2)
    }
  })

  test("schema accepts Sisyphus-Junior with prompt_append", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          prompt_append: "Additional instructions for Sisyphus-Junior",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.prompt_append).toBe(
        "Additional instructions for Sisyphus-Junior"
      )
    }
  })

  test("schema accepts Sisyphus-Junior with tools override", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })
})

describe("Atlas agent surface", () => {
  test("schema accepts agents.atlas overrides", () => {
    // given
    const config = {
      agents: {
        atlas: {
          model: "openai/gpt-5.2",
          temperature: 0.1,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.atlas?.model).toBe("openai/gpt-5.2")
      expect(result.data.agents?.atlas?.temperature).toBe(0.1)
    }
  })

  test("schema accepts atlas in disabled_agents", () => {
    // given
    const config = {
      disabled_agents: ["atlas"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_agents).toEqual(["atlas"])
    }
  })
})

describe("SessionReferenceConfigSchema", () => {
  test("applies nested resolve_options defaults on parse({})", () => {
    // given
    const input = {}

    // when
    const parsed = SessionReferenceConfigSchema.parse(input)

    // then
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

describe("continuation_control schema", () => {
  test("applies defaults for continuation control", () => {
    // given
    const config = {
      work_orchestrator: {
        continuation_control: {},
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.work_orchestrator?.continuation_control).toEqual({
        post_compaction_grace_ms: 1500,
        priority: {
          "work-orchestrator": 400,
          "ralph-loop": 300,
          "task-auto-continuation": 200,
          "unstable-agent-watchdog": 50,
        },
      })
    }
  })

  test("accepts partial priority overrides", () => {
    // given
    const config = {
      work_orchestrator: {
        continuation_control: {
          priority: {
            "work-orchestrator": 500,
            "ralph-loop": 250,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.work_orchestrator?.continuation_control?.priority).toEqual({
        "work-orchestrator": 500,
        "ralph-loop": 250,
        "task-auto-continuation": 200,
        "unstable-agent-watchdog": 50,
      })
    }
  })
})

describe("verifier_gate and discovery_channel schema", () => {
  test("applies defaults for verifier_gate and discovery_channel", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion({
      work_orchestrator: {
        verifier_gate: {},
        discovery_channel: {},
      },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.work_orchestrator?.verifier_gate).toEqual({
        enabled: true,
        evidence_ttl_ms: 900000,
        require_lsp_clean: true,
        require_test_or_build: true,
        allow_no_code_change: true,
      })
      expect(result.data.work_orchestrator?.discovery_channel).toEqual({
        enabled: true,
        capture_delegate_output: true,
        capture_assistant_updates: true,
        marker_mode: "hybrid",
        dedupe_window_ms: 1800000,
        max_open_items: 200,
        auto_task_create: false,
      })
    }
  })

  test("rejects unknown key inside verifier_gate", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion({
      work_orchestrator: {
        verifier_gate: {
          enabled: true,
          unknown_option: true,
        },
      },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys"
            && issue.path.join(".") === "work_orchestrator.verifier_gate"
            && issue.keys.includes("unknown_option")
        )
      ).toBe(true)
    }
  })
})

describe("session_handoff.auto_handoff schema", () => {
  test("applies defaults for auto_handoff", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion({
      session_handoff: {
        auto_handoff: {},
      },
    }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.session_handoff?.auto_handoff).toEqual({
        enabled: true,
        trigger_verifier_denials: 2,
        trigger_context_pressure_hits: 2,
        trigger_prompt_failures: 2,
        cooldown_ms: 600000,
        launch_mode: "auto",
        stop_continuation_on_launch: true,
      })
    }
  })

  test("rejects unknown key inside session_handoff.auto_handoff", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion({
      session_handoff: {
        auto_handoff: {
          enabled: true,
          unknown_option: 1,
        },
      },
    }))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys"
            && issue.path.join(".") === "session_handoff.auto_handoff"
            && issue.keys.includes("unknown_option")
        )
      ).toBe(true)
    }
  })
})

describe("planning_with_files schema", () => {
  test("does not expose removed directory key", () => {
    // #then
    expect(Object.keys(PlanningWithFilesConfigSchema.shape)).not.toContain("directory")
  })

  test("applies bdd_alignment default as warn", () => {
    // given
    const config = {
      work_orchestrator: {
        planning_with_files: {
          enabled: true,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.work_orchestrator?.planning_with_files?.bdd_alignment).toBe("warn")
    }
  })

  test("rejects removed planning_with_files.directory key", () => {
    // #given
    const config = {
      work_orchestrator: {
        planning_with_files: {
          enabled: true,
          directory: "custom-plans",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys"
            && issue.path.join(".") === "work_orchestrator.planning_with_files"
            && issue.keys.includes("directory")
        )
      ).toBe(true)
    }
  })
})

describe("background_task.unstable_watchdog schema", () => {
  test("applies nested defaults when unstable_watchdog is configured", () => {
    // given
    const config = {
      background_task: {
        unstable_watchdog: {},
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.background_task?.unstable_watchdog).toEqual({
        enabled: true,
        timeout_ms: 120000,
        cooldown_ms: 300000,
        thinking_summary_max_chars: 500,
      })
    }
  })
})

describe("latest-only removed config keys", () => {
  test("does not expose removed keys in schema surface", () => {
    // #then
    expect(Object.keys(OhMyOpenCodeConfigSchema.shape)).not.toContain("multi_plan_pipeline")
    expect(Object.keys(SisyphusTasksConfigSchema.shape)).not.toContain("claude_code_compat")
    expect(Object.keys(OhMyOpenCodeConfigSchema.shape)).not.toContain("context_window_governor")
    expect(Object.keys(OhMyOpenCodeConfigSchema.shape)).not.toContain("tool_output_truncator")
    expect(Object.keys(OhMyOpenCodeConfigSchema.shape)).not.toContain("context_budget")
    expect(HookNameSchema.options).not.toContain("think-mode")
    expect(HookNameSchema.options).not.toContain("tool-output-truncator")
    expect(HookNameSchema.options).not.toContain("context-window-governor")
    expect(HookNameSchema.options).not.toContain("prometheus-md-only")
    expect(HookNameSchema.options).not.toContain("delegation-block-subagent-question")
    expect(HookNameSchema.options).not.toContain("write-existing-file-guard")
  })

  test("rejects sisyphus.tasks.claude_code_compat", () => {
    // given
    const config = {
      sisyphus: {
        tasks: {
          enabled: true,
          claude_code_compat: true,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.path.join(".") === "sisyphus.tasks" &&
            issue.keys.includes("claude_code_compat")
        )
      ).toBe(true)
    }
  })

  test("rejects governance.budget_monitor.gc_threshold", () => {
    // given
    const config = {
      governance: {
        budget_monitor: {
          enabled: true,
          gc_threshold: 0.8,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.path.join(".") === "governance.budget_monitor" &&
            issue.keys.includes("gc_threshold")
        )
      ).toBe(true)
    }
  })
})

describe("strict nested unknown-key rejection", () => {
  test("rejects unknown key inside agents.oracle", () => {
    // #given
    const config = {
      agents: {
        oracle: {
          model: "openai/gpt-5.2",
          typo_key: true,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("typo_key")
        )
      ).toBe(true)
    }
  })

  test("rejects unknown key inside governance.checkpoint", () => {
    // #given
    const config = {
      governance: {
        enabled: true,
        checkpoint: {
          enabled: true,
          unknown_option: 42,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("unknown_option")
        )
      ).toBe(true)
    }
  })

  test("rejects unknown key inside work_orchestrator", () => {
    // #given
    const config = {
      work_orchestrator: {
        enabled: true,
        deprecated_key: "value",
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("deprecated_key")
        )
      ).toBe(true)
    }
  })

  test("rejects unknown key inside sisyphus.swarm", () => {
    // #given
    const config = {
      sisyphus: {
        swarm: {
          enabled: true,
          mailbox_consume_mode: "fifo",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("mailbox_consume_mode")
        )
      ).toBe(true)
    }
  })

  test("rejects unknown key inside session_handoff.extractor", () => {
    // #given
    const config = {
      session_handoff: {
        enabled: true,
        extractor: {
          model: "haiku",
          unknown_field: true,
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.code === "unrecognized_keys" &&
            issue.keys.includes("unknown_field")
        )
      ).toBe(true)
    }
  })

  test("accepts valid deeply nested config without unknown keys", () => {
    // #given
    const config = {
      governance: {
        enabled: true,
        budget_monitor: {
          enabled: true,
          warn_threshold: 0.7,
        },
        checkpoint: {
          enabled: false,
        },
      },
      work_orchestrator: {
        enabled: true,
        planning_with_files: {
          enabled: true,
          bdd_alignment: "warn",
        },
      },
    }

    // #when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // #then
    expect(result.success).toBe(true)
  })
})

describe("removed legacy hook configs", () => {
  test("rejects context_window_governor", () => {
    // given
    const config = {
      context_window_governor: {
        recovery: {
          aggressive_output_truncation: {
            enabled: true,
            target_ratio: 0.82,
            chars_per_token: 4,
            max_outputs: 12,
            min_output_chars: 200,
            keep_recent_turns: 1,
            protected_tools: ["task_update"],
          },
        },
        dynamic_pruning: {
          enabled: true,
          recovery_target_ratio: 0.88,
          chars_per_token: 3,
          skip_summarize_if_recovered: true,
          protected_tools: ["task_update"],
          turn_protection: {
            enabled: true,
            turns: 2,
          },
          strategies: {
            deduplication: { enabled: true },
            stale_tool_outputs: {
              enabled: true,
              keep_recent_turns: 5,
              min_output_chars: 256,
              max_outputs: 4,
            },
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("rejects tool_output_truncator while keeping session_state_repair valid", () => {
    // given
    const config = {
      session_state_repair: {
        auto_resume: true,
      },
      tool_output_truncator: {
        truncate_all_tool_outputs: true,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(false)
  })

  test("accepts session_state_repair alone", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(
      withVersion({
        session_state_repair: {
          auto_resume: true,
        },
      })
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.session_state_repair?.auto_resume).toBe(true)
    }
  })
})

describe("cache_strategy schema", () => {
  test("accepts cache_strategy with provider policy, ledger, and compiler settings", () => {
    // given
    const config = {
      cache_strategy: {
        observability: {
          enabled: true,
          emit_log: true,
        },
        provider_policy: {
          mode: "observe",
          inject_when_missing: false,
          capabilities: {
            customx: {
              supports_cache_policy: true,
              preferred_option_key: "cache_mode",
              option_aliases: ["cache_mode", "cache"],
            },
          },
          providers: {
            openai: { mode: "enforce" },
            moonshot: { mode: "observe" },
          },
          rollout: {
            enabled: true,
            stage: 2,
            require_thresholds: true,
            providers: {
              openai: {
                approved: true,
                threshold: {
                  enabled: true,
                  min_cache_hit_ratio: 0.4,
                  max_error_rate: 0.05,
                  max_p95_latency_ms: 2000,
                  min_samples: 50,
                },
                observed: {
                  cache_hit_ratio: 0.6,
                  error_rate: 0.01,
                  p95_latency_ms: 800,
                  samples: 120,
                },
              },
            },
          },
        },
        ledger: {
          enabled: true,
        },
        compiler: {
          enabled: true,
          max_prefix_segments: 32,
          max_prefix_chars: 16000,
          separator: "\n\n---\n\n",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cache_strategy?.provider_policy.mode).toBe("observe")
      expect(
        result.data.cache_strategy?.provider_policy.capabilities?.customx?.preferred_option_key
      ).toBe("cache_mode")
      expect(result.data.cache_strategy?.provider_policy.rollout.enabled).toBe(true)
      expect(result.data.cache_strategy?.provider_policy.rollout.stage).toBe(2)
      expect(result.data.cache_strategy?.ledger.enabled).toBe(true)
      expect(result.data.cache_strategy?.compiler.enabled).toBe(true)
    }
  })

  test("rejects cache_strategy.prefix_stability", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion({
      cache_strategy: {
        prefix_stability: {
          mode: "strict",
        },
      },
    }))

    expect(result.success).toBe(false)
  })

  test("includes cache-policy in HookNameSchema", () => {
    // then
    expect(HookNameSchema.options).toContain("cache-policy")
  })
})

describe("hook-first policy schema", () => {
  test("accepts contracts/model_policy/budget_profiles/evaluator", () => {
    const config = {
      architecture_version: 2,
      contracts: {
        clauses: [
          {
            id: "deny-write",
            description: "deny write",
            hook_points: ["tool.execute.before"],
            enforcement: "hard",
            selector: { tool_name: "Write" },
            condition: {},
            action: { type: "deny", message: "blocked" },
            priority: 10,
            conflict_resolution: "most-restrictive",
            enabled: true,
            version: 1,
            provenance: {
              author: "test",
              source: "unit",
              created_at: 1,
            },
            reason_code: "WRITE_DENY",
          },
        ],
      },
      model_policy: {
        primary: "openai/gpt-5.3-codex",
        provider_priority: ["openai", "google", "anthropic"],
        allow_fallback: true,
      },
      budget_profiles: {
        default: {
          context_tokens_target: 240000,
          context_tokens_hard_limit: 320000,
          reasoning_budget: "medium",
          max_tool_calls: 30,
          wall_clock_ms: 120000,
        },
      },
      evaluator: {
        enabled: true,
        async: true,
        metrics: ["task_success", "cost"],
      },
    }

    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))
    expect(result.success).toBe(true)
  })

  test("rejects model_policy.primary other than openai/gpt-5.3-codex", () => {
    const config = {
      model_policy: {
        primary: "google/gemini-2.5-pro",
        provider_priority: ["openai", "google"],
        allow_fallback: true,
      },
    }

    const result = OhMyOpenCodeConfigSchema.safeParse(withVersion(config))
    expect(result.success).toBe(false)
  })
})
