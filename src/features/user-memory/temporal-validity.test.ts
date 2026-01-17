import { describe, expect, test } from "bun:test"
import { calculateStaleness } from "./temporal-validity"
import { STALENESS_HALF_LIFE_MS } from "./types"

describe("temporal-validity", () => {
  describe("calculateStaleness", () => {
    test("returns ~0.5 at configured half-life", () => {
      //#given
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const fact = {
        valid_from: 0,
        lastReinforced: 0,
        staleness_category: "short-term" as const,
      }

      //#when
      const staleness = calculateStaleness(fact, halfLifeMs)

      //#then
      expect(staleness).toBeGreaterThan(0.49)
      expect(staleness).toBeLessThan(0.51)
    })

    test("returns ~0.75 at 2x half-life", () => {
      //#given
      const halfLifeMs = STALENESS_HALF_LIFE_MS["short-term"]
      const fact = {
        valid_from: 0,
        lastReinforced: 0,
        staleness_category: "short-term" as const,
      }

      //#when
      const staleness = calculateStaleness(fact, 2 * halfLifeMs)

      //#then
      expect(staleness).toBeGreaterThan(0.74)
      expect(staleness).toBeLessThan(0.76)
    })
  })
})

