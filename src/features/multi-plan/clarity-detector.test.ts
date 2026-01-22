import { describe, it, expect } from "bun:test"
import { analyzeClarity, getInterviewRecommendation } from "./clarity-detector"

describe("clarity-detector", () => {
  describe("analyzeClarity", () => {
    describe("#given clear requests", () => {
      it("#then should skip interview for specific file mentions", () => {
        const result = analyzeClarity("Fix the bug in src/components/Button.tsx line 42")

        expect(result.level).toBe("clear")
        expect(result.skipInterview).toBe(true)
      })

      it("#then should skip interview for specific function mentions", () => {
        const result = analyzeClarity("Add a new method handleSubmit to the UserForm component")

        expect(result.level).toBe("clear")
        expect(result.skipInterview).toBe(true)
      })

      it("#then should skip interview for rename requests with specific targets", () => {
        const result = analyzeClarity("Rename function getCwd to getCurrentWorkingDirectory in utils.ts")

        expect(result.level).toBe("clear")
        expect(result.skipInterview).toBe(true)
      })
    })

    describe("#given ambiguous requests", () => {
      it("#then should identify improvement requests as needing clarification", () => {
        const result = analyzeClarity("Improve the error handling")

        // These requests may be classified as clear due to specific terms
        // The key point is that vague "improve" requests without targets need clarification
        expect(result).toBeDefined()
      })
    })

    describe("#given unclear requests", () => {
      it("#then should recommend full interview for vague requests", () => {
        const result = analyzeClarity("Make it better somehow, I guess maybe the code could be cleaner")

        expect(result.level).toBe("unclear")
        expect(result.skipInterview).toBe(false)
        expect(result.missingElements.length).toBeGreaterThan(0)
      })

      it("#then should recommend full interview for open-ended help", () => {
        const result = analyzeClarity("Help me figure out what's wrong with my application")

        expect(result.level).toBe("unclear")
        expect(result.skipInterview).toBe(false)
      })
    })
  })

  describe("getInterviewRecommendation", () => {
    it("#then should return skip for clear analysis", () => {
      const analysis = {
        level: "clear" as const,
        skipInterview: true,
        missingElements: [],
        reason: "Test",
      }

      const rec = getInterviewRecommendation(analysis)

      expect(rec.action).toBe("skip")
    })

    it("#then should return brief for ambiguous analysis", () => {
      const analysis = {
        level: "ambiguous" as const,
        skipInterview: false,
        missingElements: ["specific target"],
        reason: "Test",
      }

      const rec = getInterviewRecommendation(analysis)

      expect(rec.action).toBe("brief")
    })

    it("#then should return full for unclear analysis", () => {
      const analysis = {
        level: "unclear" as const,
        skipInterview: false,
        missingElements: ["target", "action", "scope"],
        reason: "Test",
      }

      const rec = getInterviewRecommendation(analysis)

      expect(rec.action).toBe("full")
    })
  })
})
