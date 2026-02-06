import { describe, expect, test } from "bun:test"
import { createSisyphusJuniorAgentWithOverrides, SISYPHUS_JUNIOR_DEFAULTS } from "./sisyphus-junior"

const TEST_SYSTEM_DEFAULT_MODEL = "google/gemini-3-pro"

describe("createSisyphusJuniorAgentWithOverrides", () => {
  describe("honored fields", () => {
    test("applies model override", () => {
      // given
      const override = { model: "openai/gpt-5.2" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.model).toBe("openai/gpt-5.2")
    })

    test("applies temperature override", () => {
      // given
      const override = { temperature: 0.5 }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.temperature).toBe(0.5)
    })

    test("applies top_p override", () => {
      // given
      const override = { top_p: 0.9 }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.top_p).toBe(0.9)
    })

    test("applies description override", () => {
      // given
      const override = { description: "Custom description" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.description).toBe("Custom description")
    })

    test("applies color override", () => {
      // given
      const override = { color: "#FF0000" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.color).toBe("#FF0000")
    })

    test("appends prompt_append to base prompt", () => {
      // given
      const override = { prompt_append: "Extra instructions here" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).toContain("Extra instructions here")
    })
  })

  describe("defaults", () => {
    test("uses systemDefaultModel when no override", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.model).toBe(TEST_SYSTEM_DEFAULT_MODEL)
    })

    test("falls back to built-in default model when systemDefaultModel is missing", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, undefined)

      // then
      expect(result.model).toBe(SISYPHUS_JUNIOR_DEFAULTS.model)
    })

    test("uses default temperature when no override", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("disable semantics", () => {
    test("disable: true causes override block to be ignored, uses systemDefaultModel", () => {
      // given
      const override = {
        disable: true,
        model: "openai/gpt-5.2",
        temperature: 0.9,
      }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then - systemDefaultModel should be used, not the overrides
      expect(result.model).toBe(TEST_SYSTEM_DEFAULT_MODEL)
      expect(result.temperature).toBe(SISYPHUS_JUNIOR_DEFAULTS.temperature)
    })
  })

  describe("constrained fields", () => {
    test("mode is forced to subagent", () => {
      // given
      const override = { mode: "primary" as const }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.mode).toBe("subagent")
    })

    test("prompt override is ignored (discipline text preserved)", () => {
      // given
      const override = { prompt: "Completely new prompt that replaces everything" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).not.toBe("Completely new prompt that replaces everything")
    })
  })

  describe("tool safety (task blocked, delegate_task research-scoped)", () => {
    test("task remains blocked, delegate_task is allowed (research-scoped) via tools format", () => {
      // given
      const override = {
        tools: {
          task: true,
          delegate_task: true,
          read: true,
        },
      }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
        // delegate_task is allowed (research scope enforced by tool, not permission)
        expect(tools.delegate_task).not.toBe(false)
        expect(tools.read).toBe(true)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        // delegate_task is "allow" (normalized from "research" for host)
        expect(permission.delegate_task).toBe("allow")
      }
    })

    test("task remains blocked when using permission format override", () => {
      // given
      const override = {
        permission: {
          task: "allow",
          delegate_task: "allow",
          read: "allow",
        },
      } as { permission: Record<string, string> }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override as Parameters<typeof createSisyphusJuniorAgentWithOverrides>[0], TEST_SYSTEM_DEFAULT_MODEL)

      // then - task blocked, delegate_task allowed (research-scoped at tool level)
      const tools = result.tools as Record<string, boolean> | undefined
      const permission = result.permission as Record<string, string> | undefined
      if (tools) {
        expect(tools.task).toBe(false)
      }
      if (permission) {
        expect(permission.task).toBe("deny")
        // delegate_task normalized to "allow" for host (research scope enforced by tool)
        expect(permission.delegate_task).toBe("allow")
      }
    })
  })

  describe("prompt composition", () => {
    test("base prompt contains discipline constraints", () => {
      // given
      const override = {}

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      expect(result.prompt).toContain("Sisyphus-Junior")
      expect(result.prompt).toContain("You work ALONE")
      expect(result.prompt).toContain("BLOCKED ACTIONS")
      expect(result.prompt).toContain("RESEARCH-ONLY")
    })

    test("prompt_append is added after base prompt", () => {
      // given
      const override = { prompt_append: "CUSTOM_MARKER_FOR_TEST" }

      // when
      const result = createSisyphusJuniorAgentWithOverrides(override, TEST_SYSTEM_DEFAULT_MODEL)

      // then
      const baseEndIndex = result.prompt!.indexOf("Dense > verbose.")
      const appendIndex = result.prompt!.indexOf("CUSTOM_MARKER_FOR_TEST")
      expect(baseEndIndex).not.toBe(-1) // Guard: anchor text must exist in base prompt
      expect(appendIndex).toBeGreaterThan(baseEndIndex)
    })
  })
})
