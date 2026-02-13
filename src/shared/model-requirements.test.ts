import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("advisor has valid fallbackChain with gpt-5.2 as primary", () => {
    // given - advisor agent requirement
    const advisor = AGENT_MODEL_REQUIREMENTS["advisor"]

    // when - accessing advisor requirement
    // then - fallbackChain exists with gpt-5.2 as first entry
    expect(advisor).toBeDefined()
    expect(advisor.fallbackChain).toBeArray()
    expect(advisor.fallbackChain.length).toBeGreaterThan(0)

    const primary = advisor.fallbackChain[0]
    expect(primary.providers).toContain("openai")
    expect(primary.model).toBe("gpt-5.2")
    expect(primary.variant).toBe("high")
  })

  test("orchestrator has valid fallbackChain with claude-opus-4-6 as primary and requiresAnyModel", () => {
    // #given - orchestrator agent requirement
    const orchestrator = AGENT_MODEL_REQUIREMENTS["orchestrator"]

    // #when - accessing orchestrator requirement
    // #then - fallbackChain exists with claude-opus-4-6 as first entry, glm-4.7-free as last
    expect(orchestrator).toBeDefined()
    expect(orchestrator.fallbackChain).toBeArray()
    expect(orchestrator.fallbackChain).toHaveLength(5)
    expect(orchestrator.requiresAnyModel).toBe(true)

    const primary = orchestrator.fallbackChain[0]
    expect(primary.providers[0]).toBe("anthropic")
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.variant).toBe("max")

    const last = orchestrator.fallbackChain[4]
    expect(last.providers[0]).toBe("opencode")
    expect(last.model).toBe("glm-4.7-free")
  })

  test("librarian has valid fallbackChain with glm-4.7 as primary", () => {
    // given - librarian agent requirement
    const librarian = AGENT_MODEL_REQUIREMENTS["librarian"]

    // when - accessing librarian requirement
    // then - fallbackChain exists with glm-4.7 as first entry
    expect(librarian).toBeDefined()
    expect(librarian.fallbackChain).toBeArray()
    expect(librarian.fallbackChain.length).toBeGreaterThan(0)

    const primary = librarian.fallbackChain[0]
    expect(primary.providers[0]).toBe("zai-coding-plan")
    expect(primary.model).toBe("glm-4.7")
  })

  test("navigator has valid fallbackChain with grok-code-fast-1 as primary", () => {
    // given - navigator agent requirement
    const navigator = AGENT_MODEL_REQUIREMENTS["navigator"]

    // when - accessing navigator requirement
    // then - fallbackChain exists with grok-code-fast-1 as first entry, claude-haiku-4-5 as second
    expect(navigator).toBeDefined()
    expect(navigator.fallbackChain).toBeArray()
    expect(navigator.fallbackChain).toHaveLength(3)

    const primary = navigator.fallbackChain[0]
    expect(primary.providers).toContain("github-copilot")
    expect(primary.model).toBe("grok-code-fast-1")

    const secondary = navigator.fallbackChain[1]
    expect(secondary.providers).toContain("anthropic")
    expect(secondary.providers).toContain("opencode")
    expect(secondary.model).toBe("claude-haiku-4-5")

    const tertiary = navigator.fallbackChain[2]
    expect(tertiary.providers).toContain("opencode")
    expect(tertiary.model).toBe("gpt-5-nano")
  })

  test("interpreter has valid fallbackChain with gemini-3-flash as primary", () => {
    // given - interpreter agent requirement
    const interpreter = AGENT_MODEL_REQUIREMENTS["interpreter"]

    // when - accessing interpreter requirement
    // then - fallbackChain exists with gemini-3-flash as first entry
    expect(interpreter).toBeDefined()
    expect(interpreter.fallbackChain).toBeArray()
    expect(interpreter.fallbackChain.length).toBeGreaterThan(0)

    const primary = interpreter.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-flash")
  })

  test("planner has valid fallbackChain with claude-opus-4-6 as primary", () => {
    // given - planner agent requirement
    const planner = AGENT_MODEL_REQUIREMENTS["planner"]

    // when - accessing planner requirement
    // then - fallbackChain exists with claude-opus-4-6 as first entry
    expect(planner).toBeDefined()
    expect(planner.fallbackChain).toBeArray()
    expect(planner.fallbackChain.length).toBeGreaterThan(0)

    const primary = planner.fallbackChain[0]
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.providers[0]).toBe("anthropic")
    expect(primary.variant).toBe("max")
  })

  test("executor requires openai/github-copilot/opencode provider", () => {
    // #given - executor agent requirement
    const executor = AGENT_MODEL_REQUIREMENTS["executor"]

    // #when - accessing executor requirement
    // #then - requiresProvider is set (not requiresModel)
    expect(executor).toBeDefined()
    expect(executor.requiresProvider).toEqual(["openai", "github-copilot", "opencode"])
    expect(executor.requiresModel).toBeUndefined()
  })

  test("all 10 builtin agents have valid fallbackChain arrays", () => {
    // #given - list of 10 agent names
    const expectedAgents = [
      "orchestrator",
      "workflow-automator",
      "executor",
      "advisor",
      "librarian",
      "navigator",
      "interpreter",
      "planner",
      "scope-analyst",
      "reviewer",
    ]

    // when - checking AGENT_MODEL_REQUIREMENTS
    const definedAgents = Object.keys(AGENT_MODEL_REQUIREMENTS)

    // #then - all agents present with valid fallbackChain
    expect(definedAgents).toHaveLength(10)
    for (const agent of expectedAgents) {
      const requirement = AGENT_MODEL_REQUIREMENTS[agent]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain has valid fallbackChain with gpt-5.3-codex as primary", () => {
    // given - ultrabrain category requirement
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when - accessing ultrabrain requirement
    // then - fallbackChain exists with gpt-5.3-codex as first entry
    expect(ultrabrain).toBeDefined()
    expect(ultrabrain.fallbackChain).toBeArray()
    expect(ultrabrain.fallbackChain.length).toBeGreaterThan(0)

    const primary = ultrabrain.fallbackChain[0]
    expect(primary.variant).toBe("xhigh")
    expect(primary.model).toBe("gpt-5.3-codex")
    expect(primary.providers[0]).toBe("openai")
  })

  test("deep has valid fallbackChain with gpt-5.3-codex as primary", () => {
    // given - deep category requirement
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when - accessing deep requirement
    // then - fallbackChain exists with gpt-5.3-codex as first entry, medium variant
    expect(deep).toBeDefined()
    expect(deep.fallbackChain).toBeArray()
    expect(deep.fallbackChain.length).toBeGreaterThan(0)

    const primary = deep.fallbackChain[0]
    expect(primary.variant).toBe("medium")
    expect(primary.model).toBe("gpt-5.3-codex")
    expect(primary.providers[0]).toBe("openai")
  })

  test("visual-engineering has valid fallbackChain with gemini-3-pro as primary", () => {
    // given - visual-engineering category requirement
    const visualEngineering = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when - accessing visual-engineering requirement
    // then - fallbackChain exists with gemini-3-pro as first entry
    expect(visualEngineering).toBeDefined()
    expect(visualEngineering.fallbackChain).toBeArray()
    expect(visualEngineering.fallbackChain.length).toBeGreaterThan(0)

    const primary = visualEngineering.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-pro")
  })

  test("quick has valid fallbackChain with claude-haiku-4-5 as primary", () => {
    // given - quick category requirement
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when - accessing quick requirement
    // then - fallbackChain exists with claude-haiku-4-5 as first entry
    expect(quick).toBeDefined()
    expect(quick.fallbackChain).toBeArray()
    expect(quick.fallbackChain.length).toBeGreaterThan(0)

    const primary = quick.fallbackChain[0]
    expect(primary.model).toBe("claude-haiku-4-5")
    expect(primary.providers[0]).toBe("anthropic")
  })

  test("unspecified-low has valid fallbackChain with claude-sonnet-4-5 as primary", () => {
    // given - unspecified-low category requirement
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when - accessing unspecified-low requirement
    // then - fallbackChain exists with claude-sonnet-4-5 as first entry
    expect(unspecifiedLow).toBeDefined()
    expect(unspecifiedLow.fallbackChain).toBeArray()
    expect(unspecifiedLow.fallbackChain.length).toBeGreaterThan(0)

    const primary = unspecifiedLow.fallbackChain[0]
    expect(primary.model).toBe("claude-sonnet-4-5")
    expect(primary.providers[0]).toBe("anthropic")
  })

  test("unspecified-high has valid fallbackChain with claude-opus-4-6 as primary", () => {
    // given - unspecified-high category requirement
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when - accessing unspecified-high requirement
    // then - fallbackChain exists with claude-opus-4-6 as first entry
    expect(unspecifiedHigh).toBeDefined()
    expect(unspecifiedHigh.fallbackChain).toBeArray()
    expect(unspecifiedHigh.fallbackChain.length).toBeGreaterThan(0)

    const primary = unspecifiedHigh.fallbackChain[0]
    expect(primary.model).toBe("claude-opus-4-6")
    expect(primary.variant).toBe("max")
    expect(primary.providers[0]).toBe("anthropic")
  })

  test("artistry has valid fallbackChain with gemini-3-pro as primary", () => {
    // given - artistry category requirement
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when - accessing artistry requirement
    // then - fallbackChain exists with gemini-3-pro as first entry
    expect(artistry).toBeDefined()
    expect(artistry.fallbackChain).toBeArray()
    expect(artistry.fallbackChain.length).toBeGreaterThan(0)

    const primary = artistry.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro")
    expect(primary.variant).toBe("high")
    expect(primary.providers[0]).toBe("google")
  })

  test("writing has valid fallbackChain with gemini-3-flash as primary", () => {
    // given - writing category requirement
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when - accessing writing requirement
    // then - fallbackChain exists with gemini-3-flash as first entry
    expect(writing).toBeDefined()
    expect(writing.fallbackChain).toBeArray()
    expect(writing.fallbackChain.length).toBeGreaterThan(0)

    const primary = writing.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-flash")
    expect(primary.providers[0]).toBe("google")
  })

  test("all 8 categories have valid fallbackChain arrays", () => {
    // given - list of 8 category names
    const expectedCategories = [
      "visual-engineering",
      "ultrabrain",
      "deep",
      "artistry",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ]

    // when - checking CATEGORY_MODEL_REQUIREMENTS
    const definedCategories = Object.keys(CATEGORY_MODEL_REQUIREMENTS)

    // then - all categories present with valid fallbackChain
    expect(definedCategories).toHaveLength(8)
    for (const category of expectedCategories) {
      const requirement = CATEGORY_MODEL_REQUIREMENTS[category]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("FallbackEntry type", () => {
  test("FallbackEntry structure is correct", () => {
    // given - a valid FallbackEntry object
    const entry: FallbackEntry = {
      providers: ["anthropic", "github-copilot", "opencode"],
      model: "claude-opus-4-6",
      variant: "high",
    }

    // when - accessing properties
    // then - all properties are accessible
    expect(entry.providers).toEqual(["anthropic", "github-copilot", "opencode"])
    expect(entry.model).toBe("claude-opus-4-6")
    expect(entry.variant).toBe("high")
  })

  test("FallbackEntry variant is optional", () => {
    // given - a FallbackEntry without variant
    const entry: FallbackEntry = {
      providers: ["opencode", "anthropic"],
      model: "glm-4.7-free",
    }

    // when - accessing variant
    // then - variant is undefined
    expect(entry.variant).toBeUndefined()
  })
})

describe("ModelRequirement type", () => {
  test("ModelRequirement structure with fallbackChain is correct", () => {
    // given - a valid ModelRequirement object
    const requirement: ModelRequirement = {
      fallbackChain: [
        { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["openai", "github-copilot"], model: "gpt-5.2", variant: "high" },
      ],
    }

    // when - accessing properties
    // then - fallbackChain is accessible with correct structure
    expect(requirement.fallbackChain).toBeArray()
    expect(requirement.fallbackChain).toHaveLength(2)
    expect(requirement.fallbackChain[0].model).toBe("claude-opus-4-6")
    expect(requirement.fallbackChain[1].model).toBe("gpt-5.2")
  })

  test("ModelRequirement variant is optional", () => {
    // given - a ModelRequirement without top-level variant
    const requirement: ModelRequirement = {
      fallbackChain: [{ providers: ["opencode"], model: "glm-4.7-free" }],
    }

    // when - accessing variant
    // then - variant is undefined
    expect(requirement.variant).toBeUndefined()
  })

  test("no model in fallbackChain has provider prefix", () => {
    // given - all agent and category requirements
    const allRequirements = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    // when - checking each model in fallbackChain
    // then - none contain "/" (provider prefix)
    for (const req of allRequirements) {
      for (const entry of req.fallbackChain) {
        expect(entry.model).not.toContain("/")
      }
    }
  })

   test("all fallbackChain entries have non-empty providers array", () => {
     // given - all agent and category requirements
     const allRequirements = [
       ...Object.values(AGENT_MODEL_REQUIREMENTS),
       ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
     ]

     // when - checking each entry in fallbackChain
     // then - all have non-empty providers array
     for (const req of allRequirements) {
       for (const entry of req.fallbackChain) {
         expect(entry.providers).toBeArray()
         expect(entry.providers.length).toBeGreaterThan(0)
       }
     }
   })
})

describe("requiresModel field in categories", () => {
  test("deep category has requiresModel set to gpt-5.3-codex", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when / #then
    expect(deep.requiresModel).toBe("gpt-5.3-codex")
  })

  test("artistry category has requiresModel set to gemini-3-pro", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when / #then
    expect(artistry.requiresModel).toBe("gemini-3-pro")
  })
})
