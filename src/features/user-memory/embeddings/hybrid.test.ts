import { describe, test, expect } from "bun:test"
import { normalizeScoresMinMax } from "./hybrid"

describe("embeddings/hybrid", () => {
  describe("normalizeScoresMinMax", () => {
    test("maps min->0 and max->1", () => {
      //#given
      const scores = [0.2, 0.4, 0.3]

      //#when
      const normalized = normalizeScoresMinMax(scores)

      //#then
      expect(normalized).toHaveLength(3)
      expect(normalized[0]).toBe(0) // min
      expect(normalized[1]).toBe(1) // max
      expect(normalized[2]).toBeCloseTo(0.5, 5)
    })

    test("returns 0.5 for all when scores are identical", () => {
      //#given
      const scores = [0.1, 0.1, 0.1]

      //#when
      const normalized = normalizeScoresMinMax(scores)

      //#then
      expect(normalized).toEqual([0.5, 0.5, 0.5])
    })
  })
})

