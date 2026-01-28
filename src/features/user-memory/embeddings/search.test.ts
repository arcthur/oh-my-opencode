import { describe, test, expect } from "bun:test"
import { cosineSimilarity, rawCosineSimilarity } from "./search"

describe("embeddings/search", () => {
  describe("cosineSimilarity", () => {
    test("returns 1 for identical vectors", () => {
      //#given
      const a = [1, 0, 0]
      const b = [1, 0, 0]

      //#when
      const score = cosineSimilarity(a, b)

      //#then
      expect(score).toBe(1)
    })

    test("returns 0 for orthogonal vectors (no 0.5 baseline)", () => {
      //#given
      const a = [1, 0, 0]
      const b = [0, 1, 0]

      //#when
      const score = cosineSimilarity(a, b)

      //#then
      expect(score).toBe(0)
    })

    test("returns 0 for opposite vectors (negative correlation clamped)", () => {
      //#given
      const a = [1, 0, 0]
      const b = [-1, 0, 0]

      //#when
      const score = cosineSimilarity(a, b)

      //#then
      expect(score).toBe(0)
    })
  })

  describe("rawCosineSimilarity", () => {
    test("returns -1..1 raw cosine", () => {
      //#given
      const a = [1, 0, 0]
      const b = [-1, 0, 0]

      //#when
      const score = rawCosineSimilarity(a, b)

      //#then
      expect(score).toBe(-1)
    })
  })
})

