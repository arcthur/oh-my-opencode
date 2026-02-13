import { describe, expect, it } from "bun:test"
import {
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildToolSelectionTable,
  type AvailableAgent,
  type AvailableCategory,
  type AvailableSkill,
} from "./dynamic-agent-prompt-builder"

describe("dynamic agent prompt markdown safety", () => {
  it("escapes markdown table delimiters in category and skill rows", () => {
    // #given
    const categories: AvailableCategory[] = [
      { name: "front|end", description: "UI line1\nline2" },
    ]
    const skills: AvailableSkill[] = [
      { name: "skill|name", description: "A|B\nC", location: "project" },
    ]

    // #when
    const output = buildCategorySkillsDelegationGuide(categories, skills)

    // #then
    expect(output).toContain("front\\|end")
    expect(output).toContain("UI line1 line2")
    expect(output).toContain("skill\\|name")
    expect(output).toContain("A\\|B C")
    expect(output).not.toContain("A|B\nC")
  })

  it("escapes table content in agent selection and delegation tables", () => {
    // #given
    const agents: AvailableAgent[] = [
      {
        name: "advisor",
        description: "Root cause | analysis\nwith edge cases.",
        metadata: {
          category: "advisor",
          cost: "CHEAP",
          triggers: [
            {
              domain: "Debug | incidents",
              trigger: "When RCA\nis needed",
            },
          ],
        },
      },
    ]

    // #when
    const selection = buildToolSelectionTable(agents, [])
    const delegation = buildDelegationTable(agents)

    // #then
    expect(selection).toContain("Root cause \\| analysis with edge cases")
    expect(selection).not.toContain("analysis\nwith edge")
    expect(delegation).toContain("Debug \\| incidents")
    expect(delegation).toContain("When RCA is needed")
  })
})
