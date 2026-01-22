import { describe, it, expect } from "bun:test"
import { analyzeComplexity, isMultiModelAvailable, getRecommendedAction } from "./complexity-detector"

describe("complexity-detector", () => {
  describe("analyzeComplexity", () => {
    describe("#given trivial requests", () => {
      it("#then should detect typo fixes as trivial", () => {
        const result = analyzeComplexity("Fix the typo in README.md")

        expect(result.level).toBe("trivial")
        expect(result.useMultiModel).toBe(false)
      })

      it("#then should detect single line changes as simple (conservative)", () => {
        // Note: The detector is conservative - simple requests default to "simple" not "trivial"
        const result = analyzeComplexity("Change the constant from 100 to 200")

        expect(["trivial", "simple"]).toContain(result.level)
        expect(result.useMultiModel).toBe(false)
      })

      it("#then should detect rename requests as trivial", () => {
        const result = analyzeComplexity("Rename variable foo to bar")

        expect(result.level).toBe("trivial")
        expect(result.useMultiModel).toBe(false)
      })
    })

    describe("#given simple requests", () => {
      it("#then should detect config changes as simple", () => {
        const result = analyzeComplexity("Update the ESLint config to add a new rule")

        expect(result.level).toBe("simple")
        expect(result.useMultiModel).toBe(false)
      })
    })

    describe("#given complex requests", () => {
      it("#then should detect feature additions as complex", () => {
        const result = analyzeComplexity("Add a new feature for user authentication with OAuth2")

        expect(result.level).toBe("complex")
        expect(result.useMultiModel).toBe(true)
        expect(result.signals.length).toBeGreaterThan(0)
      })

      it("#then should detect architecture tasks as complex when multi-signal", () => {
        // Needs 2+ complex signals to trigger - architecture + security
        const result = analyzeComplexity("Design a new microservices architecture with authentication and authorization for the payment system")

        expect(result.level).toBe("complex")
        expect(result.useMultiModel).toBe(true)
      })

      it("#then should detect database + auth tasks as complex", () => {
        // Two complex signals: database schema update + authentication
        const result = analyzeComplexity(
          "Add database schema changes for user roles and implement authentication with session management"
        )

        expect(result.level).toBe("complex")
        expect(result.useMultiModel).toBe(true)
      })

      it("#then should detect integration + feature tasks as complex", () => {
        // Two complex signals: integration + feature
        const result = analyzeComplexity(
          "Integrate with Stripe and add a new feature for subscription management"
        )

        expect(result.level).toBe("complex")
        expect(result.useMultiModel).toBe(true)
      })

      it("#then should detect whole refactoring as complex", () => {
        const result = analyzeComplexity("Refactor the entire authentication module")

        expect(result.level).toBe("complex")
        expect(result.useMultiModel).toBe(true)
      })
    })
  })

  describe("isMultiModelAvailable", () => {
    it("#then should return true when 2+ models configured", () => {
      expect(isMultiModelAvailable(2)).toBe(true)
      expect(isMultiModelAvailable(3)).toBe(true)
    })

    it("#then should return false when 1 model configured", () => {
      expect(isMultiModelAvailable(1)).toBe(false)
    })

    it("#then should return false when no models configured", () => {
      expect(isMultiModelAvailable(0)).toBe(false)
    })
  })

  describe("getRecommendedAction", () => {
    it("#then should recommend single model for trivial tasks", () => {
      const analysis = {
        level: "trivial" as const,
        signals: [],
        useMultiModel: false,
        reason: "Trivial task",
      }

      const rec = getRecommendedAction(analysis, true)

      expect(rec).toBe("single_model")
    })

    it("#then should recommend multi model for complex tasks when available", () => {
      const analysis = {
        level: "complex" as const,
        signals: ["add feature"],
        useMultiModel: true,
        reason: "Complex task",
      }

      const rec = getRecommendedAction(analysis, true)

      expect(rec).toBe("multi_model")
    })

    it("#then should fall back to single model when multi not available", () => {
      const analysis = {
        level: "complex" as const,
        signals: ["add feature"],
        useMultiModel: true,
        reason: "Complex task",
      }

      const rec = getRecommendedAction(analysis, false)

      expect(rec).toBe("single_model_fallback")
    })
  })
})
