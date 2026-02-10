import { describe, expect, test } from "bun:test"
import {
  argsToConfig,
  detectedToInitialValues,
  validateNonTuiArgs,
} from "./install-validators"
import type { DetectedConfig, InstallArgs } from "./types"

describe("install-validators", () => {
  test("validateNonTuiArgs requires claude, gemini, and copilot", () => {
    // #given
    const args: InstallArgs = {
      tui: false,
    }

    // #when
    const result = validateNonTuiArgs(args)

    // #then
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("--claude is required (values: no, yes, max20)")
    expect(result.errors).toContain("--gemini is required (values: no, yes)")
    expect(result.errors).toContain("--copilot is required (values: no, yes)")
  })

  test("argsToConfig maps CLI flags to installer config", () => {
    // #given
    const args: InstallArgs = {
      tui: false,
      claude: "max20",
      openai: "yes",
      gemini: "yes",
      copilot: "no",
      opencodeZen: "yes",
      zaiCodingPlan: "yes",
      kimiForCoding: "no",
    }

    // #when
    const config = argsToConfig(args)

    // #then
    expect(config).toEqual({
      hasClaude: true,
      isMax20: true,
      hasOpenAI: true,
      hasGemini: true,
      hasCopilot: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: true,
      hasKimiForCoding: false,
    })
  })

  test("detectedToInitialValues maps detected max20 state", () => {
    // #given
    const detected: DetectedConfig = {
      isInstalled: true,
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: true,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: true,
      hasKimiForCoding: true,
    }

    // #when
    const initial = detectedToInitialValues(detected)

    // #then
    expect(initial).toEqual({
      claude: "max20",
      openai: "no",
      gemini: "yes",
      copilot: "no",
      opencodeZen: "no",
      zaiCodingPlan: "yes",
      kimiForCoding: "yes",
    })
  })
})
