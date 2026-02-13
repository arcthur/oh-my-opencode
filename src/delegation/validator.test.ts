import { describe, it, expect } from "bun:test"
import {
  validateDelegationDecision,
  extractDelegationDecision,
  formatValidationWarnings,
} from "./validator"
import type { DelegationDecision, ValidationWarning } from "./types"

describe("extractDelegationDecision", () => {
  describe("#given valid delegation-decision block", () => {
    describe("#when JSON is well-formed", () => {
      it("#then should extract the decision correctly", () => {
        const content = `
Some text before

<delegation-decision>
{
  "agent": "navigator",
  "taskType": "exploration",
  "complexity": "simple",
  "domain": "general",
  "reason": "Need to navigator the codebase",
  "signals": ["exploration needed", "unfamiliar code"]
}
</delegation-decision>

Some text after
`
        const result = extractDelegationDecision(content)

        expect(result).not.toBeNull()
        expect(result?.agent).toBe("navigator")
        expect(result?.taskType).toBe("exploration")
        expect(result?.complexity).toBe("simple")
        expect(result?.domain).toBe("general")
        expect(result?.reason).toBe("Need to navigator the codebase")
        expect(result?.signals).toEqual(["exploration needed", "unfamiliar code"])
      })
    })

    describe("#when JSON has extra whitespace", () => {
      it("#then should still extract correctly", () => {
        const content = `<delegation-decision>
          {
            "agent": "advisor",
            "taskType": "debugging",
            "complexity": "complex",
            "domain": "backend",
            "reason": "After 2+ failed attempts",
            "signals": ["multiple failures"]
          }
        </delegation-decision>`

        const result = extractDelegationDecision(content)

        expect(result).not.toBeNull()
        expect(result?.agent).toBe("advisor")
        expect(result?.taskType).toBe("debugging")
      })
    })
  })

  describe("#given no delegation-decision block", () => {
    describe("#when content has no tags", () => {
      it("#then should return null", () => {
        const content = "Just some regular text without delegation decision"
        const result = extractDelegationDecision(content)
        expect(result).toBeNull()
      })
    })
  })

  describe("#given multiple delegation-decision blocks", () => {
    describe("#when content has two blocks", () => {
      it("#then should extract the last block", () => {
        const content = `
<delegation-decision>
{
  "agent": "navigator",
  "taskType": "exploration",
  "complexity": "simple",
  "domain": "general",
  "reason": "First decision",
  "signals": ["first"]
}
</delegation-decision>

Some text in between

<delegation-decision>
{
  "agent": "advisor",
  "taskType": "debugging",
  "complexity": "complex",
  "domain": "backend",
  "reason": "Second decision",
  "signals": ["second"]
}
</delegation-decision>
`
        const result = extractDelegationDecision(content)

        expect(result).not.toBeNull()
        expect(result?.agent).toBe("advisor")
        expect(result?.reason).toBe("Second decision")
      })
    })
  })

  describe("#given malformed JSON", () => {
    describe("#when JSON is invalid", () => {
      it("#then should return null", () => {
        const content = `<delegation-decision>
          { invalid json }
        </delegation-decision>`

        const result = extractDelegationDecision(content)
        expect(result).toBeNull()
      })
    })

    describe("#when required fields are missing", () => {
      it("#then should return null", () => {
        const content = `<delegation-decision>
          {
            "agent": "navigator",
            "taskType": "exploration"
          }
        </delegation-decision>`

        const result = extractDelegationDecision(content)
        expect(result).toBeNull()
      })
    })

    describe("#when signals is not an array", () => {
      it("#then should return null", () => {
        const content = `<delegation-decision>
          {
            "agent": "navigator",
            "taskType": "exploration",
            "complexity": "simple",
            "domain": "general",
            "reason": "Testing",
            "signals": "not an array"
          }
        </delegation-decision>`

        const result = extractDelegationDecision(content)
        expect(result).toBeNull()
      })
    })
  })
})

describe("validateDelegationDecision", () => {
  const createDecision = (overrides: Partial<DelegationDecision> = {}): DelegationDecision => ({
    agent: "navigator",
    taskType: "exploration",
    complexity: "simple",
    domain: "general",
    reason: "Test reason",
    signals: ["test signal"],
    ...overrides,
  })

  describe("#given navigator agent", () => {
    describe("#when used for exploration task", () => {
      it("#then should be valid", () => {
        const decision = createDecision({
          agent: "navigator",
          taskType: "exploration",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
        expect(result.warnings).toHaveLength(0)
      })
    })

    describe("#when used for debugging task", () => {
      it("#then should be valid (navigator supports debugging)", () => {
        const decision = createDecision({
          agent: "navigator",
          taskType: "debugging",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
      })
    })

    describe("#when used for implementation task", () => {
      it("#then should have task type mismatch warning", () => {
        const decision = createDecision({
          agent: "navigator",
          taskType: "implementation",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(false)
        expect(result.warnings.length).toBeGreaterThan(0)
        expect(result.warnings[0].type).toBe("task_type_mismatch")
      })
    })
  })

  describe("#given advisor agent", () => {
    describe("#when used for complex debugging", () => {
      it("#then should be valid", () => {
        const decision = createDecision({
          agent: "advisor",
          taskType: "debugging",
          complexity: "complex",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
      })
    })

    describe("#when used for trivial task", () => {
      it("#then should have overkill warning", () => {
        const decision = createDecision({
          agent: "advisor",
          taskType: "debugging",
          complexity: "trivial",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(false)
        expect(result.warnings.some((w) => w.type === "overkill")).toBe(true)
      })
    })

    describe("#when used for simple task", () => {
      it("#then should have overkill warning", () => {
        const decision = createDecision({
          agent: "advisor",
          taskType: "debugging",
          complexity: "simple",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(false)
        expect(result.warnings.some((w) => w.type === "overkill")).toBe(true)
      })
    })

    describe("#when used for exploration task", () => {
      it("#then should have task type mismatch warning", () => {
        const decision = createDecision({
          agent: "advisor",
          taskType: "exploration",
          complexity: "complex",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(false)
        expect(result.warnings.some((w) => w.type === "task_type_mismatch")).toBe(true)
      })
    })
  })

  describe("#given librarian agent", () => {
    describe("#when used for research task", () => {
      it("#then should be valid", () => {
        const decision = createDecision({
          agent: "librarian",
          taskType: "research",
          domain: "external",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
      })
    })

    describe("#when used for exploration task", () => {
      it("#then should be valid", () => {
        const decision = createDecision({
          agent: "librarian",
          taskType: "exploration",
          domain: "general",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#given unknown agent", () => {
    describe("#when agent has no validation rules", () => {
      it("#then should pass validation (no rules to violate)", () => {
        const decision = createDecision({
          agent: "unknown-agent" as DelegationDecision["agent"],
          taskType: "implementation",
        })

        const result = validateDelegationDecision(decision)

        expect(result.valid).toBe(true)
      })
    })
  })

})

describe("formatValidationWarnings", () => {
  describe("#given empty warnings", () => {
    it("#then should return empty string", () => {
      const result = formatValidationWarnings([])
      expect(result).toBe("")
    })
  })

  describe("#given warnings without suggestions", () => {
    it("#then should format without suggestion", () => {
      const warnings: ValidationWarning[] = [
        {
          type: "overkill",
          message: "advisor is expensive",
        },
      ]

      const result = formatValidationWarnings(warnings)

      expect(result).toBe("- overkill: advisor is expensive")
    })
  })

  describe("#given warnings with suggestions", () => {
    it("#then should include suggestion in parentheses", () => {
      const warnings: ValidationWarning[] = [
        {
          type: "overkill",
          message: "advisor is expensive",
          suggestion: "Use navigator instead",
        },
      ]

      const result = formatValidationWarnings(warnings)

      expect(result).toBe("- overkill: advisor is expensive (Use navigator instead)")
    })
  })

  describe("#given multiple warnings", () => {
    it("#then should format each on separate line", () => {
      const warnings: ValidationWarning[] = [
        { type: "overkill", message: "Too expensive" },
        { type: "task_type_mismatch", message: "Wrong task type", suggestion: "Use different agent" },
      ]

      const result = formatValidationWarnings(warnings)

      expect(result).toContain("- overkill: Too expensive")
      expect(result).toContain("- task_type_mismatch: Wrong task type (Use different agent)")
      expect(result.split("\n")).toHaveLength(2)
    })
  })
})
